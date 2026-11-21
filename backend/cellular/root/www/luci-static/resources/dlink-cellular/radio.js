'use strict';
'require baseclass';

const regLabels=['未注册','仅紧急服务','已注册','正在搜网','注册被拒','未知','已注册 · 漫游','仅短信','漫游 · 仅短信','已注册','已注册 · 漫游'];
const carrierName={'46000':'中国移动','46002':'中国移动','46007':'中国移动','46001':'中国联通','46006':'中国联通','46009':'中国联通','46003':'中国电信','46011':'中国电信','46015':'中国广电'};

return baseclass.extend({
	missing:'—',
	fmt(value,unit='') { return value==null || value==='' ? '—' : String(value)+unit; },
	operator(r) { return r?.plmn ? (carrierName[r.plmn] || r.plmn) : '运营商未返回'; },
	registered(r) { return regLabels[r?.state] || '驻网状态未返回'; },
	signalFor(s) { return s?.register?.rat?.startsWith('5G') ? s.nr : (s?.lte || s?.nr); }
});
