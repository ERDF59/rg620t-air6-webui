#include "tone.h"

#include <math.h>

static const double tau = 6.2831853071795864769;

static double bin_power(const int16_t *x, unsigned hz)
{
    const double coefficient = 2.0 * cos(tau * hz / T830_RATE);
    double old = 0, older = 0;
    for (size_t i = 0; i < T830_WINDOW; ++i) {
        const double next = x[i] + coefficient * old - older;
        older = old;
        old = next;
    }
    return old * old + older * older - coefficient * old * older;
}

enum marker t830_marker(const int16_t *samples)
{
    double energy = 0;
    for (size_t i = 0; i < T830_WINDOW; ++i)
        energy += (double)samples[i] * samples[i];
    if (energy < 180.0 * 180.0 * T830_WINDOW)
        return MARKER_NONE;

    const double local = bin_power(samples, T830_UP_HZ);
    const double remote = bin_power(samples, T830_DOWN_HZ);
    const double threshold = 0.20 * energy * T830_WINDOW;
    if (remote >= threshold && remote > 2 * local) return MARKER_REMOTE;
    if (local >= threshold && local > 2 * remote) return MARKER_LOCAL;
    return MARKER_NONE;
}

void t830_accumulate(struct markers *out, const int16_t *samples, size_t frames)
{
    for (size_t i = 0; i < frames; ++i) {
        out->window[out->used++] = samples[i];
        if (out->used == T830_WINDOW) {
            switch (t830_marker(out->window)) {
            case MARKER_REMOTE: ++out->remote; break;
            case MARKER_LOCAL: ++out->local; break;
            case MARKER_NONE: break;
            }
            out->used = 0;
        }
    }
}

void t830_uplink(int16_t *samples, size_t frames, size_t offset)
{
    for (size_t i = 0; i < frames; ++i) {
        const size_t p = (offset + i) % T830_RATE;
        samples[i] = p < T830_RATE / 3u
            ? (int16_t)(2048.0 * sin(tau * T830_UP_HZ * p / T830_RATE)) : 0;
    }
}
