#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ql_nw.h"
#include "ql_sim.h"
static int unlocked,nr=7;
int ql_nw_init(NW_IPC_MODE m){(void)m;return 0;}
int ql_sim_init(SIM_IPC_MODE m){(void)m;return 0;}
int ql_nw_release(void){return 0;}
int ql_sim_release(void){return 0;}
int ql_sim_get_card_info(QL_SIM_SLOT_E s,ql_sim_card_info_t *c){(void)s;const char *v=getenv("CARD");
c->state=unlocked||!v?QL_SIM_STATUS_READY:!strcmp(v,"pin")?QL_SIM_STATUS_SIM_PIN:QL_SIM_STATUS_SIM_PUK;return 0;}
int ql_sim_get_all_remain_time(QL_SIM_SLOT_E s,ql_sim_get_all_remain_time_resp_t *r){(void)s;r->result=0;r->pin1_count=3;r->puk1_count=10;return 0;}
static int op(char id,QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v){
  if(s!=QL_SIM_SLOT_1||p!=QL_SIM_PIN_1)abort();
  FILE *f=fopen("calls","a");fputc(id,f);fclose(f);
  if(!strcmp(v,"9999"))return -1;
  if(id=='V'||id=='U')unlocked=1;
  if(id=='E'||id=='D'){f=fopen("policy","w");fputs(id=='E'?"1":"0",f);fclose(f);}return 0;
}
int ql_sim_enable_pin(QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v){return op('E',s,p,v);}
int ql_sim_disable_pin(QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v){return op('D',s,p,v);}
int ql_sim_verify_pin(QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v){return op('V',s,p,v);}
int ql_sim_change_pin(QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v,const char *n){if(strcmp(n,"5678"))abort();return op('C',s,p,v);}
int ql_sim_unblock_pin(QL_SIM_SLOT_E s,QL_SIM_PIN_E p,const char *v,const char *n){if(strcmp(n,"5678"))abort();return op('U',s,p,v);}
int ql_nw_get_nr_disable_mode(ql_nw_get_nr_disable_mode_req_t *n){n->nr_disable_mode=nr;return 0;}
int ql_nw_set_nr_disable_mode(ql_nw_set_nr_disable_mode_req_t *n){nr=n->nr_disable_mode;return 0;}
int ql_nw_get_roaming_disable_mode(ql_nw_get_roaming_disable_mode_resp_t *r){r->roaming_disable_mode=0;return 0;}
int ql_nw_set_roaming_disable_mode(ql_nw_set_roaming_disable_mode_req_t *r){(void)r;return 1;}
int ql_nw_get_meas_info(ql_nw_get_meas_info_resp_t *m){m->nr_pcc_num=1;strcpy(m->nr_pcc_info.cc_type,"NR PCC");m->nr_pcc_info.ssb_best_beam_id=0;m->nr_pcc_info.brsrp=-101;return 0;}
int ql_nw_get_signal_strength(ql_nw_signal_strength_info_t *s,QL_NW_SIGNAL_STRENGTH_LEVEL_E *l){(void)l;s->has_nr5g=1;s->nr5g.nr_cc_num=1;nr_ca_signal_rx_info_table *r=s->nr5g.nr_signal_rx_info;
strcpy(r->cc_type,"NR PCC");for(int i=0;i<4;i++)r->ssb_rsrp_rx[i]= i==1?-255:-100-i;return 0;}
