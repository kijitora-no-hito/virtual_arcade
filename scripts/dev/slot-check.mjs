// スロットマシンとコイン（v0.7.0。DESIGN §17）の確認。Edge ヘッドレス（CDP）と API・WebSocket で：
//   クレーンゲームでバッジを取る → スロット台をクリック（遠ければ歩いて窓が開く）→ 両替でコイン 10 → レバー（スペース）で回す・← ↓ → で止める
//   （店内の人は動かない）→ コインが増減する（窓・上のバー・サーバ）→ ボーナスの LUCKY ランプ → 7 を狙って BIG → チャットの案内 →
//   頭上の 🎰 → API を直接たたいてのごまかし（コイン不足・遠い・二重の spin・早すぎる・ありえない押す位置・違う回）が断られる →
//   スマホ（390×844）でタップで開いて大きなボタンで回して止める
//   node scripts/dev/slot-check.mjs <BASE の URL（例 http://127.0.0.1:8796/arcade）> [撮る先のフォルダ]
// サーバは CRANE_COOLDOWN_SEC=1・CRANE_MAX_CHANCE=100・BADGE_MODE=stack・BADGE_STACK_MAX=9・SLOT_BIG_ODDS=4（ボーナスをすぐ出す。確認用）で起動しておく。
// 結果は 1 行ずつ「OK / NG 内容」。最後に NG の数で終わる（0 なら成功）。WebSocket を 2 本使う。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , base, outDir] = process.argv;
if (!base) {
  console.error('使い方は scripts/dev/slot-check.mjs の先頭を見てください');
  process.exit(1);
}
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9366);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'va-edge-'));
const p = spawn(
  edge,
  ['--headless=new', '--mute-audio', '--window-size=1920,1080', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);
// Edge を必ず閉じる（終わり・失敗・Ctrl+C）。ヘッドレスでも音は出るので --mute-audio で起動している
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
const newKey = () => crypto.randomBytes(32).toString('base64url');
let ng = 0;
const check = (ok, what, detail = '') => {
  if (!ok) ng++;
  console.log(`${ok ? 'OK' : 'NG'}  ${what}${detail ? `  (${detail})` : ''}`);
};

const call = async (key, method, pth, body) => {
  const res = await fetch(`${base}${pth}`, {
    method,
    headers: { ...(key ? { 'X-VA-Key': key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const joinWs = async (name, key) => {
  await call(key, 'POST', '/api/enter', { name, look: { color: 'orange', hat: 'cap' } });
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
  const msgs = [];
  await new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', key, proto: 2 })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      msgs.push(m);
      if (m.type === 'welcome') resolve();
    });
    ws.on('error', reject);
  });
  return { ws, msgs, send: (m) => ws.send(JSON.stringify(m)) };
};

// ---- CDP
let list = null;
for (let i = 0; i < 60 && !list; i++) {
  await sleep(250);
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {}
}
const page = list.find((t) => t.type === 'page');
const cdp = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => cdp.once('open', r));
let n = 0;
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++n;
    const wait = method === 'Page.captureScreenshot' ? 20000 : 5000;
    const timer = setTimeout(() => {
      cdp.off('message', on);
      console.log(`（${method} の返事が ${wait / 1000} 秒来なかったので先へ進みます）`);
      res(undefined);
    }, wait);
    const on = (d) => {
      const m = JSON.parse(String(d));
      if (m.id === id) {
        clearTimeout(timer);
        cdp.off('message', on);
        res(m.result);
      }
    };
    cdp.on('message', on);
    cdp.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
const pt = (e) => ev(`JSON.stringify(${e})`).then((s) => (s ? JSON.parse(s) : null));
const shot = async (name) => {
  if (!outDir) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r) return;
  const f = path.join(outDir, name);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log(`撮った: ${f}`);
};
const waitFor = async (expr, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await ev(expr)) return true;
    await sleep(100);
  }
  return false;
};
const KEYS = {
  Space: [' ', 32],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowDown: ['ArrowDown', 40],
  ArrowRight: ['ArrowRight', 39],
  Escape: ['Escape', 27],
};
const key = async (code) => {
  const [k, vk] = KEYS[code];
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const st = () => pt('window.__vaSlot && __vaSlot.state()');
const uiCoins = async () => Number(((await ev(`document.querySelector('.slot-coins')?.textContent ?? ''`)) || '').replace(/,/g, ''));

await send('Page.enable');
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

// 1 人目（ブラウザ）
const keyA = newKey();
const nameA = `スロッターA${crypto.randomBytes(2).toString('hex')}`;
check((await call(keyA, 'POST', '/api/enter', { name: nameA, look: { color: 'cyan', hat: 'none' } })).status === 200, '1 人目が入店（API）');
await send('Page.navigate', { url: new URL(base).origin + '/__ls' });
await sleep(800);
await ev(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(keyA))}); sessionStorage.setItem('va:room', 'open')`);
await send('Page.navigate', { url: `${base}/#dev` });
check(await waitFor(`!!window.__va && !!__va.slot(0) && !!__va.slot(2) && !!__va.me()`, 10000), '店内に入った（スロット台 3 台の位置が取れる）');
await sleep(1500);
{
  const sl = [await pt('__va.slot(0)'), await pt('__va.slot(1)'), await pt('__va.slot(2)')];
  const picks = [];
  for (const s of sl) picks.push(await pt(`__va.pick(${s.x}, ${s.y})`));
  check(picks.every((h) => h?.kind === 'slot'), 'スロット台の当たり判定', JSON.stringify(picks));
  check(new Set(picks.map((h) => h?.id)).size === 3, '3 台が別の台');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sl[1].x, y: sl[1].y });
  check(await waitFor(`[...document.querySelectorAll('canvas')].some((c) => c.style.cursor === 'pointer')`, 2000), 'スロット台にカーソルを置くと指の形');
  await sleep(300);
  await shot('slot_pc_store_hover.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 950 });
  await sleep(300);
  await shot('slot_pc_store.png');
}

