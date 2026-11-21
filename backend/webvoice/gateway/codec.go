package main

import "math/bits"

// G.711 mu-law, PCM16 LE at each native boundary. RTP clock 8000 Hz.
func compress(v int16) byte {
	x := int(v)
	m := 0xff
	if x < 0 {
		x = -x
		m = 0x7f
	}
	if x > 32635 {
		x = 32635
	}
	x += 132
	e := bits.Len(uint(x)) - 8
	return byte(m ^ (e<<4 | ((x >> (e + 3)) & 15)))
}
func expand(u byte) int16 {
	u = ^u
	t := (int((u&15)<<3) + 132) << ((u >> 4) & 7)
	if u&128 != 0 {
		return int16(132 - t)
	}
	return int16(t - 132)
}
