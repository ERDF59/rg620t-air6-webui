/* The only output is sample/marker counts and peak magnitudes, never PCM.
 * "inspect" is passive. "measure" is called by the gated test-call wrapper. */
#define main unused_original_main
#include "pcm_io.c"
#undef main
int main(int argc,char **argv){
 const int measure=argc==2 && !strcmp(argv[1],"measure");
 if(!measure && (argc!=2 || strcmp(argv[1],"inspect")))return 2;
 snd_config_t *cfg=NULL;snd_ctl_t *ctl=NULL;snd_pcm_t *cap=NULL;int rc=1,card=-1,conflict=0;
 struct front_end fe={"Capture_2",SND_PCM_STREAM_CAPTURE,-1,0};
 struct route rt[]={{"UL2_CH1 PCM_2_CAP_CH1","UL2_CH1 ",0,0,0},{"UL2_CH2 PCM_2_CAP_CH2","UL2_CH2 ",0,0,0}};
 struct markers tone[2]={0};int peak[2]={0};size_t total=0;
 if(config_create(&cfg)<0 || board_card(cfg,&ctl,&card)<0 || front_end(ctl,&fe)<0 ||
    mixer_routes(ctl,rt,2,&conflict)<0 || conflict || !fe.avail)goto out;
 if(!measure){printf("Both independent modem receive routes found\n");rc=0;goto out;}
 struct sigaction sa={0};sa.sa_handler=stop;sigemptyset(&sa.sa_mask);
 if(sigaction(SIGTERM,&sa,NULL)<0 ||sigaction(SIGINT,&sa,NULL)<0 ||sigaction(SIGHUP,&sa,NULL)<0)goto out;
 for(int i=0;i<2;i++)if(!rt[i].initial){if(set_switch(ctl,&rt[i],1)<0)goto out;rt[i].changed=1;}
 char hw[32];snprintf(hw,sizeof(hw),"hw:%d,%d",card,fe.dev);
 if(snd_pcm_open_lconf(&cap,hw,SND_PCM_STREAM_CAPTURE,SND_PCM_NONBLOCK,cfg)<0 ||
    snd_pcm_set_params(cap,SND_PCM_FORMAT_S16_LE,SND_PCM_ACCESS_RW_INTERLEAVED,2,T830_RATE,0,80000)<0 ||
    snd_pcm_start(cap)<0)goto out;
 int64_t start=milliseconds();
 while(!cancelled && total<T830_RATE*5 && milliseconds()-start<6500){
  int16_t sample[T830_WINDOW*2],channel[T830_WINDOW];snd_pcm_sframes_t n=snd_pcm_readi(cap,sample,T830_WINDOW);
  if(n<0 && n!=-EAGAIN){alsa_error("stereo RX",(int)n);goto out;}
  if(n<=0){struct timespec pause={.tv_nsec=1500000};nanosleep(&pause,NULL);continue;}
  for(int k=0;k<2;k++){for(int i=0;i<n;i++){int a=sample[i*2+k];channel[i]=a;if(a<0)a=-a;if(a>peak[k])peak[k]=a;}t830_accumulate(&tone[k],channel,(size_t)n);}
  total+=(size_t)n;
 }
 printf("RX frames=%zu peak_ch1=%d peak_ch2=%d marker_ch1=%u marker_ch2=%u\n",total,peak[0],peak[1],tone[0].remote,tone[1].remote);
 rc=total>=T830_RATE*5?0:1;
out:
 if(cap){snd_pcm_drop(cap);snd_pcm_close(cap);}
 if(ctl){for(int i=1;i>=0;i--)if(rt[i].changed&&set_switch(ctl,&rt[i],rt[i].initial)<0)rc=1;snd_ctl_close(ctl);}
 if(cfg)snd_config_delete(cfg);return rc;
}
