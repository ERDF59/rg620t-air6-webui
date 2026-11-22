#!/bin/sh
# Real rpcd/ubus/uhttpd, loopback only, with synthetic modem snapshots.
set -eu
src="$1/backend/cellular/root"
tmp="$(mktemp -d /tmp/rg620-sse.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p /var/run "$tmp/www/cgi-bin" "$tmp/state"
printf 'dlink,dwr-be7200g\n' > "$tmp/board"
printf 'root:fixture-only:0:0:0:0:::\n' > "$tmp/shadow"
sed -e "s|/tmp/sysinfo/board_name|$tmp/board|g" -e "s|/etc/shadow|$tmp/shadow|g" \
    -e "s|/tmp/dlink-cellular-events|$tmp/state|g" \
    -e "s|/usr/libexec/dlink-cellular-event-access.uc|$src/usr/libexec/dlink-cellular-event-access.uc|g" \
    "$src/www/cgi-bin/rg620-events" > "$tmp/www/cgi-bin/rg620-events"
chmod 755 "$tmp/www/cgi-bin/rg620-events"
ubusd &
sleep 1
rpcd &
uhttpd -f -p 127.0.0.1:8180 -h "$tmp/www" -x /cgi-bin -n 3 -t 30 &
sleep 1

session() { ubus call session create '{"timeout":90}' | jsonfilter -e '@.ubus_rpc_session'; }
bad=11111111111111111111111111111111
anon=00000000000000000000000000000000
no_acl="$(session)"
network="$(session)"
admin="$(session)"
grant() {
  ubus call session grant '{"ubus_rpc_session":"'"$1"'","scope":"ubus","objects":[["dlink-cellular","'"$2"'"]]}'
}
grant "$network" overview
grant "$admin" overview
grant "$admin" events_sms
stamp="$(cut -d. -f1 /proc/uptime)"
for name in heartbeat network.at sms.at; do printf '%s\n' "$stamp" > "$tmp/state/$name"; done
printf '{"ok":true,"nr":{"rsrp":-101}}\n' > "$tmp/state/network"
printf '%s\n' "$stamp" > "$tmp/state/sms"
url=http://127.0.0.1:8180/cgi-bin/rg620-events
post() {
  exec uclient-fetch -O - -T 4 --header='Content-Type: text/plain' --post-data="$1" "$url"
}
for invalid in "$anon:NS" "$bad:NS" "$no_acl:NS"; do
  if (post "$invalid") > "$tmp/denied" 2>&1; then echo 'unexpected auth' >&2; exit 1; fi
  grep -q '403' "$tmp/denied" || { cat "$tmp/denied" >&2; exit 1; }
  ! grep -q 'event:' "$tmp/denied"
done
post "$network:NS" > "$tmp/network" 2>"$tmp/network.log" &
reader=$!
sleep 2
grep -q 'event: network' "$tmp/network"
grep -q '"network":true,"sms":false' "$tmp/network"
! grep -q 'event: sms' "$tmp/network"
# Exclusive stream lease; another browser must fall back, not fill all CGI slots.
if (post "$admin:NS") > "$tmp/busy" 2>&1; then echo 'unexpected concurrent stream' >&2; exit 1; fi
grep -q '503' "$tmp/busy"
kill "$reader"
sleep 2
post "$admin:NS" > "$tmp/admin" 2>"$tmp/admin.log" &
reader=$!
sleep 2
grep -q -- '-101' "$tmp/admin" || { cat "$tmp/admin.log" >&2; exit 1; }
grep -q 'event: sms' "$tmp/admin"
grep -q '"network":true,"sms":true' "$tmp/admin"
! grep -q -E 'pdu|indexes|ubus_rpc_session' "$tmp/admin"
kill "$reader"
echo 'PASS: real CGI streams incrementally, verifies rpcd ACL, rejects anonymous/unknown sessions and caps stream concurrency'
