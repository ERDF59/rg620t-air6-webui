#define _GNU_SOURCE
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <time.h>
#include <unistd.h>
#include "ql_nw.h"

#ifndef TRACE_FILE
#define TRACE_FILE "/tmp/dlink-cellular-trace/capture.json"
#endif
#define EVENT_LIMIT 128u
struct trace_event { time_t at; char fields[416]; };
static struct trace_event events[EVENT_LIMIT];
static unsigned long total;
static time_t started, ended;
static unsigned seconds;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static volatile sig_atomic_t stopping;
static struct { int registration, signal, cell, rrc, reject; } channels;
static const char *problem;

static const char *rat(unsigned n)
{
	switch (n) {
	case QL_NW_RADIO_TECH_NR5G: return "5G SA";
	case QL_NW_RADIO_TECH_NSA5G: return "5G NSA";
	case QL_NW_RADIO_TECH_LTE: return "LTE";
	case QL_NW_RADIO_TECH_UMTS: return "UMTS";
	case QL_NW_RADIO_TECH_GSM: return "GSM";
	default: return "";
	}
}

static void counter(const char *key, uint64_t attempt, uint64_t failure, uint64_t lost)
{
	printf("\"%s\":{\"attempt\":\"%" PRIu64 "\",\"failure\":\"%" PRIu64 "\",\"lost\":\"%" PRIu64 "\"}",
	       key,attempt,failure,lost);
}

static int query(void)
{
	int fd=open("/var/lock/dlink-cellular.lock",O_CREAT|O_CLOEXEC|O_NOFOLLOW|O_WRONLY,0600);
	if(fd<0 || flock(fd,LOCK_EX|LOCK_NB)) { puts("{\"ok\":false,\"error\":\"busy\"}"); return 0; }
	int rc=ql_nw_init(NW_IPC_MODE_DEFAULT);
	if(rc) { printf("{\"ok\":false,\"error\":\"ril_init\",\"code\":%d}\n",rc); return 0; }
	ql_nw_get_attach_fail_count_t c={0};
	ql_nw_pref_nwmode_roaming_info_t p={0}, roam={0};
	ql_nw_get_endc_status_req_t en={0};
	int counters=ql_nw_get_attach_failure_count(&c);
	int preferred=ql_nw_get_pref_nwmode(&p);
	int roaming=ql_nw_get_roaming(&roam);
	int endc=ql_nw_get_endc_status(&en);
	printf("{\"ok\":true,\"preferred\":");
	if(preferred) printf("null");
	else printf("%" PRIu64,p.preferred_nw_mode);
	printf(",\"roaming\":");
	if(roaming || (unsigned)roam.preferred_roaming>1) printf("null");
	else printf("%s",roam.preferred_roaming==QL_NW_ROAM_STATE_ON?"true":"false");
	printf(",\"endc\":");
	if(endc || en.endc_available>1 || en.dcnr_restricted>1) printf("null");
	else printf("{\"available\":%s,\"restricted\":%s}",en.endc_available?"true":"false",en.dcnr_restricted?"true":"false");
	printf(",\"counters_code\":%d,\"counters\":",counters);
	if(counters) printf("null");
	else {
		putchar('{');
		counter("lte_rach",c.lte_rach_attempt.rach_attempt_count,c.lte_rach_attempt.rach_failure_count,0); putchar(',');
		counter("nr_rach",c.nr_rach_attempt.rach_attempt_count,c.nr_rach_attempt.rach_failure_count,0); putchar(',');
		counter("lte_rrc",c.lte_rrc_connect_attempt.rrc_connect_attempt_count,c.lte_rrc_connect_attempt.rrc_connect_failure_count,c.lte_rrc_connect_attempt.rrc_radio_link_failure_count); putchar(',');
		counter("nr_rrc",c.nr_rrc_connect_attempt.rrc_connect_attempt_count,c.nr_rrc_connect_attempt.rrc_connect_failure_count,c.nr_rrc_connect_attempt.rrc_radio_link_failure_count); putchar(',');
		counter("lte_ho",c.lte_ho_attempt.ho_attempt_count,c.lte_ho_attempt.ho_failure_count,0); putchar(',');
		counter("nr_ho",c.nr_ho_attempt.ho_attempt_count,c.nr_ho_attempt.ho_failure_count,0); putchar(',');
		counter("nr_scg",c.nr_scg_change.nr_scg_change_count,c.nr_scg_change.nr_scg_change_failure_count,c.nr_scg_change.nr_scg_failure_count);
		putchar('}');
	}
	puts("}");
	ql_nw_release();
	return 0;
}

