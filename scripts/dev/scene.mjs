// 画面の確認用：API と WebSocket で店内に何人か入れて、筐体に配信を設定し、発言・エモーションを続ける。
//
//   node scripts/dev/scene.mjs start <BASE の URL> <状態ファイル> <管理者の合言葉> [秒]
//     例 node scripts/dev/scene.mjs start http://127.0.0.1:8798/arcade %TEMP%\va_scene.json "合言葉" 900
//     → 状態ファイルに「わたし」（ブラウザで撮る人）の鍵を書く。秒が過ぎるか Ctrl+C まで動き続ける。
//   node scripts/dev/scene.mjs me <BASE の URL> <状態ファイル> <x> <y> [admin]
//     → 「わたし」で一度つないで (x, y) まで歩いてから切る（次にブラウザで開くとそこにいる）。admin を付けると管理者にする。
//
// 配信の URL は Blender Foundation が YouTube に公開している映画（個人の配信を写さないため）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import WebSocket from 'ws';
import { playRandom } from './lib2048.mjs';

const [, , cmd, base, stateFile, ...rest] = process.argv;
if (!cmd || !base || !stateFile) {
  console.error('使い方は scripts/dev/scene.mjs の先頭を見てください');
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

const wsUrl = () => `${base.replace(/^http/, 'ws')}/ws`;

/** 入室して WebSocket でつなぐ */
const join = async (name, look, key = newKey()) => {
  await call(key, 'POST', '/api/enter', { name, look });
  const ws = new WebSocket(wsUrl());
  const bot = { key, name, ws, pid: null, at: null };
  await new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', key, proto: 2 })));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'welcome') {
        bot.pid = m.you.pid;
        resolve();
      }
      if (m.type === 'error' && !bot.pid) reject(new Error(m.error));
      if (m.type === 'error' && bot.pid) console.log(`[${name}] ${m.error}`);
    });
    ws.on('error', reject);
  });
  setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 20000).unref();
  return bot;
};
const send = (bot, m) => bot.ws.send(JSON.stringify(m));
/** 歩いて着くまで待つ（1 マス 0.25 秒＋余裕） */
const walk = async (bot, x, y) => {
  send(bot, { type: 'goto', x, y });
  await sleep(4500);
};

if (cmd === 'me') {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const [x, y, admin] = rest;
  const me = await join('わたし', { color: 'cyan', hat: 'none' }, st.me);
  if (admin === 'admin') await call(me.key, 'POST', '/api/admin/login', { password: st.password });
  await walk(me, Number(x), Number(y));
  me.ws.close();
  await sleep(300);
  console.log(`わたし → (${x}, ${y})${admin === 'admin' ? '（管理者）' : ''}`);
  process.exit(0);
}

if (cmd !== 'start') throw new Error(`知らないコマンド: ${cmd}`);
const [password, seconds = '900'] = rest;

const VIDEOS = {
  bbb: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', // Big Buck Bunny（Blender Foundation）
  sintel: 'https://youtu.be/eRsGyueVLvQ', // Sintel（Blender Foundation）
  tos: 'https://www.youtube.com/live/R6MlUcmOul8', // Tears of Steel（Blender Foundation。/live/ の形の確認用）
};

// 「わたし」（ブラウザで撮る人）。名前だけ決めておく
const meKey = newKey();
await call(meKey, 'POST', '/api/enter', { name: 'わたし', look: { color: 'cyan', hat: 'none' } });
fs.writeFileSync(stateFile, JSON.stringify({ me: meKey, password }, null, 2));

const midori = await join('みどり', { color: 'green', hat: 'cap' });
const aoi = await join('あおい', { color: 'blue', hat: 'headphones' });
const pink = await join('ピンク', { color: 'pink', hat: 'ribbon' });
const taiyo = await join('たいよう', { color: 'orange', hat: 'spiky' });
const boss = await join('てんちょう', { color: 'yellow', hat: 'beanie' });
const purple = await join('むらさき', { color: 'purple', hat: 'none' });

// 筐体を使って配信を設定する
await Promise.all([walk(midori, 4, 5), walk(aoi, 11, 5), walk(pink, 5, 10)]);
await call(midori.key, 'POST', '/api/cabinets/2/claim');
await call(midori.key, 'PATCH', '/api/cabinets/2', {
  url: VIDEOS.bbb,
  eventName: '参加型対戦',
  gameName: 'パズルゲーム',
  playerName: 'みどり',
  note: '初心者さん歓迎！ 1 試合ずつ交代で遊びます。コメントで「参加」と書いてね',
});
await call(aoi.key, 'POST', '/api/cabinets/6/claim');
await call(aoi.key, 'PATCH', '/api/cabinets/6', {
  url: VIDEOS.sintel,
  eventName: '格闘ゲーム 交流大会 予選',
  gameName: '格闘ゲーム',
  playerName: 'あおい',
  note: '21 時から決勝。観戦だけでもどうぞ',
});
await call(pink.key, 'POST', '/api/cabinets/11/claim');
await call(pink.key, 'PATCH', '/api/cabinets/11', {
  url: VIDEOS.tos,
  eventName: 'まったり配信',
  gameName: 'レースゲーム',
  playerName: 'ピンク',
  note: 'タイムアタックの練習中',
});

