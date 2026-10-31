// ゲーム筐体と 2048・Columns like game・ランキングの確認（v0.6.0。DESIGN §16・§16.8）。Edge ヘッドレス（CDP）と API・WebSocket で：
//   筐体をクリック → 歩いて窓が開く → iframe に矢印キー（親の人は動かない）→ 窓を閉じて記録 → もう一度開いてゲームオーバーまで → 結果の帯 →
//   Try again で始め直す → ランキングの窓 → 2 人目（API と WebSocket）が遊んで順位が並ぶ・壁のランキングのポスター（ranking の受信）に反映 →
//   不正な手順（でたらめな手・速すぎる・別のセッション・遠い）が断られる →
//   Columns like game：筐体をクリック → Play → iframe にキーでピースを置く → フォーカスが外れると一時停止 → 閉じて記録 → ゲームオーバーまで →
//   練習の設定は記録しない → Esc → ランキングの窓のゲームのタブ → 2 人目の記録・ポスター → 不正な記録 →
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
  if (globalThis.__tab2Open) await send('Page.bringToFront');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const pt = (e) => ev(`JSON.stringify(${e})`).then((s) => (s ? JSON.parse(s) : null));
const FRAME = `document.querySelector('.game-frame iframe')`;
const FDOC = `${FRAME}?.contentDocument`;
const frameScore = () => ev(`Number((${FDOC}?.querySelector('.score-container')?.firstChild?.textContent ?? 'NaN'))`);
/** iframe の中の要素をマウスでクリック（親の座標に直して CDP で） */
const clickIn = async (sel) => {
  const r = await pt(`(() => { const f = ${FRAME}.getBoundingClientRect(); const e = ${FDOC}.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; })()`);
  if (r) await click(r.x, r.y);
  return r;
};
const keyName = async (k, code) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
};
const SPACE = () => keyName(' ', 32);
/** GC_ONLY=2048,columns,hextris,spectate,mobile で一部だけ（確かめ直すとき） */
const ONLY = new Set((process.env.GC_ONLY ?? '').split(',').filter(Boolean));
const run = (part) => !ONLY.size || ONLY.has(part);
/** ネットワークのログ（v0.6.0 Hextris：iframe から外への通信が無いか） */
const netLog = [];
cdp.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.method === 'Network.requestWillBeSent') netLog.push({ url: m.params.request.url, doc: m.params.documentURL ?? '', frame: m.params.frameId });
  else if (m.method === 'Network.webSocketCreated') netLog.push({ url: m.params.url, doc: 'websocket', frame: '' });
});

await send('Page.enable');
await send('Network.enable');
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
check(!!(await pt(`__va.ranking('2048')`)), 'ランキングのポスターの位置が取れる');
// 2026-10-30 ユーザー指定：ランキングは床の立て看板をやめて左の壁の奥寄り（掲示板の手前）のポスター 3 枚に
{
  const rp = [await pt(`__va.ranking('2048')`), await pt(`__va.ranking('columns')`), await pt(`__va.ranking('hextris')`)];
  const bd = await pt('__va.board()');
  check(
    rp.every(Boolean) && rp[0].x < rp[1].x && rp[1].x < rp[2].x && rp[0].y > rp[1].y && rp[1].y > rp[2].y && bd && rp[0].x > bd.x && rp[0].y < bd.y,
    'ポスターは左の壁に 2048・Columns like game・Hextris の順（画面の左下から右上へ。掲示板より奥）',
    JSON.stringify({ rp, bd }),
  );
  const picks = [];
  for (const [i, g] of ['2048', 'columns', 'hextris'].entries()) picks.push(await pt(`__va.pick(${rp[i]?.x}, ${rp[i]?.y})`));
  check(picks.every((h, i) => h?.kind === 'ranking' && h.game === ['2048', 'columns', 'hextris'][i]), 'ポスターの当たり判定はそのゲームのランキング', JSON.stringify(picks));
  const cab = await pt(`__va.game('2048')`);
  check(rp.every((r) => Math.hypot(r.x - cab.x, r.y - cab.y) > 300), 'ポスターはゲーム筐体のまわりには無い');
  const freed = [];
  // (17,4) は v0.7.0 からスロット台
  for (const [x, y] of [[16, 9], [20, 3]]) freed.push(await ev(`__va.passable(${x}, ${y})`));
  check(freed.every(Boolean), '立て看板のあったマス (16,9)・(20,3) は通れる（(17,4) は v0.7.0 からスロット台）', JSON.stringify(freed));
  // ホバー：札とポスターの縁が光る（hoverRanking）。カーソルは指の形
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rp[1].x, y: rp[1].y });
  check(await waitFor(`[...document.querySelectorAll('canvas')].some((c) => c.style.cursor === 'pointer')`, 2000), 'ポスターにカーソルを置くと指の形');
  await shot('game_pc_ranking_hover.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 900 });
}

// 2 人目（API・WebSocket。頭上の 🎮 を見る・記録を並べる・観戦する / される）
const keyB = newKey();
const nameB = `ゲーマーB${crypto.randomBytes(2).toString('hex')}`;
const B = await joinWs(nameB, keyB);