static void append(time_t when, const char *fmt, ...)
{
	struct trace_event *event=&events[total % EVENT_LIMIT];
	va_list args;
	va_start(args,fmt);
	const int len=vsnprintf(event->fields,sizeof event->fields,fmt,args);
	va_end(args);
	if(len<0 || (size_t)len>=sizeof event->fields) return;
	event->at=when;
	total++;
}

static void registration(const char *type, const ql_nw_reg_status_info_t *r)
{
	char plmn[7]={0};
	size_t n=0;
	for(size_t i=0;i<3 && r->mcc[i]>='0' && r->mcc[i]<='9';i++) plmn[n++]=r->mcc[i];
	for(size_t i=0;i<3 && r->mnc[i]>='0' && r->mnc[i]<='9';i++) plmn[n++]=r->mnc[i];
	pthread_mutex_lock(&mutex);
	append(time(NULL),"\"type\":\"%s\",\"rat\":\"%s\",\"state\":%d,\"plmn\":\"%s\",\"cause\":%d",
	       type,rat(r->radio_tech),r->reg_state,plmn,r->reg_state==QL_NW_SERVICE_DENIED ? r->deny_reason : 0);
	pthread_mutex_unlock(&mutex);
}
static void on_reg(ql_nw_reg_status_info_t *r)
{
	if(r) registration("registration",r);
}
static void on_signal(ql_nw_signal_strength_info_t *s, QL_NW_SIGNAL_STRENGTH_LEVEL_E level)
{
	if(!s) return;
	int nr=s->has_nr5g==1;
	if(!nr && s->has_lte!=1) return;
	int rsrp=nr?s->nr5g.rsrp:s->lte.rsrp;
	if(rsrp<-160 || rsrp>-30) return;
	pthread_mutex_lock(&mutex);
	time_t now=time(NULL);
	static time_t last;
	if(now!=last) {
		append(now,"\"type\":\"signal\",\"rat\":\"%s\",\"rsrp\":%d,\"level\":%d",nr?"NR":"LTE",rsrp,level);
		last=now;
	}
	pthread_mutex_unlock(&mutex);
}
static void cell_changed(const char *system,unsigned pci,uint32_t arfcn,uint64_t cid)
{
	static struct { unsigned pci; uint32_t arfcn; uint64_t cid; int seen; } last[2];
	const int n=!strcmp(system,"NR");
	pthread_mutex_lock(&mutex);
	if(!last[n].seen || last[n].pci!=pci || last[n].arfcn!=arfcn || last[n].cid!=cid) {
		last[n].seen=1; last[n].pci=pci; last[n].arfcn=arfcn; last[n].cid=cid;
		append(time(NULL),"\"type\":\"cell\",\"rat\":\"%s\",\"pci\":%u,\"arfcn\":%" PRIu32 ",\"cell\":\"%" PRIu64 "\"",
		       system,pci,arfcn,cid);
	}
	pthread_mutex_unlock(&mutex);
}
static void on_cells(ql_nw_cell_info_t *c)
{
	if(!c) return;
	if((c->serving_rat==QL_NW_RADIO_TECH_NR5G || c->serving_rat==QL_NW_RADIO_TECH_NSA5G) &&
	   c->nr_info_valid==1 && c->nr_info_len && c->nr_info[0].pci<=1007)
		cell_changed("NR",c->nr_info[0].pci,c->nr_info[0].nr_arfcn,c->nr_info[0].cid);
	if((c->serving_rat==QL_NW_RADIO_TECH_LTE || c->serving_rat==QL_NW_RADIO_TECH_NSA5G) &&
	   c->lte_info_valid==1 && c->lte_info_len && c->lte_info[0].pci<=503)
		cell_changed("LTE",c->lte_info[0].pci,c->lte_info[0].earfcn,c->lte_info[0].cid);
}
static void on_rrc(ql_nw_cscon_info_t *r)
{
	if(!r) return;
	pthread_mutex_lock(&mutex);
	append(time(NULL),"\"type\":\"rrc\",\"mode\":%u,\"state\":%u,\"access\":%u,\"core\":%u",
	       r->con_status.mode,r->con_status.state,r->con_status.access,r->con_status.core_network);
	pthread_mutex_unlock(&mutex);
}
static void on_reject(ql_nw_enwrejac_info_t *r)
{
	if(!r) return;
	pthread_mutex_lock(&mutex);
	append(time(NULL),"\"type\":\"reject\",\"rat_code\":%u,\"service\":%u,\"attach\":%u,\"esm\":%u,\"proc\":%u,\"result\":%u",
	       r->rat,r->service_rej_cause,r->attach_rej_cause,r->esm_rej_cause,r->nas_proc,r->proc_result);
	pthread_mutex_unlock(&mutex);
}

