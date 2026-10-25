// スマホで店のどこへでも行けるかの確認（v0.4.0。0.3.0 の「スマホだとこれ以上右にいけない？」への対応）。
// Edge ヘッドレス（CDP）・mobile・タッチで、画面に見えている通れるマスのうち行き先にいちばん近いものを指でタップして歩くのを
// くり返し、店の右端（クレーンゲームの前など）まで行けるか・カメラが付いてくるか・ドラッグで店の四隅まで見られるか・
// チャットの欄のタップで店内が動かないかを確かめる。
//   VIEWPORT=390x844 node scripts/dev/reach-check.mjs <url（#dev 付き）> <鍵> [out.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , url, key, out] = process.argv;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9365);
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
const tap = async (x, y) => {
  await touch('touchStart', [[x, y]]);
  await sleep(40);
  await touch('touchEnd', []);
};
const drag = async (x0, y0, x1, y1) => {
  await touch('touchStart', [[x0, y0]]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [[x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(150);
};
const J = (e) => ev(`JSON.stringify(${e})`).then((v) => (v === undefined ? null : JSON.parse(v)));
const me = () => J('__va.me()');
const cam = () => J('__va.cam()');
const rect = await J('__va.canvasRect()');
const inside = (p, pad = 6) => p && p.x > rect.left + pad && p.x < rect.right - pad && p.y > rect.top + pad && p.y < rect.bottom - pad;
console.log(`画面 ${process.env.VIEWPORT ?? '390x844'}・店内の Canvas ${Math.round(rect.right - rect.left)}×${Math.round(rect.bottom - rect.top)}`);

const longPress = async (x, y) => {
  await touch('touchStart', [[x, y]]);
  await sleep(650);
  await touch('touchEnd', []);
};
/** カメラが止まるまで待つ（追従の途中で位置を測ると、タップする時にはずれている） */
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    const m = await me();
    if (Math.hypot(m.x - m.to.x, m.y - m.to.y) < 0.02) break;
    await sleep(150);
  }
  let prev = await cam();
  for (let i = 0; i < 30; i++) {
    await sleep(120);
    const c = await cam();
    if (Math.abs(c.cx - prev.cx) < 0.3 && Math.abs(c.cy - prev.cy) < 0.3) return;
    prev = c;
  }
};
const closeModals = () => ev(`document.querySelectorAll('.modal-back, .m-sheet-back').forEach((b) => b.click())`);
let longPressUsed = 0;

/** 行き先 goal まで、見えているマスをタップしながら歩く（行き先が物の陰で、タップでは筐体が開くときは長押し）。着いたら true */
const walkTo = async (goal) => {
  for (let step = 0; step < 14; step++) {
    await closeModals();
    await settle();
    const m = await me();
    if (m.to.x === goal.x && m.to.y === goal.y && Math.hypot(m.x - goal.x, m.y - goal.y) < 0.05) return true;
    // 行き先が見えていて、タップでは床にならない（物の陰）→ 長押し
    const gp = await J(`__va.tile(${goal.x}, ${goal.y})`);
    if (inside(gp, 8)) {
      const h = await J(`__va.pick(${gp.x}, ${gp.y})`);
      if (!h || h.kind !== 'floor' || h.x !== goal.x || h.y !== goal.y) {
        await longPress(gp.x, gp.y);
        longPressUsed++;
        await sleep(400);
        for (let i = 0; i < 40; i++) {
          const mm = await me();
          if (Math.hypot(mm.x - mm.to.x, mm.y - mm.to.y) < 0.05) break;
          await sleep(250);
        }
        continue;
      }
    }
    // 見えていて、タップすると「その床」になるマスのうち、行き先にいちばん近いもの
    const cand = await ev(`JSON.stringify((() => {
      const out = [];
      for (let y = 0; y < ${16}; y++) for (let x = 0; x < ${22}; x++) {
        if (!__va.passable(x, y)) continue;
        const p = __va.tile(x, y); // マスの真ん中
        if (!p) continue;
        const r = __va.canvasRect();
        if (p.x < r.left + 6 || p.x > r.right - 6 || p.y < r.top + 6 || p.y > r.bottom - 6) continue;
        const h = __va.pick(p.x, p.y);
        if (!h || h.kind !== 'floor' || h.x !== x || h.y !== y) continue;
        out.push({ x, y, px: p.x, py: p.y, d: Math.hypot(x - ${goal.x}, y - ${goal.y}) });
      }
      out.sort((a, b) => a.d - b.d);
      return out[0] ?? null;
    })())`).then((v) => JSON.parse(v));
    if (!cand) return false;
    await tap(cand.px, cand.py);
    // 歩き終わるまで（1 マス 0.25 秒）
    await sleep(600);
    for (let i = 0; i < 40; i++) {
      const mm = await me();
      if (Math.hypot(mm.x - mm.to.x, mm.y - mm.to.y) < 0.05) break;
      await sleep(250);
    }
  }
  const m = await me();
  return m.to.x === goal.x && m.to.y === goal.y;
};

// ---- 店の右端：クレーンゲーム No.2 の前 (21, 1)・要望箱の前・ノートの前・手前の右の角・左の奥
const goals = [
  { x: 21, y: 1, what: '右奥の端（クレーンゲーム No.2 の前）' },
  { x: 21, y: 15, what: '右手前の角' },
  { x: 20, y: 11, what: '要望箱の横' },
  { x: 0, y: 15, what: '左手前の角' },
  { x: 1, y: 11, what: 'ノートの前' },
  { x: 1, y: 1, what: '左奥の角' },
  { x: 19, y: 0, what: '奥の壁ぎわ（自販機とクレーンゲームの間）' },
];
const goals2 = [...goals, { x: 1, y: 1, what: '筐体の列の奥（筐体の陰の床）' }, { x: 12, y: 2, what: '筐体の陰の床 (12,2)' }];
goals.length = 0;
goals.push(...goals2);
for (const g of goals) {
  const ok = await walkTo(g);
  const m = await me();
  const p = await J(`__va.tile(${m.x}, ${m.y})`);
  check(ok, `タップで歩いて行ける：${g.what} (${g.x},${g.y})`, `着いた所 (${m.to.x},${m.to.y})`);
  check(inside(p, 20), '　カメラが付いてくる（自分が画面の中）', `自分の画面の位置 ${Math.round(p.x)},${Math.round(p.y)}`);
  if (g.x === 21 && g.y === 1 && out) {
    await sleep(800);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  }
}

console.log(`（長押しで歩いた回数 ${longPressUsed}）`);

// ---- 長押し：筐体の陰の床（タップでは筐体が開く所）へ歩く
await closeModals();
await walkTo({ x: 8, y: 7 });
await settle();
const hidden = await ev(`JSON.stringify((() => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 22; x++) {
    if (!__va.passable(x, y)) continue;
    const p = __va.tile(x, y);
    const r = __va.canvasRect();
    if (p.x < r.left + 20 || p.x > r.right - 20 || p.y < r.top + 20 || p.y > r.bottom - 20) continue;
    const h = __va.pick(p.x, p.y);
    if (h && h.kind === 'cabinet') return { x, y, px: p.x, py: p.y, cab: h.id };
  }
  return null;
})())`).then(JSON.parse);
if (hidden) {
  await settle();
  console.log('（筐体の陰の床）', JSON.stringify(hidden), 'pick', JSON.stringify(await J(`__va.pick(${hidden.px}, ${hidden.py})`)), 'cam', JSON.stringify(await cam()));
  await tap(hidden.px, hidden.py);
  await sleep(600);
  check(await ev(`!!document.querySelector('.cabinet-modal')`), `筐体の陰の床 (${hidden.x},${hidden.y}) をタップすると筐体 No.${hidden.cab} が開く（今の当たり判定のまま）`);
  await closeModals();
  await sleep(300);
  await longPress(hidden.px, hidden.py);
  await sleep(300);
  const lm = await me();
  check(lm.to.x === hidden.x && lm.to.y === hidden.y && !(await ev(`!!document.querySelector('.cabinet-modal')`)), '同じ所を長押しすると、その床へ歩く（筐体は開かない）', `行き先 (${lm.to.x},${lm.to.y})`);
} else check(false, '筐体の陰の床が見つからない');
await closeModals();

// ---- 遠くのクレーンゲームをタップ → 前まで歩いて窓が開く（店の右端の置いてある物も使える）
await walkTo({ x: 3, y: 12 });
await settle();
const crane = await J('__va.crane(2)');
if (!inside(crane)) {
  // 見えていなければ、見回して画面に入れる
  const mx = (rect.left + rect.right) / 2;
  const my = (rect.top + rect.bottom) / 2;
  for (let i = 0; i < 6; i++) {
    const q = await J('__va.crane(2)');
    if (inside(q, 20)) break;
    const dx = Math.max(-150, Math.min(150, mx - q.x));
    const dy = Math.max(-150, Math.min(150, my - q.y));
    await drag(mx - dx / 2, my - dy / 2, mx + dx / 2, my + dy / 2);
  }
}
const crane2 = await J('__va.crane(2)');
if (inside(crane2, 20)) {
  await tap(crane2.x, crane2.y);
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.crane-modal')`)); i++) await sleep(300);
  check(await ev(`!!document.querySelector('.crane-modal')`), '遠くのクレーンゲームをタップ → 前まで歩いて窓が開く');
  await ev(`document.querySelector('.crane-modal .modal-head button')?.click()`);
  await sleep(400);
} else check(false, '見回してクレーンゲームを画面に入れる');

await closeModals();
await sleep(3500);
// ---- ドラッグの見回しで、店の四隅まで見られる
const corners = [
  { x: 22, y: 0, what: '右の角' },
  { x: 22, y: 16, what: '手前の角' },
  { x: 0, y: 16, what: '左の角' },
  { x: 0, y: 0, what: '奥の角（壁の上）' },
];
const cx = (rect.left + rect.right) / 2;
const cy = (rect.top + rect.bottom) / 2;
for (const c of corners) {
  const z = c.x === 0 && c.y === 0 ? 150 : 0;
  for (let i = 0; i < 6; i++) {
    const p = await J(`__va.tile(${c.x} - 0.5, ${c.y} - 0.5)`); // マスの角（店の角）
    // 奥の角は壁の上（高さ 150）まで
    const pz = z ? { x: p.x, y: p.y - z * (await cam()).s } : p;
    if (inside(pz, 4)) break;
    // 角を画面の真ん中へ寄せる向きにドラッグ（1 回 150px まで）
    const dx = Math.max(-150, Math.min(150, cx - pz.x));
    const dy = Math.max(-150, Math.min(150, cy - pz.y));
    await drag(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2);
  }
  const p = await J(`__va.tile(${c.x} - 0.5, ${c.y} - 0.5)`);
  const pz = z ? { x: p.x, y: p.y - z * (await cam()).s } : p;
  check(inside(pz, 4), `ドラッグで${c.what}まで見られる`, `${Math.round(pz.x)},${Math.round(pz.y)}`);
}
await sleep(3500);

// ---- チャットの欄の上をタップしても、店内は動かない
await settle();
const before = { me: await me(), cam: await cam() };
const dock = await J(`(r => ({ x: r.left + r.width / 2, y: r.top + r.height * 0.6 }))(document.querySelector('.m-dock .chat-list, .m-dock .m-emotes').getBoundingClientRect())`);
await tap(dock.x, dock.y);
await drag(dock.x - 40, dock.y, dock.x + 40, dock.y - 30);
await sleep(600);
const after = { me: await me(), cam: await cam() };
check(
  after.me.to.x === before.me.to.x && after.me.to.y === before.me.to.y && Math.abs(after.cam.cx - before.cam.cx) < 0.5 && !after.cam.free,
  'チャットの欄（エモーションの列・履歴）の上のタップ・ドラッグで、店内は動かない',
);
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
