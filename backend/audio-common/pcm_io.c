#define _POSIX_C_SOURCE 200809L
#include <alloca.h>
#include <alsa/asoundlib.h>
#include <errno.h>
#include <inttypes.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "tone.h"

/* Do not install a global alsa.conf or route through the SDK's mixed recorder. */
static const char hw_config[] =
    "ctl.hw {\n @args [ CARD ]\n @args.CARD { type integer }\n"
    " type hw\n card $CARD\n}\n"
    "pcm.hw {\n @args [ CARD DEV ]\n @args.CARD { type integer }\n"
    " @args.DEV { type integer }\n type hw\n card $CARD\n device $DEV\n}\n";

struct route {
    const char *name;
    const char *prefix;
    unsigned numid;
    int initial, changed;
};

struct front_end {
    const char *name;
    snd_pcm_stream_t stream;
    int dev;
    unsigned avail;
};

static volatile sig_atomic_t cancelled;

static void stop(int sig)
{
    (void)sig;
    cancelled = 1;
}

static int alsa_error(const char *subject, int rc)
{
    fprintf(stderr, "%s: %s\n", subject, snd_strerror(rc));
    return rc;
}

static int config_create(snd_config_t **cfg)
{
    snd_input_t *in = NULL;
    int rc = snd_config_top(cfg);
    if (rc < 0) return rc;
    rc = snd_input_buffer_open(&in, hw_config, sizeof(hw_config) - 1);
    if (rc >= 0) {
        rc = snd_config_load(*cfg, in);
        snd_input_close(in);
    }
    return rc;
}

static int board_card(snd_config_t *cfg, snd_ctl_t **result, int *selected)
{
    snd_ctl_card_info_t *meta;
    snd_ctl_card_info_alloca(&meta);
    int card = -1, rc;
    while ((rc = snd_card_next(&card)) == 0 && card >= 0) {
        char name[32];
        snprintf(name, sizeof(name), "hw:%d", card);
        snd_ctl_t *ctl = NULL;
        if (snd_ctl_open_lconf(&ctl, name, 0, cfg) < 0) continue;
        if (snd_ctl_card_info(ctl, meta) < 0 ||
            strcmp(snd_ctl_card_info_get_name(meta), "mt6990-slic") != 0) {
            snd_ctl_close(ctl);
            continue;
        }
        if (*result) {
            snd_ctl_close(ctl);
            return alsa_error("multiple mt6990-slic cards", -EADDRINUSE);
        }
        *result = ctl;
        *selected = card;
    }
    if (rc < 0) return alsa_error("enumerate ALSA cards", rc);
    if (!*result) {
        fprintf(stderr, "mt6990-slic not found; the voice kernel must boot and register its card\n");
        return -ENODEV;
    }
    return 0;
}

static int pcm_name_is(const char *value, const char *name)
{
    const size_t len = strlen(name);
    return strncmp(value, name, len) == 0 &&
           (value[len] == '\0' || strcmp(value + len, " (*)") == 0);
}

static int front_end(snd_ctl_t *ctl, struct front_end *endpoint)
{
    snd_pcm_info_t *info;
    snd_pcm_info_alloca(&info);
    int dev = -1, rc;
    while ((rc = snd_ctl_pcm_next_device(ctl, &dev)) == 0 && dev >= 0) {
        snd_pcm_info_set_device(info, (unsigned)dev);
        snd_pcm_info_set_subdevice(info, 0);
        snd_pcm_info_set_stream(info, endpoint->stream);
        if (snd_ctl_pcm_info(ctl, info) < 0) continue;
        if (!pcm_name_is(snd_pcm_info_get_id(info), endpoint->name) &&
            !pcm_name_is(snd_pcm_info_get_name(info), endpoint->name)) continue;
        if (endpoint->dev != -1) return alsa_error(endpoint->name, -EADDRINUSE);
        endpoint->dev = dev;
        endpoint->avail = snd_pcm_info_get_subdevices_avail(info);
    }
    if (rc < 0) return alsa_error("enumerate PCM devices", rc);
    if (endpoint->dev < 0) return alsa_error(endpoint->name, -ENOENT);
    printf("%s: device=%d free-substreams=%u\n", endpoint->name, endpoint->dev, endpoint->avail);
    return 0;
}

