// Hextris を自動で遊ばせて点数の目安を見る（v0.7.0。ゲームでもらえるコインの sMin・sMax の根拠。DESIGN §17.9）。
//   node scripts/dev/hextris-sim.mjs [1 つの戦略のゲームの数（既定 6）] [速さ（既定 3。ゲームの時計を何倍で進めるか）]
// 同梱した元の Hextris（client/public/games/hextris/）をこのスクリプトの中の小さな静的サーバで出し、Edge ヘッドレス（--mute-audio）で窓の外として開く
// （親がいないので自分で種を決めて始める）。ゲームの時計は元の main.js の spd で速める（点数はゲームの時計で決まるので、速めても同じ遊び方なら同じ点）。
// 戦略：random = ゲームの時計の 0.3 秒ごとにでたらめに回す（-1・0・+1）・simple = いちばん近い落ちてくるブロックを、上が同じ色の面（無ければいちばん低い面）へ回す
//   （反応が速すぎて人より上手）・miss40 = simple だが 0.3 秒ごとの判断の 40% をでたらめにする（ふつうの人の代わり）。
// STYLES=random,simple,miss40 で選べる（既定は全部）。
// 結果は 1 ゲームずつ点数・ゲームの秒数、最後に戦略ごとの中央値。Edge は終わり・失敗・Ctrl+C で必ず閉じる。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const games = Number(process.argv[2] ?? 6);
const speed = Number(process.argv[3] ?? 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public/games/hextris');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9371);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'va-edge-'));
const p = spawn(edge, ['--headless=new', '--mute-audio', '--disable-extensions', '--window-size=900,900', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list = null;
for (let i = 0; i < 60 && !list; i++) {
  await sleep(250);
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {}
}
// 拡張機能の歓迎のページが開くことがあるので about:blank のページを使う
const target = list.find((t) => t.type === 'page' && t.url === 'about:blank') ?? list.find((t) => t.type === 'page');
const cdp = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => cdp.once('open', r));
let n = 0;
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++n;
    const on = (d) => {
      const m = JSON.parse(String(d));
      if (m.id === id) {
        cdp.off('message', on);
        res(m.result);
      }
    };
    cdp.on('message', on);
    cdp.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

// ページの中で動かす自動の遊び手（ゲームの時計 MainHex.ct で 0.3 秒 = 18 刻みごとに 1 回考える）
const BOT = (style) => `(() => {
  window.spd = ${speed};
  window.onblur = null; // ヘッドレスではフォーカスが外れて一時停止するため
  window.__bot = { last: -1 };
  clearInterval(window.__botTimer);
  window.__botTimer = setInterval(() => {
    if (gameState !== 1 || !window.MainHex) return;
    if (MainHex.ct - __bot.last < 18 / 1) return;
    __bot.last = MainHex.ct;
    MainHex.lastRotate = 0; // 元の 75 ms の間隔の守り（実際の時計）は速めた分だけ人より厳しくなるので外す
    if (${JSON.stringify(style)} === 'random' || (${JSON.stringify(style)} === 'miss40' && Math.random() < 0.4)) {
      const r = Math.floor(Math.random() * 3) - 1;
      if (r) MainHex.rotate(r);
      return;
    }
    // simple：いちばん近い落ちてくるブロック
    const falling = blocks.filter((b) => !b.settled && !b.initializing).sort((a, b) => a.distFromHex - b.distFromHex);
    const b = falling[0];
    if (!b) return;
    const lane0 = (6 - b.fallingLane + MainHex.position + 6) % 6;
    let best = 0, bv = -1e9;
    for (const r of [0, 1, -1, 2, -2, 3]) {
      const lane = (lane0 + r + 12) % 6;
      const st = MainHex.blocks[lane];
      const top = st[st.length - 1];
      const top2 = st[st.length - 2];
      let v = -st.length;
      if (top && top.color === b.color) v += 20 + (top2 && top2.color === b.color ? 10 : 0);
      v -= Math.abs(r) * 0.1;
      if (v > bv) { bv = v; best = r; }
    }
    if (best) MainHex.rotate(best);
  }, 15);
})()`;

const styles = (process.env.STYLES ?? 'random,simple,miss40').split(',');
const results = Object.fromEntries(styles.map((k) => [k, []]));
await send('Page.enable');
await send('Page.navigate', { url });
for (let t = 0; t < 40 && !(await ev(`typeof VAHextris !== 'undefined' && typeof MainHex !== 'undefined' && gameState === 0`)); t++) await sleep(250);
for (const style of styles)
  for (let i = 0; i < games; i++) {
    await send('Page.bringToFront');
    await ev(`window.onblur = null; VAHextris.requestPlay()`);
    for (let t = 0; t < 40 && (await ev(`gameState`)) !== 1; t++) await sleep(100);
    await ev(BOT(style));
    const t0 = Date.now();
    while ((await ev(`gameState`)) === 1 && Date.now() - t0 < 15 * 60_000) await sleep(500);
    const r = JSON.parse(await ev(`JSON.stringify({ score, ct: MainHex.ct, state: gameState })`));
    await ev(`clearInterval(window.__botTimer)`);
    results[style].push(r.score);
    console.log(`${style} ${i + 1}：${r.score} 点・ゲームの時間 ${(r.ct / 60).toFixed(0)} 秒（実際 ${((Date.now() - t0) / 1000).toFixed(0)} 秒・状態 ${r.state}）`);
    await sleep(800);
  }
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
for (const [k, xs] of Object.entries(results)) console.log(`${k}：中央値 ${med(xs)}・最小 ${Math.min(...xs)}・最大 ${Math.max(...xs)}（${xs.join(', ')}）`);
server.close();
process.exit(0);