if (run('2048')) {
// ---- 遠くから筐体をクリック → 歩いて着いたら窓が開く
const g0 = await pt(`__va.game('2048')`);
const me0 = await pt('__va.me()');
await click(g0.x, g0.y);
check(await waitFor(`!!document.querySelector('.game-modal')`, 15000), '遠くから筐体をクリック → 歩いて着いたら 2048 の窓が開く', `始めの位置 (${me0?.x?.toFixed?.(0)},${me0?.y?.toFixed?.(0)})`);
check(await waitFor(`(${FDOC}?.querySelectorAll('.tile-container .tile').length ?? 0) >= 2`, 8000), 'iframe に 2048 の盤（最初のタイル 2 枚）が出る');
check(await waitFor(`document.activeElement === ${FRAME}`, 3000), '開いたら iframe にフォーカス');
check(await ev(`!!${FDOC}?.querySelector('.va-credit a[href="https://github.com/gabrielecirulli/2048"]')`), '出典（Original: 2048 by Gabriele Cirulli）がある');
check(await ev(`!/official version/.test(${FDOC}?.body?.textContent ?? '')`), '「official version」の注意書きは無い');
check(await waitFor(`(__va.me() ? true : false)`, 1000) && (await pt('__va.rankings()'))?.['2048'] !== undefined, 'welcome のランキング（ポスターの上位）を受け取っている');

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
const pA = B.msgs.filter((m) => m.type === 'player' && m.player.name === nameA).pop()?.player;
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

// ---- v0.7.0：点数に応じてスロットのコイン（DESIGN §17.9。結果の帯に「+n コイン」・上のバーの 🪙・2,000 点より少なければ「もう少しで 6 枚」）
{
  const coinText = () => ev(`document.querySelector('.game-result .game-coins')?.textContent ?? ''`);
  const meCoins = async () => Number(String((await ev(`document.querySelector('.me-coins')?.textContent ?? ''`)) || '').replace(/[^0-9]/g, '')) || 0;
  check(/点数に応じてスロットのコイン（6〜60 枚）/.test(await ev(`document.querySelector('.game-modal .game-note')?.textContent ?? ''`)), '窓の下の説明に「点数に応じてスロットのコイン（6〜60 枚）」');
  const lowTxt = await coinText();
  check(score2 >= 2000 ? /\+\d+ コイン（スロット用）/.test(lowTxt) : /もう少しで 6 枚（2,000 点から）/.test(lowTxt), '前のゲームの結果の帯にコインの行（2,000 点より少なければ「もう少しで 6 枚」）', `${score2} 点：${lowTxt}`);
  const expected = (sc) => (sc < 2000 ? 0 : Math.round(6 + (54 * Math.min(1, Math.log(sc / 2000) / Math.log(10))) ));
  let got = 0;
  for (let gi = 0; gi < 5 && !got; gi++) {
    // 角に寄せる簡単な戦略：下 → 左 → 右 → 上 の順に、盤が動く（__vaGame.count() が増える）まで押す
    for (let i = 0; i < 4000; i++) {
      if (await ev(`!!${FDOC}?.querySelector('.game-message.game-over')`)) break;
      const c0 = await ev('__vaGame.count()');
      let moved = false;
      for (const d of ['down', 'left', 'right', 'up']) {
        await key(d);
        for (let w = 0; w < 6 && !moved; w++) {
          await sleep(25);
          moved = (await ev('__vaGame.count()')) > c0;
        }
        if (moved) break;
      }
      if (!moved) await sleep(300);
    }
    const sc = await frameScore();
    await waitFor(`/記録しました/.test(document.querySelector('.game-result')?.textContent ?? '') && !!document.querySelector('.game-result .game-coins')`, 6000);
    const txt = await coinText();
    console.log(`（2048 を角に寄せて遊んだ：${sc} 点 → ${txt}）`);
    if (sc >= 2000) {
      got = expected(sc);
      check(txt.includes(`+${got} コイン（スロット用）`), '結果の帯に「+n コイン（スロット用）」（n = 点数の式どおり）', `${sc} 点・${txt}・式 ${got}`);
      check(await ev(`!!document.querySelector('.game-result .game-coins.got')`), '+n コインの印は目立つ色（got）');
      check(await waitFor(`Number(String(document.querySelector('.me-coins')?.textContent ?? '').replace(/[^0-9]/g, '')) >= ${got}`, 3000), '上のバーの 🪙 がその場で増える', `${await meCoins()}`);
      const srv = (await call(keyA, 'GET', '/api/slot/1')).body?.coins;
      check(srv === (await meCoins()), 'サーバの手元のコイン = 上のバーの 🪙', `${srv} / ${await meCoins()}`);
      await sleep(500);
      await shot('game_pc_coins.png');
    } else {
      check(/もう少しで 6 枚/.test(txt), '2,000 点より少なければ「もう少しで 6 枚」', `${sc} 点・${txt}`);
      await ev(`${FDOC}.querySelector('.retry-button').click()`);
      await sleep(800);
    }
  }
  check(got > 0, '2048 を遊んでコインがもらえた');
}

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
check(!!finB.body?.coins && (g.score >= 2000) === (finB.body.coins.gained > 0), '2 人目の記録にもコインの結果（2,000 点から）', JSON.stringify(finB.body?.coins));
const rk2 = await call(keyA, 'GET', '/api/games/2048/ranking?period=all');
const ia = rk2.body.entries.findIndex((e) => e.name === nameA);
const ib = rk2.body.entries.findIndex((e) => e.name === nameB);
const sorted = rk2.body.entries.every((e, i, a) => i === 0 || a[i - 1].score >= e.score);
check(ia >= 0 && ib >= 0 && sorted && (g.score > (rk2.body.entries[ia]?.score ?? 0) ? ib < ia : ib > ia), '2 人が点数の順に並ぶ（1 人 1 行）', `A ${ia + 1} 位・B ${ib + 1} 位`);
check(rk2.body.entries.filter((e) => e.name === nameA).length === 1, '同じ人は 1 行（いちばん良い記録）');
const top = (await pt('__va.rankings()'))?.['2048'] ?? [];
const bTop = rk2.body.entries.slice(0, 5).some((e) => e.name === nameB);
check(!bTop || top.some((e) => e.name === nameB), 'ポスターの上位（WebSocket の ranking）に 2 人目が出る', top.map((e) => `${e.rank}:${e.name}:${e.score}`).join(' '));
// 壁は別の canvas に 1 回だけ描くが、ポスターは毎フレーム重ねて描くので、ランキングが変わるとその場で描き直される
check(
  await waitFor(`JSON.stringify(__va.rankingFace('2048')) === JSON.stringify(__va.rankings()['2048'].slice(0, 5).map((e) => [e.name, e.score]))`, 3000) &&
    (!bTop || (await pt(`__va.rankingFace('2048')`))?.some(([n]) => n === nameB)),
  '壁のポスターがその場で描き直される（いま描いている上位 = 受け取った上位。2 人目も出る）',
  JSON.stringify(await pt(`__va.rankingFace('2048')`)),
);
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
}
// ================================================================ Columns like game（DESIGN §16.8）
if (run('columns')) {
const CDOC = FDOC; // 同じ窓の iframe
const cOverlay = (id) => ev(`!!${CDOC}?.querySelector('#overlay_${id}.open')`);
const cScore = () => ev(`Number((${CDOC}?.querySelector('#score')?.textContent ?? 'NaN').replace(/,/g, ''))`);

check(!!(await pt(`__va.game('columns')`)) && !!(await pt(`__va.ranking('columns')`)), 'Columns like game の筐体とポスターの位置が取れる');
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
check(/🪙 (\+\d+ コイン（スロット用）|コインなし：もう少しで 6 枚（3,000 点から）)/.test(cRes), 'Columns の結果の帯にもコインの行（3,000 点から）', cRes);
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
check(await waitFor(`!!document.querySelector('.ranking-modal') && [...document.querySelectorAll('.ranking-modal .rank-games .tab')].map((b) => b.textContent).join('|') === '2048|Columns like game|Hextris'`, 5000), 'ポスターをクリック → ランキングの窓（2048 / Columns like game のタブ）');
check(await waitFor(`document.querySelector('.ranking-modal .rank-games .tab.on')?.textContent === 'Columns like game' && [...document.querySelectorAll('.ranking-modal th')].some((t) => t.textContent === '開始Lv') && document.querySelectorAll('.ranking-modal .rank-table tbody tr:not(.rank-gap)').length >= 1`, 5000), 'Columns のポスターから開くと Columns のタブ（開始Lv の列）');
await sleep(400);
await shot('game_pc_ranking_columns.png');
await ev(`[...document.querySelectorAll('.ranking-modal .rank-games .tab')].find((b) => b.textContent === '2048').click()`);
check(await waitFor(`[...document.querySelectorAll('.ranking-modal th')].some((t) => t.textContent === '最大')`, 4000), '2048 のタブに切り替わる（最大の列）');
await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]').click()`);

