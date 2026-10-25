// 店内の BGM の確認（耳で聞けないので数字で）。Edge ヘッドレス（CDP）で店内を開き、次を順に確かめる:
//   1. 開いた直後は鳴っていない（自動再生の制限。下のバーは「🔇 クリックで BGM」）
//   2. 床をクリック（= 利用者の操作）すると AudioContext が動き出し、1 曲目が鳴る
//   3. ［次の曲］で全曲を順に切り替えられる（ファイルの曲は位置が進む・合成の曲は予約が進む）。バッファは今と次の曲の分だけ
//   4. 順番に回す曲は本体を 2 周したら次の曲へ
//   5. ファイルの曲の継ぎ目（イントロ → 本体・本体 → 本体）を OfflineAudioContext で書き出して、すき間・段差が無いか
//   6. 視聴画面：開いただけでは止めない・再生が始まったらフェードアウト・一時停止では戻さない・店内に戻るとフェードイン・
//      状態が来なければ予備で止める・小さな配信の URL は変わらない
//   7. 消音・音量が localStorage の va:bgm に残る・チャイムで例外が出ない
//   8. 合成の曲を 2 ループ書き出し、音の大きさ・無音の切れ目・継ぎ目の前後を数字で見る（環境変数 WAV_DIR があれば WAV も書く）
//   9. 曲の一覧を開いて撮る（全体 <out>.png・下のバーだけ <out>_bar.png・鳴らす前の下のバー <out>_locked.png）
//
//   node scripts/dev/bgm-check.mjs <BASE の URL> <状態ファイル（scene.mjs の）> <out.png>
//   REAL_EMBED=1 を付けると、本物の YouTube の埋め込みの状態（再生が始まった）で BGM が止まる・戻るかだけを確かめる（上の 6 は偽の状態で確かめる）
//   例 node scripts/dev/bgm-check.mjs http://127.0.0.1:8799/arcade %TEMP%\va_scene.json shot.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , base, stateFile, out] = process.argv;
const REAL = process.env.REAL_EMBED === '1';
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9362);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'va-edge-'));
const p = spawn(
  edge,
  [
    '--headless=new', '--mute-audio',
    '--window-size=1920,1080',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    // 偽の状態で確かめるときは、視聴画面の埋め込み（youtube-nocookie.com）を読み込めなくする（本物の状態が混ざらないように）。
    // REAL_EMBED=1 のときは止めずに、本物の埋め込みからの状態で BGM が止まるかだけを確かめる
    ...(REAL ? [] : ['--host-resolver-rules=MAP www.youtube-nocookie.com 127.0.0.1:9']),
    'about:blank',
  ],
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
const pageErrors = [];
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
    pageErrors.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
});
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
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
// 鍵を入れてから開く（再読み込みで自動入店した場合と同じ）
await send('Page.navigate', { url: new URL(base).origin + '/__ls' });
await sleep(1000);
await ev(`localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(state.me))}); localStorage.removeItem('va:bgm'); sessionStorage.setItem('va:room', 'open')`);
await send('Page.navigate', { url: `${base}/#dev` });
await sleep(4000);

const s0 = await ev('__va.bgm()');
check('1. 開いた直後は鳴らない（クリックで BGM）', !s0.unlocked && !s0.playing && (await ev(`!!document.querySelector('.bgm-unlock')`)), { unlocked: s0.unlocked, ctx: s0.ctxState });

const barClip = async () => {
  const b = await ev(`(b => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(document.querySelector('.bottombar'))`);
  return { x: b[0], y: b[1] - 40, width: b[2], height: b[3] + 40, scale: 1 };
};
fs.writeFileSync(
  out.replace(/\.png$/, '_locked.png'),
  Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: await barClip() })).data, 'base64'),
);

const center = (sel) => ev(`(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })(document.querySelector(${JSON.stringify(sel)}))`);
const waitFor = async (expr, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await ev(expr)) return true;
    await sleep(200);
  }
  return false;
};

