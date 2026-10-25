// スマホでソフトキーボードを出したときの確認（v0.4.1。0.4.0 の「縦向きでチャットの欄を押すとキーボードが一瞬出てすぐ閉じる」への対応）。
// Edge ヘッドレス（CDP）で Pixel の縦向き 412×915（mobile・タッチ・Android の User-Agent）にして、文字の欄にフォーカスしてから
// Emulation.setDeviceMetricsOverride で画面の高さだけを 412×400 に縮める（interactive-widget=resizes-content のキーボードと同じ。
// 端末の画面（screen）は 412×915 の縦のまま）。フォーカスが残るか・同じ DOM の要素のままか・縦向きのレイアウトのままかを確かめる。
// あわせて本当の回転（915×412・screen も横）でレイアウトが切り替わること、ノート・要望・ポスター・管理者・見た目を変える・入店の名前の欄も確かめる。
//   node scripts/dev/keyboard-check.mjs <url（#dev 付き）> <鍵> [out.png]
// 結果は 1 行ずつ「OK / NG 内容」で出す。最後に NG の数で終わる（0 なら成功）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , url, key, out] = process.argv;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9366);
const W = 412;
const H = 915;
const KB = 400; // キーボードが出たときの高さ（縦向き）
const KB_LAND = 200; // 横向き
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
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;

/** 表示域 w×h。screen（端末の画面）は sw×sh（キーボードでは変わらない・回転では変わる） */
const metrics = (w, h, sw = w, sh = h) =>
  send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: sw,
    screenHeight: sh,
    screenOrientation: sw > sh ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
  });

await send('Page.enable');
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  userAgentMetadata: { platform: 'Android', platformVersion: '15', architecture: '', model: 'Pixel 8', mobile: true },
});
await metrics(W, H);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: new URL(url).origin + '/__ls' });
await sleep(1000);
await ev(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(key))})`);
await send('Page.navigate', { url });
await sleep(5000);

let ng = 0;
const check = (ok, what, detail = '') => {
  if (!ok) ng++;
  console.log(`${ok ? 'OK' : 'NG'}  ${what}${detail ? `  (${detail})` : ''}`);
};
const orient = () =>
  ev(`(() => { const c = document.documentElement.classList; return c.contains('orient-landscape') ? 'landscape' : c.contains('orient-portrait') ? 'portrait' : c.contains('layout-mobile') ? 'mobile?' : 'pc'; })()`);
/** 印を付けた要素の今の状態：フォーカス・DOM に残っているか・同じ要素か（selector で探し直したものと同じか） */
const state = (selector) =>
  ev(`(() => {
    const el = window.__kbdEl;
    const now = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({ focused: !!el && document.activeElement === el, connected: !!el && el.isConnected, same: !!el && now === el, value: el ? el.value : null, vp: innerWidth + "x" + innerHeight });
  })()`).then((s) => JSON.parse(s ?? '{}'));
const mark = (selector) =>
  ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    window.__kbdEl = el;
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  })()`);
const blur = () => ev(`document.activeElement && document.activeElement.blur()`);

/** 文字の欄にフォーカス → キーボード（高さだけ縮む）→ 閉じる。どの段でもフォーカス・同じ要素・向きが変わらないこと */
const keyboard = async (what, selector, { w = W, h = H, kb = KB, expect = 'portrait' } = {}) => {
  const ok = await mark(selector);
  check(ok, `${what}：欄にフォーカスできる`, selector);
  if (!ok) return;
  await metrics(w, kb, w, h);
  await sleep(800);
  const s1 = await state(selector);
  const o1 = await orient();
  check(s1.focused && s1.connected && s1.same, `${what}：キーボード（${w}×${kb}）が出てもフォーカスが残り、同じ要素のまま`, JSON.stringify(s1));
  check(o1 === expect, `${what}：キーボードが出ても ${expect === 'portrait' ? '縦' : '横'}向きのレイアウトのまま`, o1);
  await metrics(w, h, w, h);
  await sleep(600);
  const s2 = await state(selector);
  const o2 = await orient();
  check(s2.focused && s2.same && o2 === expect, `${what}：キーボードを閉じても（${w}×${h}）同じ要素・同じ向き`, `${JSON.stringify(s2)} ${o2}`);
  await blur();
  await sleep(200);
};

