#!/bin/sh
# Isolated OpenWrt userspace; no real modem, UCI, web server or router.
set -eu
src="$1"
root="$src/backend/cellular/root"
rpc="$root/usr/libexec/rpcd/dlink-cellular"
acl="$root/usr/share/rpcd/acl.d/luci-app-dlink-cellular.json"
tmp="$(mktemp -d /tmp/rg620-eng.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
eq() { [ "$1" = "$2" ] || { printf 'expected %s, got %s\n' "$2" "$1" >&2; exit 1; }; }
has() { grep -Fxq "$1"; }
for method in mimo_set scan_start scan_stop wifi_power_set wifi_flag_set wan_auto_set; do
    eq "$(sh "$rpc" list | jsonfilter -e "@.$method.confirm")" true
    jsonfilter -i "$acl" -e '@["luci-app-dlink-cellular-private"].write.ubus["dlink-cellular"][*]' | has "$method"
    if jsonfilter -i "$acl" -e '@.*.read.ubus["dlink-cellular"][*]' | has "$method"; then
        echo "write leaked into read ACL: $method" >&2; exit 1
    fi
done
for method in at_query engineering_info scan_status events_sms beam_info sim_protection radio_policy; do
    jsonfilter -i "$acl" -e '@["luci-app-dlink-cellular-private"].read.ubus["dlink-cellular"][*]' | has "$method"
    if jsonfilter -i "$acl" -e '@["luci-app-dlink-cellular"].read.ubus["dlink-cellular"][*]' | has "$method"; then
        echo "administrator endpoint leaked into public read ACL: $method" >&2; exit 1
    fi
done
printf '%s\n' dlink,dwr-be7200g > "$tmp/board"
printf '%s\n' 'root:!:0:0:0:0:::' > "$tmp/shadow"
sed -e "s|/tmp/sysinfo/board_name|$tmp/board|g" -e "s|/etc/shadow|$tmp/shadow|g" \
    -e "s|/usr/libexec/dlink-cellular-engineering|$tmp/engineering|g" "$rpc" > "$tmp/rpc"
sed -e "s|/usr/bin/mipc_wan_cli|$tmp/mipc|g" -e "s|/var/lock/dlink-cellular.lock|$tmp/lock|g" \
    -e "s|/var/lock/dlink-wan-auto.lock|$tmp/wan.lock|g" \
    -e "s|/lib/wifi/mtkdat.lua|$tmp/mtkdat.lua|g" -e "s|/var/lock/dlink-wifi-power.lock|$tmp/wifi.lock|g" \
    "$root/usr/libexec/dlink-cellular-engineering" > "$tmp/engineering"
cat > "$tmp/mipc" <<'MIPC'
#!/bin/sh
[ "$#" -eq 2 ] && [ "$1" = --at_cmd ] || exit 1
printf '%s\n' "$2" >> "$TEST_AT_CALLS"
case "$2" in
    'AT+CSQ') printf '+CSQ: 18,99\r\nOK\r\n';;
    'AT+QTEMP') printf '+CME ERROR: 4\r\n';;
    *) exit 1;;
esac
MIPC
export TEST_AT_CALLS="$tmp/at-calls"
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$tmp/timeout"
export PATH="$tmp:$PATH"
chmod 700 "$tmp/timeout"
chmod 700 "$tmp/mipc" "$tmp/engineering"
call() { printf '%s\n' "$2" | sh "$tmp/rpc" call "$1"; }
err() { call "$@" | jsonfilter -e '@.error'; }
eq "$(err at_query '{"command":"AT+CSQ"}')" password_required
printf '%s\n' 'root:fixture-value:0:0:0:0:::' > "$tmp/shadow"
for bad in '{"command":"AT+CFUN=0"}' '{"command":"AT;AT+CSQ"}' '{"command":"AT+CSQ\nAT"}' '{"command":"AT+CSQ\u0000X"}' '{"command":12}'; do
    eq "$(err at_query "$bad")" input
done
for method in mimo_set scan_start scan_stop wifi_power_set wifi_flag_set wan_auto_set; do
    eq "$(err "$method" '{"confirm":1}')" confirm
