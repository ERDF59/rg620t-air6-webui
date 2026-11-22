#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <time.h>
#include <unistd.h>
#include "ql_sms.h"

/* Match the maximum batch returned by the modem's inbox enumeration. */
#define SMS_DELETE_MAX_RECORDS 60
#define SMS_PDU_CAPACITY (sizeof(((ql_sms_read_pdu_resp_t *)0)->content))

struct sms_record {
    uint16_t index;
    size_t length;
    unsigned char pdu[SMS_PDU_CAPACITY];
};

static void fail(const char *error, int code)
{
    printf("{\"ok\":false,\"error\":\"%s\",\"code\":%d}\n", error, code);
}

static int hex_digit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int uint16_arg(const char *s, uint16_t *value)
{
    if (!*s || s[strspn(s, "0123456789")])
        return 0;
    unsigned long n = strtoul(s, NULL, 10);
    /* Only individual numbered slots, never a reserved boundary value. */
    if (!n || n >= UINT16_MAX)
        return 0;
    *value = (uint16_t)n;
    return 1;
}

static int read_line(char *line, size_t capacity)
{
    if (!fgets(line, capacity, stdin))
        return 0;
    char *newline = strchr(line, '\n');
    if (!newline)
        return 0;
    *newline = '\0';
    return 1;
}

static int parse_record(const char *index, const char *hex, struct sms_record *out)
{
    size_t n = strlen(hex);
    if (!uint16_arg(index, &out->index) || !n || n % 2 || n / 2 > sizeof out->pdu)
        return 0;
    for (size_t i = 0; i < n; i += 2) {
        int hi = hex_digit(hex[i]), lo = hex_digit(hex[i + 1]);
        if (hi < 0 || lo < 0)
            return 0;
        out->pdu[i / 2] = (unsigned char)((hi << 4) | lo);
    }
    out->length = n / 2;
    return 1;
}

/* The selected PDUs enter over stdin; an incomplete group must never delete a prefix. */
static size_t read_records(const char *arg, struct sms_record *records)
{
    char line[2 * SMS_PDU_CAPACITY + 5 + 3];
    uint16_t count = 1;
    if (!strcmp(arg, "--group")) {
        if (!read_line(line, sizeof line) || !uint16_arg(line, &count) ||
            count > SMS_DELETE_MAX_RECORDS)
            return 0;
        for (size_t i = 0; i < count; i++) {
            if (!read_line(line, sizeof line))
                return 0;
            char *hex = strchr(line, ' ');
            if (!hex)
                return 0;
            *hex++ = '\0';
            if (!parse_record(line, hex, &records[i]))
                return 0;
            for (size_t j = 0; j < i; j++)
                if (records[i].index == records[j].index)
                    return 0;
        }
    } else if (!read_line(line, sizeof line) || !parse_record(arg, line, records)) {
        return 0;
    }
    return fgetc(stdin) == EOF && !ferror(stdin) ? count : 0;
}

static const char *verify_record(const struct sms_record *record, int *rc)
{
    ql_sms_read_pdu_req_t request = {
        .flag = QL_SMS_FLAG_INDEX, .message_index = record->index,
    };
    ql_sms_read_pdu_resp_t current = {0};
    *rc = ql_sms_read_pdu(&request, &current);
    if (*rc)
        return "sms_read";
    if ((size_t)current.content_size != record->length ||
        memcmp(current.content, record->pdu, record->length))
        return "sms_changed";
    return NULL;
}

/* The event sampler and inbox reads hold the same lock for well under a second; wait briefly
 * instead of rejecting a user-initiated delete on the first collision. */
static int lock_modem(int fd)
{
    struct timespec pause = { .tv_nsec = 100000000 };
    for (int attempt = 0; attempt < 20; attempt++) {
        if (!flock(fd, LOCK_EX | LOCK_NB))
            return 1;
        if (errno != EWOULDBLOCK && errno != EINTR)
            return 0;
        nanosleep(&pause, NULL);
    }
    return 0;
}

int main(int argc, char **argv)
{
    struct sms_record records[SMS_DELETE_MAX_RECORDS];
    size_t count = argc == 2 ? read_records(argv[1], records) : 0;
    if (!count) {
        fail("input", 0);
        return 0;
    }

    int fd = open("/var/lock/dlink-cellular.lock", O_CREAT | O_CLOEXEC | O_NOFOLLOW | O_WRONLY, 0600);
    if (fd < 0 || !lock_modem(fd)) {
        if (fd >= 0) close(fd);
        fail("busy", 0);
        return 0;
    }
    int rc = ql_sms_init(SMS_IPC_MODE_DEFAULT);
    if (rc) {
        close(fd);
        fail("ril_init", rc);
        return 0;
    }

    const char *error = NULL;
    size_t deleted = 0;
    if (count > 1) {
        /* Check the full group before deleting any part. */
        for (size_t i = 0; i < count; i++)
            if ((error = verify_record(&records[i], &rc)))
                break;
    }
    for (; !error && deleted < count; deleted++) {
        /* The modem itself can reuse a slot even while our local RPC lock is held. */
        if ((error = verify_record(&records[deleted], &rc)))
            break;
        if ((rc = ql_sms_delete_pdu(records[deleted].index))) {
            error = "sms_delete";
            break;
        }
    }

    if (!error)
        printf("{\"ok\":true,\"deleted\":%zu}\n", deleted);
    else if (!deleted)
        fail(error, rc);
    else
        printf("{\"ok\":true,\"deleted\":%zu,\"partial\":true,\"error\":\"%s\",\"code\":%d}\n", deleted, error, rc);
    ql_sms_release();
    close(fd);
    return 0;
}