// 2 人目（API・WebSocket。頭上の 🎰・チャットの案内を見る。ごまかしの確かめ）
const keyB = newKey();
const B = await joinWs(`スロッターB${crypto.randomBytes(2).toString('hex')}`, keyB);

// ---- クレーンゲームでバッジを取る（CRANE_MAX_CHANCE=100・CRANE_COOLDOWN_SEC=1）
const cr = await pt('__va.crane(1)');
await click(cr.x, cr.y);
check(await waitFor(`!!document.querySelector('.crane-modal') && !!window.__vaCrane`, 20000), 'クレーンゲームまで歩いて窓が開く');
for (let i = 0; i < 6; i++) {
  await waitFor(`__vaCrane.phase() === 'ready' && !document.querySelector('.crane-controls button.crane-btn:disabled')`, 4000);
  await sleep(1200);
  await ev('__vaCrane.aimDrop()');
  await waitFor(`__vaCrane.phase() === 'done'`, 15000);
  const btn = await ev(`(() => { const b = [...document.querySelectorAll('.crane-controls .primary')][0]; if (b && !b.disabled) { b.click(); return true; } return false; })()`);
  if (!btn) await sleep(1200);
  if ((await ev(`[...document.querySelectorAll('.me-button .badges span')].length`)) >= 4) break;
}
const gotBadges = await ev(`[...document.querySelectorAll('.me-button .badges span')].length`);
check(gotBadges >= 1, 'クレーンゲームでバッジを取った', `${gotBadges} 個`);
await key('Escape');
await sleep(500);

// ---- 遠くからスロット台をクリック → 歩いて窓が開く
const s0 = await pt('__va.slot(0)');
await click(s0.x, s0.y);
check(await waitFor(`!!document.querySelector('.slot-modal') && !!window.__vaSlot && __vaSlot.state().phase === 'idle'`, 20000), 'スロットまで歩いて窓が開く');
check(B.msgs.some((m) => m.type === 'player' && m.player.name === nameA && m.player.playing === 'slot'), 'ほかの人には頭上の 🎰（playing = slot）');
check((await uiCoins()) === 0, '最初はコイン 0 枚', `${await uiCoins()}`);
check(/コインが足りません/.test(await ev(`document.querySelector('.slot-status')?.textContent ?? ''`)), 'コインが無いと「足りません」の案内');
await shot('slot_dialog_exchange_before.png');

