/* Capture_2 -> mono s16le pipe. Sound is never written to a file. */
#define main bench_main
#include "pcm_io.c"
#undef main
#include <unistd.h>
#include <sys/prctl.h>
int main(void){
 int data=dup(1);if(data<0||dup2(2,1)<0)return 2;
 struct sigaction sa={.sa_handler=stop};sigemptyset(&sa.sa_mask);
 sigaction(SIGTERM,&sa,0);sigaction(SIGINT,&sa,0);sigaction(SIGHUP,&sa,0);signal(SIGPIPE,SIG_IGN);
 if(prctl(PR_SET_PDEATHSIG,SIGTERM)||getppid()==1)return 2;
 snd_config_t *cfg=NULL;snd_ctl_t *ctl=NULL;snd_pcm_t *cap=NULL;int card=-1,conflict=0,rc=1;
 struct front_end fe={"Capture_2",SND_PCM_STREAM_CAPTURE,-1,0};
 struct route rt={"UL2_CH1 PCM_2_CAP_CH1","UL2_CH1 ",0,0,0};
 if(config_create(&cfg)<0||board_card(cfg,&ctl,&card)<0||front_end(ctl,&fe)<0||!fe.avail||mixer_routes(ctl,&rt,1,&conflict)<0||conflict)goto out;
 if(!rt.initial){if(set_switch(ctl,&rt,1)<0)goto out;rt.changed=1;}
 char name[40];snprintf(name,sizeof(name),"hw:%d,%d",card,fe.dev);
 if(snd_pcm_open_lconf(&cap,name,SND_PCM_STREAM_CAPTURE,SND_PCM_NONBLOCK,cfg)<0||snd_pcm_set_params(cap,SND_PCM_FORMAT_S16_LE,SND_PCM_ACCESS_RW_INTERLEAVED,2,16000,0,80000)<0||snd_pcm_start(cap)<0)goto out;
 while(!cancelled){int16_t s[640],m[320];snd_pcm_sframes_t n=snd_pcm_readi(cap,s,320);
 if(n==-EAGAIN||n==0){struct timespec d={0,2000000};nanosleep(&d,0);continue;}
 if(n==-EPIPE && snd_pcm_prepare(cap)==0 && snd_pcm_start(cap)==0)continue;
 if(n<0)break;for(int i=0;i<n;i++)m[i]=s[i*2];if(write(data,m,(size_t)n*2)!=n*2)break;} rc=0;
out:if(cap){snd_pcm_drop(cap);snd_pcm_close(cap);}if(ctl){if(rt.changed && set_switch(ctl,&rt,rt.initial)<0)rc=1;snd_ctl_close(ctl);}if(cfg)snd_config_delete(cfg);close(data);return rc;
}
