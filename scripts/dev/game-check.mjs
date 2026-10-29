// ゲーム筐体と 2048・Columns like game・ランキングの確認（v0.6.0。DESIGN §16・§16.8）。Edge ヘッドレス（CDP）と API・WebSocket で：
//   筐体をクリック → 歩いて窓が開く → iframe に矢印キー（親の人は動かない）→ 窓を閉じて記録 → もう一度開いてゲームオーバーまで → 結果の帯 →
//   Try again で始め直す → ランキングの窓 → 2 人目（API と WebSocket）が遊んで順位が並ぶ・立て看板（ranking の受信）に反映 →
//   不正な手順（でたらめな手・速すぎる・別のセッション・遠い）が断られる →
//   Columns like game：筐体をクリック → Play → iframe にキーでピースを置く → フォーカスが外れると一時停止 → 閉じて記録 → ゲームオーバーまで →
//   練習の設定は記録しない → Esc → ランキングの窓のゲームのタブ → 2 人目の記録・立て看板 → 不正な記録 →
//   スマホ（390×844）でタップで開いてスワイプで遊ぶ（2048）・下のボタンで遊ぶ（Columns）
//   node scripts/dev/game-check.mjs <BASE の URL（例 http://127.0.0.1:8796/arcade）> [撮る先のフォルダ]
// 結果は 1 行ずつ「OK / NG 内容」。最後に NG の数で終わる（0 なら成功）。同じ IP の WebSocket を 2 本使う（scene の 6 人と合わせて 10 本まで）。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { Game2048, mulberry32 } from './lib2048.mjs';

const [, , base, outDir] = process.argv;
if (!base) {
  console.error('使い方は scripts/dev/game-check.mjs の先頭を見てください');
  process.exit(1);
}
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9364);
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

// ---- API と WebSocket（2 人目・不正な手順）
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
const shot = async (name) => {
  if (!outDir) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r) return;
  const f = path.join(outDir, name);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log(`撮った: ${f}`);
};
const waitFor = async (expr, ms = 8000) => {
  for (let t = 0; t < ms; t += 150) {
    if (await ev(expr)) return true;
    await sleep(150);
  }
  return false;
};
const KEYS = { up: ['ArrowUp', 38], right: ['ArrowRight', 39], down: ['ArrowDown', 40], left: ['ArrowLeft', 37] };
const key = async (dir) => {
  const [k, code] = KEYS[dir];
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const pt = (e) => ev(`JSON.stringify(${e})`).then((s) => (s ? JSON.parse(s) : null));
const FRAME = `document.querySelector('.game-frame iframe')`;
const FDOC = `${FRAME}?.contentDocument`;
const frameScore = () => ev(`Number((${FDOC}?.querySelector('.score-container')?.firstChild?.textContent ?? 'NaN'))`);

await send('Page.enable');
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

// 1 人目（ブラウザ）：入口の近くから始める
const keyA = newKey();
const nameA = `ゲーマーA${crypto.randomBytes(2).toString('hex')}`;
check((await call(keyA, 'POST', '/api/enter', { name: nameA, look: { color: 'cyan', hat: 'none' } })).status === 200, '1 人目が入店（API）');
await send('Page.navigate', { url: new URL(base).origin + '/__ls' });
await sleep(800);
await ev(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(keyA))}); sessionStorage.setItem('va:room', 'open')`);
await send('Page.navigate', { url: `${base}/#dev` });
check(await waitFor(`!!window.__va && !!__va.game('2048') && !!__va.me()`, 10000), '店内に入った（#dev の __va.game・__va.ranking がある）');
check(!!(await pt(`__va.ranking('2048')`)), 'ランキングの立て看板の位置が取れる');

// ---- 遠くから筐体をクリック → 歩いて着いたら窓が開く
const g0 = await pt(`__va.game('2048')`);
const me0 = await pt('__va.me()');
await click(g0.x, g0.y);
check(await waitFor(`!!document.querySelector('.game-modal')`, 15000), '遠くから筐体をクリック → 歩いて着いたら 2048 の窓が開く', `始めの位置 (${me0?.x?.toFixed?.(0)},${me0?.y?.toFixed?.(0)})`);
check(await waitFor(`(${FDOC}?.querySelectorAll('.tile-container .tile').length ?? 0) >= 2`, 8000), 'iframe に 2048 の盤（最初のタイル 2 枚）が出る');
check(await waitFor(`document.activeElement === ${FRAME}`, 3000), '開いたら iframe にフォーカス');
check(await ev(`!!${FDOC}?.querySelector('.va-credit a[href="https://github.com/gabrielecirulli/2048"]')`), '出典（Original: 2048 by Gabriele Cirulli）がある');
check(await ev(`!/official version/.test(${FDOC}?.body?.textContent ?? '')`), '「official version」の注意書きは無い');
check(await waitFor(`(__va.me() ? true : false)`, 1000) && (await pt('__va.rankings()'))?.['2048'] !== undefined, 'welcome のランキング（立て看板の上位）を受け取っている');