static int snapshot(int force)
{
	static unsigned long last=~0UL;
	pthread_mutex_lock(&mutex);
	if(!force && last==total) { pthread_mutex_unlock(&mutex); return 0; }
	FILE *file=fopen(TRACE_FILE ".new","w");
	if(!file) { pthread_mutex_unlock(&mutex); return -1; }
	fprintf(file,"{\"started\":%lld,\"ended\":%lld,\"seconds\":%u,\"total\":%lu,\"dropped\":%lu,",
		(long long)started,(long long)ended,seconds,total,total>EVENT_LIMIT?total-EVENT_LIMIT:0);
	fprintf(file,"\"channels\":{\"registration\":%s,\"signal\":%s,\"cell\":%s,\"rrc\":%s,\"reject\":%s},",
		channels.registration?"true":"false",channels.signal?"true":"false",
		channels.cell?"true":"false",channels.rrc?"true":"false",channels.reject?"true":"false");
	if(problem) fprintf(file,"\"error\":\"%s\",",problem);
	fprintf(file,"\"events\":[");
	unsigned long first=total>EVENT_LIMIT?total-EVENT_LIMIT:0;
	for(unsigned long i=first;i<total;i++) {
		const struct trace_event *event=&events[i%EVENT_LIMIT];
		fprintf(file,"%s{\"at\":%lld,%s}",i==first?"":",",(long long)event->at,event->fields);
	}
	fputs("]}\n",file);
	int err=ferror(file);
	if (fclose(file) || err || rename(TRACE_FILE ".new",TRACE_FILE)) {
		unlink(TRACE_FILE ".new");
		pthread_mutex_unlock(&mutex);
		return -1;
	}
	last=total;
	pthread_mutex_unlock(&mutex);
	return 0;
}

static void stop_now(int sig)
{
	(void)sig; stopping=1;
}
static int trace(unsigned duration)
{
	struct sigaction handler={.sa_handler=stop_now};
	sigemptyset(&handler.sa_mask);
	sigaction(SIGTERM,&handler,NULL);
	sigaction(SIGINT,&handler,NULL);
	struct timespec base,now;
	clock_gettime(CLOCK_MONOTONIC,&base);
	started=time(NULL); seconds=duration;
	if(snapshot(1)) return 1;

	int ready=ql_nw_init(NW_IPC_MODE_DEFAULT)==0;
	if(ready) {
		channels.registration=ql_nw_set_data_reg_ind_cb(on_reg)==0;
		channels.signal=ql_nw_set_signal_strength_ind_cb(on_signal)==0;
		channels.cell=ql_nw_set_ecell_info_ind_cb(on_cells)==0;
		channels.rrc=ql_nw_set_cscon_ind_cb(on_rrc)==0;
		channels.reject=ql_nw_set_nw_reject_info_ind_cb(on_reject)==0;
		if(!channels.registration && !channels.signal && !channels.cell && !channels.rrc && !channels.reject)
			problem="subscription";
		ql_nw_reg_status_info_t r={0};
		if(ql_nw_get_data_reg_status(&r)==0) registration("baseline",&r);
	} else problem="ril_init";
	if(snapshot(1)) stopping=1;
	while(!problem && !stopping) {
		sleep(1);
		clock_gettime(CLOCK_MONOTONIC,&now);
		if(now.tv_sec-base.tv_sec>=(time_t)duration) break;
		if(snapshot(0)) break;
	}
	if(ready) ql_nw_release();
	ended=time(NULL);
	return snapshot(1)!=0;
}

int main(int argc,char **argv)
{
	if(argc==2 && !strcmp(argv[1],"query")) return query();
	if(argc==3 && !strcmp(argv[1],"trace") &&
	   (!strcmp(argv[2],"30") || !strcmp(argv[2],"120") || !strcmp(argv[2],"300")))
		return trace((unsigned)strtoul(argv[2],NULL,10));
	return 2;
}
