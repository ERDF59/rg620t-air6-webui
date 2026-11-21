package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"

	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const sock = "/var/run/dlink-webvoice.sock"

type Call struct {
	ID        int
	Direction int
	State     int
	Kind      int
	Number    string
	Voice     bool
}

func active(raw []byte) (Call, bool) {
	var s struct {
		OK       bool
		ReadOnly bool `json:"read_only"`
		Calls    []Call
	}
	if json.Unmarshal(raw, &s) != nil || !s.OK || s.ReadOnly || len(s.Calls) != 1 {
		return Call{}, false
	}
	c := s.Calls[0]
	return c, c.ID >= 0 && c.ID <= 255 && c.State == 0 && (c.Kind == 0 || c.Voice)
}
func readCall() (Call, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	b, e := exec.CommandContext(ctx, "/usr/libexec/rpcd/dlink-cellular", "call", "voice_status").Output()
	if e != nil {
		return Call{}, false
	}
	return active(b)
}

type Req struct {
	Method    string
	ID        string
	Number    string
	Direction int
	Confirm   bool
	Offer     string
	Token     string
}
type Res struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Answer string `json:"answer,omitempty"`
	Token  string `json:"token,omitempty"`
	Ready  bool   `json:"ready"`
	Up     uint64 `json:"up"`
	Down   uint64 `json:"down"`
}

func fail(s string) Res { return Res{Error: s} }

type Session struct {
	ctx                context.Context
	cancel             context.CancelFunc
	pc                 *webrtc.PeerConnection
	out                *webrtc.TrackLocalStaticSample
	input              chan []byte
	connected          chan struct{}
	once               sync.Once
	call               Call
	token              string
	beat               atomic.Int64
	up, down, incoming atomic.Uint64
	locks              []*os.File
}
type Hub struct {
	mu      sync.Mutex
	s       *Session
	current func() (Call, bool)
	bridge  func(*Session)
	iface   string
	lock    func() ([]*os.File, error)
}