static int mixer_routes(snd_ctl_t *ctl, struct route *routes, size_t count,
                        int *conflict)
{
    snd_ctl_elem_list_t *list;
    snd_ctl_elem_info_t *info;
    snd_ctl_elem_value_t *value;
    snd_ctl_elem_list_alloca(&list);
    snd_ctl_elem_info_alloca(&info);
    snd_ctl_elem_value_alloca(&value);
    int rc = snd_ctl_elem_list(ctl, list);
    if (rc < 0) return alsa_error("list AFE mixer", rc);
    unsigned total = snd_ctl_elem_list_get_count(list);
    rc = snd_ctl_elem_list_alloc_space(list, total);
    if (rc < 0) return alsa_error("allocate mixer list", rc);
    if ((rc = snd_ctl_elem_list(ctl, list)) < 0) goto fail;

    for (unsigned i = 0; i < snd_ctl_elem_list_get_used(list); ++i) {
        if (snd_ctl_elem_list_get_interface(list, i) != SND_CTL_ELEM_IFACE_MIXER) continue;
        const char *name = snd_ctl_elem_list_get_name(list, i);
        for (size_t k = 0; k < count; ++k) {
            struct route *route = &routes[k];
            if (strncmp(name, route->prefix, strlen(route->prefix)) != 0) continue;
            unsigned id = snd_ctl_elem_list_get_numid(list, i);
            snd_ctl_elem_info_set_numid(info, id);
            if ((rc = snd_ctl_elem_info(ctl, info)) < 0) goto fail;
            if (snd_ctl_elem_info_get_type(info) != SND_CTL_ELEM_TYPE_BOOLEAN ||
                snd_ctl_elem_info_get_count(info) != 1) { rc = -ENOTSUP; goto fail; }
            snd_ctl_elem_value_set_numid(value, id);
            if ((rc = snd_ctl_elem_read(ctl, value)) < 0) goto fail;
            int enabled = snd_ctl_elem_value_get_boolean(value, 0);
            if (strcmp(name, route->name) == 0) {
                if (route->numid || !snd_ctl_elem_info_is_writable(info)) {
                    rc = -ENOTSUP; goto fail;
                }
                route->numid = id;
                route->initial = enabled;
            } else if (enabled) {
                printf("competing mixer route enabled: %s\n", name);
                *conflict = 1;
            }
            break;
        }
    }
    for (size_t k = 0; k < count; ++k) {
        if (!routes[k].numid) {
            fprintf(stderr, "missing mixer route: %s\n", routes[k].name);
            rc = -ENOENT; goto fail;
        }
        printf("%s: %s\n", routes[k].name, routes[k].initial ? "on" : "off");
    }
    snd_ctl_elem_list_free_space(list);
    return 0;
fail:
    snd_ctl_elem_list_free_space(list);
    return alsa_error("read target mixer routes", rc);
}

static int set_switch(snd_ctl_t *ctl, struct route *route, int on)
{
    snd_ctl_elem_value_t *value;
    snd_ctl_elem_value_alloca(&value);
    snd_ctl_elem_value_set_numid(value, route->numid);
    snd_ctl_elem_value_set_boolean(value, 0, on);
    const int rc = snd_ctl_elem_write(ctl, value);
    return rc < 0 ? alsa_error(route->name, rc) : 0;
}

static int open_pcm(snd_config_t *cfg, snd_pcm_t **pcm, int card,
                    const struct front_end *endpoint)
{
    char device[40];
    snprintf(device, sizeof(device), "hw:%d,%d", card, endpoint->dev);
    int rc = snd_pcm_open_lconf(pcm, device, endpoint->stream, SND_PCM_NONBLOCK, cfg);
    if (rc < 0) return alsa_error(endpoint->name, rc);
    rc = snd_pcm_set_params(*pcm, SND_PCM_FORMAT_S16_LE, SND_PCM_ACCESS_RW_INTERLEAVED,
                           1, T830_RATE, 0, 80000);
    if (rc < 0) return alsa_error(endpoint->name, rc);
    return 0;
}

