#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/time.h>
#include <sys/prctl.h>
#include <unistd.h>
#include <time.h>
#include "speech_drv.h"
static volatile sig_atomic_t stopped;
static void stop(int s){(void)s;stopped=1;}
static int req(SPH_REQ r){
 struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,"/var/run/t830-speech-root/tmp/socket-sphdrv");
 int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);if(fd<0)return -1;int ret=-1;
 struct timeval tv={1,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof(tv));
 SPH_MSG p={0};strcpy(p.cmd,"ACK");if(connect(fd,(void*)&a,sizeof(a)))goto end;
 if(send(fd,&p,sizeof(p),MSG_NOSIGNAL)!=sizeof(p)||recv(fd,&p,sizeof(p),MSG_WAITALL)!=sizeof(p)||strncmp(p.cmd,"READY",sizeof(p.cmd)))goto end;
 memset(&p,0,sizeof(p));p.req=r;strcpy(p.cmd,"REQ");
 if(send(fd,&p,sizeof(p),MSG_NOSIGNAL)==sizeof(p)&&recv(fd,&p,sizeof(p),MSG_WAITALL)==sizeof(p)&&p.req.id==r.id&&!strncmp(p.cmd,"REQ",sizeof(p.cmd)))ret=p.result;
end:close(fd);return ret;
}
int main(int argc,char **argv){
 if(argc==2 && !strcmp(argv[1],"status")){int r=req((SPH_REQ){.id=GET_UL_MUTE});return r==0||r==1?0:1;}
 if(argc!=1)return 2;
 struct sigaction a={.sa_handler=stop};sigemptyset(&a.sa_mask);sigaction(SIGTERM,&a,0);sigaction(SIGINT,&a,0);signal(SIGPIPE,SIG_IGN);
 if(prctl(PR_SET_PDEATHSIG,SIGTERM)||getppid()==1)return 2;
 int rc=1;SPH_REQ v={.id=SET_SPEECH_ON,.speechOn=true,.inputDevice=AUDIO_DEVICE_IN_BUILTIN_MIC,.outputDevice=AUDIO_DEVICE_OUT_SPEAKER};
 if(req(v)!=0)goto close_voice;
 if(stopped||req((SPH_REQ){.id=BGS_OPEN,.sampleRate=32000,.switchOn=true})!=0)goto close_bgs;
 while(!stopped){
  SPH_REQ b={.id=BGS_WRITE,.dataSize=1280};int have=0;
  while(!stopped&&have<1280){ssize_t n=read(0,b.dataBuf+have,1280-have);if(n<=0)goto close_bgs;have+=n;}
  int i,q;for(i=0;i<50&&!stopped;i++){q=req((SPH_REQ){.id=BGS_BUFFER_COUNT});if(q<0||q>5120)goto close_bgs;if(q<=2560)break;struct timespec d={0,4000000};nanosleep(&d,0);}
  if(stopped||i==50||req(b)!=1280||write(1,".",1)!=1)break;
 } rc=0;
close_bgs:req((SPH_REQ){.id=BGS_CLOSE});
close_voice:v.speechOn=false;req(v);return rc;
}
