// スマホのレイアウトの指の操作の確認（v0.4.0。DESIGN §11.4）。Edge ヘッドレス（CDP）で 390×844・mobile・タッチの操作を有効にして、
// Input.dispatchTouchEvent でタップ・ドラッグ・ピンチを送り、カメラ（__va.cam()）と自分の行き先（__va.me()）の変化を確かめる。
//   node scripts/dev/touch-check.mjs <url（#dev 付き）> <鍵> [out.png]
// 結果は 1 行ずつ「OK / NG 内容」で出す。最後に NG の数で終わる（0 なら成功）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , url, key, out] = process.argv;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9362);
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
  await sleep(50);
  await touch('touchEnd', []);
};
const cam = () => ev('JSON.stringify(__va.cam())').then(JSON.parse);
const me = () => ev('JSON.stringify(__va.me())').then(JSON.parse);
/** 歩き終わって、カメラが止まるまで待つ（動いている途中に測ると、指を置くときにはずれている） */
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    const m = await me();
    if (Math.hypot(m.x - m.to.x, m.y - m.to.y) < 0.02) break;
    await sleep(150);
  }
  let prev = await cam();
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    const c = await cam();
    if (Math.abs(c.cx - prev.cx) < 0.2 && Math.abs(c.cy - prev.cy) < 0.2 && Math.abs(c.s - prev.s) < 1e-4) return;
    prev = c;
  }
};

check(await ev(`document.documentElement.classList.contains('layout-mobile')`), 'スマホのレイアウトになる（390×844・指の端末）');
check(await ev(`getComputedStyle(document.querySelector('.m-canvas')).touchAction === 'none'`), '店内の Canvas は touch-action: none');
await settle();
const c0 = await cam();
check(!!c0 && c0.s > 0.5 && c0.s < 1.2 && !c0.free, '最初は自分に追従・既定の倍率', JSON.stringify(c0));

// ---- タップで歩く
// 行き先は筐体の陰にならない通路のマス（筐体の奥のマスは、手前の筐体の箱に重なって描かれるので、そこをタップすると筐体が開く）
const m0 = await me();
const tx = 8;
const ty = m0.to.y === 11 ? 12 : 11;
const tp = await ev(`JSON.stringify(__va.tile(${tx}, ${ty}))`).then(JSON.parse);
await tap(tp.x, tp.y);
await sleep(2500);
const m1 = await me();
check(m1.to.x === tx && m1.to.y === ty, 'タップした床のマスへ歩く', `(${tx},${ty}) へ → 行き先 (${m1.to.x},${m1.to.y})`);
const c1 = await cam();
check(Math.abs(c1.cx - c0.cx) + Math.abs(c1.cy - c0.cy) > 20, 'カメラが自分を追う', `${c0.cx.toFixed(0)},${c0.cy.toFixed(0)} → ${c1.cx.toFixed(0)},${c1.cy.toFixed(0)}`);

// ---- ドラッグで見回す（歩かない）。既定の倍率の縦向きは店の高さが画面に収まって縦には動かないので、先に少し拡大する
await touch('touchStart', [
  [150, 400],
  [240, 400],
]);
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [
    [150 - i * 5, 400],
    [240 + i * 5, 400],
  ]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(300);