// ---- 矢印キー（iframe の中で動く。親の人は動かない）
const meBefore = await pt('__va.me()');
const dirs = ['left', 'down', 'right', 'down', 'left', 'down', 'up', 'left', 'right', 'down'];
for (let i = 0; i < 30; i++) {
  await key(dirs[i % dirs.length]);
  await sleep(110);
}
await sleep(400);
const cnt1 = await ev('__vaGame.count()');
check(cnt1 > 5, '矢印キーで盤が動き、動いた手を親が覚えている', `手の数 ${cnt1}`);
const meAfter = await pt('__va.me()');
check(meBefore && meAfter && meBefore.to.x === meAfter.to.x && meBefore.to.y === meAfter.to.y, '窓を開いている間、店内の人は矢印キーで動かない', `(${meBefore?.to.x},${meBefore?.to.y}) → (${meAfter?.to.x},${meAfter?.to.y})`);
const score1 = await frameScore();
await shot('game_pc_2048.png');

// 頭上の 🎮（2 人目が見る）
const keyB = newKey();
const nameB = `ゲーマーB${crypto.randomBytes(2).toString('hex')}`;
const B = await joinWs(nameB, keyB);
const pA = B.msgs.find((m) => m.type === 'welcome').players.find((x) => x.name === nameA);
check(pA?.playing === '2048', 'ほかの人から見て、遊んでいる人は playing = 2048（頭上の 🎮）', JSON.stringify(pA?.playing));

// ---- ✕ で閉じる → 記録（keepalive）→ 店内の帯に結果・ランキングに出る
await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
check(await waitFor(`!document.querySelector('.game-modal')`, 3000), '✕ で窓が閉じる');
await sleep(1200);
const toast = await ev(`document.querySelector('.toast')?.textContent ?? ''`);
check(/記録しました/.test(toast), '閉じたら記録され、店内の帯に結果が出る', toast);
const rk1 = await call(keyA, 'GET', '/api/games/2048/ranking?period=all');
check(rk1.body?.me?.score === score1, 'ランキングに自分の記録（点数は iframe の点数と同じ = サーバがなぞり直した点数）', `iframe ${score1} / サーバ ${rk1.body?.me?.score}`);
const pA2 = B.msgs.filter((m) => m.type === 'player' && m.player.name === nameA).pop();
check(pA2 && !pA2.player.playing, '閉じると 🎮 が外れる');

// ---- もう一度開いて（近いのですぐ開く）ゲームオーバーまで → 結果の帯 → Try again
const g1 = await pt(`__va.game('2048')`);
await click(g1.x, g1.y);
check(await waitFor(`!!document.querySelector('.game-modal') && (${FDOC}?.querySelectorAll('.tile-container .tile').length ?? 0) >= 2`, 8000), '近くでクリックするとすぐ開く');
const gen1 = await ev('__vaGame.gen()');
let over = false;
const cyc = ['down', 'left', 'down', 'right', 'down', 'left', 'up'];
for (let i = 0; i < 1500 && !over; i++) {
  await key(cyc[i % cyc.length]);
  await sleep(55);
  if (i % 20 === 19) over = await ev(`!!${FDOC}?.querySelector('.game-message.game-over')`);
}
check(over, 'ゲームオーバーまで遊べる');
const score2 = await frameScore();
check(await waitFor(`/記録しました/.test(document.querySelector('.game-result')?.textContent ?? '')`, 5000), 'ゲームオーバーで記録され、結果の帯が出る', await ev(`document.querySelector('.game-result')?.textContent ?? ''`));
const resText = await ev(`document.querySelector('.game-result')?.textContent ?? ''`);
check(resText.includes(score2.toLocaleString('en-US')), '結果の帯の点数 = iframe の点数', `${score2}`);
check(/総合 \d+ 位/.test(resText) && /今月 \d+ 位/.test(resText), '結果の帯に総合・今月の順位');
await shot('game_pc_over.png');
// Try again（iframe の中のボタン）→ 親が新しい種で始め直す
await ev(`${FDOC}.querySelector('.retry-button').click()`);
check(await waitFor(`__vaGame.gen() > ${gen1} && !${FDOC}.querySelector('.game-message.game-over')`, 5000), 'Try again で新しいゲーム（新しい種）', `gen ${gen1} → ${await ev('__vaGame.gen()')}`);