// ---------------------------------------------------------------- チャットの欄（縦向き）
check((await orient()) === 'portrait', `縦向きのレイアウト（${W}×${H}）`, await orient());
const CHAT = '.m-dock .chat-form input';
await keyboard('チャットの欄（縦）', CHAT);

// 打った文字が残る（欄が作り直されると消える）
await mark(CHAT);
await ev(`(() => {
  const el = document.querySelector(${JSON.stringify(CHAT)});
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, 'こんにちは');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await metrics(W, KB, W, H);
await sleep(800);
const typed = await state(CHAT);
check(typed.focused && typed.value === 'こんにちは', 'キーボードが出たまま打った文字が残る', JSON.stringify(typed));
await metrics(W, H, W, H);
await sleep(500);
await blur();

// ---------------------------------------------------------------- 本当の回転では切り替わる
await metrics(H, W, H, W);
await sleep(900);
check((await orient()) === 'landscape', `回転（${H}×${W}）で横向きのレイアウトに切り替わる`, await orient());
await keyboard('チャットの欄（横）', CHAT, { w: H, h: W, kb: KB_LAND, expect: 'landscape' });

// 打っている途中で回転しても、チャットの欄は作り直さない（フォーカスが残る）。離れたら回転に合わせる
await mark(CHAT);
await metrics(W, H, W, H);
await sleep(900);
const rot = await state(CHAT);
check(rot.focused && rot.same, '打っている途中に縦へ回転しても、チャットの欄は同じ要素のままフォーカスが残る', JSON.stringify(rot));
await blur();
await sleep(500);
check((await orient()) === 'portrait', '欄から離れると縦向きのレイアウトになる', await orient());

// ---------------------------------------------------------------- チャットのシート（縦）
await ev(`(() => {
  const el = document.querySelector('.m-peek');
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, clientX: r.left + 40, clientY: r.top + 20, pointerId: 1, pointerType: 'touch' };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
})()`);
await sleep(500);
await keyboard('チャットのシートの欄', '.m-chat-sheet .chat-form input');
await ev(`document.querySelector('.m-sheet-back').click()`);
await sleep(400);

// ---------------------------------------------------------------- ノート（書く）
await ev(`__va.open({ kind: 'note' })`);
await sleep(1200);
await ev(`document.querySelector('.note-modal .modal-head .primary').click()`);
await sleep(400);
await keyboard('ノートの名前の欄', '.note-form input');
await keyboard('ノートの本文の欄', '.note-input');
await ev(`__va.open(null)`);
await sleep(300);

// ---------------------------------------------------------------- 要望
await ev(`__va.open({ kind: 'request' })`);
await sleep(500);
await keyboard('要望の本文の欄', '.request-modal textarea');
await keyboard('要望の名前の欄', '.request-name input');
await ev(`__va.open(null)`);
await sleep(300);

// ---------------------------------------------------------------- ポスター（新しく貼る）
await ev(`__va.open({ kind: 'posters' })`);
await sleep(800);
await ev(`document.querySelector('.poster-modal .modal-head .primary').click()`);
await sleep(400);
await keyboard('ポスターの題の欄', '.poster-modal form input');
await keyboard('ポスターの本文の欄', '.poster-modal form textarea');
await ev(`__va.open(null)`);
await sleep(300);

// ---------------------------------------------------------------- 管理者（合言葉）
await ev(`__va.open({ kind: 'admin' })`);
await sleep(500);
await keyboard('管理者の合言葉の欄', '.admin-login input');
await ev(`__va.open(null)`);
await sleep(300);

// ---------------------------------------------------------------- 見た目を変える（名前）
await ev(`document.querySelector('.m-menu-btn').click()`);
await sleep(400);
await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === '見た目を変える')?.click()`);
await sleep(600);
await keyboard('見た目を変えるの名前の欄', '.entry-fields input');

if (out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
}

// ---------------------------------------------------------------- 入店の画面（新しい人の名前）
await ev(`localStorage.removeItem('va:key')`);
// 同じ URL（#dev だけ）へ移っても読み直されないので、いったん別のページへ
await send('Page.navigate', { url: new URL(url).origin + '/__ls' });
await sleep(800);
await send('Page.navigate', { url });
await sleep(3000);
check(await ev(`!!document.querySelector('.entry-page')`), '入店の画面が出る（鍵を消して開き直す）');
await keyboard('入店の名前の欄', '.entry-fields input');

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