// ---- 両替
const badgeBefore = await ev(`[...document.querySelectorAll('.me-button .badges span')].length`);
await ev(`document.querySelector('.slot-ex:not(:disabled)').click()`);
check(await waitFor(`Number((document.querySelector('.slot-coins')?.textContent ?? '').replace(/,/g, '')) === 10`, 4000), '両替でコイン 10 枚', `${await uiCoins()}`);
check(await waitFor(`[...document.querySelectorAll('.me-button .badges span')].length === ${badgeBefore - 1}`, 3000), '名前の後ろのバッジが 1 つ減る');
check(await waitFor(`/10/.test(document.querySelector('.me-coins')?.textContent ?? '')`, 3000), '上のバーの自分の名前の近くにコイン', await ev(`document.querySelector('.me-coins')?.textContent ?? ''`));
check((await call(keyA, 'GET', '/api/slot/1')).body?.coins === 10, 'サーバのコインも 10');
await sleep(800);
await shot('slot_dialog_exchange.png');
// 残りのバッジもコインに（遊ぶ分）
for (let i = 0; i < 3; i++) await ev(`document.querySelector('.slot-ex:not(:disabled)')?.click()`), await sleep(400);
const coins0 = await uiCoins();

// ---- レバー（スペース）→ ← ↓ → で止める。店内の人は動かない
const me0 = await pt('__va.me()');
await key('Space');
check(await waitFor(`__vaSlot.state().phase === 'spinning'`, 4000), 'スペースでリールが回る');
check(await waitFor(`Number((document.querySelector('.slot-coins')?.textContent ?? '').replace(/,/g, '')) === ${coins0 - 3}`, 3000), '1 回 3 枚掛ける', `${coins0} → ${await uiCoins()}`);
await sleep(250);
await shot('slot_dialog_spinning.png');
await key('ArrowLeft');
await sleep(250);
check((await st()).modes[0] !== 'spin' && (await st()).modes[1] === 'spin', '← で左のリールが止まる（ほかは回ったまま）', JSON.stringify((await st()).modes));
await key('ArrowRight');
await sleep(250);
await key('ArrowDown');
check(await waitFor(`__vaSlot.state().phase === 'idle'`, 4000), '3 本止めると結果が出る');
const me1 = await pt('__va.me()');
check(me0 && me1 && me0.to.x === me1.to.x && me0.to.y === me1.to.y, '止めるキー（矢印）で店内の人は動かない', JSON.stringify({ me0, me1 }));
{
  const srv = (await call(keyA, 'GET', '/api/slot/1')).body;
  check(srv?.coins === (await uiCoins()), '窓のコインとサーバのコインが同じ', `${srv?.coins} / ${await uiCoins()}`);
}

// ---- ボーナス：ランプが光るまで適当に止め、光ったら 7 を狙う（SLOT_BIG_ODDS で出やすくしてある）
let sawLamp = false;
let sawBig = false;
let missedOnce = false;
for (let i = 0; i < 40 && !sawBig; i++) {
  if ((await uiCoins()) < 3 && !/REPLAY/.test(await ev(`document.querySelector('.slot-meter:nth-child(2) b')?.textContent ?? ''`))) {
    console.log('（コインが足りなくなったので終わります）');
    break;
  }
  await waitFor(`__vaSlot.state().phase === 'idle'`, 4000);
  await ev('__vaSlot.lever()');
  if (!(await waitFor(`__vaSlot.state().phase === 'spinning'`, 4000))) continue;
  const s = await st();
  const bonus = s.flag === 'big' || s.flag === 'reg';
  if (bonus && (missedOnce || sawLamp)) {
    // 光っている：7 を狙う（目押しが完璧な人）
    await ev('__vaSlot.aim()');
  } else {
    // わざと適当に（すぐに）押す
    await sleep(350);
    for (const r of [0, 1, 2]) await ev(`__vaSlot.press(${r})`), await sleep(120);
    if (bonus) missedOnce = true;
  }
  await waitFor(`__vaSlot.state().phase === 'idle'`, 6000);
  const after = await st();
  if (after.lamp && !sawLamp) {
    sawLamp = true;
    await sleep(400);
    await shot('slot_dialog_lamp.png');
    check(/LUCKY/.test(await ev(`document.querySelector('.slot-status')?.textContent ?? ''`)), 'ボーナスを取りこぼすと LUCKY ランプが光る（窓の案内も）');
  }
  if (after.win === 'big' || after.win === 'reg') {
    sawBig = true;
    await sleep(300);
    await shot('slot_dialog_bonus.png');
    check(!after.lamp, 'ボーナスを揃えるとランプが消える');
    const big = after.win === 'big';
    check(
      await waitFor(`/${big ? 'BIG' : 'REG'} BONUS/.test(document.querySelector('.slot-status')?.textContent ?? '')`, 2000),
      `${big ? 'BIG' : 'REG'} が揃った（窓の案内）`,
      await ev(`document.querySelector('.slot-status')?.textContent ?? ''`),
    );
    await sleep(500);
    check(
      B.msgs.some((m) => m.type === 'chat' && m.message.kind === 'system' && m.message.text.includes(`${nameA} さんがスロットで ${big ? 'BIG' : 'REG'} BONUS！（+${big ? 250 : 100} 枚）`)),
      'チャットに system「🎰 〇〇 さんがスロットで … BONUS！」',
    );
  }
}
check(sawLamp, 'LUCKY ランプを見た');
check(sawBig, '7 を狙ってボーナスを揃えた');
check((await call(keyA, 'GET', '/api/slot/1')).body?.coins === (await uiCoins()), 'ボーナスのあともサーバと窓のコインが同じ');