// ---- ランキングの窓
await ev(`[...document.querySelectorAll('.game-modal button')].find((b) => b.textContent.includes('ランキング')).click()`);
check(await waitFor(`document.querySelectorAll('.ranking-modal .rank-table tbody tr:not(.rank-gap)').length >= 1 && !document.querySelector('.ranking-modal .rank-empty')`, 5000), 'ランキングの窓（総合）に記録が並ぶ');
check(await ev(`!!document.querySelector('.ranking-modal .rank-mine')`), '自分の行に印がある');
check(await ev(`/あなた：\\d+ 位/.test(document.querySelector('.rank-me')?.textContent ?? '')`), '自分の順位が出る', await ev(`document.querySelector('.rank-me')?.textContent`));
check(await ev(`document.querySelector('.ranking-modal .rank-games .tab.on')?.textContent === '2048'`), '2048 の窓から開くと 2048 のタブ');
await ev(`[...document.querySelectorAll('.ranking-modal .rank-periods .tab')].find((b) => b.textContent === '今月').click()`);
check(await waitFor(`document.querySelector('.ranking-modal .rank-periods .tab.on')?.textContent === '今月' && document.querySelectorAll('.ranking-modal .rank-table tbody tr').length >= 1`, 4000), '今月のタブ');
await ev(`[...document.querySelectorAll('.ranking-modal .rank-periods .tab')].find((b) => b.textContent === '総合').click()`);
await sleep(600);
await shot('game_pc_ranking.png');
await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]').click()`);
// iframe にフォーカスがあるときの Esc（親にキーが届かないので、iframe が親に知らせて閉じる）
await ev(`${FRAME}.focus()`);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
check(await waitFor(`!document.querySelector('.game-modal')`, 3000), 'iframe の中で Esc を押すと窓が閉じる');
await sleep(800);

// ---- 2 人目（API・WebSocket）：筐体の前まで歩いて、よい手順で長く遊ぶ → 1 位・立て看板に反映
B.send({ type: 'goto', x: 15, y: 5 });
await sleep(5000);
const st = await call(keyB, 'POST', '/api/games/2048/start', {});
check(st.status === 200, '2 人目が始める（筐体の近く）', JSON.stringify(st.body?.code ?? ''));
const g = new Game2048(mulberry32(st.body.seed));
let movesB = '';
while (!g.terminated && movesB.length < 3000) {
  // 下・左・右の順に試し、どれも動かなければ上（角に寄せるだけの手順）
  const d = [2, 3, 1, 0].find((x) => {
    const t = new Game2048(() => 0.5);
    t.cells = g.cells.map((c) => [...c]);
    return t.move(x);
  });
  if (d === undefined || !g.move(d)) break;
  movesB += d;
}
await sleep(movesB.length * 42 + 500);
const finB = await call(keyB, 'POST', '/api/games/2048/finish', { session: st.body.session, moves: movesB });
check(finB.status === 200 && finB.body.score === g.score, '2 人目の記録（サーバの点数 = 手元でなぞった点数）', `${finB.body?.score} / ${g.score}`);
const rk2 = await call(keyA, 'GET', '/api/games/2048/ranking?period=all');
const ia = rk2.body.entries.findIndex((e) => e.name === nameA);
const ib = rk2.body.entries.findIndex((e) => e.name === nameB);
const sorted = rk2.body.entries.every((e, i, a) => i === 0 || a[i - 1].score >= e.score);
check(ia >= 0 && ib >= 0 && sorted && (g.score > (rk2.body.entries[ia]?.score ?? 0) ? ib < ia : ib > ia), '2 人が点数の順に並ぶ（1 人 1 行）', `A ${ia + 1} 位・B ${ib + 1} 位`);
check(rk2.body.entries.filter((e) => e.name === nameA).length === 1, '同じ人は 1 行（いちばん良い記録）');
const top = (await pt('__va.rankings()'))?.['2048'] ?? [];
const bTop = rk2.body.entries.slice(0, 5).some((e) => e.name === nameB);
check(!bTop || top.some((e) => e.name === nameB), '立て看板の上位（WebSocket の ranking）に 2 人目が出る', top.map((e) => `${e.rank}:${e.name}:${e.score}`).join(' '));
check(B.msgs.some((m) => m.type === 'ranking'), '2 人目にも ranking が届く');
await sleep(500);
await shot('game_pc_store_after.png');