// 管理者のお知らせ
await call(boss.key, 'POST', '/api/admin/login', { password });
await call(boss.key, 'POST', '/api/admin/notices', { text: '今夜 21:00 から格闘ゲームの交流大会！ No.6 の筐体で配信します' });

// v0.3.0：ポスター（掲示板）とクレーンゲームのバッジ
const H = 60 * 60 * 1000;
const at = (days, hour) => {
  const d = new Date(Date.now() + days * 24 * H);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};
const posters = [
  [boss, { kind: 'tournament', title: '格闘ゲーム 交流大会 決勝', game: '格闘ゲーム', body: '予選を勝ち抜いた 8 人で決勝トーナメント。\nNo.6 の筐体で配信します。観戦だけでもどうぞ！', url: 'https://example.com/tournament', startsAt: at(1, 21), endsAt: at(1, 23) }],
  [aoi, { kind: 'match', title: '参加型 パズル対戦会', game: 'パズルゲーム', body: '初心者さん歓迎。1 試合ずつ交代です', url: '', startsAt: at(2, 20), endsAt: null }],
  [midori, { kind: 'event', title: 'レトロゲーム しりとり大会', game: '', body: 'ゲームの名前でしりとり。チャットで参加できます', url: '', startsAt: at(3, 19), endsAt: null }],
  [pink, { kind: 'other', title: 'レースのタイムアタック 練習会', game: 'レースゲーム', body: '', url: '', startsAt: at(5, 22), endsAt: null }],
];
for (const [who, body] of posters) await call(who.key, 'POST', '/api/posters', body).catch((e) => console.log(e.message));
const pinned = (await call(boss.key, 'GET', '/api/posters')).posters.find((p) => p.title.startsWith('格闘ゲーム'));
if (pinned) await call(boss.key, 'POST', `/api/admin/posters/${pinned.id}/pin`, { pinned: true });

// v0.4.0：コミュニケーションノート（8 件 = 見開き 1 つ分。同じ IP からは 10 分に 10 件まで）と要望箱（管理者だけが読む）
const notes = [
  [taiyo, 'たいよう', 'はじめて来ました！\nにぎやかで楽しいお店ですね'],
  [midori, 'みどり', '参加型対戦、遊んでくれた皆さん\nありがとうございました'],
  [aoi, 'あおい', '大会の予選、No.6 で配信してます。\n観戦だけでも大歓迎です'],
  [pink, 'ピンク', 'レースのタイムアタック、\n自己ベスト更新しました 🏁'],
  [purple, 'むらさき', 'クレーンゲームで ♧ が取れた！'],
  [boss, 'てんちょう', 'ご来店ありがとうございます。\nノートには気軽にひとことどうぞ'],
  [taiyo, 'たいよう', 'また明日も来ます。\nおやすみなさい 🌙'],
  [midori, 'みどり（2 回目）', '週末の対戦会も楽しみにしてます'],
];
for (const [who, name, text] of notes) await call(who.key, 'POST', '/api/notes', { name, text }).catch((e) => console.log(e.message));
const requests = [
  [taiyo, { kind: 'feature', text: 'チャットの文字を大きくできる設定がほしいです', name: 'たいよう' }],
  [pink, { kind: 'bug', text: 'スマホで見たとき、名前が少し重なって読みにくい所がありました', name: null }],
  [aoi, { kind: 'other', text: '大会の日に、壁の大画面に対戦表を出せたらうれしいです', name: 'あおい' }],
];
for (const [who, body] of requests) await call(who.key, 'POST', '/api/requests', body).catch((e) => console.log(e.message));

// SCENE_CRANE=n：何人かがクレーンゲームで n 種類までバッジを取る（確認用のサーバは CRANE_COOLDOWN_SEC=1・CRANE_MAX_CHANCE=100 で起動する）
const craneWant = Number(process.env.SCENE_CRANE ?? 0);
if (craneWant > 0) {
  const playUntil = async (bot, crane, want) => {
    for (let i = 0; i < 40; i++) {
      const st = await call(bot.key, 'GET', `/api/crane/${crane}`);
      const c = st.machine.capsules[i % st.machine.capsules.length];
      const r = await call(bot.key, 'POST', `/api/crane/${crane}/play`, { x: c.x, z: c.z }).catch((e) => ({ badges: '', err: e.message }));
      if (r.badges && [...r.badges].length >= want) return r.badges;
      await sleep(1100);
    }
    return '';
  };
  await Promise.all([walk(taiyo, 20, 1), walk(purple, 21, 1), walk(pink, 19, 1)]);
  const got = await Promise.all([playUntil(taiyo, 1, craneWant), playUntil(purple, 2, Math.max(1, craneWant - 2)), playUntil(pink, 1, Math.max(1, craneWant - 1))]);
  console.log('バッジ', got);
}

