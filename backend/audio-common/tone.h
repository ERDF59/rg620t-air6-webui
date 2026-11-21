#ifndef T830_TONE_H
#define T830_TONE_H

#include <stddef.h>
#include <stdint.h>

#define T830_RATE 16000u
#define T830_WINDOW (T830_RATE / 50u)
#define T830_UP_HZ 750u
#define T830_DOWN_HZ 1150u
#define T830_SECONDS 6u
#define T830_MARKER_WINDOWS 8u

enum marker { MARKER_NONE, MARKER_LOCAL, MARKER_REMOTE };
struct markers {
    int16_t window[T830_WINDOW];
    size_t used;
    unsigned local, remote;
};

enum marker t830_marker(const int16_t *samples);
void t830_accumulate(struct markers *out, const int16_t *samples, size_t frames);
void t830_uplink(int16_t *samples, size_t frames, size_t offset);

#endif