static int64_t milliseconds(void)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int sample_call(snd_pcm_t *play, snd_pcm_t *capture)
{
    const size_t target_frames = T830_SECONDS * T830_RATE;
    size_t queued = 0, captured = 0;
    struct markers result = {0};
    int16_t frames[T830_WINDOW];
    const int64_t start = milliseconds();
    if (start < 0) return alsa_error("monotonic clock", -errno);
    int rc = snd_pcm_start(capture);
    if (rc < 0) return alsa_error("start PCM capture", rc);
    printf("Now: far end plays %u Hz; this test sends %u Hz pulses.\n", T830_DOWN_HZ, T830_UP_HZ);
    fflush(stdout);

    while (queued < target_frames || captured < target_frames) {
        if (cancelled) return alsa_error("interrupted", -EINTR);
        const int64_t now = milliseconds();
        if (now < 0 || now - start > (int64_t)(T830_SECONDS + 2u) * 1000)
            return alsa_error("PCM deadline", -ETIMEDOUT);
        int progress = 0;
        if (captured < target_frames) {
            size_t n = target_frames - captured;
            if (n > T830_WINDOW) n = T830_WINDOW;
            snd_pcm_sframes_t got = snd_pcm_readi(capture, frames, n);
            if (got < 0 && got != -EAGAIN) return alsa_error("input PCM", (int)got);
            if (got > 0) {
                t830_accumulate(&result, frames, (size_t)got);
                captured += (size_t)got;
                progress = 1;
            }
        }
        if (queued < target_frames) {
            size_t n = target_frames - queued;
            if (n > T830_WINDOW) n = T830_WINDOW;
            t830_uplink(frames, n, queued);
            snd_pcm_sframes_t sent = snd_pcm_writei(play, frames, n);
            if (sent < 0 && sent != -EAGAIN) return alsa_error("output PCM", (int)sent);
            if (sent > 0) { queued += (size_t)sent; progress = 1; }
        }
        if (!progress) {
            const struct timespec pause = { .tv_nsec = 2000000 };
            nanosleep(&pause, NULL);
        }
    }

    printf("queued_frames=%zu captured_frames=%zu far_end_windows=%u outgoing_echo_windows=%u\n",
           queued, captured, result.remote, result.local);
    if (result.remote < T830_MARKER_WINDOWS) {
        puts("downlink: far-end marker not detected");
        return -ENODATA;
    }
    puts("downlink: far-end marker detected");
    puts("uplink: queued, ask the far end to confirm they heard the pulses");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "abi") == 0) {
        printf("alsa=%s format=S16_LE rate=%u duration_s=%u\n", snd_asoundlib_version(), T830_RATE, T830_SECONDS);
        return 0;
    }
    if (argc != 2 || (strcmp(argv[1], "doctor") && strcmp(argv[1], "duplex"))) return 2;
    const int duplex = strcmp(argv[1], "duplex") == 0;
    snd_config_t *cfg = NULL;
    snd_ctl_t *ctl = NULL;
    snd_pcm_t *play = NULL, *capture = NULL;
    int card = -1, conflict = 0, status = 1, rc;
    struct front_end output = { "Playback_2", SND_PCM_STREAM_PLAYBACK, -1, 0 };
    struct front_end input = { "Capture_2", SND_PCM_STREAM_CAPTURE, -1, 0 };
    struct route routes[] = {
        { "PCM_2_PB_CH1 DL2_CH1", "PCM_2_PB_CH1 ", 0, 0, 0 },
        { "UL2_CH1 PCM_2_CAP_CH1", "UL2_CH1 ", 0, 0, 0 },
    };
    const size_t count = sizeof(routes) / sizeof(routes[0]);

    if ((rc = config_create(&cfg)) < 0) { alsa_error("load private ALSA config", rc); goto out; }
    if (board_card(cfg, &ctl, &card) < 0) goto out;
    printf("mt6990-slic: card=%d\n", card);
    if (front_end(ctl, &output) < 0 || front_end(ctl, &input) < 0) goto out;
    if (mixer_routes(ctl, routes, count, &conflict) < 0) goto out;
    if (conflict || !output.avail || !input.avail) {
        fprintf(stderr, "PCM is busy or a competing route is on; mixer was not changed\n");
        goto out;
    }
    if (!duplex) {
        puts("PCM endpoints and switches present; no call or playback tested");
        status = 0; goto out;
    }

    struct sigaction action = { .sa_handler = stop };
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGINT, &action, NULL) < 0 || sigaction(SIGTERM, &action, NULL) < 0 ||
        sigaction(SIGHUP, &action, NULL) < 0) {
        perror("install stop handlers"); goto out;
    }
    for (size_t i = 0; i < count; ++i) {
        if (cancelled) goto out;
        if (!routes[i].initial) {
            if (set_switch(ctl, &routes[i], 1) < 0) goto out;
            routes[i].changed = 1;
        }
    }
    if (open_pcm(cfg, &capture, card, &input) < 0 || open_pcm(cfg, &play, card, &output) < 0) goto out;
    if (cancelled) goto out;
    rc = sample_call(play, capture);
    status = rc == 0 ? 0 : (rc == -ENODATA ? 3 : 1);

out:
    if (play) { snd_pcm_drop(play); snd_pcm_close(play); }
    if (capture) { snd_pcm_drop(capture); snd_pcm_close(capture); }
    if (ctl) {
        for (size_t i = count; i > 0; --i) {
            if (routes[i - 1].changed && set_switch(ctl, &routes[i - 1], routes[i - 1].initial) < 0)
                status = 1;
        }
        snd_ctl_close(ctl);
    }
    if (cfg) snd_config_delete(cfg);
    return status;
}