// ---- ごまかし（API を直接）
await waitFor(`__vaSlot.state().phase === 'idle'`, 4000);
await sleep(1600);
{
  const a1 = await call(keyA, 'POST', '/api/slot/1/spin');
  check(a1.status === 200, 'API で回せる（台の近く）', JSON.stringify(a1.body));
  const a2 = await call(keyA, 'POST', '/api/slot/2/spin');
  check(a2.body?.code === 'spinning', '二重の spin は断る', JSON.stringify(a2.body));
  for (const presses of [
    [
      [0, 99],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 1],
      [0, 2],
      [1, 3],
    ],
    [
      [0, 1.5],
      [1, 0],
      [2, 0],
    ],
    [[0, 1]],
  ]) {
    const r = await call(keyA, 'POST', '/api/slot/1/stop', { spinId: a1.body?.spinId, presses });
    check(r.body?.code === 'bad-input', `ありえない押す位置は断る ${JSON.stringify(presses)}`, JSON.stringify(r.body));
  }
  const bad = await call(keyA, 'POST', '/api/slot/1/stop', { spinId: 'x'.repeat(16), presses: [[0, 0], [1, 0], [2, 0]] });
  check(bad.body?.code === 'no-spin', '違う回の stop は断る');
  const ok = await call(keyA, 'POST', '/api/slot/1/stop', { spinId: a1.body?.spinId, presses: [[0, 0], [1, 0], [2, 0]] });
  check(ok.status === 200 && Array.isArray(ok.body?.reels), '正しい stop は通る', JSON.stringify(ok.body));
  const twice = await call(keyA, 'POST', '/api/slot/1/stop', { spinId: a1.body?.spinId, presses: [[0, 0], [1, 0], [2, 0]] });
  check(twice.body?.code === 'no-spin', '同じ回を 2 度止められない');
  const soon = await call(keyA, 'POST', '/api/slot/1/spin');
  check(soon.body?.code === 'too-soon', '早すぎる連打は断る', JSON.stringify(soon.body));
  // 2 人目：遠い・コイン不足
  const far = await call(keyB, 'POST', '/api/slot/1/spin');
  check(far.body?.code === 'too-far', '遠い人は回せない', JSON.stringify(far.body));
  B.send({ type: 'goto', x: 19, y: 5 });
  await sleep(6000);
  const poor = await call(keyB, 'POST', '/api/slot/3/spin');
  check(poor.body?.code === 'no-coins', 'コインが無い人は回せない', JSON.stringify(poor.body));
  const nob = await call(keyB, 'POST', '/api/slot/exchange', { suit: '♠' });
  check(nob.body?.code === 'no-badge', 'マークを持っていない人は両替できない', JSON.stringify(nob.body));
  check(!JSON.stringify(B.msgs).includes('"coins":' + (await uiCoins())) || (await uiCoins()) === 0, 'ほかの人のメッセージに自分のコインが載らない');
}
// 窓の表示を合わせる（API で回した分）
await key('Escape');
await sleep(500);
check(!(await ev(`!!document.querySelector('.slot-modal')`)), 'Esc で窓を閉じる');
await sleep(600);
check(B.msgs.some((m) => m.type === 'player' && m.player.name === nameA && !m.player.playing), '閉じると 🎰 が外れる');
B.ws.close();