await settle();
const c1z = await cam();
check(Math.abs(c1z.s - (c1.s * 150) / 90) < 0.005, '2 本指を広げると、指の間の距離の比で拡大', `${c1.s.toFixed(3)} → ${c1z.s.toFixed(3)}（指は 90 → 150 px = ×1.667）`);
const before = await me();
await touch('touchStart', [[200, 420]]);
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [[200 - i * 15, 420 - i * 10]]);
  await sleep(16);
}
const cd = await cam();
await touch('touchEnd', []);
await sleep(200);
const after = await me();
const dcx = cd.cx - c1z.cx;
const dcy = cd.cy - c1z.cy;
check(cd.free === true, 'ドラッグで見回しになる', JSON.stringify({ dcx: dcx.toFixed(1), dcy: dcy.toFixed(1) }));
// 指が (−120, −80) 動いた → 店も同じだけ動く（カメラは (+dx/s, +dy/s)）。タップとの区別の 10px を超えた所（1 歩目 = (−15, −10)）から数えるので (−105, −70)
check(Math.abs(dcx * cd.s - 105) < 3 && Math.abs(dcy * cd.s - 70) < 3, 'ドラッグの分だけ店が動く', `画面で ${(dcx * cd.s).toFixed(1)}, ${(dcy * cd.s).toFixed(1)} px（指は 105, 70 px）`);
check(after.to.x === before.to.x && after.to.y === before.to.y, 'ドラッグでは歩かない（タップと区別）');
check(await ev(`!!document.querySelector('.m-backme')`), '見回し中は［自分の所へ］が出る');
await sleep(3600);
const cr = await cam();
check(cr.free === false, '指を離して 3 秒で自分の所へ戻る', JSON.stringify(cr));

// ---- 少しだけ動いたタップ（8px）はタップ
const m2 = await me();
const tx2 = Math.round(m2.to.x) - 1;
const ty2 = Math.round(m2.to.y) + 1;
const tp2 = await ev(`JSON.stringify(__va.tile(${tx2}, ${ty2}))`).then(JSON.parse);
await touch('touchStart', [[tp2.x, tp2.y]]);
await touch('touchMove', [[tp2.x + 6, tp2.y + 5]]);
await touch('touchEnd', []);
await sleep(2200);
const m3 = await me();
check(m3.to.x === tx2 && m3.to.y === ty2, '少し指が動いたタップ（8px）でも歩く', `行き先 (${m3.to.x},${m3.to.y})`);

// ---- ピンチで拡大・縮小
const p0 = await cam();
await touch('touchStart', [
  [150, 400],
  [240, 400],
]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [
    [150 - i * 5, 400],
    [240 + i * 5, 400],
  ]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(300);
const p1 = await cam();
const want = Math.min(p0.max, (p0.s * 190) / 90);
check(Math.abs(p1.s - want) < 0.01, '2 本指を広げると拡大（指の間の距離の比。上限まで）', `${p0.s.toFixed(3)} → ${p1.s.toFixed(3)}（指は 90 → 190 px、期待 ${want.toFixed(3)}・上限 ${p0.max.toFixed(3)}）`);
const m4 = await me();
check(m4.to.x === m3.to.x && m4.to.y === m3.to.y, 'ピンチでは歩かない');
await touch('touchStart', [
  [100, 400],
  [290, 400],
]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [
    [100 + i * 8, 400],
    [290 - i * 8, 400],
  ]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(400);
const p2 = await cam();
check(p2.s < p1.s * 0.6, '2 本指を狭めると縮小', `${p1.s.toFixed(3)} → ${p2.s.toFixed(3)}`);
// 縮小しすぎない（店全体が入る倍率まで）
await touch('touchStart', [
  [20, 400],
  [370, 400],
]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [
    [20 + i * 17, 400],
    [370 - i * 17, 400],
  ]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(300);
const p3 = await cam();
check(Math.abs(p3.s - p3.min) < 1e-6, 'いちばん縮小しても店全体が入る倍率まで', `${p3.s.toFixed(3)}（下限 ${p3.min.toFixed(3)}）`);
await sleep(3600);

// ---- タップで筐体を開く（当たり判定はそのまま）
await settle();
const cab = await ev('JSON.stringify(__va.cab(6))').then(JSON.parse);
await tap(cab.x, cab.y);
await sleep(700);
check(await ev(`!!document.querySelector('.cabinet-modal')`), 'タップで筐体の窓が開く');
if (out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
}
await ev(`document.querySelector('.cabinet-modal .modal-head button').click()`);
await sleep(300);
check(await ev(`!document.querySelector('.cabinet-modal')`), '✕ で閉じる');

// ---- ダブルタップ・ページのピンチでページが拡大しない
const vv = await ev('visualViewport.scale');
check(vv === 1, 'ページは拡大されていない（visualViewport.scale = 1）', String(vv));

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
