package main

import (
	"context"
	"encoding/binary"
	"io"

	"os/exec"
	"syscall"
	"time"
)

func child(ctx context.Context, name string) *exec.Cmd {
	c := exec.CommandContext(ctx, "/usr/libexec/dlink-webvoice/"+name)
	c.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	c.Cancel = func() error { return c.Process.Signal(syscall.SIGTERM) }
	c.WaitDelay = 4 * time.Second
	return c
}
func hardware(s *Session) {
	ctx, stop := context.WithCancel(s.ctx)
	defer stop()
	rx := child(ctx, "rx")
	r, e := rx.StdoutPipe()
	if e != nil {
		return
	}
	tx := child(ctx, "tx")
	w, e := tx.StdinPipe()
	if e != nil {
		return
	}
	ack, e := tx.StdoutPipe()
	if e != nil {
		return
	}
	if e = tx.Start(); e != nil {
		return
	}
	if e = rx.Start(); e != nil {
		stop()
		w.Close()
		tx.Wait()
		return
	}
	done := make(chan struct{}, 3)
	go func() {
		defer func() { done <- struct{}{} }()
		var block [640]byte
		var prev [6]int
		for {
			if _, e := io.ReadFull(r, block[:]); e != nil {
				return
			}
			out := make([]byte, 160)
			for j := 0; j < 320; j++ {
				x := int(int16(binary.LittleEndian.Uint16(block[j*2:])))
				if j%2 == 1 {
					// Half-band seven-tap decimator; downlink is Capture_2 channel 1, never stereo mix.
					y := (-prev[0] + 9*prev[2] + 16*prev[3] + 9*prev[4] - x) / 32
					if y > 32767 {
						y = 32767
					}
					if y < -32768 {
						y = -32768
					}
					out[j/2] = compress(int16(y))
				}
				copy(prev[:], prev[1:])
				prev[5] = x
			}
			if s.ctx.Err() != nil || s.send(out) != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		var b [64]byte
		for {
			n, e := ack.Read(b[:])
			if n > 0 {
				s.up.Add(uint64(n))
			}
			if e != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		t := time.NewTicker(20 * time.Millisecond)
		defer t.Stop()
		var fifo []byte
		var prev int
		warmed := false
		for {
			select {
			case <-ctx.Done():
				return
			case p := <-s.input:
				if len(fifo)+len(p) > 1120 {
					fifo = nil
					warmed = false
				}
				fifo = append(fifo, p...)
			case <-t.C:
				var bytes [1280]byte
				if len(fifo) >= 320 {
					warmed = true
				}
				for i := 0; i < 160; i++ {
					v := 0
					if warmed && len(fifo) > 0 {
						v = int(expand(fifo[0]))
						fifo = fifo[1:]
					} else {
						warmed = false
					}
					for k := 1; k <= 4; k++ {
						binary.LittleEndian.PutUint16(bytes[8*i+2*(k-1):], uint16(prev+(v-prev)*k/4))
					}
					prev = v
				}
				if _, e := w.Write(bytes[:]); e != nil {
					return
				}
			}
		}
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
	stop()
	w.Close()
	r.Close()
	ack.Close()
	tx.Wait()
	rx.Wait()
}