done
eq "$(err mimo_set '{"rat":"NR","enabled":1,"confirm":true}')" input
eq "$(err scan_start '{"rat":"NR","scope":"offline","confirm":true}')" input
eq "$(err wifi_power_set '{"radio":"bad","percent":100,"confirm":true}')" input
[ ! -e "$TEST_AT_CALLS" ]
eq "$(call at_query '{"command":"AT+CSQ"}' | jsonfilter -e '@.modem_ok')" true
eq "$(call at_query '{"command":"AT+QTEMP"}' | jsonfilter -e '@.modem_ok')" false
eq "$(cat "$TEST_AT_CALLS")" "$(printf 'AT+CSQ\nAT+QTEMP')"
echo 'PASS: authenticated, allowlisted AT input; explicit typed radio write confirmation'

mkdir -p "$tmp/config" "$tmp/overlay" "$tmp/delta"
: > "$tmp/mtkdat.lua"
export TEST_UCI="$tmp"
cat > "$tmp/config/wireless" <<'WIRELESS'
config wifi-device 'MT7990_1_1'
	option type 'mtkwifi'
	option country 'CN'

config wifi-device 'MT7990_1_2'
	option type 'mtkwifi'
	option txpower '90'
	option country 'CN'
WIRELESS
cat > "$tmp/uci" <<'UCI'
#!/bin/sh
case " $* " in *" -t "*) ;; *) set -- -t "$TEST_UCI/delta" "$@";; esac
exec /sbin/uci -c "$TEST_UCI/config" -C "$TEST_UCI/overlay" "$@"
UCI
chmod 700 "$tmp/uci"
eq "$(err wifi_power_set '{"radio":"2g","percent":99,"expected":100,"confirm":true}')" input
eq "$(err wifi_power_set '{"radio":"2g","percent":60,"expected":90,"confirm":true}')" wifi_changed
eq "$(call wifi_power_set '{"radio":"2g","percent":60,"expected":100,"confirm":true}' | jsonfilter -e '@.applied')" false
eq "$(uci get wireless.MT7990_1_1.txpower)" 60
eq "$(uci get wireless.MT7990_1_2.txpower)" 90
eq "$(uci get wireless.MT7990_1_1.country)" CN
uci set wireless.MT7990_1_2.country=US
eq "$(err wifi_power_set '{"radio":"5g","percent":30,"expected":90,"confirm":true}')" wifi_pending
eq "$(uci get wireless.MT7990_1_2.txpower)" 90
eq "$(uci changes wireless)" "wireless.MT7990_1_2.country='US'"
uci revert wireless
eq "$(uci get wireless.MT7990_1_2.country)" CN
echo 'PASS: isolated power update, independent bands, stale-value check, no wireless reload'

cat >> "$tmp/config/wireless" <<'WIFI'
config wifi-iface 'ra0'
    option device 'MT7990_1_1'
    option mode 'ap'
    option hidden '0'
    option disabled '0'
    option isolate '0'
    option wmm '1'
config wifi-iface 'rai0'
    option device 'MT7990_1_2'
    option mode 'ap'
    option hidden '0'
WIFI
cat > "$tmp/config/network" <<'NET'
config interface 'wan'
    option proto 'ql_datacall'
NET
eq "$(call wifi_flag_set '{"radio":"2g","flag":"broadcast","enabled":false,"expected":true,"confirm":true}' | jsonfilter -e '@.enabled')" false
eq "$(uci get wireless.ra0.hidden)" 1
eq "$(uci get wireless.rai0.hidden)" 0
eq "$(err wifi_flag_set '{"radio":"2g","flag":"broadcast","enabled":false,"expected":true,"confirm":true}')" wifi_changed
eq "$(call wan_auto_set '{"enabled":false,"expected":true,"confirm":true}' | jsonfilter -e '@.enabled')" false
eq "$(uci get network.wan.auto)" 0
eq "$(err wan_auto_set '{"enabled":true,"expected":true,"confirm":true}')" policy_changed
echo 'PASS: primary AP only, inverse hidden flag, WAN auto with no redial'
