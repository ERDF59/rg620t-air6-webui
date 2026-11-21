#include <stdio.h>
#include <stdbool.h>
#include <stdint.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include <math.h>
#include "speech_drv.h"
extern bool send_req(SPH_REQ *,int *);
enum { RATE=32000, FRAMES=640, PERIOD=FRAMES*2, PERIODS=150 };
static volatile sig_atomic_t stop_requested;
static void stop(int sig){(void)sig;stop_requested=1;}
static int ask(SPH_REQ *r){int x=-1;return send_req(r,&x)?x:-1;}
static int op(int id){SPH_REQ r={.id=id};return ask(&r);}
static int64_t ms(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
int main(int argc,char **argv){
 if(argc!=2)return 2;
 int tx=!__builtin_strcmp(argv[1],"marker-tx");
 if(!tx&&__builtin_strcmp(argv[1],"marker"))return 2;
 signal(SIGTERM,stop);signal(SIGINT,stop);
 SPH_REQ r={.id=BGS_OPEN,.sampleRate=RATE,.switchOn=tx};
 if(ask(&r)!=0)return 3;
 int initial=op(BGS_BUFFER_COUNT),last=initial,written=0,peak=initial,io_ok=1;
 int64_t start=ms(),last_take=start,finish=0;
 while(!stop_requested && ms()-start<5500){
  int q=op(BGS_BUFFER_COUNT);
  if(q<0||q>PERIOD*4){io_ok=0;break;}
  if(q<last)last_take=ms();
  last=q;
  if(written==PERIODS*PERIOD){
   if(!finish)finish=ms();
   if(q==0||ms()-finish>350)break;
  }else if(q<=2*PERIOD && written/PERIOD <= (ms()-start)/20+1){
   int16_t a[FRAMES];
   for(int j=0;j<FRAMES;j++){int n=written/2+j;a[j]=n%RATE<RATE/3?(int16_t)(2400*sin(6.283185307179586*750*n/RATE)):0;}
   r=(SPH_REQ){.id=BGS_WRITE,.dataSize=sizeof(a)};__builtin_memcpy(r.dataBuf,a,sizeof a);
   int n=ask(&r);if(n!=PERIOD){io_ok=0;break;}written+=n;last=q+n;if(last>peak)peak=last;
  }
  if(ms()-last_take>1200 && q>0)break;
  struct timespec delay={.tv_nsec=4000000};nanosleep(&delay,NULL);
 }
 int final=op(BGS_BUFFER_COUNT);int closed=op(BGS_CLOSE);
 int64_t taken=(int64_t)initial+written-final;
 if(initial<0||final<0||final>4*PERIOD||taken<0||taken>initial+written)io_ok=0;
 fprintf(stderr,"BGS_RESULT written=%d initial=%d final=%d taken=%lld peak=%d closed=%d io=%d\n",written,initial,final,(long long)taken,peak,closed,io_ok);
 return (closed||!io_ok||stop_requested)?1:0;
}
