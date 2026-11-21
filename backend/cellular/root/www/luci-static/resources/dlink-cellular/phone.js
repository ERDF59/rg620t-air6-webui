'use strict';
'require baseclass';
'require rpc';
'require dlink-cellular.webvoice as webvoice';

const api=(method,params=[])=>rpc.declare({object:'dlink-cellular',method,params,expect:{'':{}}});
const status=api('voice_status'), call=api('voice_dial',['number','confirm']),
	pickup=api('voice_answer',['id','confirm']), end=api('voice_hangup',['id','confirm']),
	tone=api('voice_dtmf',['id','key','confirm']);
const marker=rpc.declare({object:'dlink-media',method:'uplink_marker',params:['id','confirm'],expect:{'':{}},timeout:25});
const downlink=rpc.declare({object:'dlink-media',method:'downlink_marker',params:['id','confirm'],expect:{'':{}},timeout:25});
const states=['已接通','保持','拨号中','等待对方接听','来电响铃','呼叫等待','正在挂断'];
const digits=['1','2','3','4','5','6','7','8','9','*','0','#'];
const mobile=/^1[3-9]\d{9}$/;
const node=(tag,attrs,content)=>E(tag,attrs,Array.isArray(content)?content:[content]);
const btn=(text,fn,attrs={})=>node('button',Object.assign({type:'button',class:'dcx-button',click:fn},attrs),text);
const hint=(text,attrs={})=>node('p',Object.assign({class:'dcx-message'},attrs),text);
const normalize=s=>s.trim().replace(/[ -]/g,'');
const errorNames={dtmf_setup:'按键接口未就绪，本次没有发送。',dtmf_rejected:'基带拒绝了按键。',dtmf_unconfirmed:'未获得基带确认，没有自动重发。',busy:'基带忙，请稍候。',voice_status_unavailable:'基带没有返回通话状态。',
	voice_timeout:'请求超时，先看通话状态，不要重复操作。',voice_rejected:'基带或网络拒绝这次请求。',
	voice_unconfirmed:'没有收到通话操作确认，请读回状态。',call_present:'已有通话。',call_changed:'通话对象已变，请核对状态。',
	not_active:'语音通话接通后才能发送按键。',not_ringing:'当前没有这通响铃来电。'};

