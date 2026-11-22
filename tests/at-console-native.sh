#!/bin/sh
# Linux host, SDK header + fake sender: all examples stay off the radio.
set -eu
: "${AT_INC:?}" "${JSON_INC:?}" "${JSON_LIB:?}"
src=$(cd "$(dirname "$0")/.." && pwd)
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
sed "s|/var/lock/dlink-cellular.lock|$d/lock|" "$src/backend/cellular/src/dlink-at-console.c" > "$d/main.c"
cat > "$d/fake.c" <<'C'
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "quectel_atcid_sender.h"
static COMM_DEV dev;
COMM_DEV *ql_atcid_sender_init(ATCID_INIT_TYPE t){return t==TYPE_ADB_ATCI_SOCKET?&dev:NULL;}
void ql_atcid_sender_deinit(COMM_DEV *p){(void)p;}
int ql_atcid_sender_large_require(COMM_DEV *p,atcmd_sender_msg_t *m){
  (void)p;FILE *f=fopen("sent","ab");fputs(m->at_cmd,f);fclose(f);return 1;
}
ql_atcid_sender_large_state_t ql_atcid_sender_large_read(COMM_DEV *p,atcmd_sender_msg_t *m,int *n){
  (void)p;static int step;
  const char *s=step++?"OK\r\n":"sample\r\n";*n=strlen(s);memcpy(m->at_recv,s,*n);
  return step==1?QUECTEL_ATCID_SENDER_LARGE_STATE_READY:QUECTEL_ATCID_SENDER_LARGE_STATE_DONE;
}
C
cc -std=gnu11 -Wall -Wextra -Werror -I"$AT_INC" -I"$JSON_INC" "$d/main.c" "$d/fake.c" "$JSON_LIB" -o "$d/test"
cd "$d"
python3 - <<'PY'
import json,subprocess,pathlib
def req(command,confirm=True):
 return json.loads(subprocess.check_output(['./test'],input=json.dumps(dict(command=command,confirm=confirm)).encode()))
for cmd,confirm in [('AT',False),('AT',1),('ls',True),('AT\nX',True),('AT\0X',True),('AT'+'x'*508,True)]:
 assert not req(cmd,confirm)['ok']
assert not pathlib.Path('sent').exists()
for cmd in ['AT+Example="Mixed Case; $value"','AT'+'x'*507]:
 r=req(cmd)
 assert r['ok'] and r['modem_ok'] and not r['incomplete']
 assert r['reply']=='sample\r\nOK'
 assert pathlib.Path('sent').read_bytes()==cmd.encode()+b'\r\n'
 pathlib.Path('sent').unlink()
print('PASS: exact confirmation type, single AT line, size bounds, literal arguments, single send and multi-chunk reply.')
PY
