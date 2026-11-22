#define _GNU_SOURCE
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/file.h>
#include <sys/resource.h>
#include <syslog.h>
#include <json-c/json.h>
#include "ql_nw.h"
#include "ql_sim.h"

#define N(x) (sizeof(x)/sizeof((x)[0]))
static void error(const char *s) {printf("{\"ok\":false,\"error\":\"%s\"}\n",s);}
static json_object *request(void) {
    char buf[1025]; size_t n=fread(buf,1,sizeof(buf),stdin);
    if (!n || n==sizeof(buf) || memchr(buf,0,n)) return NULL;
    buf[n]=0;
    json_object *o=json_tokener_parse(buf); explicit_bzero(buf,sizeof(buf));
    if(!o || !json_object_is_type(o,json_type_object) || !json_object_is_type(json_object_object_get(o,"confirm"),json_type_boolean) || !json_object_get_boolean(json_object_object_get(o,"confirm"))) {json_object_put(o);return NULL;}
    return o;
}
static const char *str(json_object *o,const char *k){
    json_object *v=json_object_object_get(o,k);
    if(!json_object_is_type(v,json_type_string))return "";
    const char *s=json_object_get_string(v);
    return (size_t)json_object_get_string_len(v)==strlen(s)?s:"";
}
static int integer(json_object *o,const char *k){
    json_object *v=json_object_object_get(o,k);
    int64_t n=json_object_get_int64(v);
    return json_object_is_type(v,json_type_int)&&n>=0&&n<=254?(int)n:-1;
}
static int valid_code(const char *s,size_t lo,size_t hi){
    size_t n=strlen(s);return n>=lo&&n<=hi&&strspn(s,"0123456789")==n;
}
/* Query only; the command and argv are constant. Passwords never enter this path. */
static int protection(void){
    FILE *p=popen("timeout 4 /usr/bin/mipc_wan_cli --at_cmd 'AT+CLCK=\"SC\",2'","r");
    if(!p)return -1;
    char line[128]; int enabled=-1,ok=0;
    while(fgets(line,sizeof(line),p)){
        line[strcspn(line,"\r\n")]=0;
        if(!line[0])continue;
        ok=!strcmp(line,"OK");
        if(!strcmp(line,"+CLCK: 0"))enabled=0;
        if(!strcmp(line,"+CLCK: 1"))enabled=1;
    }
    return !pclose(p)&&ok?enabled:-1;
}
static int ready(int state){return state==QL_SIM_STATUS_READY || state==QL_SIM_STATUS_COMPLETE_READY;}
static void sim_action(json_object *o){
    const char *a=str(o,"action"),*secret=str(o,"secret"),*next=str(o,"new_pin");
    int en=!strcmp(a,"enable"),dis=!strcmp(a,"disable"),verify=!strcmp(a,"verify"),unblock=!strcmp(a,"unblock"),change=!strcmp(a,"change");
    if(!(en||dis||verify||unblock||change)||!valid_code(secret,unblock?8:4,8)||
        ((unblock||change)?!valid_code(next,4,8):next[0]!=0)){error("input");return;}
    int policy=(en||dis||change)?protection():-1;
    if((en&&policy!=0)||((dis||change)&&policy!=1)){error("sim_changed");return;}
    if(ql_sim_init(SIM_IPC_MODE_DEFAULT)){error("sim_read");return;}
    ql_sim_card_info_t card={0};
    ql_sim_get_all_remain_time_resp_t counts={.result=UINT32_MAX};
    if(ql_sim_get_card_info(QL_SIM_SLOT_1,&card) ||
        !(verify?card.state==QL_SIM_STATUS_SIM_PIN:unblock?card.state==QL_SIM_STATUS_SIM_PUK:ready(card.state)) ||
        ql_sim_get_all_remain_time(QL_SIM_SLOT_1,&counts)||counts.result!=0){error("sim_changed");goto end;}
    int remaining=unblock?counts.puk1_count:counts.pin1_count;
    if(!remaining||remaining==255||remaining!=integer(o,"remaining")){error("sim_changed");goto end;}
    /* Exactly one authenticated operation. Never verify a credential as a post-write check. */
    setlogmask(LOG_UPTO(LOG_WARNING)); /* vendor debug messages can include PIN/PUK */
    int saved=dup(STDOUT_FILENO),nullfd=open("/dev/null",O_WRONLY|O_CLOEXEC);
    if(saved<0||nullfd<0||dup2(nullfd,STDOUT_FILENO)<0){error("sim_read");goto end;}
    close(nullfd);
    int rc=en?ql_sim_enable_pin(QL_SIM_SLOT_1,QL_SIM_PIN_1,secret):
        dis?ql_sim_disable_pin(QL_SIM_SLOT_1,QL_SIM_PIN_1,secret):
        verify?ql_sim_verify_pin(QL_SIM_SLOT_1,QL_SIM_PIN_1,secret):
        change?ql_sim_change_pin(QL_SIM_SLOT_1,QL_SIM_PIN_1,secret,next):
        ql_sim_unblock_pin(QL_SIM_SLOT_1,QL_SIM_PIN_1,secret,next);
    fflush(stdout);if(dup2(saved,STDOUT_FILENO)<0)_exit(1);close(saved);
    if(rc)error("sim_rejected");
    else if((en||dis) && protection()!=en)error("readback");
    else if((verify||unblock) && (ql_sim_get_card_info(QL_SIM_SLOT_1,&card)||!ready(card.state)))error("readback");
    else puts("{\"ok\":true}");
end: ql_sim_release();
}
static int valid_policy(int nr,int v){return nr?(v==1||v==3||v==5||v==7):(v==0||v==1||v==2||v==4);}
static int get_policy(int nr){
    ql_nw_get_nr_disable_mode_req_t n={.nr_disable_mode=-1};
    ql_nw_get_roaming_disable_mode_resp_t r={.roaming_disable_mode=(QL_NW_ROAMING_DIS_TYPE_E)-1};
    int rc=nr?ql_nw_get_nr_disable_mode(&n):ql_nw_get_roaming_disable_mode(&r);
    int v=nr?n.nr_disable_mode:(int)r.roaming_disable_mode;
    return !rc&&valid_policy(nr,v)?v:-1;
}
static void number(int v,int lo,int hi){if(v>=lo&&v<=hi)printf("%d",v);else fputs("null",stdout);}
static void policy_set(json_object *o){
    int nr=!strcmp(str(o,"setting"),"nr"), v=integer(o,"value"), prev=integer(o,"expected");
    if((!nr&&strcmp(str(o,"setting"),"roaming"))||!valid_policy(nr,v)||!valid_policy(nr,prev)){error("input");return;}
    if(get_policy(nr)!=prev){error("policy_changed");return;}
    ql_nw_set_nr_disable_mode_req_t n={.nr_disable_mode=v};
    ql_nw_set_roaming_disable_mode_req_t r={.roaming_disable_mode=v};
    if(v!=prev && (nr?ql_nw_set_nr_disable_mode(&n):ql_nw_set_roaming_disable_mode(&r)))error("policy_write");
    else if(get_policy(nr)!=v)error("readback");
    else printf("{\"ok\":true,\"value\":%d}\n",v);
}
static void cc(const char *label){json_object *v=json_object_new_string_len(label,strnlen(label,10));fputs(json_object_to_json_string(v),stdout);json_object_put(v);}
static void beam(const nr_meas_info_table *m){
    printf("{\"cc\":");cc(m->cc_type);
    printf(",\"id\":");number(m->ssb_best_beam_id,0,63);
    printf(",\"power\":");number(m->brsrp,-156,-31);
    printf(",\"avg\":");number(m->ssb_rsrp_avg,-156,-31);
    printf(",\"snr\":");number(m->ssb_snr_avg,-40,60);putchar('}');
}
static void vector(const int16_t v[4],int lo,int hi){
    putchar('[');for(int i=0;i<4;i++){if(i)putchar(',');number(v[i],lo,hi);}putchar(']');
}
static void beams(void){
    ql_nw_get_meas_info_resp_t m={0};ql_nw_signal_strength_info_t s={0};QL_NW_SIGNAL_STRENGTH_LEVEL_E lvl=0;
    int mr=ql_nw_get_meas_info(&m),sr=ql_nw_get_signal_strength(&s,&lvl);
    if(mr&&sr){error("beam_read");return;}
    fputs("{\"ok\":true,\"beams\":[",stdout);int comma=0;
    if(!mr){
        if(m.nr_pcc_num){beam(&m.nr_pcc_info);comma=1;}
        for(size_t i=0;i<m.nr_scc_num&&i<N(m.nr_scc_info);i++){if(comma)putchar(',');beam(&m.nr_scc_info[i]);comma=1;}
    }
    fputs("],\"rx\":[",stdout);
    if(!sr&&s.has_nr5g==1)for(size_t i=0;i<s.nr5g.nr_cc_num&&i<N(s.nr5g.nr_signal_rx_info);i++){
        nr_ca_signal_rx_info_table *r=&s.nr5g.nr_signal_rx_info[i];if(i)putchar(',');
        fputs("{\"cc\":",stdout);cc(r->cc_type);fputs(",\"rsrp\":",stdout);vector(r->ssb_rsrp_rx,-156,-31);
        fputs(",\"snr\":",stdout);vector(r->ssb_snr_rx,-40,60);fputs(",\"rssi\":",stdout);vector(r->rssi_rx,-150,-10);putchar('}');
    }
    puts("]}");
}
int main(int argc,char **argv){
    struct rlimit limit={0,0};setrlimit(RLIMIT_CORE,&limit);
    if(argc!=2){error("input");return 0;}
    int fd=open("/var/lock/dlink-cellular.lock",O_CREAT|O_CLOEXEC|O_NOFOLLOW|O_WRONLY,0600);
    const char *a=argv[1];
    int readonly=!strcmp(a,"sim_protection")||!strcmp(a,"radio_policy")||!strcmp(a,"beam_info");
    int acquired=0;
    for(int i=0;fd>=0 && i<(readonly?10:1);i++){
        if(!flock(fd,LOCK_EX|LOCK_NB)){acquired=1;break;}
        if(readonly)usleep(80000);
    }
    if(!acquired){error("busy");return 0;}
    json_object *o=NULL;
    if(!strcmp(a,"sim_action")||!strcmp(a,"radio_policy_set")){o=request();if(!o){error("input");return 0;}}
    if(!strcmp(a,"sim_protection")){
        int p=protection();printf("{\"ok\":true,\"enabled\":%s}\n",p<0?"null":p?"true":"false");
    }else if(!strcmp(a,"sim_action"))sim_action(o);
    else if(ql_nw_init(NW_IPC_MODE_DEFAULT))error("ril_init");
    else {
        if(!strcmp(a,"radio_policy_set"))policy_set(o);
        else if(!strcmp(a,"radio_policy")){
            fputs("{\"ok\":true,\"nr\":",stdout);number(get_policy(1),1,7);
            fputs(",\"roaming\":",stdout);number(get_policy(0),0,4);puts("}");
        }else if(!strcmp(a,"beam_info"))beams();else error("input");
        ql_nw_release();
    }
    json_object_put(o);return 0;
}
