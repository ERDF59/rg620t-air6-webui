/* Test-only API double. These structures are not vendor ABI declarations. */
#ifndef FIXTURE_QL_SMS_H
#define FIXTURE_QL_SMS_H
#include <stdint.h>
#define SMS_IPC_MODE_DEFAULT 0
#define QL_SMS_FLAG_INDEX 1
typedef struct { int flag; uint16_t message_index; } ql_sms_read_pdu_req_t;
typedef struct { unsigned content_size; unsigned char content[200]; } ql_sms_read_pdu_resp_t;
int ql_sms_init(int mode);
int ql_sms_read_pdu(ql_sms_read_pdu_req_t *req, ql_sms_read_pdu_resp_t *resp);
int ql_sms_delete_pdu(uint16_t storage_index);
void ql_sms_release(void);
#endif
