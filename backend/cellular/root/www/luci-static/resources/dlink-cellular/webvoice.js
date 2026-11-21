'use strict';
'require baseclass';
'require rpc';

const method=(name,params)=>rpc.declare({object:'dlink-webvoice',method:name,params,expect:{'':{}},timeout:15});
const open=method('open',['id','direction','number','offer','confirm']),pulse=method('pulse',['token']),close=method('close',['token']);
const button=(label,fn)=>E('button',{type:'button',class:'dcx-button',click:fn},label);
const errors={busy:'音频正被另一页面或诊断占用。',call_changed:'通话已变化，请刷新后再连接。',offline:'路由器音频服务未就绪。',lan:'没有可用的局域网音频地址。',rtc:'未能建立加密音频连接。',invalid_offer:'浏览器没有提供兼容的语音格式。',session_closed:'通话已结束，或音频连接已关闭。'};
const key=c=>c&&c.state===0?[c.id,c.direction,c.number||''].join(':'):'';
return baseclass.extend({
 create(getCall,available,redraw){
  let serial=0, session=null, phase='off', note='',muted=false, blocked=false,connected=false,live=false,remoteFlow=false,checking=false;
  const secure=window.isSecureContext&&!!navigator.mediaDevices?.getUserMedia&&typeof RTCPeerConnection==='function';
  const el=E('audio',{autoplay:'',playsinline:''});el.autoplay=true;
  const title=E('h3',{},'通话音频'),status=E('p',{class:'dcx-audio-state',role:'status'}),detail=E('p',{class:'dcx-message'});
  const link=E('a',{class:'dcx-button',href:'https://'+location.hostname+location.pathname+'#phone'},'打开 HTTPS 电话页');
  const connect=button('启用麦克风和扬声器',()=>start());
  const mute=button('静音麦克风',()=>{if(!session?.mic)return;muted=!muted;for(const t of session.mic.getAudioTracks())t.enabled=!muted;draw();});
  const speaker=button('播放通话声音',async()=>{try{await el.play();blocked=false;draw();}catch{note='请检查浏览器的声音权限和输出设备。';draw();}});
  const end=button('断开音频',()=>stop('已断开网页音频，电话仍由 SIM 保持。'));
  const controls=E('div',{class:'dcx-actions dcx-audio-actions'},[connect,mute,speaker,end,link]);
  const panel=E('section',{class:'dcx-webvoice','aria-label':'网页通话音频'},[title,status,detail,controls,el]);
  const show=(node,b)=>{node.hidden=!b;node.style.display=b?'':'none';};
  function draw(){
   const active=!!session, possible=Boolean(key(getCall()))&&available();
   panel.dataset.phase=phase;show(link,!secure&&location.protocol==='http:');show(connect,secure&&!active);connect.disabled=!possible;
   show(mute,active&&!!session.mic);show(end,active);show(speaker,active&&blocked);mute.textContent=muted?'取消麦克风静音':'静音麦克风';mute.setAttribute('aria-pressed',String(muted));
   const states={off:'未连接',permission:'等待麦克风授权',linking:'正在连接路由器',media:'正在等待双向音频',live:muted?'通话音频已连接 · 麦克风静音':'通话音频已连接'};
   status.textContent=states[phase]||states.off;
   detail.textContent=note || (!secure?(location.protocol==='http:'?'麦克风需要 HTTPS。原页面仍可拨号和接听。':'此浏览器未提供麦克风接口，请检查站点证书和权限。'):active?(blocked?'浏览器暂停了播放，点下方按钮打开听筒声音。':phase==='live'?'对方的声音从本机播放。断开音频不会挂断电话。':'连接只用于当前通话。'):!possible?'电话接通后，可使用本机的麦克风和扬声器。':'启用后，麦克风的声音将发送给通话对方。');
  }
  function stop(message=''){
   ++serial;const old=session;session=null;phase='off';note=message;connected=live=remoteFlow=checking=muted=blocked=false;
   if(old){clearInterval(old.timer);clearTimeout(old.deadline);old.pc && (old.pc.onconnectionstatechange=null);old.mic?.getTracks().forEach(t=>t.stop());old.pc?.close();if(old.token)close(old.token).catch(()=>{});}
   el.pause();el.srcObject=null;draw();redraw();
  }
  async function start(){
   const c=getCall();if(session||!secure||!available()||!key(c))return;
   const cur={id:key(c),serial:++serial};session=cur;phase='permission';note='';draw();redraw();
   const valid=()=>session===cur&&key(getCall())===cur.id;
   try{
    const mic=await navigator.mediaDevices.getUserMedia({video:false,audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    if(!valid()){mic.getTracks().forEach(t=>t.stop());if(session===cur)stop('通话已变化。');return;}
    cur.mic=mic;const pc=new RTCPeerConnection({iceServers:[]});cur.pc=pc;phase='linking';draw();
    mic.getAudioTracks()[0].onended=()=>{if(valid())stop('麦克风已断开。');};
    pc.addTrack(mic.getAudioTracks()[0],mic);
    pc.ontrack=e=>{if(!valid())return;el.srcObject=e.streams[0]||new MediaStream([e.track]);el.play().catch(()=>{if(valid()){blocked=true;draw();}});};
    pc.onconnectionstatechange=()=>{if(!valid())return;if(pc.connectionState==='connected'){connected=true;phase='media';draw();}
     if(['failed','closed','disconnected'].includes(pc.connectionState))stop('连接已断开；可重新启用音频。');};
    await pc.setLocalDescription(await pc.createOffer());if(!valid())return;
    const r=await open(String(c.id),c.direction,c.number||'',pc.localDescription.sdp,true);
    if(!valid()){if(r?.token)close(r.token).catch(()=>{});return;}
    if(!r?.ok)throw new Error(errors[r?.error]||'音频服务没有接受连接。');
    cur.token=r.token;await pc.setRemoteDescription({type:'answer',sdp:r.answer});if(!valid())return;
    const beat=async()=>{if(checking||!valid())return;checking=true;
     try{const v=await pulse(cur.token);if(!valid())return;if(!v?.ok){stop(errors[v?.error]||'音频服务已停止。');return;}
      if(connected&&v.ready){const stats=await pc.getStats();if(!valid())return;stats.forEach(x=>{if(x.type==='inbound-rtp'&&(x.kind==='audio'||x.mediaType==='audio')&&x.packetsReceived>0)remoteFlow=true;});
       if(remoteFlow){live=true;phase='live';clearTimeout(cur.deadline);draw();}}
     }catch{if(valid())stop('无法联系路由器，已释放麦克风。');}finally{if(valid())checking=false;}};
    cur.timer=setInterval(beat,2000);cur.deadline=setTimeout(()=>{if(valid()&&!live)stop('没有收到双向音频，请确认连接的是路由器局域网。');},16000);beat();
   }catch(e){if(session!==cur)return;const reason={NotAllowedError:'浏览器未允许使用麦克风，请在地址栏的站点权限中开启。',NotFoundError:'未找到麦克风。',NotReadableError:'麦克风不可用，可能被其他程序占用。'};stop(reason[e.name]||e.message||'音频连接失败。');}
  }
  function update(){if(session&&(!available()||key(getCall())!==session.id)){stop('通话已变化，网页音频已关闭。');return;}draw();}
  window.addEventListener('pagehide',()=>{if(session)stop();});
  draw();return {panel,update,busy:()=>!!session,leave:()=>{if(session)stop();}};
 }
});
