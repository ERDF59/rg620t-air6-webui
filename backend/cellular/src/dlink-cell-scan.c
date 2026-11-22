#define _GNU_SOURCE
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <time.h>
#include <unistd.h>
#include "ql_nw.h"

#ifndef SCAN_DIR
#define SCAN_DIR "/tmp/dlink-cellular-scan"
#endif
#ifndef MODEM_LOCK
#define MODEM_LOCK "/var/lock/dlink-cellular.lock"
#endif
#ifndef SCAN_SECONDS
#define SCAN_SECONDS 30
#endif
#define COUNT(a) (sizeof(a) / sizeof((a)[0]))
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static ql_nw_cell_band_scan_result_list_info_t scan;
static int done;
static volatile sig_atomic_t stopping;

static void on_signal(int sig) { (void)sig; stopping=1; }
static void on_result(ql_nw_cell_band_scan_result_list_info_t *result)
{
	if (!result) return;
	pthread_mutex_lock(&lock);
	if (!done) { scan=*result; done=1; }
	pthread_mutex_unlock(&lock);
}
static int finished(void)
{
	pthread_mutex_lock(&lock);
	int result=done;
	pthread_mutex_unlock(&lock);
	return result;
}
static void radio_value(FILE *out, int value, int lo, int hi)
{
	if (value<lo || value>hi) fputs("null",out); else fprintf(out,"%.2f",value/4.0);
}
static void cells(FILE *out, const ql_nw_cell_band_info_t *list, size_t count, int nr, int *comma)
{
	for (size_t i=0;i<count;i++) {
		const ql_nw_cell_band_info_t *c=&list[i];
		if (!c->arfcn || c->arfcn>(nr?3279165u:262143u) || c->pci>(nr?1007u:503u) ||
		    c->cell_band<1 || c->cell_band>1024) continue;
		fprintf(out,"%s{\"rat\":\"%s\",\"band\":%u,\"arfcn\":%" PRIu32 ",\"pci\":%" PRIu32
		        ",\"cell\":\"%" PRIu64 "\",\"rsrp\":",*comma?",":"",nr?"NR":"LTE",
		        c->cell_band,c->arfcn,c->pci,c->cid);
		*comma=1;
		radio_value(out,c->rsrp,-640,-120);
		fputs(",\"rsrq\":",out); radio_value(out,c->rsrq,-180,0);
		fputs(",\"sinr\":",out); radio_value(out,c->snr,-140,200);
		putc('}',out);
	}
}
static int publish(const char *state, int code, const ql_nw_cell_band_scan_result_list_info_t *result)
{
	FILE *out=fopen(SCAN_DIR "/status.new","w");
	if (!out) return 1;
	fprintf(out,"{\"ok\":true,\"state\":\"%s\",\"code\":%d,\"cells\":[",state,code);
	if (result) {
		int comma=0;
		const size_t lte=COUNT(result->lte_cell_band_info), nr=COUNT(result->nr_cell_band_info);
		cells(out,result->lte_cell_band_info,result->lte_band_count<lte?result->lte_band_count:lte,0,&comma);
		cells(out,result->nr_cell_band_info,result->nr_band_count<nr?result->nr_band_count:nr,1,&comma);
	}
	fputs("]}\n",out);
	int err=ferror(out);
	if (fclose(out) || err || rename(SCAN_DIR "/status.new",SCAN_DIR "/status.json")) return 1;
	return 0;
}
static long now_ms(void)
{
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC,&t);
	return t.tv_sec*1000L+t.tv_nsec/1000000;
}
static int stop_requested(void)
{
	return stopping || access(SCAN_DIR "/stop",F_OK)==0;
}
int main(int argc, char **argv)
{
	if (argc!=3) return 2;
	int rat=!strcmp(argv[1],"NR")?1:!strcmp(argv[1],"LTE")?2:!strcmp(argv[1],"both")?0:-1;
	int type=!strcmp(argv[2],"network")?1:!strcmp(argv[2],"all")?0:-1;
	if (rat<0 || type<0) return 2;
	struct sigaction sig={.sa_handler=on_signal};
	sigemptyset(&sig.sa_mask);
	sigaction(SIGTERM,&sig,NULL);
	sigaction(SIGINT,&sig,NULL);
	int fd=open(MODEM_LOCK,O_CREAT|O_CLOEXEC|O_NOFOLLOW|O_WRONLY,0600);
	if (fd<0) return publish("busy",0,NULL);
	const long lock_until=now_ms()+2000;
	while (flock(fd,LOCK_EX|LOCK_NB)) {
		if (stop_requested()) return publish("cancelled",0,NULL);
		if (now_ms()>=lock_until) return publish("busy",0,NULL);
		usleep(100000);
	}
	if (stop_requested()) return publish("cancelled",0,NULL);
	int rc=ql_nw_init(NW_IPC_MODE_DEFAULT);
	if (rc) return publish("ril_init",rc,NULL);
	const char *state="running";
	ql_nw_cell_band_scan_mode_req_t req={.mode=1,.timeout=SCAN_SECONDS,.scan_type=type,.cell_rat=rat};
	if (stop_requested()) state="cancelled";
	else if (publish("running",0,NULL)) state="failed";
	else if ((rc=ql_nw_cell_band_scan(&req,on_result))!=0) state="rejected";
	else {
		long until=now_ms()+SCAN_SECONDS*1000L+1000;
		int requested=0;
		int timed_out=0;
		while (!finished()) {
			if (!requested && (stop_requested() || now_ms()>=until)) {
				timed_out=!stop_requested();
				requested=1;
				publish("stopping",0,NULL);
				ql_nw_cell_band_scan_mode_req_t abort_req={0};
				rc=ql_nw_cell_band_scan(&abort_req,on_result);
				until=now_ms()+4000;
			}
			if (requested && now_ms()>=until) break;
			usleep(150000);
		}
		if (!finished()) state="stop_unconfirmed";
		else {
			switch (scan.cell_band_result) {
			case QL_NW_ASYNC_SUCCESS: state="complete"; break;
			case QL_NW_ASYNC_ABORT: state=timed_out?"timeout":"cancelled"; break;
			default: state="failed"; break;
			}
		}
	}
	int result=publish(state,rc,finished()?&scan:NULL);
	ql_nw_release();
	return result;
}
