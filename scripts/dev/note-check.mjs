// コミュニケーションノートの確認（v0.4.0。DESIGN §12）。スマホの縦向き（1 ページずつ）で開き、左右のスワイプでめくる・
// 画面から書く（いちばん新しいページへ）・ほかの人が書いたらその場で加わる（今のページは動かさない）を確かめる。
//   node scripts/dev/note-check.mjs <url（#dev 付き）> <鍵> [out.png]
// ほかの人は、この中で新しく入店して WebSocket でつないで書く（店内にいる人だけが書けるため）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , url, key, out] = process.argv;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9364);
const [vw, vh] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'va-edge-'));
const p = spawn(
  edge,
  ['--headless=new', '--mute-audio', '--window-size=1920,1080', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);

// Edge を必ず閉じる（終わり・失敗・Ctrl+C）。ヘッドレスでも音は出るので --mute-audio で起動している（v0.5.0）
const killEdge = () => {
  try {
    p.kill();
  } catch {}
};
process.on('exit', killEdge);
process.on('SIGINT', () => process.exit(130));
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error(e);
  process.exit(1);
});
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
    // 返事が来ないとき（ヘッドレスの Edge がタッチの返事を返さないことがある）は 5 秒で先へ進む
    const timer = setTimeout(() => {
      ws.off('message', on);
      console.log(`（${method} の返事が 5 秒来なかったので先へ進みます）`);
      res(undefined);
    }, 5000);
    const on = (d) => {
      const m = JSON.parse(String(d));
      if (m.id === id) {
        clearTimeout(timer);
        ws.off('message', on);
        res(m.result);
      }
    };
    ws.on('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

await send('Page.enable');
// ヘッドレスでも前面・フォーカスありとして扱う（裏に回ったページはタッチの返事が遅れる・来ないことがある）
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: new URL(url).origin + '/__ls' });
await sleep(1000);
await ev(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(key))}); sessionStorage.setItem('va:room', 'open')`); // v0.5.0：このタブで店内にいた（再読み込み）ことにして自動で入る
await send('Page.navigate', { url });
await sleep(5000);

let ng = 0;
const check = (ok, what, detail = '') => {
  if (!ok) ng++;
  console.log(`${ok ? 'OK' : 'NG'}  ${what}${detail ? `  (${detail})` : ''}`);
};
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const swipe = async (x0, x1, y) => {
  await touch('touchStart', [[x0, y]]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[x0 + ((x1 - x0) * i) / 6, y]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(500);
};
const label = () => ev(`document.querySelector('.note-pages')?.textContent`);
const firstName = () => ev(`document.querySelector('.note-page .note-name')?.textContent`);

const base = new URL(url);
const apiBase = base.origin + base.pathname.replace(/\/$/, '');
const total0 = (await (await fetch(`${apiBase}/api/notes`)).json()).total;
const pages = (n) => Math.max(1, Math.ceil(n / 4));

await ev(`__va.open({kind:'note'})`);
await sleep(1500);
check((await label()) === `${pages(total0)} / ${pages(total0)}`, '開くといちばん新しいページ（縦向きは 1 ページずつ）', await label());
const book = await ev(`JSON.stringify(document.querySelector('.note-book').getBoundingClientRect())`).then(JSON.parse);
const y = Math.round(book.top + book.height / 2);
await swipe(book.left + book.width * 0.2, book.left + book.width * 0.85, y);
check((await label()) === `${pages(total0) - 1} / ${pages(total0)}`, '右へスワイプで前のページ', await label());

await swipe(book.left + book.width * 0.85, book.left + book.width * 0.2, y);
check((await label()) === `${pages(total0)} / ${pages(total0)}`, '左へスワイプで次のページ', await label());
await swipe(book.left + book.width * 0.85, book.left + book.width * 0.2, y);
check((await label()) === `${pages(total0)} / ${pages(total0)}`, '最後のページで止まる', await label());

// 前のページを見ている間に、ほかの人が書く → 件数は増えるが今のページは動かない
await swipe(book.left + book.width * 0.2, book.left + book.width * 0.85, y);
const before = await label();
const nameBefore = await firstName();
const okey = globalThis.crypto.randomUUID().replace(/-/g, '') + 'x'.repeat(12);
await fetch(`${apiBase}/api/enter`, { method: 'POST', headers: { 'X-VA-Key': okey, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'そら', look: { color: 'green', hat: 'cap' } }) });
const ows = new WebSocket(`${apiBase.replace(/^http/, 'ws')}/ws`);
await new Promise((r) => ows.once('open', r));
ows.send(JSON.stringify({ type: 'hello', key: okey, proto: 2 }));
await new Promise((r) => ows.once('message', r));
const posted = await fetch(`${apiBase}/api/notes`, {
  method: 'POST',
  headers: { 'X-VA-Key': okey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'そら', text: 'はじめまして。\nスマホから来ました' }),
});
check(posted.status === 201, 'ほかの人が書く（API）', String(posted.status));
await sleep(800);
const after = await label();
const t1 = total0 + 1;
check(after === `${pages(total0) - 1} / ${pages(t1)}` && (await firstName()) === nameBefore, 'その場で件数が増え、今のページは動かない', `${before} → ${after}`);
ows.close();

// 自分で書く → いちばん新しいページへ
await ev(`document.querySelector('.note-modal .modal-head .primary').click()`);
await sleep(300);
await ev(`(() => {
  const ta = document.querySelector('.note-input');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, 'ノートの確認です\\n2 行目\\n3 行目\\n4 行目は入らない');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
check((await ev(`document.querySelector('.note-input').value`)) === 'ノートの確認です\n2 行目\n3 行目', '書く欄は 3 行まで（4 行目は入らない）');
await ev(`document.querySelector('.note-form .primary').click()`);
await sleep(1200);
const t2 = t1 + 1;
check((await label()) === `${pages(t2)} / ${pages(t2)}`, '書いたらいちばん新しいページへ', await label());
const texts = await ev(`[...document.querySelectorAll('.note-text')].map((e) => e.textContent).join('|')`);
check(texts.includes('ノートの確認です\n2 行目\n3 行目'), '書いた文が出る（改行も）');
if (out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
}
console.log(`NG ${ng}`);
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res) => bws.once('open', res));
bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((res) => p.once('exit', res));
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(ng ? 1 : 0);
