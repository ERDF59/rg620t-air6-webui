'use strict';
'require baseclass';

const alphabet = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const ext = { 10:'\f', 20:'^', 40:'{', 41:'}', 47:'\\', 60:'[', 61:'~', 62:']', 64:'|', 101:'€' };
function gsm(b, count, start) {
	let result='', escape=false;
	for (let i=0; i<count; i++) {
		const bit=start+i*7, index=bit>>3;
		const value=((b[index] | ((b[index+1] || 0)<<8)) >> (bit%8)) & 127;
		if (escape) { result+=ext[value] || '�'; escape=false; }
		else if (value===27) escape=true;
		else result+=alphabet[value];
	}
	return result;
}

function decode(pdu) {
	if (!/^(?:[a-f\d]{2})+$/i.test(pdu || '')) throw Error('PDU');
	const b=pdu.match(/../g).map(x=>parseInt(x,16));
	const semi=v=> (v & 15).toString(16) + (v >> 4).toString(16);
	let p=1+b[0];
	if (p+3>b.length) throw Error('PDU');
	const tag=b[p++];
	if ((tag&3)!==0) throw Error('PDU type');
	const length=b[p++], toa=b[p++], address=b.slice(p,p+Math.ceil(length/2));
	let sender;
	if ((toa&0x70)===0x50) sender=gsm(address,Math.floor(length*4/7),0);
	else sender=((toa&0x70)===0x10 ? '+' : '') + address.map(semi).join('').slice(0,length);
	p+=address.length;
	if (p+10>b.length) throw Error('PDU');
	p++; // TP-PID
	const dcs=b[p++];
	const ts=b.slice(p,p+7).map(semi);
	const tz=b[p+6], quarters=(tz&7)*10 + (tz>>4), pad=v=>String(v).padStart(2,'0');
	const time=ts.slice(0,3).join('-')+' '+ts.slice(3,6).join(':')+' UTC'+((tz&8)?'-':'+')+pad(Math.floor(quarters/4))+':'+pad(quarters%4*15);
	p+=7;
	const udl=b[p++];
	let kind;
	if ((dcs&0xc0)===0 && !(dcs&0x20)) kind=(dcs>>2)&3;
	else if ((dcs&0xf0)===0xe0) kind=2;
	else if ((dcs&0xe0)===0xc0) kind=0;
	else if ((dcs&0xf0)===0xf0) kind=dcs&4 ? 1 : 0;
	else kind=3;
	const octets=kind===0 ? Math.ceil(udl*7/8) : udl;
	if (p+octets>b.length) throw Error('PDU length');
	const data=b.slice(p,p+octets), header=(tag&0x40)?1+data[0]:0;
	if (header>data.length || !Number.isFinite(header)) throw Error('PDU header');
	let part=null;
	for (let i=1;i+1<header;) {
		const id=data[i++], len=data[i++];
		if (i+len>header) throw Error('PDU header');
		if (id===0 && len===3) part=data[i+2]+'/'+data[i+1];
		if (id===8 && len===4) part=data[i+3]+'/'+data[i+2];
		i+=len;
	}

	if (kind===0) {
		const skips=Math.ceil(header*8/7);
		if (skips>udl) throw Error('PDU header');
		return { sender,time,text:gsm(data,udl-skips,skips*7),part };
	}
	if (kind===2 && (data.length-header)%2===0) {
		let text='';
		for (let i=header;i<data.length;i+=2) text+=String.fromCharCode(data[i]*256+data[i+1]);
		return { sender,time,text,part };
	}
	throw Error('PDU encoding');
}

return baseclass.extend({ decode });
