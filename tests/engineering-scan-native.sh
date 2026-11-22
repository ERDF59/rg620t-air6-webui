#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/scan"
f=tests/fixtures/engineering-scan
cc -Wall -Wextra -Werror -pthread -I"$f" -DSCAN_SECONDS=2 "-DSCAN_DIR=\"$tmp/scan\"" "-DMODEM_LOCK=\"$tmp/modem.lock\"" \
  backend/cellular/src/dlink-cell-scan.c "$f/sdk-fake.c" -o "$tmp/worker"
SCAN_FAKE=complete "$tmp/worker" NR network > "$tmp/ok"
grep -qx 'released' "$tmp/ok"
python3 - "$tmp/scan/status.json" <<'PY'
import json, sys
result=json.load(open(sys.argv[1]))
assert result['state']=='complete'
assert len(result['cells'])==1
assert result['cells'][0]['pci']==0
assert result['cells'][0]['rsrp']==-100.25
assert result['cells'][0]['cell']=='987654321012345678'
PY
SCAN_FAKE=cancel "$tmp/worker" NR network > "$tmp/cancel" &
pid=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
    grep -qx started "$tmp/cancel" && break
    sleep 0.1
done
grep -qx started "$tmp/cancel"
: > "$tmp/scan/stop"
wait "$pid"
grep -qx abort "$tmp/cancel"
grep -qx released "$tmp/cancel"
grep -q '"state":"cancelled".*"rat":"NR"' "$tmp/scan/status.json"
rm -f "$tmp/scan/stop"
SCAN_FAKE=unconfirmed "$tmp/worker" NR network > "$tmp/unconfirmed"
grep -qx abort "$tmp/unconfirmed"
grep -q '"state":"stop_unconfirmed"' "$tmp/scan/status.json"
echo 'PASS: asynchronous scan completion, unit/size handling, confirmed partial cancel, and missing abort response'