return baseclass.extend({
	create(mutate) {
		let sys, refreshing=false, sending=false, waiting=null, generation=0;
		const stamp=hint('',{class:'dcx-updated'});
		const live=hint('正在读取通话状态…',{role:'status'});
		const notice=hint('',{role:'status'});
		const number=node('input',{type:'tel',inputmode:'tel','aria-label':'电话号码',autocomplete:'off',maxlength:22,
			placeholder:'输入电话号码'},[]);
		const stateBox=node('div',{class:'dcx-phone-status'},[
			node('h3',{},'通话状态'),live,notice,stamp
		]);

		const getOne=()=>sys?.ok && sys.calls?.length===1 && (sys.calls[0].kind===0 || sys.calls[0].voice===true)?sys.calls[0]:null;
		const idle=()=>sys?.ok && !sys.read_only && !waiting && sys.calls?.length===0;
		function requested(op) {
			generation++;
			waiting={op,at:Date.now()};
			notice.textContent='请求已送达，等待基带确认…';
			draw(); return refresh();
		}
		const hasTone=()=>!waiting && getOne()?.state===0;
		const enter=async k=>{
			if (sending) return;
			if (hasTone()) {
				sending=true;
				notice.textContent='正在发送 '+k+'…';
				draw();
				try {
					const r=await tone(String(getOne().id),k,true);
					notice.textContent=r?.ok && r.ack==='modem'?'基带已确认按键 '+k+'。':(errorNames[r?.error] || '按键请求未成功。');
				} catch(e) { notice.textContent='按键请求没有返回。'; }
				finally { sending=false; draw(); }
			} else if (idle() && /^\d$/.test(k) && number.value.length<22) {
				number.value+=k; draw();
			}
		};
		const pad=digits.map(k=>btn(k,()=>void enter(k),{class:'dcx-button dcx-digit','aria-label':'按键 '+k}));
		const padGroup=node('div',{class:'dcx-dialpad',role:'group','aria-label':'电话按键'},pad);
		padGroup.addEventListener('keydown',e=>{
			if(digits.includes(e.key) && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
				e.preventDefault(); void enter(e.key);
			}
		});
		const dial=btn('拨打',async()=>{
			const local=normalize(number.value);
			if (!/^\+?\d{3,15}$/.test(local) || !idle()) return;
			const target=mobile.test(local)?'+86'+local:local;
			await mutate(dial,notice,()=>call(target,true),'拨打 SIM 电话',
				'拨打 '+target+'？可能产生话费。接通后可单独启用网页音频。',
				()=>requested('dial'));
			draw();
		});
		const answer=btn('接听',async()=>{
			const c=getOne();
			if (!c || c.state!==4 || c.direction!==1) return;
			await mutate(answer,notice,()=>pickup(String(c.id),true),'接听来电',
				'接听 '+(c.number||'此来电')+'？接通后可单独启用网页音频。',
				()=>requested('answer'));
			draw();
		});
		const hang=btn('挂断',async()=>{
			const c=getOne();
			if (!c || c.state>5) return;
			await mutate(hang,notice,()=>end(String(c.id),true),'挂断电话',
				'结束当前这通电话？',()=>requested('hangup'));
			draw();
		});
		const clear=btn('退格',()=>{
			if(!idle()) return;
			number.value=number.value.slice(0,-1);
			draw();
		});
		number.addEventListener('input',draw);
		number.addEventListener('keydown',e=>{
			if(e.key==='Enter' && !e.repeat && !dial.disabled) {e.preventDefault();dial.click();}
		});

		function draw() {
			const one=getOne(), okay=sys?.ok===true;
			if(okay && sys.calls?.length===0)
				live.textContent=waiting?.op==='dial'?'尚未读到新通话':(sys.read_only?'当前没有通话 · 仅状态可读':'当前没有通话');
			else if(okay && one) {
				const who=one.direction===1?'来电':'去电';
				live.textContent=who+' · '+(states[one.state]||'状态未识别')+(one.number?' · '+one.number:'');
			} else if(okay && sys.calls?.length) {
				live.textContent=sys.calls.map(c=>(c.direction===1?'来电 · ':c.direction===0?'去电 · ':'')+(states[c.state]||'状态未识别')).join('；')+' · 仅查看';
			} else live.textContent=errorNames[sys?.error]||'基带通话状态暂不可用。';
			audioPanel.update();
			markerButton.disabled=rxButton.disabled=audioPanel.busy() || checking || !one || one.state!==0;
			const ready=Boolean(idle());
			number.disabled=!ready; clear.disabled=!ready||!number.value;
			dial.disabled=!ready||!/^\+?\d{3,15}$/.test(normalize(number.value));
			answer.disabled=!!waiting || !(one?.state===4 && one?.direction===1);
			hang.disabled=!!waiting || !(one && one.state>=0 && one.state<=5);
			for(let i=0;i<pad.length;i++) pad[i].disabled=sending||!(hasTone() || (ready && /^\d$/.test(digits[i])));
			padTitle.textContent=hasTone()?'通话按键 · DTMF':'拨号盘';
		}
		async function refresh() {
			if (refreshing||sending) return;
			const started=generation;
			refreshing=true;
			try {
				const next=await status();
				if(started!==generation) return;
				sys=next;
				if(next?.ok) {
					stamp.textContent='通话状态更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});
					const calls=next.calls||[];
					if(waiting && ((waiting.op==='dial' && calls.some(c=>c.direction!==1 && [0,2,3].includes(c.state))) ||
					   (waiting.op==='answer' && calls.some(c=>c.state===0)) ||
					   (waiting.op==='hangup' && !calls.length))) {
						waiting=null; notice.textContent='';
					}
				}
			} catch(e) {if(started===generation) sys=null;}
			finally {
				refreshing=false;
				if(waiting && Date.now()-waiting.at>=15000) {
					waiting=null;
					notice.textContent='未确认上次操作的结果，请先核对通话状态。';
				}
				draw();
			}
		}
		let checking=false;
		const audioPanel=webvoice.create(getOne,()=>Boolean(!checking && !waiting && sys?.browser_audio && !sys?.read_only),draw);
		const testNote=hint('通话接通后点击测试。三声短音改走上行混音，电脑不播放，也不使用麦克风。',{role:'status'});
		const markerButton=btn('测试手机听筒（上行）',async()=>{
			const c=getOne();
			if(!c || c.state!==0 || checking) return;
			checking=true;draw();testNote.textContent='正在向通话对端发送三声短音，请听手机听筒…';
			try {
				const v=await marker(String(c.id),true);
				testNote.textContent=v?.ok?({not_drained:'测试音未从语音服务的队列取走。可以挂断，诊断结果已保留。',partial:'测试音只传了一部分。可以挂断，诊断结果已保留。',drained:'测试音已从语音队列读出。是否有声，以手机听筒为准。'}[v.phase]||'设备已返回，请核对手机听筒。'):
					({route_unsupported:'请先更新路由器的语音服务。',busy:'另一个测音正在运行。',call_changed:'通话已变化，请确认仍在接通状态。',speech_offline:'原厂语音服务尚未就绪。',speech_open:'基带语音会话未打开。'}[v?.error]||'基带未确认接收测试音。');
			}catch(e){testNote.textContent='测音结果未返回，请先查看通话状态。';}
			finally{checking=false;draw();}
		});
		const rxNote=hint('手机不要静音，把手机麦克风靠近电脑扬声器。点击后电脑会播放一小段测试音；路由器只计数，不录音。',{role:'status'});
		const rxButton=btn('测试手机回传（下行）',async()=>{
			const c=getOne();
			if(!c || c.state!==0 || checking)return;
			checking=true;draw();
			let ctx;
			try{
				ctx=new AudioContext();await ctx.resume();
				if(ctx.state!=='running')throw new Error('speaker');
				const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;
				osc.frequency.value=1150;gain.gain.setValueAtTime(0,t);
				for(let i=0;i<16;i++){const at=t+0.05+i*.65;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.12,at+.012);gain.gain.setValueAtTime(.12,at+.39);gain.gain.linearRampToValueAtTime(0,at+.41);}
				osc.connect(gain);gain.connect(ctx.destination);osc.start(t+.04);osc.stop(t+10.55);
				rxNote.textContent='请让手机麦克风听到电脑的测试音…';
				const v=await downlink(String(c.id),true);
				rxNote.textContent=!v?.ok?(errorNames[v?.error]||'未完成接收测试，请核对通话状态。'):
					v.detected?'路由器已从这通电话中识别出电脑播放的测试音。':'没有从手机回传中识别出测试音；诊断结果已保留。';
			}catch(e){rxNote.textContent='播放或测量未完成。请检查电脑的声音输出和通话状态。';}
			finally{if(ctx)await ctx.close().catch(()=>{});checking=false;draw();}
		});
		const padTitle=node('h3',{},'拨号盘');
		const panel=node('div',{class:'dcx-phone'},[
			node('div',{class:'dcx-phone-dial'},[padTitle,number,padGroup,
				node('div',{class:'dcx-actions'},[dial,clear])]),
			node('div',{},[stateBox,
				node('div',{class:'dcx-actions'},[answer,hang]),
				hint('已接通后，用拨号盘按数字、* 或 # 选择语音菜单。'),
				audioPanel.panel,
				node('details',{class:'dcx-audio-tools'},[node('summary',{},'音频诊断'),markerButton,testNote,rxButton,rxNote])
			])
		]);
		draw();
		return {panel,refresh,leave:audioPanel.leave};
	}
});
