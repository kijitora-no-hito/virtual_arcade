// PC の上のバー・予約部屋の帯・下のバーが重ならないかの確認（v0.5.1。0.5.0 の予約部屋で、主催者でサイトの管理者の人の上のバーの項目が重なっていた）。
// Edge ヘッドレス（CDP）で、大きさ・倍率（ブラウザの拡大 = deviceScaleFactor と CSS の幅）・役割（ふつうの人・主催者・サイトの管理者・主催者＋管理者）・
// 部屋（オープン・予約）の組み合わせを順に開き、バーの中の項目の四角を取って、
//   - 同じバーの項目どうしが重ならない
//   - 項目がバーの外にはみ出さない（ページの横スクロールもない）
//   - 省略（…）された文字には title がある
//   - 下のバーの「エモーション」が 1 行
// を確かめる。結果は 1 行ずつ「OK / NG 内容」で出し、最後に NG の数で終わる（0 なら成功）。
//
//   node scripts/dev/header-check.mjs <BASE の URL> <状態ファイル> <管理者の合言葉> [撮る先のフォルダ] [ファイル名の頭]
//     例 node scripts/dev/header-check.mjs http://127.0.0.1:8797/arcade %TEMP%\va_hdr.json "合言葉" %TEMP% hdr_
//   状態ファイルが無い（か予約が終わっている）ときは、API で人を 3 人（主催者・ふつうの人・管理者）作り、今の 30 分の枠から 5 時間の予約を入れて書く。
//   サーバは別ポート・一時 DB で起動しておくこと（予約が入る）。撮る先のフォルダを渡すと、決まった組み合わせを PNG に撮る。
//   CASES=quick で大きさを 1920・1366・900 に絞る。COINS=99999 で上のバーにスロットのコイン（🪙）を出した形も見る（v0.7.0。表示だけ）。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [, , base, stateFile, password, outDir, prefix = 'hdr_'] = process.argv;
if (!base || !stateFile || !password) {
  console.error('使い方は scripts/dev/header-check.mjs の先頭を見てください');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newKey = () => crypto.randomBytes(32).toString('base64url');
const call = async (key, method, p, body) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'X-VA-Key': key, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${json?.error ?? ''}`);
  return json;
};

// ---------------------------------------------------------------- 人と予約を用意する
const PASS = 'header-check-pass';
const SLOT = 30 * 60 * 1000;
let st = null;
try {
  st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!(st.endAt > Date.now() + 10 * 60 * 1000)) st = null;
} catch {}
if (!st) {
  // 名前と部屋名は上限の長さ（20 文字・30 文字）にして、いちばん詰まる場合を見る
  st = { host: newKey(), visitor: newKey(), admin: newKey() };
  await call(st.host, 'POST', '/api/enter', { name: '主催者の長い名前ですとても長い名前です名', look: { color: 'pink', hat: 'none' } });
  await call(st.visitor, 'POST', '/api/enter', { name: 'わたし', look: { color: 'cyan', hat: 'none' } });
  await call(st.admin, 'POST', '/api/enter', { name: '管理者の名前', look: { color: 'cyan', hat: 'none' } });
  await call(st.admin, 'POST', '/api/admin/login', { password });
  const startAt = Math.floor(Date.now() / SLOT) * SLOT;
  const r = await call(st.host, 'POST', '/api/reservations', {
    startAt,
    minutes: 300,
    title: '金曜の夜の格闘ゲーム交流会・初心者歓迎・観戦だけでも',
    host: '主催者の長い名前です',
    description: '',
    passphrase: PASS,
  });
  st.endAt = r.reservation.endAt;
  await sleep(5500); // 予約の時間の移り変わりはサーバが 5 秒ごとに見る
  fs.writeFileSync(stateFile, JSON.stringify(st));
}
// 合言葉で入った記録はサーバのメモリだけなので、毎回入り直す（管理者は合言葉なしで入れる）
await call(st.visitor, 'POST', '/api/rooms/reserved/enter', { passphrase: PASS });
await call(st.admin, 'POST', '/api/rooms/reserved/enter', {});

// ---------------------------------------------------------------- Edge
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9367);
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
  try {
    fs.rmSync(profile, { recursive: true, force: true });
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
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
await send('Page.enable');

// ---------------------------------------------------------------- ページの中で測る
const MEASURE = `(() => {
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const label = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
  const groups = {
    topbar: ['.topbar > :not(.topbar-mid):not(.topbar-right)', '.topbar-mid > *', '.topbar-right > *'],
    roombar: ['.roombar > :not(.roombar-gap)'],
    bottombar: ['.bottombar > :not(.emotes)', '.emotes > *'],
  };
  const out = { problems: [], counts: {}, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth, room: window.__va?.room?.() };
  for (const [name, sels] of Object.entries(groups)) {
    const bar = document.querySelector('.' + name);
    if (!bar) { out.counts[name] = -1; continue; }
    const br = bar.getBoundingClientRect();
    const side = document.querySelector('.side')?.getBoundingClientRect();
    if (side && br.right > side.left + 0.5) out.problems.push(name + ' が右の欄（チャット）の下にもぐっている（右端 ' + Math.round(br.right) + ' > ' + Math.round(side.left) + '）');
    const items = sels.flatMap((s) => [...document.querySelectorAll(s)]).filter(vis);
    out.counts[name] = items.length;
    if (bar.scrollWidth > bar.clientWidth + 1) out.problems.push(name + ' があふれている（scrollWidth ' + bar.scrollWidth + ' > ' + bar.clientWidth + '）');
    const rs = items.map((el) => [el, el.getBoundingClientRect()]);
    for (const [el, r] of rs) {
      if (r.left < br.left - 0.5 || r.right > br.right + 0.5 || r.top < br.top - 0.5 || r.bottom > br.bottom + 0.5)
        out.problems.push(name + ': ' + label(el) + ' がバーの外 [' + [r.left, r.top, r.right, r.bottom].map(Math.round) + '] / [' + [br.left, br.top, br.right, br.bottom].map(Math.round) + ']');
    }
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const [a, ra] = rs[i];
        const [b, rb] = rs[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 0.5 && iy > 0.5) out.problems.push(name + ': ' + label(a) + ' と ' + label(b) + ' が重なる（' + Math.round(ix) + '×' + Math.round(iy) + '）');
      }
    // 中の文字が箱からはみ出していない・省略されていたら title がある
    for (const [el] of rs)
      for (const d of [el, ...el.querySelectorAll('*')]) {
        if (!vis(d)) continue;
        const s = getComputedStyle(d);
        const clipped = d.scrollWidth > d.clientWidth + 1;
        if (!clipped || d.tagName === 'INPUT' || d.tagName === 'svg') continue;
        if (s.overflowX === 'visible') { out.problems.push(name + ': ' + label(d) + ' の文字が箱からはみ出す'); continue; }
        if (!d.closest('[title]')) out.problems.push(name + ': ' + label(d) + ' が省略されているのに title が無い');
      }
  }
  const emo = document.querySelector('.emotes > .muted');
  if (emo && vis(emo)) { const lh = parseFloat(getComputedStyle(emo).lineHeight) || 18; if (emo.getBoundingClientRect().height > lh * 1.5) out.problems.push('「エモーション」が 2 行になっている'); }
  if (out.scrollX > 0) out.problems.push('ページが横にスクロールする（' + out.scrollX + 'px）');
  return out;
})()`;

// ---------------------------------------------------------------- 組み合わせ
// [名前, CSS の幅, 高さ, 倍率]。ブラウザの拡大 125% の 1920×1080 は CSS では 1536×864・DPR 1.25
const SIZES =
  process.env.CASES === 'quick'
    ? [['1920', 1920, 1080, 1], ['1366', 1366, 768, 1], ['900', 900, 700, 1]]
    : [
        ['2560', 2560, 1440, 1],
        ['1920', 1920, 1080, 1],
        ['1900', 1900, 1000, 1],
        ['1600', 1600, 900, 1],
        ['1366', 1366, 768, 1],
        ['1280', 1280, 720, 1],
        ['1024', 1024, 768, 1],
        ['1920z125', 1536, 864, 1.25],
        ['1920z150', 1280, 720, 1.5],
        ['1600z125', 1280, 720, 1.25],
        ['1366z125', 1093, 614, 1.25],
        ['1366z150', 911, 512, 1.5],
        ['900', 900, 700, 1],
      ];
const ROLES = { visitor: 'ふつう', host: '主催者', admin: '管理者', hostadmin: '主催者＋管理者' };
// 撮る組み合わせ（大きさ・役割・部屋）
const SHOTS = new Set(['1920/hostadmin/reserved', '1600/hostadmin/reserved', '1366/hostadmin/reserved', '1280/hostadmin/reserved', '1920z125/hostadmin/reserved', '1920/visitor/open', '1024/hostadmin/reserved', '900/hostadmin/reserved', '1920/visitor/reserved']);

// 主催者：主催者＋管理者のときだけ管理者に入り、ただの主催者のときは出る（管理者の合言葉は IP ごとに 10 分 5 回までなので、役割ごとに 1 回だけ）
const keyOf = async (role) => {
  if (role === 'visitor') return st.visitor;
  if (role === 'admin') return st.admin;
  if (role === 'hostadmin') await call(st.host, 'POST', '/api/admin/login', { password });
  else await call(st.host, 'POST', '/api/admin/logout', {});
  return st.host;
};

let ng = 0;
let cases = 0;
const origin = new URL(base).origin;
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: origin + '/__ls' });
await sleep(800);
for (const role of (process.env.ROLES ?? 'host,hostadmin,admin,visitor').split(',')) {
  const key = await keyOf(role);
  for (const room of ['reserved', 'open'])
    for (const [sname, w, h, dpr] of SIZES) {
      cases++;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
      await send('Page.navigate', { url: origin + '/__ls' });
      await sleep(300);
      await ev(`localStorage.clear(); localStorage.setItem('va:key', ${JSON.stringify(JSON.stringify(key))}); sessionStorage.setItem('va:room', ${JSON.stringify(room)})`);
      await send('Page.navigate', { url: `${base}/#dev` });
      let m = null;
      for (let i = 0; i < 30; i++) {
        await sleep(250);
        m = await ev(MEASURE);
        if (m && m.room === room && m.counts.topbar > 0 && (room === 'open' || m.counts.roombar !== 0)) break;
      }
      await sleep(900); // 名前・バッジ・時計が入るのを待つ
      // v0.7.0：COINS=99999 で上のバーの名前の後ろのコイン（🪙）を出して確かめる（表示だけ）
      if (process.env.COINS) {
        await ev(`window.__va?.fakeCoins?.(${Number(process.env.COINS)})`);
        await sleep(300);
      }
      m = await ev(MEASURE);
      const tag = `${sname}(${w}x${h}@${dpr}) ${ROLES[role]} ${room === 'open' ? 'オープン' : '予約'}`;
      const problems = [...(m?.problems ?? [])];
      if (!m || m.room !== room) problems.push(`部屋が ${m?.room} になっている`);
      if (m && m.counts.topbar <= 0) problems.push('上のバーが無い（PC のレイアウトになっていない？）');
      if (m && room === 'reserved' && m.counts.roombar <= 0) problems.push('予約部屋の帯（.roombar）が無い');
      if (m && room === 'open' && m.counts.roombar !== -1) problems.push('オープン部屋に予約部屋の帯がある');
      if (problems.length) {
        ng++;
        console.log(`NG ${tag}`);
        for (const pr of problems) console.log(`   - ${pr}`);
      } else console.log(`OK ${tag}  項目 ${JSON.stringify(m.counts)}`);
      if (outDir && SHOTS.has(`${sname}/${role}/${room}`)) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const f = path.join(outDir, `${prefix}${room}_${role}_${sname}.png`);
        fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
        console.log(`   saved ${f}`);
      }
    }
}
console.log(`${cases} 通り、NG ${ng}`);

const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res) => bws.once('open', res));
bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((res) => p.once('exit', res));
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(ng ? 1 : 0);
