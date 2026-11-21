'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require dlink-cellular.sms as smsCodec';
'require dlink-cellular.radio as cellular';
'require dlink-cellular.diagnostics as diagnostics';
'require dlink-cellular.phone as phoneView';

const api = (method, params=[]) => rpc.declare({ object:'dlink-cellular', method, params, expect:{ '':{} } });
const radio=api('overview'), readQos=api('qos',['rat']), getLocks=api('locks'), access=api('access'),
	setBand=api('band_set',['rat','bands','confirm']), setCell=api('cell_set',['rat','arfcn','pci','confirm']),
	clearCell=api('cell_clear',['confirm']), putList=api('cell_list_set',['cells','confirm']),
	clearList=api('cell_list_clear',['confirm']), inbox=api('sms_list'), read=api('sms_read',['index']),
	send=api('sms_send',['to','body','confirm']);
const wan=rpc.declare({object:'network.interface.wan',method:'status',expect:{'':{}}});
const { missing, fmt:f, operator, registered, signalFor }=cellular;
const errors={password_required:'请先设置 LuCI 管理员密码。', busy:'基带正在处理另一项请求，请稍候再刷新。',
	timeout:'基带没有及时返回。请先读回状态；短信不要立即重复发送。', input:'输入无效，请检查所选频段、小区参数或短信内容。',
	capture_active:'已有一轮采集在运行。',capture_start:'无法启动采集。',
	wan_missing:'当前 WAN 不是 Quectel 蜂窝接口。',wan_pending:'蜂窝 WAN 正在拨号。',
	wan_down:'无法关闭蜂窝 WAN。',wan_up:'启动 WAN 的请求失败。请在「网络 → 接口」把 WAN 启动。',
	voice_timeout:'请求超时，先核对状态再操作。',voice_unconfirmed:'基带没有确认，请读回通话状态。',
	voice_rejected:'基带或网络拒绝了请求。',call_present:'已有一通电话。',call_changed:'通话对象已变，请核对状态。',
	not_ringing:'来电已不在响铃状态。',voice_status_unavailable:'基带没有返回通话状态。',
	readback:'基带没有确认目标设置。请核对当前读回，必要时解除锁定或恢复全部频段。',
	sms_read:'这条短信已不存在或无法读取。', sms_send:'基带未接受发送请求。',
	band_read:'基带无法读取频段设置。', band_write:'基带拒绝了频段设置。',cell_write:'基带拒绝了小区锁定。',
	cell_read:'基带无法读取小区锁定状态。',single_lock:'当前有单小区锁定，请先解除，再提交白名单。',
	cell_list_write:'基带拒绝白名单请求。',cell_duplicate:'白名单有重复小区。',cell_min:'白名单至少选两个小区。',sms_list:'基带无法读取短信存储。'};
const asError = (r) => r && r.ok===true ? '' : ((errors[r?.error] || '暂时无法读取基带。') + (r?.code ? '（RIL '+r.code+'）' : ''));
const msg = (str) => E('p',{'class':'dcx-message',role:'status'},[str]);
const button = (label,fn,extra={}) => {
	const node=E('button',Object.assign({type:'button','class':'dcx-button',click:fn},extra),[label]);
	node.disabled=extra.disabled===true;
	return node;
};
const section = (title, details, children) => E('section',{'class':'dcx-section'},[
	E('div',{'class':'dcx-section-title'},[E('h3',{},title),details?E('span',{},details):null]),...children]);
const field = (label, input) => E('label',{'class':'dcx-field'},[E('span',{},label),input]);
const datum=(title,value)=>E('div',{},[E('dt',{},title),E('dd',{},value)]);
const grid=(columns,rows,empty)=> rows.length ? E('div',{'class':'dcx-table-wrap'},[
	E('table',{'class':'dcx-table'},[E('thead',{},E('tr',{},columns.map(c=>E('th',{scope:'col'},c)))),
		E('tbody',{},rows.map(row=>E('tr',{},row.map(value=>E('td',{},value)))))])]) : msg(empty);