// 2 人目（API）：Columns の筐体の前で記録 → 順位・ポスター・不正な記録
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
  'Columns のポスターの上位（WebSocket の ranking）= ランキングの上位 5 人（2 人目も出る）',
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
}

// ================================================================ Hextris（DESIGN §16.9）
const HWIN = `${FRAME}?.contentWindow`;
const hState = () => ev(`${HWIN}?.gameState`);
const hScore = () => ev(`Number(${HWIN}?.score ?? NaN)`);
/** 消去を 1 回起こす（同じ色のブロックを 3 つ、六角形の 1 つの辺に置く。点数は元のゲームの処理で入る） */
const hexClear = (lane = 0) =>
  ev(`(() => { try { const w = ${HWIN}; if (!w || w.gameState !== 1) return false; const c = w.colors[${lane} % w.colors.length]; for (let i = 0; i < 3; i++) w.MainHex.addBlock(new w.Block(${lane}, c, 1)); return true; } catch (e) { return String(e); } })()`);
const holdKey = (type, k, code) => send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
let hexFrames = null;
if (run('hextris') || run('spectate')) {
  const net0 = netLog.length;
  await send('Page.bringToFront');
  // 確かめ用：iframe のアニメーション（requestAnimationFrame）が回っているか
  const rafRate = async () => ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })`);
  console.log(`（店内のページの requestAnimationFrame：${await rafRate()} 回/秒）`);
  check(!!(await pt(`__va.game('hextris')`)) && !!(await pt(`__va.ranking('hextris')`)), 'Hextris の筐体とポスターの位置が取れる');
  const hg = await pt(`__va.game('hextris')`);
  await click(hg.x, hg.y);
  check(await waitFor(`!!document.querySelector('.game-modal.game-hextris')`, 15000), '遠くから Hextris の筐体をクリック → 歩いて着いたら窓が開く');
  check(await waitFor(`!!${FDOC}?.getElementById('canvas') && ${HWIN}?.gameState === 0`, 8000), 'iframe に Hextris（Canvas・始める前の画面）が出る');
  check(await ev(`!!${FDOC}?.querySelector('#va_credit a[href="https://github.com/Hextris/hextris"]')`), '出典（GitHub・GNU GPL v3）がある');
  check(
    await ev(`(() => { const d = ${FDOC}; const w = ${HWIN}; return !d.querySelector('script[src*="googlesyndication"], script[src*="analytics"], link[href*="fonts.googleapis"], link[rel="manifest"], .rrssb-buttons, #badges, meta[property^="og:"], meta[property^="twitter:"]') && typeof w.ga === 'undefined' && typeof w.Cookies === 'undefined'; })()`),
    '広告・Google Analytics・Google Fonts・SNS の共有・バッジ・og/twitter の meta・manifest が無い',
  );
  check((await ev('__vaGame.session()')) === false, 'Play を押すまでは始めない（サーバのセッション無し）');
  await clickIn('#startBtn');
  check(await waitFor(`__vaGame.session() === true && ${HWIN}?.gameState === 1`, 6000), 'Play（クリック）→ 親がサーバに start → iframe のゲームが始まる', `gameState ${await hState()}`);
  await ev(`${FRAME}.focus()`);
  const hMe0 = await pt('__va.me()');
  const pos0 = await ev(`${HWIN}.MainHex.position`);
  await sleep(200);
  await key('left');
  await sleep(150);
  await key('left');
  await sleep(150);
  const pos1 = await ev(`${HWIN}.MainHex.position`);
  check(pos0 !== pos1, '← キーで六角形が回る', `${pos0} → ${pos1}`);
  const hMe1 = await pt('__va.me()');
  check(hMe0 && hMe1 && hMe0.to.x === hMe1.to.x && hMe0.to.y === hMe1.to.y, 'Hextris の窓を開いている間、店内の人はキーで動かない');
  // 消去を 2 回（2 回目はコンボ ×2）。点数は元のゲームの処理（consolidateBlocks）で入り、親が記録を覚える
  await sleep(600);
  const hcRes = [await hexClear(0)];
  await sleep(500);
  hcRes.push(await hexClear(3));
  await sleep(900);
  const hs1 = await hScore();
  const hc1 = await ev('__vaGame.moves()');
  check(hs1 > 0 && (await ev('__vaGame.score()')) === hs1 && Array.isArray(hc1) && hc1.length >= 2 && hc1[0][1] === 1, 'ブロックを消すと点が入り、親が消した記録 [k, m] と点数を覚えている', `点数 ${hs1} / 記録 ${JSON.stringify(hc1)} / gameState ${await hState()} / ${JSON.stringify(hcRes)}`);
  await sleep(1500);
  await shot('game_pc_hextris.png');

  // ---- 観戦（DESIGN §16.10）：2 人目（WebSocket）が見る → 遊ぶ人の窓に人数・画像が届く
  if (run('spectate')) {
    const pidA = (await pt('__va.me()'))?.pid ?? (await pt(`__va.players()`))?.find((x) => x.name === nameA)?.pid;
    const frames = [];
    const onB = (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'spec-frame') frames.push({ at: Date.now(), bytes: Math.floor(((m.image.length - m.image.indexOf(',') - 1) * 3) / 4), type: m.image.slice(5, m.image.indexOf(';')), info: m.info });
    };
    B.ws.on('message', onB);
    B.send({ type: 'spectate', pid: pidA });
    check(await waitFor(`/👀 1/.test(document.querySelector('.game-modal .spec-count')?.textContent ?? '')`, 4000), '見る人が来ると、遊ぶ人の窓に「👀 1 人が見ています」', await ev(`document.querySelector('.game-modal .spec-count')?.textContent`));
    // ↓ を押し続けて画面を動かしながら 6 秒測る
    await ev(`${FRAME}.focus()`);
    await holdKey('rawKeyDown', 's', 83);
    await sleep(6000);
    await holdKey('keyUp', 's', 83);
    const f6 = frames.filter((f) => f.at >= frames[0]?.at);
    const span = f6.length > 1 ? (f6[f6.length - 1].at - f6[0].at) / 1000 : 0;
    const fps = span ? (f6.length - 1) / span : 0;
    const avg = f6.length ? f6.reduce((a, f) => a + f.bytes, 0) / f6.length : 0;
    const maxB = Math.max(0, ...f6.map((f) => f.bytes));
    hexFrames = { n: f6.length, fps, avg, max: maxB, kbps: (avg * fps) / 1024, type: f6[0]?.type };
    check(f6.length >= 5 && fps <= 5.3 && maxB <= 32 * 1024, 'Hextris の画像が見る人に届く（1 秒に 5 枚まで・1 枚 32 KB まで）', `${f6.length} 枚 / ${span.toFixed(1)} 秒・${fps.toFixed(2)} 枚/秒・平均 ${(avg / 1024).toFixed(1)} KB・最大 ${(maxB / 1024).toFixed(1)} KB・${hexFrames.kbps.toFixed(1)} KB/秒・${hexFrames.type}`);
    check(f6.some((f) => f.info && typeof f.info.score === 'number'), '画像に点数などの文字が添えてある', JSON.stringify(f6[0]?.info));
    check(((await pt('__va.players()')) ?? []).find((x) => x.name === nameA)?.viewers === 1, '頭上の名札に見ている人数（players の viewers = 1）');

    // 2 つ目のタブ（別のオリジン localhost にして鍵を分ける）：筐体をクリック → ［遊ぶ］［見る］→ 見る窓に画像
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    globalThis.__tab2Open = true;
    const c2 = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => c2.once('open', r));
    let k2 = 0;
    const send2 = (method, params = {}) =>
      new Promise((res) => {
        const id = ++k2;
        const timer = setTimeout(() => {
          c2.off('message', on);
          res(undefined);
        }, method === 'Page.captureScreenshot' ? 20000 : 5000);
        const on = (d) => {
          const m = JSON.parse(String(d));
          if (m.id === id) {
            clearTimeout(timer);
            c2.off('message', on);
            res(m.result);
          }
        };
        c2.on('message', on);
        c2.send(JSON.stringify({ id, method, params }));
      });
    const ev2 = async (e) => (await send2('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
    const wait2 = async (e, ms = 8000) => {
      for (let i = 0; i < ms; i += 150) {
        if (await ev2(e)) return true;
        await sleep(150);
      }
      return false;
    };
    const shot2 = async (name) => {
      if (!outDir) return;
      const r = await send2('Page.captureScreenshot', { format: 'png' });
      if (!r) return;
      fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
      console.log(`撮った: ${path.join(outDir, name)}`);
    };
    const click2 = async (x, y) => {
      await send2('Page.bringToFront');
      await send2('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send2('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send2('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const base2 = base.replace('127.0.0.1', 'localhost');
    const keyC = newKey();
    const nameC = `みる人C${crypto.randomBytes(2).toString('hex')}`;
    await call(keyC, 'POST', '/api/enter', { name: nameC, look: { color: 'pink', hat: 'ribbon' } });
    await send2('Page.enable');
    await send2('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send2('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send2('Page.navigate', { url: new URL(base2).origin + '/__ls' });
    await sleep(800);
    await ev2(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(keyC))}); sessionStorage.setItem('va:room', 'open')`);
    await send2('Page.navigate', { url: `${base2}/#dev` });
    check(await wait2(`!!window.__va && !!__va.game('hextris') && !!__va.me()`, 12000), '2 つ目のタブ（見る人 C）が店内に入る');
    await sleep(1500);
    const hg2 = JSON.parse((await ev2(`JSON.stringify(__va.game('hextris'))`)) ?? 'null');
    if (hg2) await click2(hg2.x, hg2.y);
    check(await wait2(`!!document.querySelector('.chooser-modal') && /${nameA}/.test(document.querySelector('.chooser-modal')?.textContent ?? '')`, 5000), 'だれかが遊んでいる筐体をクリック → ［▶ 遊ぶ］と［👀 〇〇 さんのプレイを見る］', await ev2(`document.querySelector('.chooser-modal')?.textContent ?? document.querySelector('.modal')?.className ?? ''`));
    await sleep(300);
    await shot2('game_pc_chooser.png');
    await ev2(`document.querySelector('.chooser-modal .chooser-watch').click()`);
    check(await wait2(`!!document.querySelector('.spectate-modal .spectate-img')`, 6000), '見る窓に Hextris の画像が出る');
    check(await waitFor(`/👀 2/.test(document.querySelector('.game-modal .spec-count')?.textContent ?? '')`, 4000), '遊ぶ人の窓は「👀 2 人が見ています」');
    // 見ている間も画面が動くように ↓ を押し続ける（遊ぶ人のタブを前に）
    await send('Page.bringToFront');
    await ev(`${FRAME}.focus()`);
    await holdKey('rawKeyDown', 's', 83);
    await sleep(2500);
    await holdKey('keyUp', 's', 83);
    await send2('Page.bringToFront');
    await sleep(500);
    const spScore = await ev2(`document.querySelector('.spectate-info strong')?.textContent ?? ''`);
    check(spScore !== '', '見る窓に点数が出る', spScore);
    await shot2('game_pc_spectate_hextris.png');
    await send('Page.bringToFront');
    await shot('game_pc_hextris_watched.png');
    // 名札（🎮👀2）をクリックしても見られる（C のタブ。A の頭上）
    check(((await pt('__va.players()')) ?? []).find((x) => x.name === nameA)?.viewers === 2, '頭上の名札の人数 = 2');
    // 許可を切る → 見ている人は終わり、新しく見られない
    await ev(`document.querySelector('.game-modal .spec-allow input').click()`);
    check(await wait2(`/許可を切りました/.test(document.querySelector('.spectate-modal .game-result')?.textContent ?? '')`, 4000), '［観戦を許可］を切ると、見る人の窓に「〇〇 さんが観戦の許可を切りました」', await ev2(`document.querySelector('.spectate-modal .game-result')?.textContent ?? ''`));
    check(await waitFor(`/👀 0/.test(document.querySelector('.game-modal .spec-count')?.textContent ?? '')`, 3000), '遊ぶ人の窓は 0 人に');
    const fN = frames.length;
    await sleep(1500);
    check(frames.length === fN, '許可を切ると画像は送られない', `${fN} → ${frames.length}`);
    await ev2(`document.querySelector('.spectate-modal button[aria-label="閉じる"]').click()`);
    const n0 = B.msgs.length;
    B.send({ type: 'spectate', pid: pidA });
    await sleep(800);
    check(B.msgs.slice(n0).some((m) => m.type === 'error' && m.code === 'denied'), '許可を切っている人は見られない（denied）');
    await ev(`document.querySelector('.game-modal .spec-allow input').click()`);
    await sleep(500);
    // 名札のクリックで見る（C のタブ）
    const tag = JSON.parse((await ev2(`JSON.stringify(__va.playTag())`)) ?? 'null');
    if (tag) await click2(tag.x, tag.y);
    check(
      !!tag && (await wait2(`!!document.querySelector('.spectate-modal')`, 4000)),
      '遊んでいる人の頭上の名札（🎮）をクリックしても見る窓が開く',
      `${JSON.stringify(tag)} ${await ev2(`JSON.stringify(__va.pick(${tag?.x ?? 0}, ${tag?.y ?? 0}))`)} ${await ev2(`document.querySelector('.modal')?.className ?? ''`)}`,
    );
    await sleep(1500);
    // 遊ぶ人が窓を閉じると「〇〇 さんのゲームが終わりました（点数）」
    globalThis.__tab2 = { send2, ev2, wait2, shot2, click2, c2, id: t.id, nameC };
    B.ws.off('message', onB);
  }

  // フォーカスが外れると一時停止（窓の見出しをクリック）
  const hhead = await pt(`(() => { const r = document.querySelector('.game-modal .modal-head h2').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
  await click(hhead.x, hhead.y);
  check(await waitFor(`${HWIN}?.gameState === -1`, 3000), '窓の外をクリック（フォーカスが外れる）と一時停止', `gameState ${await hState()}`);
  const hScoreClose = await hScore();
  await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
  check(await waitFor(`!document.querySelector('.game-modal')`, 3000), 'Hextris の窓が ✕ で閉じる');
  if (globalThis.__tab2) {
    const { wait2, ev2 } = globalThis.__tab2;
    check(await wait2(`/ゲームが終わりました/.test(document.querySelector('.spectate-modal .game-result')?.textContent ?? '')`, 4000), '遊ぶ人が閉じると、見る人の窓に「〇〇 さんのゲームが終わりました（点数）」', await ev2(`document.querySelector('.spectate-modal .game-result')?.textContent ?? ''`));
    await ev2(`document.querySelector('.spectate-modal button[aria-label="閉じる"]')?.click()`);
  }
  await sleep(1200);
  const hToast = await ev(`document.querySelector('.toast')?.textContent ?? ''`);
  check(/記録しました/.test(hToast), '閉じたら記録され、店内の帯に結果が出る', hToast);
  const hrk = await call(keyA, 'GET', '/api/games/hextris/ranking?period=all');
  check(hrk.body?.me?.score === hScoreClose && hrk.body?.me?.detail?.combo >= 2, 'ランキングに自分の記録（点数 = iframe の点数・コンボ）', `iframe ${hScoreClose} / サーバ ${hrk.body?.me?.score} ${JSON.stringify(hrk.body?.me?.detail)}`);

  // もう一度開いて、↓ を押し続けてゲームオーバーまで → 結果の帯 → Enter で次のゲーム
  await click(hg.x, hg.y);
  check(await waitFor(`!!document.querySelector('.game-modal.game-hextris') && ${HWIN}?.gameState === 0`, 8000), 'Hextris の窓をもう一度開く');
  await sleep(500);
  await ev(`${FRAME}.focus()`);
  await keyName('Enter', 13);
  check(await waitFor(`__vaGame.session() === true && ${HWIN}?.gameState === 1`, 6000), 'Enter でも始まる');
  await sleep(400);
  await hexClear(1);
  await sleep(400);
  await ev(`${FRAME}.focus()`);
  await holdKey('rawKeyDown', 's', 83);
  const hOver = await waitFor(`${HWIN}?.gameState === 2`, 150000);
  await holdKey('keyUp', 's', 83);
  check(hOver, 'ゲームオーバーまで遊べる（↓ を押し続ける）');
  const hScore2 = await hScore();
  check(await waitFor(`/記録しました/.test(document.querySelector('.game-result')?.textContent ?? '')`, 6000), 'ゲームオーバーで記録され、結果の帯が出る', await ev(`document.querySelector('.game-result')?.textContent ?? ''`));
  const hRes = await ev(`document.querySelector('.game-result')?.textContent ?? ''`);
  check(hRes.includes(hScore2.toLocaleString('en-US')), '結果の帯の点数 = iframe の点数', `${hScore2} / ${hRes}`);
  check(/🪙 (\+\d+ コイン（スロット用）|コインなし：もう少しで 6 枚)/.test(hRes), 'Hextris の結果の帯にもコインの行', hRes);
  await sleep(1200);
  await shot('game_pc_hextris_over.png');
  const hgen = await ev('__vaGame.gen()');
  await ev(`${FRAME}.focus()`);
  await keyName('Enter', 13);
  check(await waitFor(`__vaGame.gen() > ${hgen} && ${HWIN}?.gameState === 1`, 6000), 'ゲームオーバーのあと Enter で次のゲーム（新しい種）');
  // ランキングの窓（Hextris のタブ・注意書き・コンボの列）
  await ev(`[...document.querySelectorAll('.game-modal button')].find((b) => b.textContent.includes('ランキング')).click()`);
  check(await waitFor(`document.querySelector('.ranking-modal .rank-games .tab.on')?.textContent === 'Hextris' && /ブラウザの申告/.test(document.querySelector('.ranking-modal .rank-self-report')?.textContent ?? '') && [...document.querySelectorAll('.ranking-modal th')].some((t) => t.textContent === 'コンボ')`, 5000), 'ランキングの窓の Hextris のタブ（「Hextris の記録はブラウザの申告です」・コンボの列）');
  await sleep(500);
  await shot('game_pc_ranking_hextris.png');
  await ev(`[...document.querySelectorAll('.ranking-modal .rank-games .tab')].find((b) => b.textContent === '2048').click()`);
  check(await waitFor(`!document.querySelector('.ranking-modal .rank-self-report')`, 3000), '2048 のタブには申告の注意書きは出ない');
  await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]').click()`);
  await ev(`${FRAME}.focus()`);
  await keyName('Escape', 27);
  check(await waitFor(`!document.querySelector('.game-modal')`, 3000), 'Hextris の iframe の中で Esc を押すと窓が閉じる');
  // iframe から外への通信が無い（Hextris のページが読んだもの・WebSocket）
  // ブラウザの中の拡張機能（chrome-extension://）はページの通信ではないので数えない
  const hexNet = netLog.slice(net0).filter((e) => e.doc.includes('/games/hextris/') && /^(https?|wss?):/.test(e.url));
  const foreignH = hexNet.filter((e) => !e.url.startsWith(new URL(base).origin));
  const wsAll = netLog.filter((e) => e.doc === 'websocket' && !e.url.startsWith(new URL(base).origin.replace('http', 'ws')));
  check(hexNet.length >= 10 && foreignH.length === 0 && wsAll.length === 0, 'Hextris の iframe から外への通信が 0 件（ネットワークのログ）', `Hextris のページの読み込み ${hexNet.length} 件・外 ${JSON.stringify(foreignH.map((e) => e.url))}`);

  // 2 人目（API）：Hextris の記録・速すぎる点数・おかしな記録は断る
  B.send({ type: 'goto', x: 15, y: 5 });
  await sleep(6000);
  const hst = await call(keyB, 'POST', '/api/games/hextris/start', {});
  check(hst.status === 200, '2 人目が Hextris を始める（筐体の近く）', JSON.stringify(hst.body?.code ?? ''));
  await sleep(2000);
  const hcl = [
    [3, 1],
    [4, 2],
    [3, 3],
  ];
  const hfin = await call(keyB, 'POST', '/api/games/hextris/finish', { session: hst.body.session, score: 9 + 32 + 27, clears: hcl });
  check(hfin.status === 200 && hfin.body.recorded && hfin.body.score === 68 && hfin.body.detail?.combo === 3, '2 人目の Hextris の記録', JSON.stringify(hfin.body));
  const hbad = async (body, wait = 1000) => {
    const s2 = (await call(keyB, 'POST', '/api/games/hextris/start', {})).body;
    await sleep(wait);
    return (await call(keyB, 'POST', '/api/games/hextris/finish', { session: s2.session, ...body })).body;
  };
  const fastCl = Array.from({ length: 12 }, (_, i) => [5, i + 1]);
  check((await hbad({ score: fastCl.reduce((a, [k, m]) => a + k * k * m, 0), clears: fastCl }))?.code === 'too-fast', 'Hextris：速すぎる点数（1 秒で 1,950 点）→ too-fast');
  check((await hbad({ score: 100, clears: [[3, 1]] }))?.code === 'bad-moves', 'Hextris：消した記録と点数が合わない → bad-moves');
  check((await hbad({ score: 27, clears: [[3, 3]] }))?.code === 'bad-moves', 'Hextris：コンボが飛ぶ → bad-moves');
  await sleep(600);
  const htop = (await pt('__va.rankings()'))?.hextris ?? [];
  const hapi = (await call(keyA, 'GET', '/api/games/hextris/ranking?period=all')).body?.entries ?? [];
  check(
    htop.length >= 2 && JSON.stringify(htop.map((e) => [e.name, e.score])) === JSON.stringify(hapi.slice(0, 5).map((e) => [e.name, e.score])) && hapi.some((e) => e.name === nameB),
    'Hextris の立て看板の上位（WebSocket の ranking）= ランキングの上位 5 人（2 人目の記録も並ぶ）',
    htop.map((e) => `${e.rank}:${e.name}:${e.score}`).join(' '),
  );
  await sleep(500);
  await shot('game_pc_store_3games.png');
}

