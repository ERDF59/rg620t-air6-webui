#!/bin/sh
set -eu
root="$1/backend/cellular/root/usr/libexec"
tmp="$(mktemp -d /tmp/rg620-qos.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
sed -e "s|/usr/bin/mipc_wan_cli|$tmp/modem|g" -e "s|/var/lock/dlink-cellular.lock|$tmp/lock|g" \
    -e "s|/usr/libexec/dlink-cellular-qos.awk|$root/dlink-cellular-qos.awk|g" "$root/dlink-cellular-qos" > "$tmp/qos"
cat > "$tmp/modem" <<'M'
#!/bin/sh
case "$2" in
  'AT+CGCONTRDP') printf '+CGCONTRDP: 0,,"Lab.MNC001.MCC460.GPRS"\r\n+CGCONTRDP: 1,,"ims.lab"\r\nOK\r\n';;
  'AT+C5GQOSRDP=0') printf '+C5GQOSRDP: 0,6\r\nOK\r\n';;
  'AT+CGEQOSRDP=0') printf '+CGEQOSRDP: 0,9\r\nOK\r\n';;
  *) printf 'ERROR\r\n';;
esac
M
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$tmp/timeout"
printf '#!/bin/sh\nexec /usr/bin/flock -n "$3"\n' > "$tmp/flock"
chmod 700 "$tmp/modem" "$tmp/timeout" "$tmp/flock"
export PATH="$tmp:$PATH"
legacy="$(sh "$tmp/qos" '5G SA')"
full="$(sh "$tmp/qos" '5G SA' 1)"
lte="$(sh "$tmp/qos" LTE 1)"
read_field() { printf '%s\n' "$1" | jsonfilter -e "$2"; }
[ "$(read_field "$legacy" '@.sessions[0].apn')" = lab ]
[ -z "$(read_field "$legacy" '@.sessions[1].apn')" ]
[ "$(read_field "$full" '@.sessions[0].apn')" = Lab.MNC001.MCC460.GPRS ]
[ "$(read_field "$full" '@.sessions[1].role')" = ims ]
[ -z "$(read_field "$full" '@.sessions[1].classes[0]')" ]
[ "$(read_field "$full" '@.kind')" = 5QI ]
[ "$(read_field "$full" '@.sessions[0].classes[0]')" = 6 ]
[ "$(read_field "$lte" '@.kind')" = QCI ]
[ "$(read_field "$lte" '@.sessions[0].classes[0]')" = 9 ]
echo 'PASS: legacy LuCI QoS contract preserved, actual APN and missing QoS included on opt-in; SA and LTE decode separately'