func locks() ([]*os.File, error) {
	var fs []*os.File
	for _, p := range []string{"t830-speech-session.lock", "t830-call-media-test.lock"} {
		f, e := os.OpenFile("/var/lock/"+p, os.O_CREATE|os.O_RDWR, 0600)
		if e == nil {
			e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		}
		if e != nil {
			if f != nil {
				f.Close()
			}
			for _, a := range fs {
				a.Close()
			}
			return nil, e
		}
		fs = append(fs, f)
	}
	return fs, nil
}
func (h *Hub) process(r Req) Res {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r.Method != "open" {
		s := h.s
		if s == nil || r.Token == "" || s.token != r.Token || s.ctx.Err() != nil {
			return fail("session_closed")
		}
		switch r.Method {
		case "close":
			s.cancel()
			return Res{OK: true}
		case "pulse":
			s.beat.Store(time.Now().UnixMilli())
			u, d := s.up.Load(), s.down.Load()
			return Res{OK: true, Ready: u > 0 && d > 0 && s.incoming.Load() > 0, Up: u, Down: d}
		}
		return fail("input")
	}
	if !r.Confirm {
		return fail("confirm")
	}
	if h.s != nil {
		return fail("busy")
	}
	c, ok := h.current()
	if !ok || strconv.Itoa(c.ID) != r.ID || c.Direction != r.Direction || c.Number != r.Number {
		return fail("call_changed")
	}
	text, ok := offer(r.Offer)
	if !ok {
		return fail("invalid_offer")
	}
	fs, e := h.lock()
	if e != nil {
		return fail("busy")
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Session{ctx: ctx, cancel: cancel, call: c, locks: fs, connected: make(chan struct{}), input: make(chan []byte, 4)}
	success := false
	defer func() {
		if !success {
			cancel()
			if s.pc != nil {
				s.pc.Close()
			}
			for _, f := range fs {
				f.Close()
			}
		}
	}()
	var b [24]byte
	if _, e = rand.Read(b[:]); e != nil {
		return fail("setup")
	}
	s.token = hex.EncodeToString(b[:])
	pc, track, e := peer(h.iface)
	if e != nil {
		return fail("rtc")
	}
	s.pc = pc
	s.out = track
	pc.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if t.Codec().MimeType != webrtc.MimeTypePCMU {
			s.cancel()
			return
		}
		var prev uint16
		first := true
		for {
			p, _, e := t.ReadRTP()
			if e != nil {
				return
			}
			if !first && int16(p.SequenceNumber-prev) <= 0 {
				continue
			}
			prev = p.SequenceNumber
			first = false
			if len(p.Payload) > 0 && len(p.Payload) <= 960 {
				select {
				case s.input <- p.Payload:
					s.incoming.Add(1)
				default: /* bounded latency */
				}
			}
		}
	})
	pc.OnConnectionStateChange(func(x webrtc.PeerConnectionState) {
		switch x {
		case webrtc.PeerConnectionStateConnected:
			s.once.Do(func() { close(s.connected) })
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed, webrtc.PeerConnectionStateDisconnected:
			s.cancel()
		}
	})
	if pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: text}) != nil {
		return fail("invalid_offer")
	}
	a, e := pc.CreateAnswer(nil)
	if e != nil {
		return fail("rtc")
	}
	g := webrtc.GatheringCompletePromise(pc)
	if pc.SetLocalDescription(a) != nil {
		return fail("rtc")
	}
	select {
	case <-g:
	case <-time.After(5 * time.Second):
		return fail("ice")
	}
	ans := pc.LocalDescription().SDP
	if !strings.Contains(ans, "a=candidate:") || !strings.Contains(ans, "a=sendrecv") {
		return fail("lan")
	}
	s.beat.Store(time.Now().UnixMilli())
	h.s = s
	success = true
	go h.run(s)
	return Res{OK: true, Answer: ans, Token: s.token}
}
func offer(x string) (string, bool) {
	if len(x) < 100 || len(x) > 32000 {
		return "", false
	}
	var lines []string
	count := 0
	for _, l := range strings.Split(strings.ReplaceAll(x, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(l, "m=") {
			count++
			if !strings.HasPrefix(l, "m=audio ") || !strings.Contains(l, " UDP/TLS/RTP/SAVPF ") {
				return "", false
			}
		}
		if strings.HasPrefix(l, "a=candidate:") || l == "a=end-of-candidates" || l == "" {
			continue
		}
		if l == "a=ice-lite" {
			return "", false
		}
		lines = append(lines, l)
	}
	return strings.Join(lines, "\r\n") + "\r\n", count == 1 && strings.Contains(x, "a=fingerprint:") && strings.Contains(x, "a=sendrecv")
}
func peer(iface string) (*webrtc.PeerConnection, *webrtc.TrackLocalStaticSample, error) {
	m := &webrtc.MediaEngine{}
	cap := webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypePCMU, ClockRate: 8000, Channels: 1}
	if e := m.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: cap, PayloadType: 0}, webrtc.RTPCodecTypeAudio); e != nil {
		return nil, nil, e
	}
	var st webrtc.SettingEngine
	st.SetLite(true)
	st.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	st.SetInterfaceFilter(func(n string) bool { return n == iface })
	st.SetIncludeLoopbackCandidate(iface == "lo0" || iface == "lo")
	st.SetICETimeouts(4*time.Second, 7*time.Second, time.Second)
	pc, e := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithSettingEngine(st)).NewPeerConnection(webrtc.Configuration{})
	if e != nil {
		return nil, nil, e
	}
	t, e := webrtc.NewTrackLocalStaticSample(cap, "downlink", "dlink")
	if e == nil {
		var sender *webrtc.RTPSender
		sender, e = pc.AddTrack(t)
		if e == nil {
			go func() {
				buf := make([]byte, 1500)
				for {
					if _, _, e := sender.Read(buf); e != nil {
						return
					}
				}
			}()
		}
	}
	if e != nil {
		pc.Close()
	}
	return pc, t, e
}
func (h *Hub) run(s *Session) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-s.ctx.Done():
			return
		case <-s.connected:
		}
		c, ok := h.current()
		if s.ctx.Err() != nil || !ok || c != s.call {
			s.cancel()
			return
		}
		h.bridge(s)
		s.cancel()
	}()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	start := time.Now()
