// v0.6.0：ゲーム筐体と 2048・スコアランキング（DESIGN §16）の API・WebSocket・DB。

import fs from 'node:fs';
import path from 'node:path';
import { countMoves, Game2048, jstMonthStart, mulberry32, type Dir2048 } from '@va/shared';
import { describe, expect, it } from 'vitest';
import win from '../../shared/test/fixtures/win2048.json';
import { Store } from '../src/db';
import { ADMIN_PW, clock, harness, newKey, sleep, tmp } from './harness';

type H = Awaited<ReturnType<typeof harness>>;
type Who = Awaited<ReturnType<H['join']>>;

// 2048 の筐体は (14, 4)（配信用の 8 番 (13, 4) の隣）。前のマスは (14, 5)
const NEAR = { x: 14, y: 5 };

/** その種で、盤が動いた手だけを n 手（終わればそこまで）。r = 手を選ぶ乱数の種 */
const playMoves = (seed: number, n: number, r = 1) => {
  const g = new Game2048(mulberry32(seed));
  const pick = mulberry32(r);
  let moves = '';
  while (!g.terminated && countMoves(moves) < n) {
    const d = Math.floor(pick() * 4) as Dir2048;
    if (g.move(d)) moves += d;
  }
  return { moves, score: g.score, maxTile: g.maxTile };
};

/** 種を決まった並びにする（cfg.rng。点数をテストのたびに同じにする） */
const seeds = (s: number) => ({ rng: mulberry32(s) });

/** 始めて、n 手遊んで（時計を進めて）、記録する */
const game = async (h: H, who: Who, n: number, r = 1) => {
  const st = await h.call('POST', '/api/games/2048/start', {}, who.key);
  expect(st.status).toBe(200);
  const p = playMoves(st.body.seed, n, r);
  clock.t += countMoves(p.moves) * 100;
  const fin = await h.call('POST', '/api/games/2048/finish', { session: st.body.session, moves: p.moves }, who.key);
  return { st, p, fin };
};

