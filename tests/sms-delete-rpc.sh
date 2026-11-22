#!/bin/sh
# Run in an isolated OpenWrt container with the checkout mounted read-only.
set -eu
src="$1"
rpc="$src/backend/cellular/root/usr/libexec/rpcd/dlink-cellular"
acl="$src/backend/cellular/root/usr/share/rpcd/acl.d/luci-app-dlink-cellular.json"
has() { grep -Fxq "$1"; }
check_eq() { [ "$1" = "$2" ] || { printf 'expected %s; got %s\n' "$2" "$1" >&2; exit 1; }; }
[ "$(sh "$rpc" list | jsonfilter -e '@.sms_delete.confirm')" = true ] ||
  { echo 'sms_delete is missing from the RPC method schema' >&2; exit 1; }
jsonfilter -i "$acl" -e '@["luci-app-dlink-cellular-private"].write.ubus["dlink-cellular"][*]' | has sms_delete
if jsonfilter -i "$acl" -e '@.*.read.ubus["dlink-cellular"][*]' | has sms_delete; then
  echo 'sms_delete must not be granted to a read ACL' >&2
  exit 1
fi
fixture="$(mktemp -d /tmp/sms-rpc.XXXXXX)"
export SMS_TEST_CALLS="$fixture/calls"
printf '%s\n' dlink,dwr-be7200g > "$fixture/board"
printf '%s\n' 'root:fixture-value:0:0:0:0:::' > "$fixture/shadow"
sed -e "s|/tmp/sysinfo/board_name|$fixture/board|g" \
    -e "s|/etc/shadow|$fixture/shadow|g" \
    -e "s|/usr/libexec/dlink-sms-delete|$fixture/helper|g" "$rpc" > "$fixture/rpc"
cat > "$fixture/helper" <<'HELPER'
#!/bin/sh
if [ "$1" = --group ]; then
  cat >> "$SMS_TEST_CALLS"
else
  IFS= read -r pdu
  printf '%s %s\n' "$1" "$pdu" >> "$SMS_TEST_CALLS"
fi
printf '%s\n' '{"ok":true}'
HELPER
chmod 700 "$fixture/helper"
rpc_call() { printf '%s\n' "$1" | sh "$fixture/rpc" call sms_delete; }
failure() { rpc_call "$1" | jsonfilter -e '@.error'; }
printf '%s\n' 'root:!:0:0:0:0:::' > "$fixture/shadow"
check_eq "$(failure '{"index":7,"pdu":"A1B203","confirm":true}')" password_required
printf '%s\n' 'root:fixture-value:0:0:0:0:::' > "$fixture/shadow"
check_eq "$(failure '{"index":7,"pdu":"A1B203"}')" confirm
check_eq "$(failure '{"index":7,"pdu":"A1B203","confirm":false}')" confirm
check_eq "$(failure '{"index":7,"pdu":"A1B203","confirm":1}')" confirm
check_eq "$(failure '{"index":"7","pdu":"A1B203","confirm":true}')" input
check_eq "$(failure '{"index":7,"pdu":"not-hex","confirm":true}')" input
[ ! -e "$SMS_TEST_CALLS" ]
check_eq "$(rpc_call '{"index":7,"pdu":"A1B203","confirm":true}' | jsonfilter -e '@.ok')" true
check_eq "$(cat "$SMS_TEST_CALLS")" '7 A1B203'
echo 'PASS: write-only SMS RPC, confirmed input and private PDU pipe'

: > "$SMS_TEST_CALLS"
check_eq "$(failure '{"records":[{"index":12,"pdu":"A1B203"},{"index":14,"pdu":"A1B203"}],"confirm":false}')" confirm
check_eq "$(failure '{"records":[],"confirm":true}')" input
check_eq "$(failure '{"records":{"index":12,"pdu":"A1B203"},"confirm":true}')" input
check_eq "$(failure '{"records":[{"index":12,"pdu":"A1B203"},{"index":14,"pdu":"nothex"}],"confirm":true}')" input
check_eq "$(failure '{"index":12,"records":[{"index":12,"pdu":"A1B203"}],"confirm":true}')" input
[ ! -s "$SMS_TEST_CALLS" ]
check_eq "$(rpc_call '{"records":[{"index":12,"pdu":"A1B203"},{"index":14,"pdu":"A1B203"}],"confirm":true}' | jsonfilter -e '@.ok')" true
check_eq "$(cat "$SMS_TEST_CALLS")" "$(printf '2\n12 A1B203\n14 A1B203')"
echo 'PASS: grouped request reaches the helper once with a complete framed payload'
