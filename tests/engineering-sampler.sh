#!/bin/sh
# Test the shared device-side sampler in OpenWrt with synthetic snapshots.
set -eu
src="$1/backend/cellular/root"
tmp="$(mktemp -d /tmp/rg620-sample.XXXXXX)"
sampler=
trap '[ -z "$sampler" ] || kill "$sampler" 2>/dev/null || :; rm -rf "$tmp"' EXIT
sed -e "s|/tmp/dlink-cellular-events|$tmp/state|g" \
  -e "s|/usr/libexec/dlink-cellular |$tmp/modem |g" "$src/usr/libexec/dlink-cellular-events" > "$tmp/service"
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$tmp/timeout"
cat > "$tmp/modem" <<'MODEM'
#!/bin/sh
printf '%s\n' "$1" >> "$FIXTURE/calls"
case "$1" in
  overview) printf '{"ok":true,"register":{"rat":"5G SA"},"nr":{"rsrp":-101}}\n';;
  sms_list) printf '{"ok":true,"used":1,"indexes":[7]}\n';;
esac
MODEM
chmod 755 "$tmp/modem" "$tmp/timeout"
export PATH="$tmp:$PATH" FIXTURE="$tmp"
sh "$tmp/service" &
sampler=$!
sleep 2
[ -f "$tmp/state/heartbeat" ]
[ ! -e "$tmp/calls" ]
now="$(cut -d. -f1 /proc/uptime)"
for key in network sms; do printf '%s\n' "$((now+5))" > "$tmp/state/lease.$key"; done
sleep 3
[ "$(jsonfilter -i "$tmp/state/network" -e '@.nr.rsrp')" = -101 ]
grep -qE '^[0-9]+$' "$tmp/state/sms"
[ "$(cat "$tmp/calls")" = "$(printf 'overview\nsms_list')" ]
! grep -q 'indexes' "$tmp/state/sms"
echo 'PASS: no modem reads without lease; one shared sample per channel and SMS change marker only'
