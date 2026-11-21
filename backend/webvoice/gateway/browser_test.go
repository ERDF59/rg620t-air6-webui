package main

import (
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrowserDuplex(t *testing.T) {
	if os.Getenv("WEBVOICE_BROWSER_TEST") != "1" {
		t.Skip("set WEBVOICE_BROWSER_TEST=1 for the Chromium fixture")
	}
	iface := "lo"
	if _, err := net.InterfaceByName(iface); err != nil {
		iface = "lo0"
	}
	var live atomic.Bool
	live.Store(true)
	var tone atomic.Bool
	call := Call{ID: 7, Direction: 1, Number: "100", Kind: 0}
	h := Hub{iface: iface, current: func() (Call, bool) { return call, live.Load() }, lock: func() ([]*os.File, error) { return nil, nil }, bridge: func(s *Session) {
		ti := time.NewTicker(time.Second / 50)
		defer ti.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case b := <-s.input:
				for _, v := range b {
					if expand(v) > 700 {
						tone.Store(true)
					}
				}
				s.up.Add(1)
			case <-ti.C:
				out := make([]byte, 160)
				for i := range out {
					out[i] = compress(int16(4500 * math.Sin(2*math.Pi*650*float64(i)/8000)))
				}
				s.send(out)
			}
		}
	}}
	mux := http.NewServeMux()
	mux.HandleFunc("/rpc", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var q Req
		if json.NewDecoder(io.LimitReader(r.Body, 48000)).Decode(&q) != nil {
			w.WriteHeader(400)
			return
		}
		json.NewEncoder(w).Encode(h.process(q))
	})
	mux.HandleFunc("/end-test-call", func(w http.ResponseWriter, r *http.Request) { live.Store(false) })
	mux.Handle("/ui/", http.StripPrefix("/ui/", http.FileServer(http.Dir("../../cellular/root/www/luci-static/resources/dlink-cellular"))))
	mux.Handle("/", http.FileServer(http.Dir("../tests")))
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	srv := &http.Server{Handler: mux}
	go srv.Serve(l)
	defer srv.Close()
	cmd := exec.Command("node", "../tests/browser.cjs", "http://"+l.Addr().String())
	out, e := cmd.CombinedOutput()
	t.Log(string(out))
	if e != nil || !tone.Load() || !strings.Contains(string(out), "DUPLEX_PASS") {
		t.Fatalf("browser=%v received microphone signal=%v", e, tone.Load())
	}
}
