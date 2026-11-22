#!/bin/sh
# Run with a compiler in a disposable Linux container, never on the CPE.
set -eu
src="$1"
fixture="$(mktemp -d /tmp/sms-native.XXXXXX)"
export SMS_TEST_CALLS="$fixture/calls"
: > "$SMS_TEST_CALLS"
cc -std=c11 -Wall -Wextra -Werror -I "$src/tests/fixtures" \
    "$src/backend/cellular/src/dlink-sms-delete.c" "$src/tests/fixtures/sms-ql-stub.c" \
    -o "$fixture/delete"
mkdir -p /var/lock
run() { printf '%s\n' "$3" | SMS_TEST_SCENARIO="$1" "$fixture/delete" "$2"; }
no_delete() { if grep -q '^delete ' "$SMS_TEST_CALLS"; then cat "$SMS_TEST_CALLS" >&2; exit 1; fi; }
run match 0 A1B203 | grep -q '"error":"input"'
run match 65535 A1B203 | grep -q '"error":"input"'
run match 7 A1B20Z | grep -q '"error":"input"'
[ ! -s "$SMS_TEST_CALLS" ]
run reused_index 7 A1B203 | grep -q '"error":"sms_changed"'
run read_error 7 A1B203 | grep -q '"error":"sms_read"'
run init_error 7 A1B203 | grep -q '"error":"ril_init"'
no_delete
: > "$SMS_TEST_CALLS"
run match 7 a1b203 | grep -q '"ok":true'
[ "$(grep '^delete ' "$SMS_TEST_CALLS")" = 'delete 7' ]
[ "$(cat "$SMS_TEST_CALLS")" = "$(printf 'init 0\nread 7\ndelete 7\nrelease 0')" ]
: > "$SMS_TEST_CALLS"
run delete_error 7 A1B203 | grep -q '"error":"sms_delete","code":23'
[ "$(grep '^delete ' "$SMS_TEST_CALLS")" = 'delete 7' ]
echo 'PASS: guarded single-index native deletion, stale and error paths'

run_group() { printf '%s\n' 2 '12 A1B203' '14 A1B203' | SMS_TEST_SCENARIO="$1" "$fixture/delete" --group; }
: > "$SMS_TEST_CALLS"
run_group reused_second | grep -q '"error":"sms_changed"'
no_delete
[ "$(cat "$SMS_TEST_CALLS")" = "$(printf 'init 0\nread 12\nread 14\nrelease 0')" ]
: > "$SMS_TEST_CALLS"
run_group match | grep -q '"ok":true,"deleted":2'
[ "$(head -3 "$SMS_TEST_CALLS")" = "$(printf 'init 0\nread 12\nread 14')" ]
[ "$(grep '^delete ' "$SMS_TEST_CALLS")" = "$(printf 'delete 12\ndelete 14')" ]
: > "$SMS_TEST_CALLS"
run_group delete_second_error | grep -q '"deleted":1,"partial":true,"error":"sms_delete","code":23'
[ "$(grep '^delete ' "$SMS_TEST_CALLS")" = "$(printf 'delete 12\ndelete 14')" ]
: > "$SMS_TEST_CALLS"
printf '%s\n' 2 '12 A1B203' | SMS_TEST_SCENARIO=match "$fixture/delete" --group | grep -q '"error":"input"'
printf '%s\n' 2 '12 A1B203' '12 A1B203' | SMS_TEST_SCENARIO=match "$fixture/delete" --group | grep -q '"error":"input"'
[ ! -s "$SMS_TEST_CALLS" ]
echo 'PASS: multipart preflight before any delete, truncation and duplicates rejected, actual partial count'