// ---- 不正な手順は断られる
const bad = async (body) => (await call(keyB, 'POST', '/api/games/2048/finish', body)).body?.code;
let s = (await call(keyB, 'POST', '/api/games/2048/start', {})).body;
await sleep(1500);
check((await bad({ session: s.session, moves: 'hello' })) === 'bad-moves', 'でたらめな文字の手順 → bad-moves');
s = (await call(keyB, 'POST', '/api/games/2048/start', {})).body;
await sleep(2500);
// 同じ向きを 2 回続けると、2 回目は盤が動かない
// 動いた手のあとに、その盤で動かない向きを足す
const gs = new Game2048(mulberry32(s.seed));
let sm = '';
let stuckDir = null;
for (let i = 0; i < 400 && stuckDir === null; i++) {
  for (const d of [0, 1, 2, 3]) {
    const t = new Game2048(() => 0.5);
    t.cells = gs.cells.map((c) => [...c]);
    if (!t.move(d)) stuckDir = d;
  }
  if (stuckDir === null) {
    const d = i % 4;
    if (gs.move(d)) sm += d;
  }
}
await sleep(sm.length * 45 + 300);
const cStuck = await bad({ session: s.session, moves: sm + stuckDir });
check(cStuck === 'bad-moves', '盤が動かない手を含む手順 → bad-moves', `${sm.length} 手 + 動かない ${stuckDir} → ${cStuck}`);
s = (await call(keyB, 'POST', '/api/games/2048/start', {})).body;
const fast = new Game2048(mulberry32(s.seed));
let fm = '';
for (let i = 0; fm.length < 150 && i < 2000; i++) {
  const d = i % 4;
  if (fast.move(d)) fm += d;
}
check((await bad({ session: s.session, moves: fm })) === 'too-fast', '速すぎる手順（150 手をすぐ）→ too-fast');
check((await bad({ session: 'abcdefg', moves: '0' })) === 'no-session', '別のセッション → no-session');
s = (await call(keyB, 'POST', '/api/games/2048/start', {})).body;
await sleep(500);
check((await bad({ session: s.session, moves: 'K0' })) === 'bad-moves', '2048 の前の Keep going → bad-moves');
B.send({ type: 'goto', x: 3, y: 13 });
await sleep(6000);
check((await call(keyB, 'POST', '/api/games/2048/start', {})).body?.code === 'too-far', '遠くからは始められない → too-far');
check((await call(keyB, 'POST', '/api/games/xyz/start', {})).status === 404, '知らないゲーム → 404');
// ================================================================ Columns like game（DESIGN §16.8）
const CDOC = FDOC; // 同じ窓の iframe
const cOverlay = (id) => ev(`!!${CDOC}?.querySelector('#overlay_${id}.open')`);
const cScore = () => ev(`Number((${CDOC}?.querySelector('#score')?.textContent ?? 'NaN').replace(/,/g, ''))`);
/** iframe の中の要素をマウスでクリック（親の座標に直して CDP で） */
const clickIn = async (sel) => {
  const r = await pt(`(() => { const f = ${FRAME}.getBoundingClientRect(); const e = ${CDOC}.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; })()`);
  if (r) await click(r.x, r.y);
  return r;
};
const keyName = async (k, code) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
};
const SPACE = () => keyName(' ', 32);

