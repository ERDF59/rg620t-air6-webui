/* Authenticated rpcd writer. One JSON request on stdin, one vendor transaction;
 * no shell, argv credentials, command history or retransmission on timeout. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/resource.h>
#include <syslog.h>
#include <unistd.h>
#include <json-c/json.h>
#include "quectel_atcid_sender.h"

static void fail(const char *err){printf("{\"ok\":false,\"error\":\"%s\"}\n",err);}
int main(void){
    struct rlimit core={0,0}; setrlimit(RLIMIT_CORE,&core);
    setlogmask(LOG_UPTO(LOG_WARNING));
    char input[4097];
    size_t size=fread(input,1,sizeof(input),stdin);
    if(!size||size==sizeof(input)||memchr(input,0,size)){fail("input");return 0;}
    json_tokener *tok=json_tokener_new();
    json_tokener_set_flags(tok,JSON_TOKENER_STRICT|JSON_TOKENER_VALIDATE_UTF8);
    input[size]='\0';
    json_object *req=json_tokener_parse_ex(tok,input,(int)size+1);
    int valid=json_tokener_get_error(tok)==json_tokener_success && json_object_is_type(req,json_type_object);
    json_tokener_free(tok); explicit_bzero(input,sizeof(input));
    if(!valid){fail("input");return 0;}
    json_object *confirm=json_object_object_get(req,"confirm"),*v=json_object_object_get(req,"command");
    if(!json_object_is_type(confirm,json_type_boolean)||!json_object_get_boolean(confirm)){fail("confirm");return 0;}
    if(!json_object_is_type(v,json_type_string)){fail("input");return 0;}
    const char *s=json_object_get_string(v);size_t n=json_object_get_string_len(v);
    atcmd_sender_msg_t msg={0};
    if(n<2||n>sizeof(msg.at_cmd)-3||strncasecmp(s,"AT",2)){fail("at_format");return 0;}
    for(size_t i=0;i<n;i++)if((unsigned char)s[i]<32||s[i]==127){fail("at_format");return 0;}
    memcpy(msg.at_cmd,s,n); memcpy(msg.at_cmd+n,"\r\n",3); msg.timeout=12;
    json_object_put(req);
    int fd=open("/var/lock/dlink-cellular.lock",O_CREAT|O_WRONLY|O_NOFOLLOW|O_CLOEXEC,0600);
    /* Wait for a short telemetry read to finish, before (not after) transmission. */
    int locked=0;
    for(int i=0;fd>=0 && i<20;i++){
        if(!flock(fd,LOCK_EX|LOCK_NB)){locked=1;break;}
        if(errno!=EWOULDBLOCK && errno!=EINTR)break;
        usleep(75000);
    }
    if(!locked){fail("busy");return 0;}
    COMM_DEV *dev=ql_atcid_sender_init(TYPE_ADB_ATCI_SOCKET);
    if(!dev){fail("at_unavailable");return 0;}
    /* Start with the streaming API: the short-response API's overflow fallback
     * re-sends the command, which is not acceptable for writes. */
    char reply[32769]; size_t used=0; int truncated=0,done=0;
    if(ql_atcid_sender_large_require(dev,&msg)>=0){
        for(;;){
            int len=0;
            ql_atcid_sender_large_state_t state=ql_atcid_sender_large_read(dev,&msg,&len);
            if(len<0 || (size_t)len>sizeof(msg.at_recv))break;
            size_t bytes=strnlen(msg.at_recv,(size_t)len), room=sizeof(reply)-1-used;
            if(bytes>room){bytes=room;truncated=1;}
            memcpy(reply+used,msg.at_recv,bytes);used+=bytes;
            if(state==QUECTEL_ATCID_SENDER_LARGE_STATE_DONE){done=1;break;}
            if(state!=QUECTEL_ATCID_SENDER_LARGE_STATE_READY||len==0)break;
        }
    }
    ql_atcid_sender_deinit(dev);explicit_bzero(&msg,sizeof(msg));
    if(!used){fail("at_unconfirmed");return 0;}
    while(used && (reply[used-1]=='\r'||reply[used-1]=='\n'))used--;
    reply[used]=0; const char *last=strrchr(reply,'\n');last=last?last+1:reply;
    json_object *out=json_object_new_object();
    json_object_object_add(out,"ok",json_object_new_boolean(1));
    json_object_object_add(out,"modem_ok",json_object_new_boolean(done&&!truncated&&!strcmp(last,"OK")));
    json_object_object_add(out,"incomplete",json_object_new_boolean(!done||truncated));
    json_object_object_add(out,"reply",json_object_new_string_len(reply,(int)used));
    puts(json_object_to_json_string(out));json_object_put(out);return 0;
}