// ================================================================ 観戦：2048（手の中継。見る人の iframe が見るだけでなぞる）
if (run('spectate') && globalThis.__tab2) {
  const { ev2, wait2, shot2, click2, send2, c2, id: tabId } = globalThis.__tab2;
  B.send({ type: 'goto', x: 14, y: 5 });
  await sleep(4000);
  B.send({ type: 'play', game: '2048' });
  const s48 = (await call(keyB, 'POST', '/api/games/2048/start', {})).body;
  const gB = new Game2048(mulberry32(s48.seed));
  let mB = '';
  let sentN = 0;
  let syncWanted = false;
  let viewersB = 0;
  B.ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'spectators') {
      viewersB = m.viewers;
      if (m.sync) syncWanted = true;
    }
  });
  const moveB = (n) => {
    for (let i = 0; i < n && !gB.terminated; i++) {
      const dd = [2, 3, 1, 0].find((x) => {
        const t = new Game2048(() => 0.5);
        t.cells = gB.cells.map((c) => [...c]);
        return t.move(x);
      });
      if (dd === undefined) break;
      gB.move(dd);
      mB += dd;
    }
  };
  // 遊ぶ人（ボット）の窓の代わり：見る人がいる間だけ、頼まれたらまとめて・それ以外は増えた分を 0.2 秒ごとに
  const pump = setInterval(() => {
    if (!viewersB) return;
    if (syncWanted) {
      B.send({ type: 'spec-sync', session: s48.session, moves: mB, score: gB.score });
      sentN = mB.length;
      syncWanted = false;
    } else if (mB.length > sentN) {
      B.send({ type: 'spec-moves', session: s48.session, from: sentN, moves: mB.slice(sentN), score: gB.score });
      sentN = mB.length;
    }
  }, 200);
  moveB(40); // 見る人が来る前の手（途中から見る人にはまとめて届く）
  await sleep(800);
  const g48 = JSON.parse((await ev2(`JSON.stringify(__va.game('2048'))`)) ?? 'null');
  if (g48) await click2(g48.x, g48.y);
  check(await wait2(`!!document.querySelector('.chooser-modal')`, 5000), '2048 を遊んでいる人がいる筐体 → ［遊ぶ］［見る］');
  await ev2(`document.querySelector('.chooser-modal .chooser-watch').click()`);
  check(await wait2(`!!document.querySelector('.spectate-modal .spectate-2048-frame iframe')`, 5000), '見る窓に 2048（見るだけの iframe）');
  const board = () =>
    ev2(`(() => { const d = document.querySelector('.spectate-2048-frame iframe')?.contentDocument; if (!d) return null; const b = [0,1,2,3].map(() => [0,0,0,0]); for (const t of d.querySelectorAll('.tile-container .tile')) { const v = Number((t.className.match(/tile-(\\d+)/) || [])[1]); const p = t.className.match(/tile-position-(\\d)-(\\d)/); if (p && v) { const x = +p[1] - 1, y = +p[2] - 1; b[x][y] = Math.max(b[x][y], v); } } return JSON.stringify(b); })()`);
  const want = () => JSON.stringify(gB.cells);
  let same = false;
  for (let i = 0; i < 30 && !same; i++) {
    await sleep(300);
    same = (await board()) === want();
  }
  check(same, '途中から見ても、それまでの手をまとめてなぞって 2048 の盤が一致する', `${await board()} / ${want()}`);
  moveB(25);
  same = false;
  for (let i = 0; i < 30 && !same; i++) {
    await sleep(300);
    same = (await board()) === want();
  }
  check(same, '続きの手を中継して、見る人の盤も一致する（' + mB.length + ' 手）', `${await board()} / ${want()}`);
  const spInfo = await ev2(`document.querySelector('.spectate-info strong')?.textContent ?? ''`);
  check(spInfo.replace(/,/g, '') === String(gB.score), '見る窓の点数 = 遊ぶ人の点数', `${spInfo} / ${gB.score}`);
  await sleep(1200);
  await shot2('game_pc_spectate_2048.png');
  // 遊ぶ人が窓を閉じる（play null）→ 終わりの知らせ
  B.send({ type: 'play', game: null });
  check(await wait2(`/ゲームが終わりました/.test(document.querySelector('.spectate-modal .game-result')?.textContent ?? '')`, 4000), '2048：遊ぶ人が閉じると「〇〇 さんのゲームが終わりました（点数）」', await ev2(`document.querySelector('.spectate-modal .game-result')?.textContent ?? ''`));
  clearInterval(pump);
  await ev2(`document.querySelector('.spectate-modal button[aria-label="閉じる"]')?.click()`);
  void send2;
  c2.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tabId}`).catch(() => {});
}
if (hexFrames) console.log(`観戦の帯域（Hextris）：${hexFrames.n} 枚・${hexFrames.fps.toFixed(2)} 枚/秒・1 枚 平均 ${(hexFrames.avg / 1024).toFixed(1)} KB（最大 ${(hexFrames.max / 1024).toFixed(1)} KB）・見る人 1 人あたり ${hexFrames.kbps.toFixed(1)} KB/秒（${hexFrames.type}）`);

// ================================================================ 観戦：Columns like game（井戸と NEXT を 1 枚にまとめた画像）
let colFrames = null;
if (run('spectate')) {
  const pidA = ((await pt('__va.players()')) ?? []).find((x) => x.name === nameA)?.pid;
  const cg2 = await pt(`__va.game('columns')`);
  await click(cg2.x, cg2.y);
  check(await waitFor(`!!document.querySelector('.game-modal.game-columns') && !!${FDOC}?.querySelector('#play')`, 15000), '観戦：Columns like game の窓を開く');
  await sleep(500);
  await clickIn('#play');
  await waitFor(`__vaGame.session() === true`, 5000);
  const cf = [];
  const onC = (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'spec-frame') cf.push({ at: Date.now(), bytes: Math.floor(((m.image.length - m.image.indexOf(',') - 1) * 3) / 4), info: m.info, image: m.image });
  };
  B.ws.on('message', onC);
  B.send({ type: 'spectate', pid: pidA });
  await ev(`${FRAME}.focus()`);
  for (let i = 0; i < 8; i++) {
    await keyName(i % 2 ? 'ArrowLeft' : 'ArrowRight', i % 2 ? 37 : 39);
    await SPACE();
    await sleep(600);
  }
  B.ws.off('message', onC);
  const span = cf.length > 1 ? (cf[cf.length - 1].at - cf[0].at) / 1000 : 0;
  const avg = cf.length ? cf.reduce((a, f) => a + f.bytes, 0) / cf.length : 0;
  colFrames = { n: cf.length, fps: span ? (cf.length - 1) / span : 0, avg, max: Math.max(0, ...cf.map((f) => f.bytes)) };
  check(cf.length >= 3 && cf.every((f) => f.bytes <= 32 * 1024) && cf.some((f) => f.info?.level !== undefined), 'Columns like game の画像（井戸と NEXT・点数・レベル）が見る人に届く', `${cf.length} 枚・平均 ${(avg / 1024).toFixed(1)} KB・${JSON.stringify(cf[cf.length - 1]?.info)}`);
  if (outDir && cf.length) {
    const last = cf[cf.length - 1].image;
    const ext = last.startsWith('data:image/webp') ? 'webp' : 'jpg';
    fs.writeFileSync(path.join(outDir, `spectate_columns_frame.${ext}`), Buffer.from(last.slice(last.indexOf(',') + 1), 'base64'));
    console.log(`撮った: ${path.join(outDir, `spectate_columns_frame.${ext}`)}`);
  }
  B.send({ type: 'spectate', pid: null });
  await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
  await sleep(1200);
}
if (colFrames) console.log(`観戦の帯域（Columns like game）：${colFrames.n} 枚・${colFrames.fps.toFixed(2)} 枚/秒・1 枚 平均 ${(colFrames.avg / 1024).toFixed(1)} KB（最大 ${(colFrames.max / 1024).toFixed(1)} KB）`);

B.ws.close();

// ---- スマホ（390×844）：タップで開いて、スワイプで遊ぶ
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
// タップ：ヘッドレスの Edge はタッチの返事が遅れることがあり、返事を待ってから指を離すと長押し（0.45 秒）になって
// 指の下の床へ歩いてしまう。返事を待たずに続けて送る
const tapAt = async (x, y) => {
  const a = touch('touchStart', [[x, y]]);
  await sleep(40);
  const b = touch('touchEnd', []);
  await Promise.all([a, b]);
};
if (run('2048')) {
await send('Page.navigate', { url: `${base}/#dev` });
check(await waitFor(`document.documentElement.classList.contains('layout-mobile') && !!window.__va && !!__va.game('2048')`, 10000), 'スマホのレイアウトで入り直す');
await sleep(2500);
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
// ランキングのポスター（左の壁）をタップ → 窓（遠くても歩かない）。画面の外なら指でドラッグして見回す
let mr = await pt(`__va.ranking('2048')`);
const inView = (q) => q && q.x > 30 && q.x < 360 && q.y > 120 && q.y < 640;
for (let i = 0; i < 4 && mr && !inView(mr); i++) {
  const [sx, sy] = [195, 420];
  const [ex, ey] = [sx + Math.max(-300, Math.min(300, 195 - mr.x)), sy + Math.max(-300, Math.min(300, 360 - mr.y))];
  await touch('touchStart', [[sx, sy]]);
  for (let k = 1; k <= 8; k++) {
    await touch('touchMove', [[sx + ((ex - sx) * k) / 8, sy + ((ey - sy) * k) / 8]]);
    await sleep(30);
  }
  await touch('touchEnd', []);
  await sleep(600);
  mr = await pt(`__va.ranking('2048')`);
}
check(inView(mr) && (await pt(`__va.pick(${mr?.x}, ${mr?.y})`))?.kind === 'ranking', 'スマホ：左の壁のポスターが画面に入り、当たり判定はランキング', JSON.stringify(mr));
await shot('game_mobile_ranking_wall.png');
const mBefore = await pt('__va.me()');
if (mr) await tapAt(mr.x, mr.y);
for (let i = 0; i < 2 && mr && !(await waitFor(`!!document.querySelector('.ranking-modal')`, 2500)); i++) await tapAt(mr.x, mr.y);
check(await waitFor(`!!document.querySelector('.ranking-modal')`, 5000) && (await ev(`document.querySelector('.ranking-modal .rank-games .tab.on')?.textContent`)) === '2048', 'スマホ：ポスターをタップでランキングの窓（2048 のタブ）');
const mAfter = await pt('__va.me()');
check(mBefore && mAfter && mBefore.to.x === mAfter.to.x && mBefore.to.y === mAfter.to.y, 'ランキングは歩かずに開く');
await sleep(500);
await shot('game_mobile_ranking.png');
await ev(`document.querySelector('.ranking-modal button[aria-label="閉じる"]')?.click()`);
}