// 床（筐体の無いところ）をクリック = 利用者の操作
const floor = await ev('(p => [p.x, p.y])(__va.tile(3, 12))');
await click(floor[0], floor[1]);
await waitFor('__va.bgm().playing');
await sleep(1500);
const s1 = await ev('__va.bgm()');
check('2. クリックで鳴り始める（1 曲目はサーバの曲の先頭）', s1.unlocked && s1.playing && s1.ctxState === 'running', { item: s1.item, filePos: s1.filePos, parts: s1.fileParts });

if (REAL) {
  // 本物の埋め込み：状態が届き、再生が始まったら BGM がフェードアウトして止まる・店内に戻ると戻る
  await ev('__va.watch(2)');
  const got = await waitFor('__va.duck().gotState', 15000);
  const duckedReal = await waitFor('__va.duck().ducked', 15000);
  await sleep(2200);
  const r = await ev('__va.bgm()');
  check('R. 本物の埋め込みから状態が届く', got, await ev('__va.duck()'));
  check('R. 本物の埋め込みの再生が始まったら BGM が止まる', duckedReal && !r.playing, { playing: r.playing, fadingGain: r.fadingGain });
  await ev('__va.stopWatch()');
  await sleep(2000);
  check('R. 店内に戻ると BGM が戻る', (await ev('__va.bgm()')).playing);
  // 撮る（小さな配信も本物が映る）：下のバーと、曲の一覧を開いた全体
  await ev('__va.bgmApi.setVolume(25)');
  await sleep(800);
  fs.writeFileSync(out.replace(/\.png$/, '_bar.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: await barClip() })).data, 'base64'));
  const info = await center('.bgm-info');
  await click(info[0], info[1]);
  await sleep(600);
  fs.writeFileSync(out, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('saved', out);
} else {
// 全曲を順に（［次の曲］のボタン）
const seen = [];
const items = await ev(
  '__va.bgmApi.getState().items.map(i => ({ key: i.key, kind: i.kind, title: i.title, credit: i.credit, intro: i.intro ?? null, body: i.body ?? null, introSec: i.introSec ?? null, bodySec: i.bodySec ?? null, gain: i.gain, rotate: i.rotate }))',
);
for (let i = 0; i < items.length; i++) {
  await waitFor('__va.bgm().playing');
  const a = await ev('__va.bgm()');
  await sleep(1500);
  const b = await ev('__va.bgm()');
  const synth = b.item.key.startsWith('synth:');
  const ok = b.playing && (synth ? b.scheduled > a.scheduled : b.filePos > a.filePos) && b.errors.length === 0;
  check(`3. 曲 ${i + 1}/${items.length}「${b.item.title}」（${b.item.credit}）が鳴る`, ok, synth ? { scheduled: b.scheduled } : { pos: b.filePos, parts: b.fileParts });
  seen.push(b.item.key);
  if (!synth) check('3.   持っているバッファは今の曲と次の曲の分だけ', b.buffers.length <= 4, b.buffers);
  const r = await center('.bgm-next');
  await click(r[0], r[1]);
  await sleep(300);
}
check('3. 曲を切り替えられる（一覧を一巡して先頭に戻る）', new Set(seen).size === items.length && (await ev('__va.bgm()')).item.key === seen[0], seen);

// 順番に回す：本体 2 周の終わりの少し前から鳴らすと、次の曲へ進む
await waitFor('__va.bgm().playing');
const r0 = await ev('__va.bgm()');
if (r0.fileParts) {
  const end = r0.fileParts.intro + r0.fileParts.body * 2;
  await ev(`__va.bgmApi.seek(${end - 2.5})`);
  await sleep(1000);
  const mid = await ev('__va.bgm()');
  await sleep(4000);
  await waitFor('__va.bgm().playing');
  const r1 = await ev('__va.bgm()');
  check('4. 順番に回す曲は本体を 2 周したら次の曲へ', mid.item.key === r0.item.key && r1.item.key !== r0.item.key && r1.item.key.startsWith('file:'), {
    before: r0.item.title,
    posBefore: mid.filePos,
    after: r1.item.title,
  });
}

// 継ぎ目（ブラウザで鳴らすのと同じ部品で書き出して）
for (const it of items.filter((x) => x.kind === 'file')) {
  const r = await ev(`__va.bgmSeams(${JSON.stringify(it.intro)}, ${JSON.stringify(it.body)}, ${it.introSec}, ${it.bodySec})`);
  // すき間：継ぎ目の前後 10 ms ごとの大きさが落ち込まない。段差：継ぎ目の差が、ふつうの差（99%）かまわり ±50 ms の差の最大を超えない
  const okSeam = (x) => !x || ((x.around === null || x.minWin10ms > x.around * 0.2) && x.jump <= Math.max(r.typicalDiff * 1.5 + 0.02, x.localMax * 1.1));
  check(`5. 継ぎ目「${it.title}」：イントロ → 本体・本体 → 本体にすき間・段差なし`, okSeam(r.introToBody) && okSeam(r.bodyLoop), r);
}

// 視聴画面：開いただけでは止めない → 再生が始まったらフェードアウト → 一時停止では戻さない → 店内に戻るとフェードイン
await ev(`__va.bgmApi.select(${items.findIndex((x) => x.kind === 'file')})`);
await waitFor('__va.bgm().playing');
await sleep(800);
const live = 2; // scene.mjs が配信を設定する筐体
await ev(`__va.watch(${live})`);
await sleep(1000);
const w0 = await ev('__va.bgm()');
check('6. 視聴画面を開いただけでは止めない', (await ev(`!!document.querySelector('.watch')`)) && w0.playing && !w0.ducked, { playing: w0.playing });
const src = await ev(`document.querySelector('.watch iframe')?.src`);
check('6. 大きな埋め込みに enablejsapi と origin', /enablejsapi=1/.test(src) && src.includes(`origin=${encodeURIComponent(new URL(base).origin)}`), src);
const mini = await ev(`document.querySelector('.mini-embed iframe')?.src ?? null`);
check('6. 小さな配信の URL は今までどおり（音なし・jsapi なし）', mini === null || (/mute=1/.test(mini) && !/enablejsapi/.test(mini)), mini);
await ev('__va.playerState(1)');
await sleep(900);
const w1 = await ev('__va.bgm()');
await sleep(1300);
const w2 = await ev('__va.bgm()');
const gainOf = (k) => items.find((x) => x.key === k).gain;
check('6. 再生が始まったら 1.8 秒でフェードアウトして止める', w1.ducked && w1.fadingGain > 0.05 && w1.fadingGain < 0.9 * gainOf(w1.item.key) && w2.fadingGain < 0.001 && !w2.playing, {
  midFadeGain: w1.fadingGain,
  endGain: w2.fadingGain,
  gain: gainOf(w1.item.key),
  playingAfter: w2.playing,
});
await ev('__va.playerState(2)');
await ev('__va.playerState(0)');
await sleep(600);
check('6. 一時停止・終了では戻さない', !(await ev('__va.bgm()')).playing);
await ev('__va.stopWatch()');
await sleep(700);
const w3 = await ev('__va.bgm()');
await sleep(1500);
const w4 = await ev('__va.bgm()');
const g = gainOf(w4.item.key);
check('6. 店内に戻ると 1.5 秒でフェードインして続きから', w3.playing && w3.runGain < g * 0.8 && Math.abs(w4.runGain - g) < 0.01 && w4.filePos > w0.filePos, {
  midFadeGain: w3.runGain,
  gain: w4.runGain,
  posBefore: w0.filePos,
  posAfter: w4.filePos,
});
// 状態が届かないとき（予備）：埋め込みを読み込めないので状態は来ない
await ev(`__va.watch(${live})`);
await sleep(3500);
const f1 = { ...(await ev('__va.bgm()')), duck: await ev('__va.duck()') };
await sleep(4500);
const f2 = { ...(await ev('__va.bgm()')), gotState: (await ev('__va.duck()')).gotState };
check('6. 状態が届かなければ数秒で止める（予備）', !f1.ducked && f2.ducked && !f2.playing && !f2.gotState, { at3s: f1.ducked, at8s: f2.ducked, duck3s: f1.duck });
await ev('__va.stopWatch()');
// 消音・音量・チャイム
const muteBtn = await center('.bgm-mute');
await click(muteBtn[0], muteBtn[1]);
await sleep(500);
const m1 = await ev('__va.bgm()');
const saved1 = await ev(`JSON.parse(localStorage.getItem('va:bgm'))`);
check('7. 消音で止まり、設定が残る', m1.muted && !m1.playing && saved1.muted === true, saved1);
await click(muteBtn[0], muteBtn[1]);
await ev('__va.bgmApi.setVolume(40)');
await waitFor('__va.bgm().playing');
const m2 = await ev('__va.bgm()');
const saved2 = await ev(`JSON.parse(localStorage.getItem('va:bgm'))`);
check('7. 消音を戻すと鳴り、音量が残る', !m2.muted && m2.playing && saved2.volume === 40, saved2);
await ev('__va.bgmApi.chime()');
await sleep(300);
check('7. チャイムで例外が出ない', (await ev('__va.bgm()')).errors.length === 0);

// 合成の曲を書き出して数字で見る（WAV_DIR があれば WAV も書く = tools/bgm/loudness.py --ref で測る）
for (const k of items.filter((x) => x.kind === 'synth').map((x) => x.key.slice(6))) {
  const r = await ev(`__va.bgmRender(${JSON.stringify(k)}, 2)`);
  const ok = r.nan === 0 && r.rms > 0.01 && r.peak < 1 && r.minWindow > 0.003 && r.seamBefore > 0.003 && r.seamAfter > 0.003;
  check(`8. 合成の曲の書き出し「${k}」：鳴っている・途切れない・割れない`, ok, r);
  if (process.env.WAV_DIR) fs.writeFileSync(path.join(process.env.WAV_DIR, `synth-${k}.wav`), Buffer.from(await ev(`__va.bgmWav(${JSON.stringify(k)})`), 'base64'));
}

// 撮る（音量を既定に戻し、サーバの曲の先頭で）
await ev('__va.bgmApi.setVolume(25)');
await ev('__va.bgmApi.select(0)');
await waitFor('__va.bgm().playing');
await sleep(800);
fs.writeFileSync(out.replace(/\.png$/, '_bar.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: await barClip() })).data, 'base64'));
// 曲の一覧を開いて
const info = await center('.bgm-info');
await click(info[0], info[1]);
await sleep(500);
check('9. 曲の一覧が開く', await ev(`document.querySelectorAll('.bgm-row').length === ${items.length}`));
fs.writeFileSync(out, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
console.log('saved', out);
}

const errs = (await ev('__va.bgm()')).errors;
check('例外なし（BGM）', errs.length === 0, errs);
const pe = pageErrors.filter((e) => !/youtube|ytimg|doubleclick|googlevideo|Permissions-Policy|compute-pressure/i.test(String(e)));
check('ページの例外・警告なし（YouTube の埋め込み由来を除く）', pe.length === 0, pe.slice(0, 5));

const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res) => bws.once('open', res));
bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((res) => p.once('exit', res));
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}
const ng = results.filter((r) => !r.ok).length;
console.log(ng ? `NG ${ng} 件` : `すべて OK（${results.length} 件）`);
process.exit(ng ? 1 : 0);