outer:
	for {
		select {
		case <-s.ctx.Done():
			break outer
		case <-tick.C:
			if time.Now().UnixMilli()-s.beat.Load() > 12000 {
				break outer
			}
			select {
			case <-s.connected:
			default:
				if time.Since(start) > 15*time.Second {
					break outer
				}
			}
			c, ok := h.current()
			if !ok || c != s.call {
				break outer
			}
		}
	}
	s.cancel()
	s.pc.Close()
	<-done
	for _, f := range s.locks {
		f.Close()
	}
	h.mu.Lock()
	if h.s == s {
		h.s = nil
	}
	h.mu.Unlock()
}
func (s *Session) send(b []byte) error {
	e := s.out.WriteSample(media.Sample{Data: b, Duration: 20 * time.Millisecond})
	if e == nil {
		s.down.Add(1)
	}
	return e
}

const methods = `{"open":{"id":"","direction":0,"number":"","offer":"","confirm":true},"pulse":{"token":""},"close":{"token":""}}`

func main() {
	if len(os.Args) == 2 && os.Args[1] == "serve" {
		if e := serve(); e != nil {
			os.Exit(1)
		}
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "list" {
		os.Stdout.WriteString(methods + "\n")
		return
	}
	r := Req{}
	resp := fail("input")
	if len(os.Args) == 3 && os.Args[1] == "call" && json.NewDecoder(io.LimitReader(os.Stdin, 48000)).Decode(&r) == nil {
		r.Method = os.Args[2]
		c, e := net.DialTimeout("unix", sock, time.Second)
		if e == nil {
			defer c.Close()
			c.SetDeadline(time.Now().Add(12 * time.Second))
			if json.NewEncoder(c).Encode(r) == nil && json.NewDecoder(io.LimitReader(c, 48000)).Decode(&resp) != nil {
				resp = fail("offline")
			}
		} else {
			resp = fail("offline")
		}
	}
	json.NewEncoder(os.Stdout).Encode(resp)
}
func serve() error {
	board, _ := os.ReadFile("/tmp/sysinfo/board_name")
	if strings.TrimSpace(string(board)) != "dlink,dwr-be7200g" {
		return errors.New("board")
	}
	h := Hub{current: readCall, bridge: hardware, iface: "br-lan", lock: locks}
	// Only the singleton owning the service lock may clean its stale Unix socket.
	lock, e := os.OpenFile("/var/run/dlink-webvoice.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer lock.Close()
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return e
	}
	if st, e := os.Lstat(sock); e == nil && st.Mode()&os.ModeSocket != 0 {
		if e = os.Remove(sock); e != nil {
			return e
		}
	}
	l, e := net.Listen("unix", sock)
	if e != nil {
		return e
	}
	defer l.Close()
	if e = os.Chmod(sock, 0600); e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	go func() { <-ctx.Done(); l.Close() }()
	for {
		c, e := l.Accept()
		if e != nil {
			break
		}
		go func() {
			defer c.Close()
			c.SetDeadline(time.Now().Add(12 * time.Second))
			var r Req
			if json.NewDecoder(bufio.NewReader(io.LimitReader(c, 48000))).Decode(&r) == nil {
				json.NewEncoder(c).Encode(h.process(r))
			}
		}()
	}
	h.mu.Lock()
	s := h.s
	if s != nil {
		s.cancel()
	}
	h.mu.Unlock()
	for i := 0; i < 50; i++ {
		h.mu.Lock()
		empty := h.s == nil
		h.mu.Unlock()
		if empty {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}
