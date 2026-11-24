const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PW_CORE || 'playwright-core');

const dist = process.env.WEBUI_TEST_DIST || path.resolve(__dirname, '../dist');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = path.resolve(dist, pathname.slice('/rg620/'.length) || 'index.html');
  if (!pathname.startsWith('/rg620/') || !file.startsWith(dist + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const incoming = (id, state = 4, number = '+12025550101') => ({ id, direction: 1, state, kind: 0, number });
const outgoing = (state, number = '+8613800138000') => ({ id: 10, direction: 0, state, kind: 0, number });

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH, headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    await ctx.addInitScript(() => {
      sessionStorage.setItem('rg620_ubus_session', 'fixture');
      window.fixture = { micRequests: 0, blockPlayback: true, vibrations: [] };
      const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (options) => {
        window.fixture.micRequests += 1;
        const stream = await media(options);
        [window.fixture.track] = stream.getAudioTracks();
        return stream;
      };
      Object.defineProperty(navigator, 'vibrate', { value: (pattern) => window.fixture.vibrations.push(pattern) });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.srcObject) {
          if (window.fixture.blockPlayback) return Promise.reject(new DOMException('Fixture playback gate', 'NotAllowedError'));
          window.fixture.player = this;
        }
        return play.call(this);
      };
    });

    let call = incoming(7);
    let answer = 'reject';
    let dialResult = 'setup';
    let gatewayReady = true;
    let releaseStalledOpen;
    let audioAvailable = true;
    const requests = [];
    const errors = [];
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname !== '/ubus') return route.continue();
      const { id, params: [, object, method, params] } = route.request().postDataJSON();
      let result = { ok: true };
      const frame = route.request().frame();
      if (object === 'dlink-cellular') {
        if (method === 'access') result = { ok: true, protected: true, sdk: true, services: true };
        if (method === 'sms_list') result = { ok: true, indexes: [] };
        if (method === 'diag_checks') result = { ok: true, sim: 'ready', radio: true, ims: true, ceer: 0, ratmode: 'NR' };
        if (method === 'voice_status') result = { ok: true, browser_audio: audioAvailable, calls: call ? [call] : [] };
        if (method === 'voice_answer') {
          requests.push({ method, ...params });
          if (answer === 'reject') result = { ok: false, error: 'call_changed' };
          else call = answer === 'replace' ? incoming(9, 0) : { ...call, state: 0 };
        }
        if (method === 'voice_dial') {
          requests.push({ method, ...params });
          call = dialResult === 'empty' ? null
            : dialResult === 'wrongCountry' ? outgoing(2, '+8613472345678') : outgoing(2);
        }
      } else if (object === 'dlink-webvoice') {
        if (method === 'open') {
          requests.push({ method, id: params.id, direction: params.direction, number: params.number, confirm: params.confirm });
          if (gatewayReady === 'stall') {
            await new Promise((resolve) => { releaseStalledOpen = resolve; });
            result = { ok: true, token: 'late-audio', answer: 'unused fixture answer' };
          } else if (!gatewayReady) result = { ok: false, error: 'offline' };
          else result = await frame.evaluate(async (offer) => {
            const remote = new RTCPeerConnection({ iceServers: [] });
            const tone = new AudioContext();
            const oscillator = tone.createOscillator();
            const output = tone.createMediaStreamDestination();
            oscillator.connect(output);
            oscillator.start();
            remote.addTrack(output.stream.getAudioTracks()[0], output.stream);
            window.fixture.remote = { pc: remote, tone, oscillator };
            await remote.setRemoteDescription({ type: 'offer', sdp: offer });
            await remote.setLocalDescription(await remote.createAnswer());
            if (remote.iceGatheringState !== 'complete') {
              await new Promise((resolve) => {
                const update = () => {
                  if (remote.iceGatheringState === 'complete') {
                    remote.removeEventListener('icegatheringstatechange', update);
                    resolve();
                  }
                };
                remote.addEventListener('icegatheringstatechange', update);
              });
            }
            return { ok: true, answer: remote.localDescription.sdp, token: 'fixture-audio' };
          }, params.offer);
        }
        if (method === 'pulse') result = await frame.evaluate(async () => {
          const remote = window.fixture.remote;
          const stats = remote && await remote.pc.getStats();
          return { ok: Boolean(remote), ready: Array.from(stats?.values() || []).some((item) => item.type === 'inbound-rtp' && item.packetsReceived > 0) };
        });
        if (method === 'close') {
          requests.push({ method, token: params.token });
          await frame.evaluate(async () => {
            const remote = window.fixture.remote;
            if (!remote) return;
            window.fixture.remote = null;
            remote.pc.close();
            remote.oscillator.stop();
            await remote.tone.close();
          });
        }
      }
      await route.fulfill({ json: { jsonrpc: '2.0', id, result: [0, result] } });
    });

    const page = await ctx.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(12000);
    const byButton = (name) => page.getByRole('button', { name: new RegExp(name + '$') });
    const confirmAnswer = async () => {
      await byButton('接听来电').click();
      await byButton('确认执行').click();
    };
    const panel = page.getByRole('region', { name: '网页通话音频' });
    const inCall = page.locator('.voice-stage.is-talking');
    const micRequests = () => page.evaluate(() => window.fixture.micRequests);
    await page.goto(origin + '/rg620/#/network/voice');
    await page.getByText('呼叫转移与呼叫等待', { exact: true }).waitFor();
    await confirmAnswer();
    await page.getByText('通话状态已变化，已重新读取。', { exact: true }).first().waitFor();
    call = incoming(8, 0);
    await byButton('刷新状态').click();
    await inCall.waitFor();
    await byButton('启用麦克风和扬声器').waitFor();
    assert.equal(await micRequests(), 0, 'failed answer does not arm the next call');

    answer = 'replace';
    call = incoming(8);
    await byButton('刷新状态').click();
    await confirmAnswer();
    await inCall.waitFor();
    assert.equal(await micRequests(), 0, 'an acknowledged answer must still match the active call');
    assert.deepEqual(requests.slice(0, 2).map(({ id, peer, ringing_only }) => [id, peer, ringing_only]),
      [['7', incoming(7).number, true], ['8', incoming(8).number, true]]);

    answer = 'connect';
    await page.evaluate(() => { location.hash = '#/sms/center'; });
    await page.getByRole('heading', { name: '短信中心' }).waitFor();
    const popup = incoming(11, 4, '+12025550111');
    call = popup;
    const popupAnswer = page.locator('.alert-card').filter({ hasText: popup.number }).getByRole('button', { name: '接听', exact: true });
    await popupAnswer.waitFor();
    await page.waitForFunction(() => window.fixture.vibrations.some(Array.isArray));
    await popupAnswer.click();
    await panel.waitFor();
    await page.locator('.voice-audio[data-phase="live"]').waitFor();
    assert.deepEqual(requests.find(({ method }) => method === 'open'),
      { method: 'open', id: '11', direction: 1, number: popup.number, confirm: true });
    await byButton('播放通话声音').waitFor();
    await page.evaluate(() => { window.fixture.blockPlayback = false; });
    await byButton('播放通话声音').click();
    await page.waitForFunction(() => window.fixture.player?.paused === false);
    await byButton('静音麦克风').click();
    assert.equal(await page.evaluate(() => window.fixture.track.enabled), false);
    await byButton('取消静音').click();
    assert.equal(await page.evaluate(() => window.fixture.track.enabled), true);
    if (process.env.VOICE_TEST_ARTIFACTS) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.VOICE_TEST_ARTIFACTS, 'voice-390-live.png'), animations: 'disabled' });
    }
    await byButton('断开音频').click();
    await page.waitForFunction(() => window.fixture.track.readyState === 'ended' && !window.fixture.remote);
    assert.equal(await inCall.isVisible(), true, 'disconnect audio does not hang up the call');
    assert.equal(requests.at(-1).method, 'close');

    gatewayReady = false;
    const dial = async (number) => {
      call = null;
      await byButton('刷新状态').click();
      const input = page.getByPlaceholder('输入电话号码');
      await input.fill(number);
      await byButton('拨打').click();
      await byButton('确认执行').click();
    };
    const stage = page.locator('.voice-stage-copy');
    dialResult = 'empty';
    await dial('13800138000');
    await page.getByText('已请求拨号', { exact: true }).first().waitFor();
    await byButton('刷新状态').click();
    await stage.getByText('输入号码拨打，或等待来电呼入').waitFor();
    call = outgoing(2);
    await byButton('刷新状态').click();
    await stage.getByText(/拨号中/).waitFor();
    call = outgoing(0);
    await byButton('刷新状态').click();
    await inCall.waitFor();
    assert.equal(await micRequests(), 1, 'an empty dial readback does not authorize a later same-number call');

    dialResult = 'wrongCountry';
    await dial('+13472345678');
    await stage.getByText(/拨号中/).waitFor();
    call = outgoing(0, '+8613472345678');
    await byButton('刷新状态').click();
    await inCall.waitFor();
    assert.equal(await micRequests(), 1, 'explicit international dialing is not matched as a mainland mobile');

    dialResult = 'setup';
    await dial('13800138000');
    await stage.getByText(/拨号中/).waitFor();
    call = outgoing(0);
    await byButton('刷新状态').click();
    await panel.getByText('路由器的网页通话服务未就绪。').waitFor();
    assert.equal(await micRequests(), 2);
    assert.deepEqual(requests.at(-1),
      { method: 'open', id: '10', direction: 0, number: '+8613800138000', confirm: true });
    assert.equal(await page.evaluate(() => window.fixture.track.readyState), 'ended');

    gatewayReady = 'stall';
    await page.clock.install();
    const audioRpc = (method) => (req) => req.url() === origin + '/ubus' &&
      req.postDataJSON()?.params?.[1] === 'dlink-webvoice' && req.postDataJSON()?.params?.[2] === method;
    const opening = page.waitForRequest(audioRpc('open'));
    await byButton('启用麦克风和扬声器').click();
    await opening;
    await page.clock.fastForward(16_001);
    await panel.getByText('路由器未及时建立网页音频，已释放麦克风。').waitFor();
    assert.equal(await page.evaluate(() => window.fixture.track.readyState), 'ended');
    const closing = page.waitForRequest(audioRpc('close'));
    releaseStalledOpen();
    assert.equal((await closing).postDataJSON().params[3].token, 'late-audio');

    audioAvailable = false;
    await byButton('刷新状态').click();
    await panel.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: mobile answer/dial; failed and mismatched calls do not capture; browser-to-browser audio packets, blocked playback recovery, mute, release and capability gate');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