describe('ゲーム筐体と 2048（DESIGN §16）', () => {
  it('始める：店内にいて筐体の近く・知らないゲームは 404・種とセッション・ベスト', async () => {
    const h = await harness('g-start');
    const key = newKey();
    await h.call('POST', '/api/enter', { name: 'そら', look: { color: 'red', hat: 'cap' } }, key);
    expect((await h.call('POST', '/api/games/2048/start', {}, key)).body.code).toBe('not-online');
    const a = await h.join('あお');
    expect((await h.call('POST', '/api/games/tetris/start', {}, a.key)).status).toBe(404);
    expect((await h.call('POST', '/api/games/2048/start', {}, a.key)).body.code).toBe('too-far');
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/2048/start', {}, a.key);
    expect(st.status).toBe(200);
    expect(typeof st.body.session).toBe('string');
    expect(st.body.seed).toBeGreaterThanOrEqual(0);
    expect(st.body.seed).toBeLessThan(2 ** 32);
    expect(st.body.best).toBe(0);
    // 斜め 2 マスでも遊べる
    await h.walk(a, 16, 6);
    expect((await h.call('POST', '/api/games/2048/start', {}, a.key)).status).toBe(200);
    await h.walk(a, 17, 7);
    expect((await h.call('POST', '/api/games/2048/start', {}, a.key)).body.code).toBe('too-far');
    await h.stop();
  });

  it('記録：サーバがなぞり直した点数・自己ベスト・順位・ランキング（鍵ごとのベスト・今月）', async () => {
    const h = await harness('g-finish', seeds(11));
    const a = await h.join('あかね');
    const b = await h.join('ばんり');
    await h.walk(a, NEAR.x, NEAR.y);
    await h.walk(b, 15, 5);
    const g1 = await game(h, a, 60);
    expect(g1.fin.status).toBe(200);
    expect(g1.fin.body).toMatchObject({ recorded: true, score: g1.p.score, maxTile: g1.p.maxTile, moves: 60, newBest: true, best: g1.p.score });
    expect(g1.fin.body.rank).toEqual({ all: 1, month: 1 });
    // セッションは 1 回だけ
    expect((await h.call('POST', '/api/games/2048/finish', { session: g1.st.body.session, moves: g1.p.moves }, a.key)).body.code).toBe('no-session');
    // 2 回目は短く（ベストは前のまま）
    const g2 = await game(h, a, 5);
    expect(g2.fin.body).toMatchObject({ recorded: true, newBest: false, best: g1.p.score });
    // 2 人目が長く遊ぶ → 1 位
    const g3 = await game(h, b, 200, 7);
    expect(g3.p.score).toBeGreaterThan(g1.p.score);
    expect(g3.fin.body.rank).toEqual({ all: 1, month: 1 });
    expect(g3.fin.body.score).toBe(g3.p.score);
    // 始めたときのベストはサーバの記録
    expect((await h.call('POST', '/api/games/2048/start', {}, a.key)).body.best).toBe(g1.p.score);

    const all = await h.call('GET', '/api/games/2048/ranking?period=all', undefined, a.key);
    expect(all.status).toBe(200);
    expect(all.body.entries.map((e: { name: string; score: number; rank: number }) => [e.rank, e.name, e.score])).toEqual([
      [1, 'ばんり', g3.p.score],
      [2, 'あかね', g1.p.score],
    ]);
    expect(all.body.me).toMatchObject({ rank: 2, name: 'あかね', score: g1.p.score });
    expect(all.body.total).toBe(2);
    expect(JSON.stringify(all.body)).not.toMatch(/key/i);
    // 鍵なしでも読める（me は null）
    const anon = await h.call('GET', '/api/games/2048/ranking?period=month');
    expect(anon.body).toMatchObject({ period: 'month', me: null, total: 2 });
    expect((await h.call('GET', '/api/games/nope/ranking')).status).toBe(404);
    await h.stop();
  });

  it('今月：先月の記録は今月のランキングに入らない（日本時間の月）・名前は記録したときのもの', async () => {
    const h = await harness('g-month', seeds(12));
    const now = clock.t;
    // 月の初め（日本時間）の 1 時間前に遊んだことにする
    clock.t = jstMonthStart(now) - 60 * 60 * 1000;
    const a = await h.join('せんげつ');
    await h.walk(a, NEAR.x, NEAR.y);
    const old = await game(h, a, 150, 3);
    expect(old.fin.status).toBe(200);
    expect(clock.t).toBeLessThan(jstMonthStart(now));
    clock.t = Math.max(clock.t, now);
    const b = await h.join('こんげつ');
    await h.walk(b, 15, 5);
    const cur = await game(h, b, 20, 5);
    expect(cur.p.score).toBeLessThan(old.p.score);
    expect(cur.fin.body.rank).toEqual({ all: 2, month: 1 });
    const month = await h.call('GET', '/api/games/2048/ranking?period=month', undefined, a.key);
    expect(month.body.entries.map((e: { name: string }) => e.name)).toEqual(['こんげつ']);
    expect(month.body.me).toBeNull();
    // 名前を変えても記録の名前はそのまま
    await h.call('POST', '/api/enter', { name: 'かえたなまえ', look: { color: 'red', hat: 'cap' } }, a.key);
    const all = await h.call('GET', '/api/games/2048/ranking', undefined, a.key);
    expect(all.body.entries[0].name).toBe('せんげつ');
    await h.stop();
  });

  it('不正な手順は断る（でたらめ・動かない手・2048 の前の K・速すぎる・別のセッション・大きすぎる）', async () => {
    const h = await harness('g-bad', seeds(15));
    const a = await h.join('ずる');
    await h.walk(a, NEAR.x, NEAR.y);
    const fin = async (body: unknown) => h.call('POST', '/api/games/2048/finish', body, a.key);
    const start = async () => (await h.call('POST', '/api/games/2048/start', {}, a.key)).body as { session: string; seed: number };

    let st = await start();
    clock.t += 60_000;
    expect((await fin({ session: st.session, moves: '0123x' })).body.code).toBe('bad-moves');
    // 断られたセッションはもう使えない
    expect((await fin({ session: st.session, moves: '' })).body.code).toBe('no-session');

    st = await start();
    clock.t += 60_000;
    expect((await fin({ session: st.session, moves: 'K0' })).body.code).toBe('bad-moves');

    // 動かない手を混ぜる：動いた手のあとに、その盤で動かない向き
    st = await start();
    const p = playMoves(st.seed, 30);
    const g = new Game2048(mulberry32(st.seed));
    for (const ch of p.moves) g.move(Number(ch) as Dir2048);
    const stuck = ([0, 1, 2, 3] as Dir2048[]).find((d) => !new Game2048(() => 0, g.cells).move(d));
    clock.t += 60_000;
    if (stuck !== undefined) expect((await fin({ session: st.session, moves: p.moves + stuck })).body.code).toBe('bad-moves');

    // 速すぎる：200 手を 1 秒で
    st = await start();
    const q = playMoves(st.seed, 200, 9);
    clock.t += 1000;
    const fast = await fin({ session: st.session, moves: q.moves });
    expect(fast.status).toBe(400);
    expect(fast.body.code).toBe('too-fast');
    // 別のセッション（作った覚えのないもの）・形が違う
    st = await start();
    expect((await fin({ session: 'abc', moves: '0' })).body.code).toBe('no-session');
    expect((await fin({ session: st.session, moves: 12 })).body.code).toBe('bad-moves');
    // 手の並びは 256 KB まで受け取る（それより大きければ 413）。ほかの API は 16 KB のまま
    st = await start();
    clock.t += 4 * 3_600_000;
    expect((await fin({ session: st.session, moves: '0'.repeat(150_000) })).body.code).toBe('bad-moves');
    expect((await fin({ session: 'x', moves: '0'.repeat(300_000) })).status).toBe(413);
    expect((await h.call('POST', '/api/chat', { text: 'あ'.repeat(20_000) }, a.key)).status).toBe(413);
    // 手を動かさずに閉じた（点数 0）は記録しない
    st = await start();
    const zero = await fin({ session: st.session, moves: '' });
    expect(zero.body).toMatchObject({ recorded: false, score: 0 });
    expect((await h.call('GET', '/api/games/2048/ranking', undefined, a.key)).body.total).toBe(0);
    await h.stop();
  });

  it('2048 を作って続けた（K）記録も通る・退店のあとでも記録できる', async () => {
    // 種を決める（cfg.rng = 2 / 2^32 → 種 2）
    const h = await harness('g-win', { rng: () => win.seed / 2 ** 32 });
    const a = await h.join('つよい');
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/2048/start', {}, a.key);
    expect(st.body.seed).toBe(win.seed);
    clock.t += countMoves(win.moves) * 50;
    // 退店してから（ページを離れた）記録する
    expect((await h.call('POST', '/api/leave', {}, a.key)).status).toBe(200);
    const fin = await h.call('POST', '/api/games/2048/finish', { session: st.body.session, moves: win.moves }, a.key);
    expect(fin.status).toBe(200);
    expect(fin.body).toMatchObject({ recorded: true, score: win.score, maxTile: 2048 });
    await h.stop();
  });

  it('WebSocket：welcome の rankings・上位が変わると ranking・チャットの案内・play と 🎮・歩くと外れる', async () => {
    const h = await harness('g-ws', seeds(13));
    const a = await h.join('うたう');
    const b = await h.join('みてる');
    expect(a.c.welcome!.rankings).toEqual({ '2048': [] });
    await h.walk(a, NEAR.x, NEAR.y);

    // 窓を開いた → 頭上の 🎮（ほかの人にも）
    a.c.send({ type: 'play', game: '2048' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.playing === '2048');
    a.c.send({ type: 'play', game: 'nope' });
    await a.c.waitFor('error', (m) => m.code === 'not-found');

    const g1 = await game(h, a, 40);
    const r1 = await b.c.waitFor('ranking', (m) => m.game === '2048' && m.top.length === 1);
    expect(r1.top[0]).toMatchObject({ rank: 1, name: 'うたう', score: g1.p.score });
    // 自己ベストで総合 1 位 → チャットに案内
    const chat = await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text.startsWith('🏆'));
    expect(chat.message.text).toMatch(/^🏆 うたう さんが 2048 で [\d,]+ 点！（総合 1 位・今月 1 位）$/);

    // ベストを更新しない記録では、上位も変わらない（ranking は来ない・案内も無い）
    const n = b.c.msgs.length;
    const g2 = await game(h, a, 3);
    expect(g2.fin.body.newBest).toBe(false);
    await sleep(100);
    expect(b.c.msgs.slice(n).some((m) => m.type === 'ranking' || (m.type === 'chat' && m.message.text.startsWith('🏆')))).toBe(false);

    // 歩くと 🎮 が外れる
    a.c.send({ type: 'goto', x: 14, y: 6 });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && !m.player.playing);
    // 新しくつないだ人の welcome にも上位
    const c = await h.connect(b.key);
    expect(c.welcome!.rankings!['2048'][0]).toMatchObject({ name: 'うたう', score: g1.p.score });
    await h.stop();
  });

  it('管理者は記録を 1 行ずつ消せる（その人の次に良い記録が出る）。ほかの人は消せない', async () => {
    const h = await harness('g-admin', seeds(14));
    const a = await h.join('けされる');
    const adm = await h.join('かんり');
    await h.walk(a, NEAR.x, NEAR.y);
    const big = await game(h, a, 120, 2);
    const small = await game(h, a, 10, 4);
    expect(small.p.score).toBeLessThan(big.p.score);
    const list = await h.call('GET', '/api/games/2048/ranking', undefined, a.key);
    const id = list.body.entries[0].id as number;
    expect((await h.call('DELETE', `/api/admin/games/2048/scores/${id}`, undefined, a.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key)).status).toBe(200);
    expect((await h.call('DELETE', `/api/admin/games/nope/scores/${id}`, undefined, adm.key)).status).toBe(404);
    const del = await h.call('DELETE', `/api/admin/games/2048/scores/${id}`, undefined, adm.key);
    expect(del.status).toBe(200);
    await a.c.waitFor('ranking', (m) => m.top[0]?.score === small.p.score);
    const after = await h.call('GET', '/api/games/2048/ranking', undefined, a.key);
    expect(after.body.entries).toHaveLength(1);
    expect(after.body.entries[0].score).toBe(small.p.score);
    expect((await h.call('DELETE', `/api/admin/games/2048/scores/${id}`, undefined, adm.key)).status).toBe(404);
    await h.stop();
  });
});