const validCell = (system, frequency, phys) =>
	/^(NR|LTE)$/.test(system) && /^\d+$/.test(frequency) && /^\d+$/.test(phys) &&
	Number(frequency)<=(system==='NR'?3279165:262143) && Number(phys)<=(system==='NR'?1007:503);
const keyOf = x => [x.rat,x.arfcn,x.pci].join(':');
const mobile = /^1[3-9]\d{9}$/;
const rate = x => x == null ? missing : (x / 1000).toLocaleString('zh-CN',{useGrouping:false,maximumFractionDigits:3})+' Mbps';
const baud=(x)=>x?.bw?x.bw+' MHz':missing;
const bandLabel=(x)=>(x.rat==='NR'?'n':'B')+x.band;
const cellText=(x)=>x ? [x.rat==='NR'?'5G NR':x.rat, x.arfcn, x.opt===2?'仅频点':'PCI '+x.pci].join(' · ') : missing;

return view.extend({
	handleSaveApply:null, handleSave:null, handleReset:null,

	render() {
		this.selected='signal'; this.snapshot=undefined; this.stamp=null; this.pending=false; this.draft=new Map(); this.listAck='';
		this.body=E('div',{'class':'dcx-body',id:'dcx-panel',role:'region','aria-label':'蜂窝管理内容'});
		this.tabs=['signal','locks','sms','phone','diag'].map((id,i)=>button(['信号与小区','锁频与锁小区','短信','电话','诊断'][i],()=>this.open(id),{'class':'dcx-tab','data-tab':id,'aria-controls':'dcx-panel'}));
		this.last=E('span',{'class':'dcx-updated','aria-live':'polite'},'');
		const app=E('div',{'class':'dcx', 'data-ui':'overview'},[
			E('link',{rel:'stylesheet',href:L.resource('dlink-cellular/cellular.css')}),
			E('div',{'class':'dcx-head'},[
				E('div',{},[E('div',{'class':'dcx-device'},'D-LINK / DWR-BE7200G'),E('h2',{},'蜂窝管理')]),
				E('div',{'class':'dcx-refresh'},[this.last,button('刷新',()=>this.refresh())])]),
			E('nav',{'class':'dcx-nav','aria-label':'蜂窝功能'},this.tabs),
			this.body]);
		this.open(location.hash==='#phone'?'phone':'signal');
		poll.add(()=>{if(this.selected==='signal' && app.isConnected && !this.pending && !document.hidden) return this.refresh(false);},10);
		poll.add(()=>{
			if(document.hidden) return;
			if(this.selected==='diag' && this.diag?.panel.isConnected) return this.diag.refreshCapture();
			if(this.selected==='phone' && this.phone?.panel.isConnected) return this.phone.refresh();
		},2);
		return app;
	},

	async open(tab, preset=null) {
		if(this.selected==='phone' && tab!=='phone') this.phone?.leave();
		this.selected=tab;
		this.preset=preset;
		for (const t of this.tabs) t.setAttribute('aria-current', t.dataset.tab===tab?'page':'false');
		this.body.replaceChildren(msg('正在读取…'));
		await this.refresh();
	},

	async refresh(manual=true) {
		const page=this.selected;
		if (this.pending) return;
		this.pending=true;
		const handle=manual?this.body.querySelector('[aria-live]'):null;
		if (handle) handle.textContent='正在读取…';
		try {
			if (page==='signal') {
				const [s,w]=await Promise.all([radio(),wan().catch(()=>null)]);
				if(this.selected!==page) return;
				const issue=asError(s);
				if(issue) this.body.replaceChildren(msg(issue));
				else {
					this.snapshot=s;
					this.body.replaceChildren(this.signal(s,w));
					this.stamp=new Date();
				}
			} else {
				const a=await access();
				if (this.selected!==page) return;
				if (asError(a)) this.body.replaceChildren(msg(asError(a)));
				else if (page==='locks') {
					const state=await getLocks();
					if (this.selected===page) this.body.replaceChildren(this.lockForm(state,a.protected));
				} else if (page==='phone') {
					if(!a.protected) this.body.replaceChildren(this.passwordNote('设置管理员密码后可使用电话。'));
					else {
						this.phone ??= phoneView.create(this.mutate.bind(this));
						this.body.replaceChildren(this.phone.panel);
						await this.phone.refresh();
					}
				} else if (page==='diag') {
					if(!a.protected) this.body.replaceChildren(this.passwordNote('设置管理员密码后可使用蜂窝诊断。'));
					else {
						this.diag ??= diagnostics.create(this.mutate.bind(this));
						this.body.replaceChildren(this.diag.panel);
						await Promise.all([this.diag.refreshCapture(),this.diag.refreshRead()]);
					}
				} else if (!a.protected) this.body.replaceChildren(this.passwordNote('设置密码后，才允许读取和发送短信。'));
				else {
					const s=await inbox();
					if (this.selected===page) this.body.replaceChildren(this.sms(s));
				}
			}
			if(this.selected===page) this.last.textContent=page==='signal' && this.stamp?'信号 '+this.stamp.toLocaleTimeString('zh-CN',{hour12:false}):'';
		} catch(e) {
			if(this.selected===page) this.body.replaceChildren(msg('读取失败，请刷新后重试。'));
		} finally {
			this.pending=false;
			if (page!==this.selected) void this.refresh();
		}
	},

	signal(s,w) {
		const r=s.register, signal=signalFor(s);
		const reg=registered(r), carrier=operator(r);
		const primary=(s.carriers||[]).find(x=>x.primary && x.rat==='NR') || (s.carriers||[]).find(x=>x.primary);
		const cid=r?.cell && r.cell!=='0'?r.cell:null;
		const used=new Set((s.carriers||[]).filter(x=>x.primary).map(x=>[x.rat,x.arfcn,x.pci].join(':')));
		const chooser=x=>button('使用此小区',()=>this.open('locks',x),{'class':'dcx-link'});
		const cells=(s.cells||[]).map(c=>[
			c.rat, used.has([c.rat,c.arfcn,c.pci].join(':'))?'主小区':'测量小区',
			f(c.arfcn),f(c.pci),c.cell==='0'?missing:c.cell,f(c.rsrp,' dBm'),chooser(c)]);
		const carriers=(s.carriers||[]).map(c=>[
			bandLabel(c),c.primary?'主载波':c.state===2?'辅载波 · 已激活':c.state===1?'辅载波 · 未激活':'辅载波',
			baud(c),f(c.arfcn),f(c.pci),chooser(c)]);
		const stats=(key, title)=>datum(title, signal ? (key==='sinr10' && signal[key]!=null?f(signal[key]/10,' dB'):f(signal[key],key==='rssi'?' dBm':' dB')):missing);
		return E('div',{},[
			E('div',{'class':'dcx-radio'},[
				E('div',{'class':'dcx-lead'},[
					E('div',{'class':'dcx-caption'},carrier+' · '+(r?.rat || '制式未返回')+' · '+reg),
					E('div',{'class':'dcx-rsrp'},[E('strong',{},f(signal?.rsrp)),E('span',{},'dBm · RSRP')]),
					E('div',{'class':'dcx-caption'},primary?'主载波 '+bandLabel(primary)+' / '+baud(primary):'主载波未返回')
				]),
				E('dl',{'class':'dcx-metrics'},[
					stats('rsrq','RSRQ'),stats('sinr10','SINR'),stats('rssi','RSSI'),
					datum('蜂窝数据',w?.up===true?'已拨号':w?.up===false?'未拨号':missing),
					datum('Cell ID',f(cid)),datum('TAC',r?.tac?String(r.tac):missing)])
			]),
			E('div',{'class':'dcx-ambr',title:'基带报告的数据会话速率上限，不是测速结果'},[
				E('span',{'class':'dcx-caption'},'数据签约速率 · AMBR'),
				E('strong',{},'下行 '+rate(s.ambr?.net_dl)),E('strong',{},'上行 '+rate(s.ambr?.net_ul)),
				s.ambr && (s.ambr.ims_dl!=null || s.ambr.ims_ul!=null) ?
					E('span',{'class':'dcx-caption'},'IMS ↓ '+rate(s.ambr.ims_dl)+' / ↑ '+rate(s.ambr.ims_ul)) : null]),
			this.qosLine(r,w),
			r?.reject ? msg('注册拒绝码：'+r.reject) : null,
			s.nr && s.lte ? msg('LTE 锚点：RSRP '+f(s.lte.rsrp,' dBm')+' · RSRQ '+f(s.lte.rsrq,' dB')+' · SINR '+(s.lte.sinr10==null?missing:f(s.lte.sinr10/10,' dB'))) : null,
			section('当前载波',carriers.length?'聚合与主辅载波':'',[
				grid(['频段','角色','下行带宽','下行 ARFCN','PCI','操作'],carriers,s.carriers==null?'基带载波数据不可用。':'基带未返回正在使用的载波。')]),
			section('小区测量','基带已返回 '+cells.length+' 条',[
				grid(['制式','角色','下行 ARFCN','PCI','Cell ID','RSRP','操作'],cells,s.cells==null?'小区测量不可用。':'没有小区测量数据。')])
		]);
	},

	qosLine(reg,w) {
		const rat=reg?.rat;
		const line=E('div',{'class':'dcx-qos','aria-label':'会话 QoS'},E('span',{},['会话 QoS']));
		const result=E('div',{'class':'dcx-qos-values'},['读取中…']);
		line.append(result);
		if(!w?.up || !['5G SA','5G NSA','LTE'].includes(rat)) {
			this.qosMemo=null;
			result.textContent='当前数据会话未报告';
			return line;
		}
		const build=x=>{
			if (!x?.ok || !x.sessions?.length) { result.textContent='当前会话未报告'; return; }
			result.replaceChildren(...x.sessions.map(item=>E('span',{},[
				(item.role==='ims'?'IMS':'数据')+' · '+item.apn+' ',
				E('strong',{},[x.kind+' '+item.classes.join(' / ')]),
				E('small',{'class':'dcx-caption'},['CID '+item.cid])
			])));
		};
		const key=[rat,reg.plmn,w.l3_device].join(':');
		if(this.qosMemo?.key!==key || this.qosMemo.until<Date.now()) {
			const until=Date.now()+30000;
			const promise=readQos(rat).catch(()=>null);
			const memo=this.qosMemo={key,until,promise};
			void promise.then(x=>{if(!x?.ok) memo.until=0;});
		}
		void this.qosMemo.promise.then(build);
		return line;
	},

	passwordNote(text) {
		return E('div',{'class':'dcx-notice'},[E('p',{},text),E('a',{href:L.url('admin/system/admin')},'设置管理员密码')]);
	},

	async mutate(btn, output, action, title, detail, done) {
		if(this.pending) return;
		let settle;
		const confirmed=new Promise(r=>settle=r);
		const cancel=button('取消',()=>{ui.hideModal();settle(false);});
		ui.showModal(title,[E('p',{},detail),E('div',{'class':'right'},[
			cancel, ' ', button('确认',()=>{ui.hideModal();settle(true);},{'class':'btn cbi-button-action'})])]);
		cancel.focus();
		if(!await confirmed || this.pending) return;
		this.pending=true; btn.disabled=true; output.textContent='正在请求基带…';
		try {
			const r=await action();
			const err=asError(r);
			if (err) output.textContent=err;
			else { output.textContent='已确认。'; if(done) await done(r); }
		} catch(e) { output.textContent='请求未返回。先核对状态，不要重复提交。'; }
		finally { this.pending=false; btn.disabled=false; }
	},

	lockForm(state, protectedAdmin) {
		if(asError(state)) return msg(asError(state));
		const workflow=this.preset;
		const selectable=!!state.cell && protectedAdmin;
		const rat=E('select',{},[E('option',{value:'NR'},'5G NR'),E('option',{value:'LTE'},'4G LTE')]);
		const arfcn=E('input',{type:'number',min:'0',inputmode:'numeric',value:workflow?.arfcn ?? '',placeholder:'下行频点'});
		const pci=E('input',{type:'number',min:'0',inputmode:'numeric',value:workflow?.pci ?? '',placeholder:'物理小区 ID'});
		rat.value=workflow?.rat || (state.cell?.rat==='LTE'?'LTE':'NR');
		if (!selectable) for (const n of [rat,arfcn,pci]) n.disabled=true;
		const feedback=msg('');
		const refresh=async()=>{
			const updated=await getLocks();
			if(this.selected==='locks' && !asError(updated)) this.body.replaceChildren(msg('已应用，基带读回一致。'),this.lockForm(updated,true));
		};
		const confirmCell=button('锁定小区',()=>{
			const system=rat.value, frequency=arfcn.value, phys=pci.value;
			if (!validCell(system,frequency,phys)) {
				feedback.textContent='请输入有效的 ARFCN 和 PCI。'; return;
			}
			void this.mutate(confirmCell,feedback,()=>setCell(system,frequency,phys,true),'锁定小区',
				'即将锁定 '+system+' / ARFCN '+frequency+' / PCI '+phys+'。蜂窝连接可能中断，请保留 LAN 管理连接。',refresh);
		},{disabled:!selectable});
		const unlock=button('解除小区锁定',()=>this.mutate(unlock,feedback,()=>clearCell(true),'解除小区锁定',
			'允许基带重新选择小区。蜂窝连接可能短暂中断。',refresh),{disabled:!selectable || !state.cell?.opt});
		const groups=['lte','nr'].map(key=>{
			const title=key==='lte'?'4G LTE':'5G NR', supported=state.supported?.[key] || [], active=state.current?.[key];
			const prefix=key==='lte'?'B':'n';
			const enabled=protectedAdmin && Array.isArray(active) && supported.length>0;
			const boxes=supported.map(b=>{
				const el=E('input',{type:'checkbox',value:String(b)});
				el.checked=active?.includes(b)===true; el.disabled=!enabled;
				return el;
			});
			const action=msg('');
			const update=auto=>{
				const chosen=boxes.filter(x=>x.checked).map(x=>x.value).join(',');
				if(!auto && !chosen) {action.textContent='至少保留一个频段。';return;}
				const request=auto?'auto':chosen;
				void this.mutate(auto?reset:apply,action,()=>setBand(key.toUpperCase(),request,true),
					auto?'恢复全部 '+title+' 频段':'应用 '+title+' 频段',
					'蜂窝连接可能中断。此操作只调整 '+title+'；不会修改 Wi-Fi。',refresh);
			};
			const apply=button('应用'+(key==='lte'?' LTE':' NR'),()=>update(false),{disabled:!enabled});
			const reset=button('允许全部',()=>update(true),{disabled:!enabled});
			return E('div',{'class':'dcx-band'},[
				E('h4',{},title),
				E('p',{'class':'dcx-caption'},Array.isArray(active)?'当前允许 '+active.map(b=>prefix+b).join(' · '):'基带没有返回当前掩码'),
				boxes.length?E('div',{'class':'dcx-band-list'},boxes.map((el,i)=>E('label',{},[el,prefix+supported[i]]))):msg('没有可选频段。'),
				E('div',{'class':'dcx-actions'},[apply,reset]),action]);
		});
		return E('div',{},[
			!protectedAdmin ? this.passwordNote('锁定状态可以查看；变更频段和小区前，请先设置管理员密码。'):null,
			section('小区锁定',state.cell?(state.cell.opt?'当前已锁定':'当前未锁定'):'基带读回不可用',[
				state.cell?.opt?msg(cellText(state.cell)):null,
				E('div',{'class':'dcx-formrow'},[field('无线制式',rat),field('下行 ARFCN',arfcn),field('PCI',pci)]),
				E('div',{'class':'dcx-actions'},[confirmCell,unlock]),feedback]),
			this.whitelist(state,protectedAdmin,()=>({rat:rat.value,arfcn:arfcn.value,pci:pci.value})),
			section('频段限制','LTE 和 NR 分开应用',[E('div',{'class':'dcx-twocol'},groups)])
		]);
	},

	whitelist(state, protectedAdmin, fromForm) {
		const draft=this.draft, feedback=msg(this.listAck);
		const eligible=protectedAdmin && state.cell?.opt===0;
		const selected=E('div',{'class':'dcx-caption'},'');
		const candidates=E('details',{'class':'dcx-candidates'},E('summary',{},'从最近测量的小区中多选'));
		const data=new Map();
		for(const x of this.snapshot?.cells || []) if(validCell(x.rat,x.arfcn,x.pci)) data.set(keyOf(x),x);
		const selectable=[];
		if(data.size) {
			candidates.append(E('div',{'class':'dcx-band-list'},Array.from(data).map(([id,c])=>{
				const node=E('input',{type:'checkbox'});
				node.disabled=!eligible;
				node.addEventListener('change',()=>{ if(node.checked) add(c); else {draft.delete(id); draw();} });
				selectable.push([id,node]);
				return E('label',{'class':'dcx-candidate'},[node,c.rat+' '+c.arfcn+' / PCI '+c.pci]);
			})));
		} else candidates.append(msg('没有小区测量。先到「信号与小区」刷新。'));
		const add=c=>{
			if(!eligible) return;
			if(!validCell(c.rat,c.arfcn,c.pci)) {feedback.textContent='先在上方输入有效的 ARFCN 和 PCI。';return;}
			const v={rat:c.rat,arfcn:Number(c.arfcn),pci:Number(c.pci)}, id=keyOf(v);
			if(!draft.has(id) && Array.from(draft.values()).filter(x=>x.rat===v.rat).length>=32) {
				feedback.textContent='每种制式最多加入 32 个小区。'; draw(); return;
			}
			draft.set(id,v); feedback.textContent=this.listAck; draw();
		};
		const set=button('提交白名单',()=>{
			const spec=Array.from(draft.keys()).join(',');
			void this.mutate(set,feedback,()=>putList(spec,true),'提交小区白名单',
				'允许基带从所选 '+draft.size+' 个小区中选择，不是同时连接。可能中断蜂窝，请保持 LAN 管理连接。',
				()=>{this.listAck='基带已接受白名单请求；接口不提供有效名单读回。';feedback.textContent=this.listAck;});
		});
		const clear=button('解除白名单',()=>{
			void this.mutate(clear,feedback,()=>clearList(true),'解除小区白名单',
				'请求基带取消多小区限制。可能短暂重选小区。',()=>{
					this.listAck='基带已接受解除白名单请求；接口不提供有效名单读回。';
					feedback.textContent=this.listAck;
				});
		},{disabled:!protectedAdmin});
		const draw=()=>{
			set.disabled=!eligible || draft.size<2;
			for(const [id,x] of selectable) x.checked=draft.has(id);
			const chips=Array.from(draft,([id,c])=>E('span',{'class':'dcx-candidate dcx-chip'},[
				c.rat+' '+c.arfcn+' / PCI '+c.pci,
				button('移除',()=>{draft.delete(id);draw();},{'class':'dcx-link','aria-label':'移除 '+c.rat+' '+c.arfcn+' PCI '+c.pci,disabled:!eligible})]));
			selected.replaceChildren(...(chips.length?chips:['待提交：未选小区']));
		};
		draw();
		const manual=button('加入上方输入的小区',()=>add(fromForm()),{disabled:!eligible});
		return section('多小区白名单','与单小区锁定分开',[
			msg(state.cell?.opt?'先解除单小区锁定，再提交白名单。':'选两个或更多候选，让基带自行选择。当前生效名单不可回读。'),
			candidates,selected,E('div',{'class':'dcx-actions'},[manual,set,clear]),feedback
		]);
	},

	sms(state) {
		if(asError(state)) return msg(asError(state));
		const ids=Array.from(new Set(state.indexes || [])).sort((a,b)=>b-a);
		const detail=E('div',{'class':'dcx-sms-detail','aria-live':'polite'},msg(ids.length?'选择一条短信查看内容。':'收件箱是空的。'));
		let request=0;
		const rows=ids.map(id=>E('li',{},button('短信 #'+id,async(e)=>{
			const ticket=++request;
			for(const item of e.target.closest('ul').querySelectorAll('button')) item.setAttribute('aria-current',item===e.target?'true':'false');
			detail.replaceChildren(msg('正在读取短信…'));
			try {
				const r=await read(id);
				if(ticket!==request) return;
				if(asError(r)) {detail.replaceChildren(msg(asError(r)));return;}
				const decoded=smsCodec.decode(r.pdu);
				detail.replaceChildren(...[
					E('div',{'class':'dcx-sms-from'},[E('strong',{},[decoded.sender.startsWith('+86') && mobile.test(decoded.sender.slice(3)) ? decoded.sender.slice(3) : decoded.sender]),E('span',{},[decoded.time])]),
					decoded.part ? msg('长短信分段 '+decoded.part):null,
					E('p',{'class':'dcx-sms-text'},[decoded.text])
				].filter(Boolean));
			} catch(e) { if(ticket===request) detail.replaceChildren(msg('这条短信的编码暂时无法显示。')); }
		},{'class':'dcx-link'})));
		const number=E('input',{type:'tel',inputmode:'tel',autocomplete:'off',maxlength:'21',placeholder:'例如 13800138000'});
		const body=E('textarea',{rows:'4',maxlength:'70',placeholder:'输入短信内容'});
		const counter=E('span',{'class':'dcx-caption'},'0 / 70');
		body.addEventListener('input',()=>{counter.textContent=body.value.length+' / 70';});
		const status=msg('');
		const deliver=button('发送短信',()=>{
			const local=number.value.trim().replace(/[ -]/g,''), text=body.value;
			const to=mobile.test(local)?'+86'+local:local;
			if (!/^\+?\d{1,15}$/.test(to) || !text.trim() || /[\uD800-\uDFFF]/.test(text)) {
				status.textContent='请输入有效号码和正文；单条短信支持中文，不支持 emoji。'; return;
			}
			void this.mutate(deliver,status,()=>send(to,text,true),'发送短信',
				'发送给 '+to+'？运营商可能收费。',()=>{body.value='';counter.textContent='0 / 70';status.textContent='已提交给基带；尚未确认对方收到。';});
		});
		const usage=state.used!=null && state.capacity!=null?state.used+' / '+state.capacity+' 已存储':'存储容量未返回';
		return E('div',{'class':'dcx-twocol'},[
			section('收件箱',usage,[E('div',{'class':'dcx-inbox'},[ids.length?E('ul',{},rows):null,detail]),
				state.limited ? msg('基带只返回了部分存储索引。'):null]),
			section('写短信','大陆手机号直接输入',[field('收件号码',number),field('正文',body),
				E('div',{'class':'dcx-actions'},[deliver,counter]),status])
		]);
	}
});
