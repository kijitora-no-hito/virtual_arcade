// 画面の確認用。Edge ヘッドレス（CDP）で 1920×1080 を撮る:
//   node scripts/dev/shot.mjs <url> <out.png> [待ち ms] [eval 式] [localStorage の JSON]
//   環境変数 CLICK="x,y;x,y"（順にクリック）/ MOUSE="x,y"（ホバー）/ CDP_PORT（既定 9361）
//   CLICK_EXPR・MOUSE_EXPR：ページの中で評価して "x,y;x,y" を返す式（URL の末尾に #dev を付けると window.__va が使える。
//   例 "(p => p.x + ',' + p.y)(__va.cab(3))"）。CLICK・MOUSE より先に評価する
//   AFTER_MS：eval 式のあと、撮るまでに待つ時間（ボタンを押して窓が開くのを待つ）
//   v0.4.0（スマホ）：VIEWPORT="390x844"（既定 1920x1080）・MOBILE=1（mobile: true とタッチの操作。DPR の既定 2）・DPR=…
//   TAP="x,y;x,y" / TAP_EXPR：指でタップ（Input.dispatchTouchEvent）。CLICK より後、eval 式より前
// --virtual-time-budget だと WebSocket の受信前に撮れてしまうので、実時間で待ってから撮る
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , url, out, waitMs = '4000', expr, lsJson] = process.argv;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9361);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'va-edge-'));
const p = spawn(
  edge,
  ['--headless=new', '--window-size=1920,1080', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list = null;
for (let i = 0; i < 60 && !list; i++) {
  await sleep(250);
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {}
}
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let n = 0;
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++n;
    const on = (d) => {
      const m = JSON.parse(String(d));
      if (m.id === id) {
        ws.off('message', on);
        res(m.result);
      }
    };
    ws.on('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Page.enable');
const [vw, vh] = (process.env.VIEWPORT ?? '1920x1080').split('x').map(Number);
const mobile = process.env.MOBILE === '1';
await send('Emulation.setDeviceMetricsOverride', {
  width: vw,
  height: vh,
  deviceScaleFactor: Number(process.env.DPR ?? (mobile ? 2 : 1)),
  mobile,
  ...(mobile ? { screenOrientation: vw > vh ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } } : {}),
});
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (lsJson) {
  // 同じオリジンを開いて localStorage を入れてから本番の URL へ
  // 同じオリジンの存在しないページ（404 の文字だけ）で入れる。アプリを開くと先に鍵を作ってしまうため
  await send('Page.navigate', { url: new URL(url).origin + '/__ls' });
  await sleep(1200);
  const kv = JSON.parse(lsJson);
  for (const [k, v] of Object.entries(kv))
    await send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))})` });
}
await send('Page.navigate', { url });
await sleep(Number(waitMs));
const evalStr = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
if (process.env.CLICK_EXPR) process.env.CLICK = String(await evalStr(process.env.CLICK_EXPR));
if (process.env.MOUSE_EXPR) process.env.MOUSE = String(await evalStr(process.env.MOUSE_EXPR));
if (process.env.CLICK) {
  // CLICK="x,y;x,y"：順にクリック（タブの切り替えなど）
  for (const pt of process.env.CLICK.split(';')) {
    const [x, y] = pt.split(',').map(Number);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(600);
  }
}
if (process.env.TAP_EXPR) process.env.TAP = String(await evalStr(process.env.TAP_EXPR));
if (process.env.TAP) {
  for (const pt of process.env.TAP.split(';')) {
    const [x, y] = pt.split(',').map(Number);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
  }
}
if (process.env.MOUSE) {
  const [x, y] = process.env.MOUSE.split(',').map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 5, y: y - 5 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(500);
}
if (expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result.value));
  if (process.env.AFTER_MS) await sleep(Number(process.env.AFTER_MS));
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res) => bws.once('open', res));
bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((res) => p.once('exit', res));
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(0);
