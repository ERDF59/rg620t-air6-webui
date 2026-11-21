/* Called only after the shared AT guard validated one active voice call and matching CLCC index.
 * Native PS0 SINGLE_TONE addresses the active voice call; it has no CLCC-id TLV.
 * No auto-retry, no keypad history, and no audio mixing. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "mipc_msg_host.h"
#include "mipc_msg_tlv_api.h"
enum { BAD_KEY=20, SETUP=21, NO_ACK=22, REJECT=23, BAD_ACK=24 };
int main(int argc,char **argv){
 if(argc!=2)return BAD_KEY;
 const int probe=!strcmp(argv[1],"--probe");
 char key=argv[1][0];
 if(!probe && (!key || argv[1][1] || !strchr("0123456789*#", key)))return BAD_KEY;
 /* libqlvoice selects this SDK-configured temporary voice endpoint (ttyCMIPC12). */
 if(mipc_init("voice_server"))return SETUP;
 int rc=SETUP;
 mipc_msg_t *req=mipc_msg_init(probe?MIPC_CALL_GET_CALL_STATUS_REQ:MIPC_CALL_DTMF_REQ,MIPC_MSG_PS0),*cnf=NULL;
 if(!req)goto end;
 if(!probe){
  if(mipc_call_dtmf_req_add_mode(req,MIPC_DTMF_MODE_SINGLE_TONE)!=MIPC_MSG_API_RESULT_SUCCESS||
     mipc_call_dtmf_req_add_digit(req,1,&key)!=MIPC_MSG_API_RESULT_SUCCESS)goto end;
  uint16_t n=0;const char *p=mipc_msg_get_val_ptr(req,MIPC_CALL_DTMF_REQ_T_DIGIT,&n);
  if(!p||n!=1||*p!=key||mipc_msg_get_val_uint32(req,MIPC_CALL_DTMF_REQ_T_MODE,UINT32_MAX)!=MIPC_DTMF_MODE_SINGLE_TONE)goto end;
 }
 mipc_msg_set_timeout_once(5000);
 cnf=mipc_msg_sync_timeout(req); /* exactly one transaction */
 if(!cnf){rc=NO_ACK;goto end;}
 if(cnf->hdr.msg_id!=(probe?MIPC_CALL_GET_CALL_STATUS_CNF:MIPC_CALL_DTMF_CNF)||
    cnf->hdr.msg_sim_ps_id!=MIPC_MSG_PS0){rc=BAD_ACK;goto end;}
 uint16_t len=0;if(!mipc_msg_get_val_ptr(cnf,MIPC_T_RESULT,&len)||len!=sizeof(uint32_t)){rc=BAD_ACK;goto end;}
 rc=mipc_get_result(cnf)==MIPC_RESULT_SUCCESS?0:REJECT;
 if(probe&&!rc)puts("MIPC_READ_CONFIRMED");
end:
 if(cnf)mipc_msg_deinit(cnf);
 if(req)mipc_msg_deinit(req);
 mipc_deinit();return rc;
}