// ---- コインの預かり：預ける（キー 4 文字）→ 引き出す → 退店の確認で［預けてから退店］→ 入り直して引き出す
{
  await ev('window.confirm = () => true');
  const sl = await pt('__va.slot(0)');
  await click(sl.x, sl.y);
  check(await waitFor(`!!document.querySelector('.slot-modal') && __vaSlot.state().phase === 'idle'`, 15000), 'スロットの窓を開き直す');
  const before = await uiCoins();
  await ev(`[...document.querySelectorAll('.coin-bank button')].find((b) => /預ける/.test(b.textContent)).click()`);
  check(await waitFor(`!!document.querySelector('.bank-code-text')`, 4000), '預けるとキーが出る');
  const code1 = await ev(`document.querySelector('.bank-code-text')?.dataset.code ?? ''`);
  check(/^[A-HJ-NP-Z]{4}$/.test(code1), 'キーはアルファベット 4 文字（I・O なし）', code1);
  check(await waitFor(`Number((document.querySelector('.slot-coins')?.textContent ?? '').replace(/,/g, '')) === 0`, 3000), '預けると手元は 0 枚', `${before} → ${await uiCoins()}`);
  check(!(await ev(`!!document.querySelector('.me-coins')`)), '上のバーのコインも消える');
  check(/メモしてください/.test(await ev(`document.querySelector('.bank-code-warn')?.textContent ?? ''`)), '「メモしてください」の注意');
  await ev(`document.querySelector('.coin-bank')?.scrollIntoView()`);
  await sleep(300);
  await shot('slot_bank_code.png');
  // 間違ったキー
  const setInput = async (v) =>
    ev(`(() => { const i = document.querySelector('.bank-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await setInput(code1 === 'ZZZZ' ? 'YYYY' : 'ZZZZ');
  await sleep(100);
  await ev(`document.querySelector('.coin-bank form button').click()`);
  check(await waitFor(`/ありません/.test(document.querySelector('.bank-msg')?.textContent ?? '')`, 3000), '違うキーは断る', await ev(`document.querySelector('.bank-msg')?.textContent ?? ''`));
  // 正しいキー（小文字で）
  await setInput(code1.toLowerCase());
  await sleep(100);
  await ev(`document.querySelector('.coin-bank form button').click()`);
  check(await waitFor(`Number((document.querySelector('.slot-coins')?.textContent ?? '').replace(/,/g, '')) === ${before}`, 3000), '小文字で入れても引き出せる（元の枚数）', `${await uiCoins()}`);
  const again = await call(keyA, 'POST', '/api/slot/withdraw', { code: code1 });
  check(again.body?.code === 'bad-code', 'キーは 1 回だけ');
  await key('Escape');
  await sleep(500);
  // 退店：手元にコインがあるので確認の窓
  await ev(`[...document.querySelectorAll('.topbar-right button')].find((b) => b.textContent.trim() === '退店').click()`);
  check(await waitFor(`!!document.querySelector('.leave-modal')`, 3000), '手元にコインがあると退店の確認の窓');
  check(/コインが/.test(await ev(`document.querySelector('.leave-modal')?.textContent ?? ''`)), '「コインが n 枚あります。退店すると消えます」');
  await shot('slot_leave_confirm.png');
  await ev(`[...document.querySelectorAll('.leave-modal button')].find((b) => /預けてから/.test(b.textContent)).click()`);
  check(await waitFor(`!!document.querySelector('.leave-modal .bank-code-text')`, 4000), '［預けてから退店］でキーが出る');
  const code2 = await ev(`document.querySelector('.leave-modal .bank-code-text')?.dataset.code ?? ''`);
  await shot('slot_leave_code.png');
  await ev(`[...document.querySelectorAll('.leave-modal button')].find((b) => /退店する/.test(b.textContent)).click()`);
  check(await waitFor(`!document.querySelector('.topbar')`, 5000), '退店した（入店の画面）');
  check((await call(keyA, 'GET', '/api/slot/1')).body?.coins === 0, '退店で手元のコインは消える');
  // 入り直して引き出す
  check((await call(keyA, 'POST', '/api/enter', { name: nameA, look: { color: 'cyan', hat: 'none' } })).status === 200, '入り直す（API）');
  await ev(`sessionStorage.setItem('va:room', 'open')`);
  // 同じ URL（# だけ）への navigate は読み直さないので reload
  await send('Page.reload');
  check(await waitFor(`!!window.__va && !!__va.me()`, 10000), '店内に戻った');
  await ev(`__va.open({ kind: 'bank' })`);
  check(await waitFor(`!!document.querySelector('.bank-modal .bank-input')`, 3000), '預かりの窓');
  await setInput(code2);
  await sleep(100);
  await ev(`document.querySelector('.coin-bank form button').click()`);
  check(await waitFor(`/引き出しました/.test(document.querySelector('.bank-msg')?.textContent ?? '')`, 3000), '退店のときのキーで引き出せる', await ev(`document.querySelector('.bank-msg')?.textContent ?? ''`));
  check(await waitFor(`/${before}/.test(document.querySelector('.me-coins')?.textContent ?? '')`, 3000), '上のバーのコインが戻る', await ev(`document.querySelector('.me-coins')?.textContent ?? ''`));
  await shot('slot_bank_withdraw.png');
  await key('Escape');
  await sleep(300);
}

// ---- スマホ（390×844）：タップで開いて、大きなボタンで回して止める
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const tapAt = async (x, y) => {
  const a = touch('touchStart', [[x, y]]);
  await sleep(40);
  const b = touch('touchEnd', []);
  await Promise.all([a, b]);
};
await send('Page.reload');
check(await waitFor(`document.documentElement.classList.contains('layout-mobile') && !!window.__va && !!__va.slot(0)`, 10000), 'スマホのレイアウトで入り直す');
await sleep(2500);
const ms = await pt('__va.slot(0)');
check(!!ms && ms.x > 0 && ms.x < 390 && ms.y > 0 && ms.y < 844, 'スマホの画面にスロット台が見える', JSON.stringify(ms));
for (let i = 0; i < 3 && ms && !(await ev(`!!document.querySelector('.slot-modal')`)); i++) {
  await tapAt(ms.x, ms.y);
  await sleep(2500);
}
check(await waitFor(`!!document.querySelector('.slot-modal') && __vaSlot.state().phase === 'idle'`, 15000), 'タップでスロットの窓が開く');
const rect = await pt(`(() => { const r = document.querySelector('.slot-modal').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
check(rect && rect.w >= 385 && rect.h >= 800, '窓は全画面', JSON.stringify(rect));
const btn = async (sel) => pt(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
const lever = await btn('.slot-lever');
check(lever && lever.h >= 60 && lever.y < 844, 'レバーのボタンが大きく画面の中', JSON.stringify(lever));
const cm0 = await uiCoins();
await tapAt(lever.x, lever.y);
check(await waitFor(`__vaSlot.state().phase === 'spinning'`, 4000), 'タップでリールが回る');
await sleep(300);
await shot('slot_mobile_spinning.png');
for (const i of [1, 2, 3]) {
  const b = await btn(`.slot-controls button:nth-child(${i + 1})`);
  await tapAt(b.x, b.y);
  await sleep(250);
}
check(await waitFor(`__vaSlot.state().phase === 'idle'`, 5000), '止めるボタンのタップで 3 本止まる');
const cm1 = await uiCoins();
console.log(`（スマホの 1 回：コイン ${cm0} → ${cm1}）`);
await sleep(400);
await shot('slot_mobile.png');
await ev(`document.querySelector('.slot-modal .modal-head button[aria-label="閉じる"]').click()`);
await sleep(500);
await ev(`document.querySelector('.m-menu-btn')?.click()`);
await sleep(600);
check(/🪙/.test(await ev(`document.querySelector('.m-menu-coins')?.textContent ?? ''`)), 'スマホのメニューにコイン', await ev(`document.querySelector('.m-menu-coins')?.textContent ?? ''`));
check([...(await ev(`[...document.querySelectorAll('.m-menu button')].map((b) => b.textContent).join('|')`))].join('').includes('コインを預ける'), 'スマホのメニューに［コインを預ける・引き出す］');
await shot('slot_mobile_menu.png');

console.log(`NG ${ng}`);
cdp.close();
process.exit(ng ? 1 : 0);
