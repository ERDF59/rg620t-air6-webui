#include "ql_sms.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int scenario(const char *name)
{
    const char *value = getenv("SMS_TEST_SCENARIO");
    return value && strcmp(value, name) == 0;
}

static void event(const char *what, unsigned index)
{
    FILE *f = fopen(getenv("SMS_TEST_CALLS"), "a");
    assert(f);
    fprintf(f, "%s %u\n", what, index);
    fclose(f);
}

int ql_sms_init(int mode)
{
    assert(mode == SMS_IPC_MODE_DEFAULT);
    event("init", 0);
    return scenario("init_error") ? 19 : 0;
}

int ql_sms_read_pdu(ql_sms_read_pdu_req_t *req, ql_sms_read_pdu_resp_t *resp)
{
    assert(req->flag == QL_SMS_FLAG_INDEX);
    event("read", req->message_index);
    if (scenario("read_error"))
        return 17;
    resp->content[0] = 0xA1;
    resp->content[1] = 0xB2;
    resp->content[2] = (scenario("reused_index") || (scenario("reused_second") && req->message_index == 14)) ? 0x04 : 0x03;
    resp->content_size = 3;
    return 0;
}

int ql_sms_delete_pdu(uint16_t index)
{
    event("delete", index);
    return (scenario("delete_error") || (scenario("delete_second_error") && index == 14)) ? 23 : 0;
}

void ql_sms_release(void)
{
    event("release", 0);
}
