'use strict';
'require baseclass';
'require rpc';
'require dlink-cellular.radio as cellular';

const rpcMethod=(method,params=[])=>rpc.declare({object:'dlink-cellular',method,params,expect:{'':{}}});
const query=rpcMethod('diag'), readChecks=rpcMethod('diag_checks'), status=rpcMethod('capture_status'), start=rpcMethod('capture_start',['seconds','confirm']),
	stop=rpcMethod('capture_stop'), redial=rpcMethod('wan_redial',['confirm']);
const summary=rpcMethod('summary');
const readWan=rpc.declare({object:'network.interface.wan',method:'status',expect:{'':{}}});
const lookup={baseline:'采集起点',registration:'驻网变化',signal:'信号通知',cell:'服务小区',rrc:'RRC 状态',reject:'接入拒绝'};
const kinds={lte_rach:'LTE 随机接入',nr_rach:'NR 随机接入',lte_rrc:'LTE RRC 建链',nr_rrc:'NR RRC 建链',
	lte_ho:'LTE 切换',nr_ho:'NR 切换',nr_scg:'NR 辅小区组'};
const names={busy:'基带正忙，稍后再读。',timeout:'诊断请求超时。',capture_active:'已有一轮采集在运行。',
	capture_start:'无法启动采集。',capture_stop:'停止失败，请刷新采集状态。',
	wan_missing:'当前 WAN 不是 Quectel 蜂窝接口。',wan_pending:'蜂窝 WAN 正在拨号。',
	wan_down:'无法关闭蜂窝 WAN。',wan_up:'启动 WAN 的请求失败。请在「网络 → 接口」把 WAN 启动。'};
const fmt=cellular.fmt;
const statusLine=(text='')=>E('p',{'class':'dcx-message',role:'status'},[text]);
const btn=(label,action)=>E('button',{'class':'dcx-button',type:'button',click:action},[label]);
const area=(label,content)=>E('section',{'class':'dcx-section'},[
	E('div',{'class':'dcx-section-title'},E('h3',{},[label])),...content]);
const table=(titles,rows)=>E('div',{'class':'dcx-table-wrap'},E('table',{'class':'dcx-table'},[
	E('thead',{},E('tr',{},titles.map(t=>E('th',{scope:'col'},[t])))),
	E('tbody',{},rows.map(row=>E('tr',{},row.map(v=>E('td',{},[v])))))
]));
const dataVal=(label,value)=>E('div',{},[E('dt',{},[label]),E('dd',{},[value])]);
const timeText=t=>t ? new Date(t*1000).toLocaleTimeString('zh-CN',{hour12:false}):'—';
const errorFor=x=>names[x?.error] || '当前诊断数据不可用。';
const validRrc=s=>s===0?'空闲':s===1?'已连接':fmt(s);
function detail(e) {
	switch(e.type) {
	case 'baseline': case 'registration':
		return [e.rat,cellular.operator(e),cellular.registered(e),e.cause?'RIL 原因 '+e.cause:''].filter(Boolean).join(' · ');
	case 'signal': return e.rat+' · RSRP '+fmt(e.rsrp,' dBm');
	case 'cell': return [e.rat,'PCI '+e.pci,e.arfcn?'ARFCN '+e.arfcn:'',e.cell!=='0'?'Cell '+e.cell:''].filter(Boolean).join(' · ');
	case 'rrc': return validRrc(e.mode)+' · 状态 '+e.state+' · 接入 '+e.access+' · 核心网 '+e.core;
	case 'reject': return ['制式 '+e.rat_code,'服务 '+e.service,'附着 '+e.attach,'ESM '+e.esm,'NAS 流程 '+e.proc,'结果 '+e.result].join(' · ');
	default: return '未分类';
	}
}
function bitRat(mask) {
	if(mask==null) return '—';
	const bits=[[1,'GSM'],[2,'WCDMA'],[4,'CDMA'],[8,'EVDO'],[16,'LTE'],[32,'TD-SCDMA'],[64,'NR'],[128,'UMTS']];
	return bits.filter(([b])=>(mask&b)!==0).map(i=>i[1]).join(' + ') || '未报告';
}
function difference(now,previous) {
	if(now==null || previous==null) return '—';
	const a=BigInt(now),b=BigInt(previous);
	return a<b?'计数重置':'+'+(a-b).toString();
}
function save(data) {
	const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
	const link=E('a',{href:url,download:'dlink-ril-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'});
	link.click();
	setTimeout(()=>URL.revokeObjectURL(url),1000);
}

