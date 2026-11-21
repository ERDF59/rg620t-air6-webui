'use strict';
'require baseclass';
'require rpc';
'require dlink-cellular.radio as cellular';

const summary=rpc.declare({object:'dlink-cellular',method:'summary',expect:{'':{}}});
const wan=rpc.declare({object:'network.interface.wan',method:'status',expect:{'':{}}});
const { fmt, operator, registered, signalFor }=cellular;

return baseclass.extend({
	title: '蜂窝信号',

	load() {
		return Promise.all([summary().catch(()=>null),wan().catch(()=>null)]);
	},

	render([s,w]) {
		if (!s || !s.ok) {
			if (!s?.error || s.error==='board') return null;
			return E('p',{},['基带暂未返回信号，下次刷新重试。']);
		}
		const r=s.register, raw=signalFor(s);
		const datum=(caption,value)=>E('div',{'class':'dcxs-datum'},[
			E('span',{'class':'dcxs-label'},[caption]),E('strong',{},[value])]);
		const name=operator(r)+' · '+fmt(r?.rat)+' · '+registered(r);
		return E('div',{'class':'dcxs'},[
			E('link',{rel:'stylesheet',href:L.resource('dlink-cellular/status.css')}),
			E('div',{'class':'dcxs-serving'},[
				E('span',{'class':'dcxs-label'},[name]),
				E('div',{'class':'dcxs-headline'},[
					E('strong',{},[fmt(raw?.rsrp)]),E('span',{'class':'dcxs-label'},['dBm · RSRP'])])]),
			E('div',{'class':'dcxs-metrics'},[
				datum('RSRQ',fmt(raw?.rsrq,' dB')),
				datum('SINR',fmt(raw?.sinr10 == null ? null : raw.sinr10/10,' dB')),
				datum('RSSI',fmt(raw?.rssi,' dBm')),
				datum('蜂窝数据',w?.up===true?'已拨号':w?.up===false?'未拨号':'—')]),
			E('a',{'class':'dcxs-link',href:L.url('admin/network/dlink-cellular')},['完整蜂窝管理 →'])
		]);
	}
});