// v0.6.0：2048 の記録（ランキングの立て看板に出る）。筐体 (14,4) の近くで遊んだことにする（手の数 × 40 ms より後に記録）
if (process.env.SCENE_GAME !== '0') {
  const play2048 = async (bot, n, pick) => {
    const st = await call(bot.key, 'POST', '/api/games/2048/start', {});
    const p = playRandom(st.seed, n, pick);
    await sleep(p.moves.length * 45 + 300);
    return call(bot.key, 'POST', '/api/games/2048/finish', { session: st.session, moves: p.moves }).catch((e) => console.log(e.message));
  };
  await Promise.all([walk(taiyo, 14, 5), walk(purple, 15, 5), walk(aoi, 13, 5), walk(boss, 16, 5), walk(pink, 14, 6)]);
  const got = await Promise.all([play2048(taiyo, 260, 3), play2048(purple, 180, 5), play2048(aoi, 120, 7), play2048(boss, 90, 9), play2048(pink, 60, 11)]);
  console.log('2048', got.map((r) => r?.score));
  // Columns like game（DESIGN §16.8）：筐体 (14,9) の前で、ピースを列に順に置いた記録（点数はサーバがなぞり直して決める。ピースの数 × 200 ms より後に記録）
  const playColumns = async (bot, n, bonus) => {
    const st = await call(bot.key, 'POST', '/api/games/columns/start', { options: { mode: 0, colors: 5, height: 0, start: 1 + (n % 4) } });
    const moves = Array.from({ length: n }, (_, i) => [(i * 3) % 7, i % 3, bonus, 1 + Math.floor(i / 2)]);
    await sleep(Math.max(n * 220, (n / 2 + 1) * 1000) + 300);
    return call(bot.key, 'POST', '/api/games/columns/finish', { session: st.session, moves }).catch((e) => console.log(e.message));
  };
  await Promise.all([walk(taiyo, 14, 10), walk(pink, 15, 10), walk(aoi, 13, 10)]);
  const gotC = await Promise.all([playColumns(taiyo, 16, 12), playColumns(pink, 12, 8), playColumns(aoi, 9, 4)]);
  console.log('columns', gotC.map((r) => r?.score));
}

// 配置：あおいは筐体の列の奥（筐体の陰）、みどりは No.6 の前に座って視聴、ほかは通路
await Promise.all([walk(aoi, 12, 3), walk(pink, 7, 12), walk(taiyo, 9, 7), walk(boss, 16, 11), walk(purple, 17, 7), walk(midori, 8, 6)]);
send(midori, { type: 'watch', cabinet: 6 });
// v0.6.0：ベガ立ち（てんちょう・むらさき。動くまで腕を組んで頭上に印。発言・エモーションの間はそちらが出る）
send(boss, { type: 'stance', stance: 'vega' });
send(purple, { type: 'stance', stance: 'vega' });

const lines = [
  [taiyo, 'こんばんは！ 今日はにぎやかですね'],
  [pink, 'No.11 でレースの練習してます〜'],
  [boss, 'いらっしゃいませ！ 大画面をクリックすると配信の一覧が出ます'],
  [purple, '大会、何時からでしたっけ？'],
  [aoi, '21 時からです！ 予選は No.6 で配信中'],
  [taiyo, 'あとで観に行きます 👀'],
];
const emotes = [
  [taiyo, '👋'],
  [purple, '😮'],
  [pink, '🎉'],
  [boss, '👍'],
  [taiyo, '😂'],
  [purple, '👏'],
];
let i = 0;
const tick = async () => {
  const [who, text] = lines[i % lines.length];
  await call(who.key, 'POST', '/api/chat', { text }).catch((e) => console.log(e.message));
  const [w2, e2] = emotes[i % emotes.length];
  send(w2, { type: 'emote', emoji: e2 });
  i++;
};
console.log(`準備できました（状態: ${stateFile}）。${seconds} 秒動きます`);
// 最初は全員の吹き出しが出るように少し早めに
for (let k = 0; k < 4; k++) {
  await tick();
  await sleep(1200);
}
const timer = setInterval(tick, 4000); // 同じ IP からの発言は 1 分に 20 回まで
setTimeout(() => {
  clearInterval(timer);
  process.exit(0);
}, Number(seconds) * 1000);
