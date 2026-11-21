package main

import "testing"

func TestPCM(t *testing.T) {
	for _, x := range []int16{0, 8, 1000, -1000, 12000, -12000, 32767, -32768} {
		v := int(expand(compress(x)))
		d := v - int(x)
		if d > 700 || d < -700 {
			t.Fatalf("%d => %d", x, v)
		}
	}
}
func TestCallGuard(t *testing.T) {
	good := []byte(`{"ok":true,"calls":[{"id":1,"state":0,"direction":1,"kind":20,"voice":true,"number":"100"}]}`)
	if _, ok := active(good); !ok {
		t.Fatal("vendor voice")
	}
	for _, s := range []string{`{"ok":true,"calls":[]}`, `{"ok":true,"read_only":true,"calls":[{"id":1,"state":0,"kind":0}]}`, `{"ok":true,"calls":[{"id":1,"state":4,"kind":0}]}`, `{"ok":true,"calls":[{"id":1,"state":0,"kind":20}]}`} {
		if _, ok := active([]byte(s)); ok {
			t.Fatal(s)
		}
	}
}
