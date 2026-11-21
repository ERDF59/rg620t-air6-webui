#ifndef SMS_SUBMIT_H
#define SMS_SUBMIT_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* SMS-SUBMIT using the modem's SMSC and one UCS-2 TP-UD, no delivery report. */
static size_t sms_submit(unsigned char *out, size_t cap, const char *phone, const char *body)
{
	/* Accept a local mainland mobile number and send it in international form. */
	char local[15];
	if (strlen(phone)==11 && phone[0]=='1' && phone[1]>='3' && phone[1]<='9' &&
	    strspn(phone,"0123456789")==11) {
		memcpy(local,"+86",3); memcpy(local+3,phone,12); phone=local;
	}
	const int intl = *phone == '+';
	phone += intl;
	size_t digits = strlen(phone), packed = (digits + 1)/2;
	if (!digits || digits > 15 || strspn(phone, "0123456789") != digits || cap < 9 + packed)
		return 0;

	size_t offset = 0;
	out[offset++] = 0; /* default SMSC */
	out[offset++] = 1; /* SMS-SUBMIT, no TP-VP */
	out[offset++] = 0; /* TP-MR */
	out[offset++] = digits;
	out[offset++] = intl ? 0x91 : 0x81;
	for (size_t i=0; i<digits; i+=2)
		out[offset++] = (phone[i]-'0') | ((i+1 < digits ? phone[i+1]-'0' : 15) << 4);
	out[offset++] = 0; /* TP-PID */
	out[offset++] = 8; /* TP-DCS UCS-2 */
	size_t len = offset++;
	const unsigned char *p=(const unsigned char *)body;
	while (*p) {
		uint32_t code;
		if (*p < 0x80) code=*p++;
		else if (*p>=0xc2 && *p<=0xdf && (p[1]&0xc0)==0x80) {
			code=((p[0]&31)<<6) | (p[1]&63); p+=2;
		} else if (*p>=0xe0 && *p<=0xef && (p[1]&0xc0)==0x80 && (p[2]&0xc0)==0x80) {
			code=((p[0]&15)<<12) | ((p[1]&63)<<6) | (p[2]&63); p+=3;
			if (code<0x800 || (code>=0xd800 && code<=0xdfff)) return 0;
		} else return 0;

		if (offset + 2 > cap || offset - len - 1 >= 140) return 0;
		out[offset++] = code>>8;
		out[offset++] = code;
	}
	out[len] = offset-len-1;
	return out[len] ? offset : 0;
}
#endif
