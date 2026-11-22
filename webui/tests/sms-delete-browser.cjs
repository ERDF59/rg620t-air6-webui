const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const PDU = require('node-pdu');

const address = '+12025550101';
const keep = '不在选择范围内的合成短信';
const one = '这条要单独删除（模拟）';
const two = '这条纳入批量删除（模拟）';
const stale = '这个索引已复用（模拟）';
const long = '这是合成长短信，用于检查分片删除。'.repeat(12);
const pdu = (text, from = address) => new PDU.Deliver(from, text).getPartStrings();
const parts = pdu(long);
assert.equal(parts.length, 4, 'long SMS fixture has four parts');
const partIndexes = parts.map((_, i) => 10 + i);
const fixture = new Map([
  [4, pdu(one)[0]],
  [7, pdu(two)[0]],
  [8, pdu(stale)[0]],
  ...parts.map((part, i) => [partIndexes[i], i===1 ? '03912143'+part.slice(2) : part]),
  [30, '03912143'+parts[1].slice(2)], // same PDU in another physical slot, via alternate SMSC
  [50, pdu(keep, '+12025550102')[0]],
]);
const requests = [];
let supportsDelete = true;
let partialNextGroup = false;

const dist = path.resolve(__dirname, '../dist');
const contentType = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };
const server = http.createServer(async (req, res) => {
  if (req.url === '/ubus') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { id, params: [session, object, method, params] } = JSON.parse(raw);
    let result = { ok: true };
    if (object === 'dlink-cellular') {
      if (method === 'access') result = { ok: true, protected: true, sms_delete: supportsDelete, sms_delete_group: supportsDelete };
      if (method === 'sms_list') result = { ok: true, indexes: [...fixture.keys()], used: fixture.size, capacity: 80 };
      if (method === 'sms_read') result = { ok: true, pdu: fixture.get(params.index) };
      if (method === 'sms_delete') {
        requests.push({ ...params, session });
        const records = params.records || [{ index: params.index, pdu: params.pdu }];
        if (params.confirm !== true || records.some(({ index, pdu }) => index === 8 || fixture.get(index) !== pdu))
          result = { ok: false, error: 'sms_changed' };
        else if (params.records && partialNextGroup) {
          partialNextGroup = false;
          records.slice(0, 2).forEach(({ index }) => fixture.delete(index));
          result = { ok: true, partial: true, deleted: 2, error: 'sms_delete' };
        } else {
          records.forEach(({ index }) => fixture.delete(index));
          result = { ok: true, deleted: records.length };
        }
      }
      if (method === 'voice_status') result = { ok: true, calls: [] };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: [0, result] }));
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/rg620/')) { res.writeHead(404).end(); return; }
  const file = path.resolve(dist, url.pathname.slice(7) || 'index.html');
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', contentType[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
    await ctx.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await ctx.addInitScript(() => sessionStorage.setItem('rg620_ubus_session', 'fixture'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin + '/rg620/#/sms/center');
    const thread = page.locator('.sms-contact').filter({ hasText: '12025550101' });
    await thread.click();
    const row = (text) => page.locator('.sms-message-row').filter({ hasText: text });
    const dialog = page.getByRole('dialog');
    const ok = () => dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    const cancel = () => dialog.getByRole('button', { name: '取消删除', exact: true }).click();
    const selectMessage = async (text, keyboard = false) => {
      const item = row(text);
      const input = item.getByRole('checkbox');
      if (keyboard) await input.press('Space');
      else await item.locator('.semi-checkbox').click();
      assert.equal(await input.isChecked(), true);
    };

    await row(one).getByRole('button', { name: '删除这条短信' }).click();
    await cancel();
    assert.deepEqual(requests, []);
    await row(one).getByRole('button', { name: '删除这条短信' }).click();
    await ok();
    await row(one).waitFor({ state: 'hidden' });
    assert.deepEqual(requests.map((call) => call.index), [4]);

    await page.getByRole('button', { name: '批量删除', exact: true }).click();
    await selectMessage(two);
    await selectMessage(stale, true);
    await selectMessage(long);
    assert.equal(requests.length, 1);
    const submitSelected = page.getByRole('button', { name: '删除所选 (3)', exact: true });
    const screenshots = process.env.SMS_TEST_ARTIFACTS;
    if (screenshots) {
      await page.getByText('已删除 1 条短信', { exact: true }).waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(screenshots, 'sms-batch-desktop.png'), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Measure both boxes in the same frame, after resizing and scrolling have settled.
    await page.waitForFunction(() => {
      const head = document.querySelector('.sms-thread-head');
      const peer = head?.querySelector('.sms-thread-peer')?.getBoundingClientRect();
      const action = Array.from(head?.querySelectorAll('button') || [])
        .find((button) => button.textContent?.includes('删除所选'))?.getBoundingClientRect();
      return window.innerWidth === 390 && peer && action && action.top >= peer.bottom;
    }, null, { timeout: 4000 });
    if (screenshots) {
      await page.screenshot({ path: path.join(screenshots, 'sms-batch-mobile.png'), animations: 'disabled' });
    }
    await submitSelected.click();
    await ok();
    await row(two).waitFor({ state: 'hidden' });
    await row(long).waitFor({ state: 'hidden' });
    await row(stale).waitFor();
    await page.getByText('已删除 2 条，1 条未完整删除：短信已变化，请刷新后核对').waitFor();
    assert.deepEqual(requests.map((call) => call.records ? call.records.map(({ index }) => index) : call.index), [4, 7, 8, [10,11,30,12,13]]);
    assert.ok(requests.every((call) => call.session === 'fixture' && call.confirm === true));
    assert.deepEqual([...fixture.keys()], [8, 50]);

    // A failed grouped request leaves one incomplete row, not multiple deletable fragments.
    const retryIndexes = parts.map((part, i) => {
      const index = 61 + i;
      fixture.set(index, part);
      return index;
    });
    partialNextGroup = true;
    await page.reload();
    await thread.click();
    await row(long).getByRole('button', { name: '删除这条短信' }).click();
    await ok();
    const remainder = row('现存 2/4 个分片');
    await remainder.waitFor();
    assert.equal(await remainder.count(), 1);
    await page.getByText('部分分片未删除，刷新后可重试', { exact: true }).waitFor();
    assert.deepEqual(requests.at(-1).records.map(({ index }) => index), retryIndexes);
    assert.deepEqual([...fixture.keys()], [8, 50, 63, 64]);
    if (screenshots) await page.screenshot({ path: path.join(screenshots, 'sms-multipart-remainder-mobile.png'), animations: 'disabled' });
    await remainder.getByRole('button', { name: '删除这条短信' }).click();
    await ok();
    await remainder.waitFor({ state: 'hidden' });
    assert.deepEqual(requests.at(-1).records.map(({ index }) => index), [63, 64]);
    assert.deepEqual([...fixture.keys()], [8, 50]);

    supportsDelete = false;
    await page.reload();
    await thread.click();
    await row(stale).waitFor();
    assert.equal(await page.getByRole('button', { name: '批量删除', exact: true }).count(), 0);
    assert.equal(await row(stale).getByRole('button', { name: '删除这条短信' }).count(), 0);
    console.log('PASS: localhost-only UI fixture; cancel, single, selected batch, one-call multipart, grouped remainder and retry, no delete on legacy backend');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