return baseclass.extend({
	create(mutate) {
		let sys=null, port=null, counter=null, checks=null, baseline=null, capture=null;
		let inProgress=false;
		const panel=E('div');
		const network=E('div',{'class':'dcx-diag-panel'},statusLine('正在读取驻网和拨号…'));
		const count=E('div',{'class':'dcx-diag-panel'},statusLine('正在读取基带计数…'));
		const commands=statusLine(), health=statusLine(), summaryText=statusLine(), traceBox=E('div',{'class':'dcx-trace-body'});
		const duration=E('select',{'aria-label':'采集时长'},[
			E('option',{value:'30'},['30 秒']),
			E('option',{value:'120'},['2 分钟']),
			E('option',{value:'300'},['5 分钟'])]);
		duration.value='120';
		const filter=E('select',{'aria-label':'事件类型','class':'dcx-trace-filter'},[
			E('option',{value:''},['全部事件']),
			...Object.entries(lookup).map(([v,t])=>E('option',{value:v},[t]))
		]);
		filter.addEventListener('change',()=>drawTrace());
		const launch=btn('开始采集',async()=>{
			const seconds=Number(duration.value);
			await mutate(launch,commands,()=>start(seconds,true),'开始 RIL 事件采集',
				'采集只保存在路由器内存，到期自动结束。开始新采集会替换上一次记录。',async()=>{
					commands.textContent='已请求启动。'; await refreshCapture();
				});
			drawTrace();
		});
		const halt=btn('停止采集',async()=>{
			halt.disabled=true;
			try {
				const r=await stop();
				commands.textContent=r?.ok?'已停止，记录仍可导出。':errorFor(r);
			} catch(e) { commands.textContent='停止请求未返回。'; }
			await refreshCapture();
		});
		const exportBtn=btn('导出 JSON',()=>{if(capture?.capture?.events?.length) save(capture.capture);});
		const dial=btn('重拨蜂窝 WAN',async()=>{
			await mutate(dial,health,()=>redial(true),'重拨蜂窝 WAN',
				'会短暂断开蜂窝上网。请从 LAN 打开管理页；Wi-Fi 设置和基带配置不变。',async()=>{
					health.textContent='已请求重拨，请等待 WAN 恢复。'; await refreshRead();
				});
			drawRead();
		});
		const reread=btn('读回状态与计数',()=>void refreshRead());

		function drawRead() {
			dial.disabled=port?.proto!=='ql_datacall'||port?.pending===true;
			network.replaceChildren(E('dl',{'class':'dcx-diag-values'},[
				dataVal('驻网',cellular.registered(sys?.register)),
				dataVal('当前制式',fmt(sys?.register?.rat)),
				dataVal('SIM',checks?.sim==='ready'?'就绪':checks?.sim==='pin'?'需要 PIN':checks?.sim==='puk'?'需要 PUK':'—'),
				dataVal('射频状态',checks?.radio===true?'已开启':checks?.radio===false?'已关闭':'—'),
				dataVal('拨号',port?.up===true?'已拨号':port?.pending===true?'拨号中':port?.up===false?'未拨号':'—'),
				dataVal('蜂窝接口',fmt(port?.l3_device)),
				dataVal('制式偏好',checks?.ratmode||bitRat(counter?.preferred)),
				dataVal('漫游设置',counter?.roaming==null?'—':counter.roaming?'允许':'关闭'),
				dataVal('LTE-NR 双连接',counter?.endc==null?'—':counter.endc.restricted?'受限':counter.endc.available?'可用':'未报告可用'),
				dataVal('IMS',checks?.ims===true?'已注册':checks?.ims===false?'未注册':'—'),
				dataVal('驻网拒绝原因',sys?.register?.reject?String(sys.register.reject):'—'),
				dataVal('最近扩展错误',checks?.ceer===0?'未报告错误':fmt(checks?.ceer))
			]));
			if(!counter?.counters) {
				count.replaceChildren(statusLine(counter?.ok?'基带未返回累计计数。':errorFor(counter)));
				return;
			}
			if(!baseline) baseline=counter.counters;
			count.replaceChildren(table(['项目','尝试','失败','链路失败','失败变化'],Object.entries(kinds).map(([k,label])=>{
				const v=counter.counters[k];
				return [label,fmt(v?.attempt),fmt(v?.failure),k.includes('rrc')||k==='nr_scg'?fmt(v?.lost):'—',difference(v?.failure,baseline[k]?.failure)];
			})),statusLine('变化量从本页首次成功读取起算。'));
		}
		async function refreshRead() {
			reread.disabled=true;
			const [s,p]=await Promise.all([summary().catch(()=>null),readWan().catch(()=>null)]);
			sys=s; port=p;
			counter=await query().catch(()=>null);
			drawRead();
			checks=await readChecks().catch(()=>null);
			drawRead(); reread.disabled=false;
		}
		function drawTrace() {
			const r=capture;
			const buffer=r?.capture, events=buffer?.events || [], running=r?.running===true;
			launch.disabled=running || !r?.ok;
			halt.disabled=!running; duration.disabled=running; exportBtn.disabled=events.length===0;
			const visible=events.filter(e=>!filter.value||e.type===filter.value).slice(-40).reverse();
			const channels=buffer?.channels ? Object.keys(buffer.channels).filter(k=>buffer.channels[k]).map(k=>lookup[k]).join(' · '):'';
			summaryText.textContent=!r?.ok ? errorFor(r) : !buffer
				? (running?'正在启动采集…':'尚未采集。不会在后台自动启动。')
				: (running?'采集中':buffer.ended?'已结束':'采集进程已退出')+' · '+timeText(buffer.started)+(buffer.ended?' → '+timeText(buffer.ended):'')+
				  ' · 已收到 '+buffer.total+' 条'+(buffer.dropped?'（滚动淘汰 '+buffer.dropped+' 条）':'');
			const messages=[];
			if(buffer?.error) messages.push(statusLine('采集出错：'+buffer.error));
			if(channels) messages.push(statusLine('已订阅：'+channels));
			if(visible.length) messages.push(table(['时间','事件','关键字段'],visible.map(e=>[timeText(e.at),lookup[e.type]||e.type,detail(e)])));
			else if(buffer) messages.push(statusLine(filter.value?'这轮采集未收到所选事件。':(running?'正在等待 RIL 通知。':'这轮采集未收到 RIL 通知。')));
			traceBox.replaceChildren(...messages);
		}
		async function refreshCapture() {
			if(inProgress) return;
			inProgress=true;
			try {capture=await status();}
			catch(e) {capture=null;}
			finally {inProgress=false;drawTrace();}
		}
		panel.append(
			area('RIL 事件时间线',[
				statusLine('记录驻网、小区、RRC、拒绝和信号通知。只保存解码后的事件摘要。'),
				E('div',{'class':'dcx-actions dcx-diag-controls'},[duration,launch,halt,exportBtn,filter]),
				summaryText,commands,traceBox]),
			E('div',{'class':'dcx-twocol'},[
				area('驻网与拨号',[network,E('div',{'class':'dcx-actions'},[reread,dial]),health]),
				area('接入与切换累计计数',[count])])
		);
		return {panel,refreshCapture,refreshRead};
	}
});
