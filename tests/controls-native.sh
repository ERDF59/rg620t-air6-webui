#!/bin/sh
# Run on a Linux host with the matching SDK headers and json-c; no modem or real SIM.
set -eu
: "${RIL_INC:?}" "${JSON_INC:?}" "${JSON_LIB:?}"
src=$(cd "$(dirname "$0")/.." && pwd)
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
export SIM_TEST="$d"
sed -e "s|/var/lock/dlink-cellular.lock|$d/lock|" -e "s|timeout 4 /usr/bin/mipc_wan_cli|$d/cli|" "$src/backend/cellular/src/dlink-controls.c" > "$d/controls.c"
cat > "$d/cli" <<'CLI'
#!/bin/sh
printf '+CLCK: %s\nOK\n' "$(cat "$SIM_TEST/policy")"
CLI
chmod +x "$d/cli"
cc -std=gnu11 -Wall -Wextra -Werror -I"$RIL_INC" -I"$JSON_INC" "$d/controls.c" "$src/tests/controls-fake.c" "$JSON_LIB" -o "$d/test"
cd "$d"; echo 0 > policy
call(){ printf '%s' "$2" | ./test "$1"; }
expect(){ case "$1" in *"$2"*) ;; *) echo "missing $2 in $1";exit 1;; esac; }
st(){ call sim_action "{\"confirm\":true,\"action\":\"$1\",\"secret\":\"$2\",\"new_pin\":\"$3\",\"remaining\":$4}"; }
expect "$(call sim_protection '{}')" '"enabled":false'
expect "$(call sim_action '{"confirm":false}')" '"error":"input"'
expect "$(st enable 12x4 '' 3)" '"error":"input"'
expect "$(st enable 1234 '' 1)" '"error":"sim_changed"'
expect "$(st unblock 12345678 1234 10)" '"error":"sim_changed"'
[ ! -e calls ]
expect "$(st enable 1234 '' 3)" '"ok":true'; [ "$(cat calls)" = E ]
expect "$(st enable 1234 '' 3)" 'sim_changed'; [ "$(cat calls)" = E ]
expect "$(st change 1234 5678 3)" '"ok":true'
expect "$(st disable 5678 '' 3)" '"ok":true'
export CARD=pin
expect "$(st verify 9999 '' 3)" '"error":"sim_rejected"'
expect "$(st verify 5678 '' 3)" '"ok":true'
export CARD=puk
expect "$(st unblock 12345678 5678 10)" '"ok":true'
[ "$(cat calls)" = ECDVVU ]
expect "$(call radio_policy '{}')" '"nr":7,"roaming":0'
expect "$(call radio_policy_set '{"confirm":true,"setting":"nr","value":0,"expected":7}')" '"error":"input"'
expect "$(call radio_policy_set '{"confirm":true,"setting":"nr","value":3,"expected":5}')" '"error":"policy_changed"'
expect "$(call radio_policy_set '{"confirm":true,"setting":"nr","value":5,"expected":7}')" '"value":5'
expect "$(call beam_info '{}')" '"id":0,"power":-101'
expect "$(call beam_info '{}')" '"rsrp":[-100,null,-102,-103]'
echo 'PASS: SIM state, stale attempts, one-shot PIN and PUK, policy readback, SSB zero and unavailable Rx'