describe('ゲームの記録の DB（v0.6.0）', () => {
  it('鍵ごとのいちばん良い記録・同点は先に出した人が上・since で月を分ける', () => {
    const file = path.join(tmp, 'g-store.db');
    const s = new Store(file);
    const add = (key: string, name: string, score: number, at: number) =>
      s.addGameScore({ game: '2048', at, keyHash: key, pid: `p-${key}`, name, score, maxTile: 64, moves: 10, ms: 1000 });
    add('a', 'A', 500, 100);
    add('a', 'A2', 900, 200);
    add('b', 'B', 900, 150);
    add('c', 'C', 300, 50);
    add('c', 'C', 300, 40);
    add('d', 'D', 100, 300);
    s.addGameScore({ game: 'other', at: 1, keyHash: 'z', pid: 'z', name: 'Z', score: 99999, maxTile: 2, moves: 1, ms: 1 });
    const all = s.gameBests('2048');
    expect(all.map((r) => [r.name, r.score, r.at])).toEqual([
      ['B', 900, 150],
      ['A2', 900, 200],
      ['C', 300, 40],
      ['D', 100, 300],
    ]);
    expect(s.gameBests('2048', 160).map((r) => r.name)).toEqual(['A2', 'D']);
    expect(s.bestScoreOf('2048', 'a')).toBe(900);
    expect(s.bestScoreOf('2048', 'a', 250)).toBe(0);
    expect(s.bestScoreOf('2048', 'nobody')).toBe(0);
    s.close();
    // 前の版の DB にも足すだけ（もう一度開いても壊れない）
    const s2 = new Store(file);
    expect(s2.countGameScores('2048')).toBe(6);
    s2.close();
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('ベガ立ち（DESIGN §16.7）', () => {
  it('付ける・全員に配られる・もう一度で外す・歩く／座る／ゲーム／部屋を移る／切断で外れる・回数制限', async () => {
    const h = await harness('vega', { emoteMinIntervalMs: 0 });
    const a = await h.join('べが');
    const b = await h.join('みる');
    const stanceOf = (pid: string, want: 'vega' | null) =>
      b.c.waitFor('player', (m) => m.player.pid === pid && (m.player.stance ?? null) === want && b.c.msgs.indexOf(m) >= mark);
    let mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: 'vega' });
    await stanceOf(a.pid, 'vega');
    // 知らないポーズは断る
    a.c.send({ type: 'stance', stance: 'dance' });
    await a.c.waitFor('error', (m) => m.code === 'bad-input');
    // 外す（トグルはクライアントが null を送る）
    mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: null });
    await stanceOf(a.pid, null);

    // 歩くと外れる
    mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: 'vega' });
    await stanceOf(a.pid, 'vega');
    mark = b.c.msgs.length;
    a.c.send({ type: 'goto', x: 8, y: 7 });
    await stanceOf(a.pid, null);
    clock.t += 60_000;

    // 座って視聴すると外れる
    const adm = await h.join('かんり');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key)).status).toBe(200);
    await h.walk(adm, 3, 5);
    expect((await h.call('POST', '/api/cabinets/1/claim', {}, adm.key)).status).toBe(200);
    expect((await h.call('PATCH', '/api/cabinets/1', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, adm.key)).status).toBe(200);
    mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: 'vega' });
    await stanceOf(a.pid, 'vega');
    mark = b.c.msgs.length;
    a.c.send({ type: 'watch', cabinet: 1 });
    await stanceOf(a.pid, null);

    // ゲームを始めると外れる
    mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: 'vega' });
    await stanceOf(a.pid, 'vega');
    mark = b.c.msgs.length;
    a.c.send({ type: 'play', game: '2048' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.playing === '2048' && !m.player.stance && b.c.msgs.indexOf(m) >= mark);
    a.c.send({ type: 'play', game: null });

    // 新しくつないだ人にも見える
    mark = b.c.msgs.length;
    a.c.send({ type: 'stance', stance: 'vega' });
    await stanceOf(a.pid, 'vega');
    const c = await h.connect(adm.key);
    expect(c.welcome!.players.find((p) => p.pid === a.pid)?.stance).toBe('vega');

    // 切断すると外れる（つなぎ直しても付いていない）
    await a.c.close();
    await b.c.waitFor('leave', (m) => m.pid === a.pid);
    const a2 = await h.connect(a.key);
    expect(a2.welcome!.players.find((p) => p.pid === a.pid)?.stance ?? null).toBeNull();
    await h.stop();
  });

  it('部屋を移ると外れる・回数はエモーションと同じ枠', async () => {
    const h = await harness('vega-room');
    const a = await h.join('うつる');
    a.c.send({ type: 'stance', stance: 'vega' });
    await a.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.stance === 'vega');
    // すぐもう一度（0.8 秒たっていない）→ 回数制限
    a.c.send({ type: 'stance', stance: null });
    await a.c.waitFor('error', (m) => m.code === 'rate');
    // 予約部屋へ移る（今の枠で予約して入る）→ 新しい welcome では外れている
    const slot = Math.floor(clock.t / (30 * 60 * 1000)) * 30 * 60 * 1000;
    const r = await h.call('POST', '/api/reservations', { startAt: slot, minutes: 60, title: 'へや', host: 'うつる', description: '', passphrase: 'あいことば1234' }, a.key);
    expect(r.status).toBe(201);
    const n = a.c.msgs.length;
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, a.key)).body.moved).toBe(true);
    const w = await a.c.waitFor('welcome', (m) => m.room === 'reserved' && a.c.msgs.indexOf(m) >= n);
    expect(w.players.find((p) => p.pid === a.pid)?.stance ?? null).toBeNull();
    await h.stop();
  });
});