check(!!(await pt(`__va.game('columns')`)) && !!(await pt(`__va.ranking('columns')`)), 'Columns like game の筐体と立て看板の位置が取れる');
const cg = await pt(`__va.game('columns')`);
await click(cg.x, cg.y);
check(await waitFor(`!!document.querySelector('.game-modal.game-columns')`, 15000), '遠くから Columns like game の筐体をクリック → 歩いて着いたら窓が開く');
check(await waitFor(`!!${CDOC}?.querySelector('#play') && !!${CDOC}?.querySelector('#well:not([hidden])')`, 8000), 'iframe に Columns like game（Play ボタン・井戸）が出る');
check(await ev(`(${CDOC}?.title ?? '') === 'Columns like game' && /Columns like game/.test(${CDOC}?.querySelector('h1')?.textContent ?? '')`), '題名・見出しは「Columns like game」');
check(await ev(`!!${CDOC}?.querySelector('a[href="https://github.com/jcfieldsdev/columns"]') && !${CDOC}?.querySelector('a[href^="mailto:"]')`), '出典（GitHub）があり、メールアドレスは無い');
check(await ev(`!${CDOC}?.querySelector('#scores') && !${CDOC}?.querySelector('#photo')`), 'ローカルのハイスコア・写真の背景の選択は無い');
// 外への通信が無い（iframe の中で読んだものはすべて同じオリジン）
const foreign = await ev(`${FRAME}.contentWindow.performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith(location.origin))`);
check(Array.isArray(foreign) && foreign.length === 0, 'iframe の中は外への通信が無い', JSON.stringify(foreign));
check((await ev('__vaGame.session()')) === false, 'Play を押すまでは始めない（サーバのセッション無し）');
await clickIn('#play');
check(await waitFor(`__vaGame.session() === true && __vaGame.practice() === false`, 5000), 'Play → 親がサーバに start（ランキングに載る設定）');
check(await waitFor(`(${CDOC}?.querySelector('#play')?.textContent ?? '') === 'Pause'`, 3000), 'iframe のゲームが始まる');
await ev(`${FRAME}.focus()`);
const cMe0 = await pt('__va.me()');
// 何個か置く：← → ↑ で動かし・回し、スペースで落とす
const plan = [
  ['ArrowLeft', 37],
  ['ArrowLeft', 37],
  ['ArrowUp', 38],
  ['ArrowRight', 39],
  ['ArrowRight', 39],
  ['ArrowRight', 39],
];
for (let i = 0; i < 8; i++) {
  for (let k = 0; k < i % 4; k++) await keyName(...plan[(i + k) % plan.length]);
  if (i % 3 === 2) await keyName('ArrowDown', 40);
  await SPACE();
  await sleep(i === 3 ? 0 : 700);
  if (i === 3) {
    await sleep(120);
    await shot('game_pc_columns.png');
    await sleep(600);
  }
}
await sleep(800);
const cc1 = await ev('__vaGame.count()');
check(cc1 >= 6, 'iframe にキーを送るとピースが置かれ、置いた記録を親が覚えている', `置いた数 ${cc1}`);
const cMe1 = await pt('__va.me()');
check(cMe0 && cMe1 && cMe0.to.x === cMe1.to.x && cMe0.to.y === cMe1.to.y, 'Columns の窓を開いている間、店内の人はキーで動かない');
// 窓の外をクリックして iframe からフォーカスが外れると一時停止（元のとおり）
const head = await pt(`(() => { const r = document.querySelector('.game-modal .modal-head h2').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
await click(head.x, head.y);
check(await waitFor(`!!${CDOC}?.querySelector('#overlay_pause.open')`, 3000), '窓の外をクリック（フォーカスが外れる）と一時停止');
const cScore1 = await cScore();
// ✕ で閉じる → 記録（keepalive）→ 帯・ランキング
await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
check(await waitFor(`!document.querySelector('.game-modal')`, 3000), 'Columns の窓が ✕ で閉じる');
await sleep(1200);
const cToast = await ev(`document.querySelector('.toast')?.textContent ?? ''`);
check(/記録しました/.test(cToast), '閉じたら記録され、店内の帯に結果が出る', cToast);
const crk1 = await call(keyA, 'GET', '/api/games/columns/ranking?period=all');
check(crk1.body?.me?.score === cScore1 && crk1.body?.me?.detail?.startLevel === 1, 'ランキングに自分の記録（点数は iframe の点数 = サーバがなぞり直した点数・開始レベル）', `iframe ${cScore1} / サーバ ${crk1.body?.me?.score}`);

// もう一度開いて、ゲームオーバーまで（真ん中の列に落とし続けると、あふれた列でゆっくり固まって終わる）
await click(cg.x, cg.y);
check(await waitFor(`!!document.querySelector('.game-modal.game-columns') && !!${CDOC}?.querySelector('#play')`, 8000), 'Columns の窓をもう一度開く');
await sleep(500);
await clickIn('#play');
await waitFor(`__vaGame.session() === true`, 5000);
await ev(`${FRAME}.focus()`);
let cOver = false;
for (let i = 0; i < 60 && !cOver; i++) {
  await SPACE();
  await sleep(450);
  cOver = await cOverlay('gameover');
}
if (!cOver) cOver = await waitFor(`!!${CDOC}?.querySelector('#overlay_gameover.open')`, 8000);
check(cOver, 'ゲームオーバーまで遊べる');
const cScore2 = await cScore();
check(await waitFor(`/記録しました/.test(document.querySelector('.game-result')?.textContent ?? '')`, 6000), 'ゲームオーバーで記録され、結果の帯が出る', await ev(`document.querySelector('.game-result')?.textContent ?? ''`));
const cRes = await ev(`document.querySelector('.game-result')?.textContent ?? ''`);
check(cRes.includes(cScore2.toLocaleString('en-US')), '結果の帯の点数 = iframe の点数（最後のピースの ↓ の点も）', `${cScore2} / ${cRes}`);
// Reset → 次の Play は練習の設定（Colors 4）
await clickIn('#reset');
await sleep(400);
await clickIn('#options');
await ev(`(() => { const d = ${CDOC}; const r = d.querySelector('#difficulty'); r.value = '4'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await clickIn('#overlay_options button.close');
await sleep(300);
await clickIn('#play');
check(await waitFor(`__vaGame.practice() === true && !!document.querySelector('.game-practice')`, 5000), '練習の設定（Colors 4）：窓に「記録されません」', await ev(`document.querySelector('.game-practice')?.textContent ?? ''`));
await ev(`${FRAME}.focus()`);
for (let i = 0; i < 3; i++) {
  await SPACE();
  await sleep(700);
}
const before = (await call(keyA, 'GET', '/api/games/columns/ranking?period=all')).body?.me?.score;
// iframe の中の Esc で閉じる（練習は送らない）
await ev(`${FRAME}.focus()`);
await keyName('Escape', 27);
check(await waitFor(`!document.querySelector('.game-modal')`, 3000), 'Columns の iframe の中で Esc を押すと窓が閉じる');
await sleep(1200);
const after = (await call(keyA, 'GET', '/api/games/columns/ranking?period=all')).body;
check(after?.me?.score === before && after?.entries?.filter((e) => e.name === nameA).length === 1, '練習の設定のゲームは記録されない', `${before} → ${after?.me?.score}`);

// ランキングの窓：ゲームのタブ
const cr = await pt(`__va.ranking('columns')`);
await click(cr.x, cr.y);
check(await waitFor(`!!document.querySelector('.ranking-modal') && [...document.querySelectorAll('.ranking-modal .rank-games .tab')].map((b) => b.textContent).join('|') === '2048|Columns like game'`, 5000), '立て看板をクリック → ランキングの窓（2048 / Columns like game のタブ）');
check(await waitFor(`document.querySelector('.ranking-modal .rank-games .tab.on')?.textContent === 'Columns like game' && [...document.querySelectorAll('.ranking-modal th')].some((t) => t.textContent === '開始Lv') && document.querySelectorAll('.ranking-modal .rank-table tbody tr:not(.rank-gap)').length >= 1`, 5000), 'Columns の立て看板から開くと Columns のタブ（開始Lv の列）');
await sleep(400);
await shot('game_pc_ranking_columns.png');
await ev(`[...document.querySelectorAll('.ranking-modal .rank-games .tab')].find((b) => b.textContent === '2048').click()`);
check(await waitFor(`[...document.querySelectorAll('.ranking-modal th')].some((t) => t.textContent === '最大')`, 4000), '2048 のタブに切り替わる（最大の列）');
await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]').click()`);

// 2 人目（API）：Columns の筐体の前で記録 → 順位・立て看板・不正な記録
B.send({ type: 'goto', x: 15, y: 10 });
await sleep(4500);
const cst = await call(keyB, 'POST', '/api/games/columns/start', { options: { mode: 0, colors: 5, height: 0, start: 2 } });
check(cst.status === 200 && !cst.body.practice, '2 人目が Columns を始める（筐体の近く）', JSON.stringify(cst.body?.code ?? ''));
const cMoves = Array.from({ length: 15 }, (_, i) => [i % 7, i % 3, 12, 1]);
await sleep(15 * 210 + 300);
const cfin = await call(keyB, 'POST', '/api/games/columns/finish', { session: cst.body.session, moves: cMoves });
check(cfin.status === 200 && cfin.body.recorded && cfin.body.score >= 15 * 12 && cfin.body.detail?.startLevel === 2, '2 人目の Columns の記録（開始レベル 2）', `${cfin.status} ${JSON.stringify(cfin.body)}`);
await sleep(500);
const ctop = (await pt('__va.rankings()'))?.columns ?? [];
const capi = (await call(keyA, 'GET', '/api/games/columns/ranking?period=all')).body?.entries?.slice(0, 5) ?? [];
check(
  ctop.length >= 2 && JSON.stringify(ctop.map((e) => [e.name, e.score])) === JSON.stringify(capi.map((e) => [e.name, e.score])) && ctop.some((e) => e.name === nameB),
  'Columns の立て看板の上位（WebSocket の ranking）= ランキングの上位 5 人（2 人目も出る）',
  ctop.map((e) => `${e.rank}:${e.name}:${e.score}`).join(' '),
);
await shot('game_pc_store_columns.png');
const cbad = async (body, wait = 1500, opts = { mode: 0, colors: 5, height: 0, start: 1 }) => {
  const s2 = (await call(keyB, 'POST', '/api/games/columns/start', { options: opts })).body;
  await sleep(wait);
  return (await call(keyB, 'POST', '/api/games/columns/finish', { session: s2.session, ...body })).body;
};
check((await cbad({ moves: 'hello' }))?.code === 'bad-moves', 'Columns：でたらめな記録 → bad-moves');
check((await cbad({ moves: [[0, 0, 99999, 1]] }))?.code === 'bad-moves', 'Columns：↓ の点が多すぎる → bad-moves');
check((await cbad({ moves: Array.from({ length: 30 }, (_, i) => [i % 7, 0, 0, 1]) }, 300))?.code === 'too-fast', 'Columns：速すぎる（30 個を 0.3 秒）→ too-fast');
check((await cbad({ moves: [[0, 0, 0, 1], [1, 0, 0, 900]] }))?.code === 'too-fast', 'Columns：経過秒が実際の時間を超える → too-fast');
check((await cbad({ moves: [[3, 0, 0, 1]], over: [3, 0] }))?.code === 'bad-moves', 'Columns：あふれていないのにゲームオーバー → bad-moves');
const pr = await cbad({ moves: [[3, 0, 0, 1]] }, 400, { mode: 2, colors: 5, height: 0, start: 1 });
check(pr?.recorded === false && pr?.practice === true, 'Columns：練習の設定（Time Attack）は記録しない', JSON.stringify(pr));

B.ws.close();

// ---- スマホ（390×844）：タップで開いて、スワイプで遊ぶ
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${base}/#dev` });
check(await waitFor(`document.documentElement.classList.contains('layout-mobile') && !!window.__va && !!__va.game('2048')`, 10000), 'スマホのレイアウトで入り直す');
await sleep(2500);
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
// タップ：ヘッドレスの Edge はタッチの返事が遅れることがあり、返事を待ってから指を離すと長押し（0.45 秒）になって
// 指の下の床へ歩いてしまう。返事を待たずに続けて送る
const tapAt = async (x, y) => {
  const a = touch('touchStart', [[x, y]]);
  await sleep(40);
  const b = touch('touchEnd', []);
  await Promise.all([a, b]);
};
const mg = await pt(`__va.game('2048')`);
check(!!mg && mg.x > 0 && mg.x < 390 && mg.y > 0 && mg.y < 844, 'スマホの画面に 2048 の筐体が見える', JSON.stringify(mg));
check((await pt(`__va.pick(${mg?.x}, ${mg?.y})`))?.kind === 'game', 'その点の当たり判定はゲーム筐体', JSON.stringify(await pt(`__va.pick(${mg?.x}, ${mg?.y})`)));
// ヘッドレスの Edge はタッチの返事が遅れることがあるので、開かなければもう一度タップする
for (let i = 0; i < 3 && mg && !(await ev(`!!document.querySelector('.game-modal')`)); i++) {
  await tapAt(mg.x, mg.y);
  await sleep(2500);
}
check(
  await waitFor(`!!document.querySelector('.game-modal') && (${FDOC}?.querySelectorAll('.tile-container .tile').length ?? 0) >= 2`, 15000),
  'タップで 2048 の窓が開く（全画面のシート）',
  await ev(`JSON.stringify({ me: __va.me(), toast: document.querySelector('.toast')?.textContent ?? null, modal: document.querySelector('.modal')?.className ?? null })`),
);
const rect = await pt(`(() => { const r = document.querySelector('.game-modal').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
check(rect && rect.w >= 385 && rect.h >= 800, '窓は全画面', JSON.stringify(rect));
await sleep(600);
const gc = await pt(`(() => { const f = ${FRAME}.getBoundingClientRect(); const g = ${FDOC}.querySelector('.game-container').getBoundingClientRect(); return { x: f.left + g.left + g.width / 2, y: f.top + g.top + g.height / 2, w: g.width }; })()`);
const c0 = await ev('__vaGame.count()');
const swipes = [
  [0, 80],
  [-80, 0],
  [0, 80],
  [80, 0],
  [0, 80],
  [-80, 0],
  [0, -80],
  [-80, 0],
];
for (const [dx, dy] of swipes) {
  await touch('touchStart', [[gc.x, gc.y]]);
  for (let k = 1; k <= 4; k++) {
    await touch('touchMove', [[gc.x + (dx * k) / 4, gc.y + (dy * k) / 4]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(250);
}
const c1 = await ev('__vaGame.count()');
check(c1 > c0, 'スワイプで盤が動く', `手の数 ${c0} → ${c1}（盤の幅 ${gc?.w?.toFixed?.(0)}px）`);
await shot('game_mobile_2048.png');
await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
await sleep(1500);
check(/記録しました/.test(await ev(`document.querySelector('.toast')?.textContent ?? ''`)), 'スマホで閉じても記録される');
// ランキングの立て看板をタップ → 窓（遠くても歩かない）
const mr = await pt(`__va.ranking('2048')`);
const mBefore = await pt('__va.me()');
if (mr) await tapAt(mr.x, mr.y);
check(await waitFor(`!!document.querySelector('.ranking-modal')`, 5000), 'スマホ：立て看板をタップでランキングの窓');
const mAfter = await pt('__va.me()');
check(mBefore && mAfter && mBefore.to.x === mAfter.to.x && mBefore.to.y === mAfter.to.y, 'ランキングは歩かずに開く');
await sleep(500);
await shot('game_mobile_ranking.png');

// ---- スマホ：Columns like game（全画面のシートに収まる・元の下のボタンで遊べる）
// 同じ URL（# だけ）への navigate では読み直さないので、ランキングの窓を閉じてから読み直す
await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]')?.click()`);
await send('Page.reload');
check(await waitFor(`document.documentElement.classList.contains('layout-mobile') && !!window.__va && !!__va.game('columns')`, 10000), 'スマホで入り直す（Columns）');
await sleep(2500);
const mc = await pt(`__va.game('columns')`);
check(!!mc && mc.x > 0 && mc.x < 390 && mc.y > 0 && mc.y < 844, 'スマホの画面に Columns の筐体が見える', JSON.stringify(mc));
for (let i = 0; i < 4 && mc && !(await ev(`!!document.querySelector('.game-modal')`)); i++) {
  await tapAt(mc.x, mc.y);
  await sleep(3000);
}
check(
  await waitFor(`!!document.querySelector('.game-modal.game-columns') && !!${FDOC}?.querySelector('#play')`, 15000),
  'タップで Columns の窓が開く（全画面のシート）',
  await ev(`JSON.stringify({ pick: __va.pick(${mc?.x}, ${mc?.y}), me: __va.me(), toast: document.querySelector('.toast')?.textContent ?? null, modal: document.querySelector('.modal')?.className ?? null })`),
);
const mrect = await pt(`(() => { const r = document.querySelector('.game-modal').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
check(mrect && mrect.w >= 385 && mrect.h >= 800, 'Columns の窓は全画面', JSON.stringify(mrect));
await sleep(800);
const fit = await pt(`(() => { const d = ${FDOC}; const f = ${FRAME}.getBoundingClientRect(); const de = d.documentElement; const btns = [...d.querySelectorAll('#controls button, #menu button')].map((b) => b.getBoundingClientRect()); return { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight, fh: f.height, inside: btns.every((r) => r.width > 0 && r.left >= -1 && r.right <= de.clientWidth + 1 && r.top >= -1 && r.bottom <= de.clientHeight + 1), controls: getComputedStyle(d.querySelector('#controls')).display }; })()`);
check(fit && fit.sw <= fit.cw + 1 && fit.inside && fit.controls !== 'none', 'iframe の中が横にはみ出さず、Play・Left / Swap / Drop / Right のボタンが見える', JSON.stringify(fit));
const tapIn = async (sel) => {
  const r = await pt(`(() => { const f = ${FRAME}.getBoundingClientRect(); const e = ${FDOC}.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; })()`);
  if (r) await tapAt(r.x, r.y);
  return r;
};
for (let i = 0; i < 3 && !(await ev('__vaGame.session()')); i++) {
  await tapIn('#play');
  await sleep(1200);
}
check(await waitFor(`__vaGame.session() === true`, 5000), 'スマホ：Play をタップで始まる');
for (const b of ['#left', '#swap', '#drop', '#right', '#drop', '#swap', '#drop']) {
  await tapIn(b);
  await sleep(b === '#drop' ? 700 : 200);
}
const mcnt = await ev('__vaGame.count()');
check(mcnt >= 2, 'スマホ：下のボタン（Left / Swap / Drop / Right）で遊べる', `置いた数 ${mcnt}`);
await shot('game_mobile_columns.png');
await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
await sleep(1500);
check(/記録しました/.test(await ev(`document.querySelector('.toast')?.textContent ?? ''`)), 'スマホで Columns を閉じても記録される');

console.log(`NG ${ng}`);
cdp.close();
process.exit(ng ? 1 : 0);
