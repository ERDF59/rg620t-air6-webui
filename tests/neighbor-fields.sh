#!/bin/sh
set -eu
: "${RIL_INC:?SDK with ql_nw, ql_sim and ql_sms headers}"
base=$(cd "$(dirname "$0")/.." && pwd)
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
cc -O2 -Wall -Wextra -Werror -I"$RIL_INC" -ffunction-sections -fdata-sections "$base/tests/neighbor-fields.c" -Wl,--gc-sections -o "$d/test"
"$d/test" | python3 -c 'import json,sys; c=json.load(sys.stdin)["cells"]; assert [(x["rsrq"],x["sinr10"]) for x in c]==[(-11,100),(-17,-40),(None,None),(-10,0),(-12,37)];print("PASS: individual NR/LTE measurements, scaling, zero and sentinel")'