// ---- スマホ：Columns like game（全画面のシートに収まる・元の下のボタンで遊べる）
// 同じ URL（# だけ）への navigate では読み直さないので、読み直す
if (run('columns')) {
await send('Page.navigate', { url: `${base}/#dev` });
await sleep(300);
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
}

// ---- スマホ：Hextris（全画面のシート・画面の左右のタップで回す。スマホの UA にして元のスマホの設定で動かす）
if (run('hextris') || run('mobile')) {
  // ヘッドレスの Edge は長く動かしていると前面でないページのアニメーションを間引くので、前に出しておく
  await send('Page.bringToFront');
  await send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  });
  await send('Page.navigate', { url: `${base}/#dev` });
  await sleep(300);
  await send('Page.reload');
  check(await waitFor(`document.documentElement.classList.contains('layout-mobile') && !!window.__va && !!__va.game('hextris')`, 10000), 'スマホで入り直す（Hextris）');
  await sleep(2500);
  const mh = await pt(`__va.game('hextris')`);
  check(!!mh && mh.x > 0 && mh.x < 390 && mh.y > 0 && mh.y < 844, 'スマホの画面に Hextris の筐体が見える', JSON.stringify(mh));
  for (let i = 0; i < 4 && mh && !(await ev(`!!document.querySelector('.game-modal')`)); i++) {
    await tapAt(mh.x, mh.y);
    await sleep(3000);
  }
  check(
    await waitFor(`!!document.querySelector('.game-modal.game-hextris') && ${FDOC}?.defaultView?.gameState === 0`, 15000),
    'タップで Hextris の窓が開く（全画面のシート）',
    await ev(`JSON.stringify({ pick: __va.pick(${mh?.x}, ${mh?.y}), me: __va.me(), modal: document.querySelector('.modal')?.className ?? null })`),
  );
  const hrect = await pt(`(() => { const r = document.querySelector('.game-modal').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
  check(hrect && hrect.w >= 385 && hrect.h >= 800, 'Hextris の窓は全画面', JSON.stringify(hrect));
  const hfit = await pt(`(() => { const d = ${FDOC}; const w = d.defaultView; const c = d.getElementById('canvas').getBoundingClientRect(); const de = d.documentElement; const f = ${FRAME}.getBoundingClientRect(); return { platform: w.settings.platform, cw: c.width, ch: c.height, iw: de.clientWidth, ih: de.clientHeight, sw: de.scrollWidth, fw: f.width, fh: f.height }; })()`);
  check(hfit && hfit.platform === 'mobile' && Math.abs(hfit.cw - hfit.iw) <= 1 && hfit.sw <= hfit.iw + 1 && hfit.fh > 600, 'iframe の中の Canvas が窓に収まる（スマホの設定・横にはみ出さない）', JSON.stringify(hfit));
  const tapInH = async (sel) => {
    const r = await pt(`(() => { const f = ${FRAME}.getBoundingClientRect(); const e = ${FDOC}.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 }; })()`);
    if (r) await tapAt(r.x, r.y);
    return r;
  };
  for (let i = 0; i < 3 && !(await ev('__vaGame.session()')); i++) {
    await tapInH('#startBtn');
    await sleep(1500);
  }
  check(await waitFor(`__vaGame.session() === true && ${FDOC}?.defaultView?.gameState === 1`, 5000), 'スマホ：Play をタップで始まる');
  await sleep(800);
  const fr = await pt(`(() => { const r = ${FRAME}.getBoundingClientRect(); return { l: r.left, r: r.right, y: r.top + r.height * 0.7 }; })()`);
  const mpos0 = await ev(`${FDOC}.defaultView.MainHex.position`);
  await tapAt(fr.l + 40, fr.y);
  await sleep(300);
  await tapAt(fr.l + 40, fr.y);
  await sleep(300);
  const mpos1 = await ev(`${FDOC}.defaultView.MainHex.position`);
  check(mpos0 !== mpos1, 'スマホ：画面の左をタップで六角形が回る', `${mpos0} → ${mpos1}`);
  await hexClear(2);
  await sleep(1500);
  check((await ev('__vaGame.count()')) >= 1, 'スマホ：消した記録を親が覚えている', `${await ev('__vaGame.count()')}`);
  await shot('game_mobile_hextris.png');
  await ev(`document.querySelector('.game-modal button[aria-label="閉じる"]').click()`);
  await sleep(1500);
  check(/記録しました/.test(await ev(`document.querySelector('.toast')?.textContent ?? ''`)), 'スマホで Hextris を閉じても記録される');
}

console.log(`NG ${ng}`);
cdp.close();
process.exit(ng ? 1 : 0);
