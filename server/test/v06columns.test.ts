// v0.6.0：Columns like game（DESIGN §16.8）の API・WebSocket・DB。置いた記録をサーバがなぞり直して点数を決める。

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ColumnsGame, mulberry32 } from '@va/shared';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { ADMIN_PW, clock, harness, sleep, tmp } from './harness';

type H = Awaited<ReturnType<typeof harness>>;
type Who = Awaited<ReturnType<H['join']>>;

// Columns like game の筐体は (14, 9)（配信用の 16 番 (13, 9) の隣）。前のマスは (14, 10)
const NEAR = { x: 14, y: 10 };
const RANKED = { mode: 0, colors: 5, height: 0, start: 1 };

const seeds = (s: number) => ({ rng: mulberry32(s) });

/** その種でピースを n 個置いた記録（いちばん低い列へ。r = 置き方の乱数の種） */
const playPieces = (seed: number, start: number, n: number, r = 1) => {
  const g = new ColumnsGame(mulberry32(seed), start);
  const pick = mulberry32(r);
  const moves: number[][] = [];
  let t = 1;
  for (let i = 0; i < n; i++) {
    const tops = [0, 1, 2, 3, 4, 5, 6].map((c) => g.findBottom(c));
    const x = pick() < 0.7 ? tops.indexOf(Math.max(...tops)) : Math.floor(pick() * 7);
    const bonus = Math.floor(pick() * (g.bonusLimit(x) + 1));
    const m = [x, Math.floor(pick() * 3), bonus, t];
    if (g.place({ x: m[0], rot: m[1], bonus: m[2], t: m[3] })) throw new Error('bad');
    moves.push(m);
    if (i % 2) t++;
  }
  return { moves, score: g.score, level: g.level, jewels: g.jewels };
};

/** 始めて、n 個置いて（時計を進めて）、記録する */
const game = async (h: H, who: Who, n: number, opts: Record<string, number> = RANKED, r = 1) => {
  const st = await h.call('POST', '/api/games/columns/start', { options: opts }, who.key);
  expect(st.status).toBe(200);
  const p = playPieces(st.body.seed, opts.start ?? 1, n, r);
  clock.t += n * 600;
  const fin = await h.call('POST', '/api/games/columns/finish', { session: st.body.session, moves: p.moves }, who.key);
  return { st, p, fin };
};

describe('Columns like game（DESIGN §16.8）', () => {
  it('始める：筐体の近く・設定（ランキングに載る設定・練習）・おかしな設定は断る', async () => {
    const h = await harness('c-start');
    const a = await h.join('あお');
    expect((await h.call('POST', '/api/games/columns/start', { options: RANKED }, a.key)).body.code).toBe('too-far');
    // 2048 の筐体の前では Columns は始められない
    await h.walk(a, 14, 5);
    expect((await h.call('POST', '/api/games/columns/start', { options: RANKED }, a.key)).body.code).toBe('too-far');
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/columns/start', { options: { ...RANKED, start: 7 } }, a.key);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ best: 0, options: { mode: 0, colors: 5, height: 0, start: 7 } });
    expect(st.body.practice).toBeUndefined();
    // 設定を省くと既定（Standard・5 色・Height 0・レベル 1）
    expect((await h.call('POST', '/api/games/columns/start', {}, a.key)).body.options).toEqual(RANKED);
    for (const bad of [{ ...RANKED, start: 13 }, { ...RANKED, colors: 7 }, { ...RANKED, mode: 'x' }, 'abc'])
      expect((await h.call('POST', '/api/games/columns/start', { options: bad }, a.key)).body.code).toBe('bad-input');
    for (const practice of [{ ...RANKED, colors: 4 }, { ...RANKED, height: 3 }, { ...RANKED, mode: 1, height: 2 }, { ...RANKED, mode: 2 }])
      expect((await h.call('POST', '/api/games/columns/start', { options: practice }, a.key)).body.practice).toBe(true);
    await h.stop();
  });

  it('記録：なぞり直した点数・開始レベル・ランキング（detail）・自己ベスト・チャットの案内・立て看板の上位', async () => {
    const h = await harness('c-finish', seeds(21));
    const a = await h.join('あかね');
    const b = await h.join('みてる');
    await h.walk(a, NEAR.x, NEAR.y);
    const g1 = await game(h, a, 60, { ...RANKED, start: 3 });
    expect(g1.fin.status).toBe(200);
    expect(g1.p.score).toBeGreaterThan(0);
    expect(g1.fin.body).toMatchObject({
      recorded: true,
      score: g1.p.score,
      moves: 60,
      newBest: true,
      detail: { startLevel: 3, level: g1.p.level, jewels: g1.p.jewels },
      rank: { all: 1, month: 1 },
    });
    const r1 = await b.c.waitFor('ranking', (m) => m.game === 'columns' && m.top.length === 1);
    expect(r1.top[0]).toMatchObject({ name: 'あかね', score: g1.p.score, detail: { startLevel: 3 } });
    const chat = await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text.startsWith('🏆'));
    expect(chat.message.text).toMatch(/^🏆 あかね さんが Columns like game で [\d,]+ 点！（総合 1 位・今月 1 位）$/);
    // セッションは 1 回だけ
    expect((await h.call('POST', '/api/games/columns/finish', { session: g1.st.body.session, moves: g1.p.moves }, a.key)).body.code).toBe('no-session');
    const list = await h.call('GET', '/api/games/columns/ranking?period=all', undefined, a.key);
    expect(list.body.entries[0]).toMatchObject({ rank: 1, name: 'あかね', score: g1.p.score, maxTile: 0, detail: { startLevel: 3, level: g1.p.level, jewels: g1.p.jewels } });
    expect(list.body.me).toMatchObject({ rank: 1 });
    // 2048 のランキングとは別
    expect((await h.call('GET', '/api/games/2048/ranking')).body.total).toBe(0);
    // 新しくつないだ人の welcome にも
    const c = await h.connect(b.key);
    expect(c.welcome!.rankings!.columns[0]).toMatchObject({ name: 'あかね' });
    // 始めたときのベスト
    expect((await h.call('POST', '/api/games/columns/start', { options: RANKED }, a.key)).body.best).toBe(g1.p.score);
    await h.stop();
  });

  it('練習の設定は記録しない（ランキングに出ない）', async () => {
    const h = await harness('c-practice', seeds(22));
    const a = await h.join('れんしゅう');
    await h.walk(a, NEAR.x, NEAR.y);
    const g = await game(h, a, 30, { ...RANKED, colors: 4 });
    expect(g.st.body.practice).toBe(true);
    expect(g.fin.status).toBe(200);
    expect(g.fin.body).toMatchObject({ recorded: false, practice: true });
    expect((await h.call('GET', '/api/games/columns/ranking')).body.total).toBe(0);
    await h.stop();
  });

  it('不正な記録は断る：でたらめ・↓ の点が多すぎる・経過秒が減る・速すぎる・経過秒が実際の時間を超える・あふれていないのに over', async () => {
    const h = await harness('c-bad', seeds(23));
    const a = await h.join('ずる');
    await h.walk(a, NEAR.x, NEAR.y);
    const tryFinish = async (body: (p: ReturnType<typeof playPieces>, seed: number) => Record<string, unknown>, advance = 60_000) => {
      const st = await h.call('POST', '/api/games/columns/start', { options: RANKED }, a.key);
      const p = playPieces(st.body.seed, 1, 20);
      clock.t += advance;
      return (await h.call('POST', '/api/games/columns/finish', { session: st.body.session, ...body(p, st.body.seed) }, a.key)).body;
    };
    expect(await tryFinish(() => ({ moves: 'abc' }))).toMatchObject({ code: 'bad-moves' });
    expect(await tryFinish(() => ({ moves: [[9, 0, 0, 1]] }))).toMatchObject({ code: 'bad-moves' });
    expect(await tryFinish((p) => ({ moves: [...p.moves, [0, 0, 99999, 50]] }))).toMatchObject({ code: 'bad-moves' });
    expect(await tryFinish((p) => ({ moves: [...p.moves, [0, 0, 0, 0]] }))).toMatchObject({ code: 'bad-moves' });
    expect(await tryFinish((p) => ({ moves: p.moves, over: [0, 0] }))).toMatchObject({ code: 'bad-moves' });
    // 20 個を 3 秒（200 ms × 20 = 4 秒より速い）
    expect(await tryFinish((p) => ({ moves: p.moves }), 3000)).toMatchObject({ code: 'too-fast' });
    // 経過秒 400 と言うが、実際は 60 秒
    expect(await tryFinish((p) => ({ moves: [...p.moves.slice(0, -1), [p.moves[19][0], 0, 0, 400]] }))).toMatchObject({ code: 'too-fast' });
    // 2048 の手の並びは Columns では通らない
    expect(await tryFinish(() => ({ moves: '0123' }))).toMatchObject({ code: 'bad-moves' });
    expect((await h.call('GET', '/api/games/columns/ranking')).body.total).toBe(0);
    // 正しい記録は通る
    expect(await tryFinish((p) => ({ moves: p.moves }))).toMatchObject({ recorded: true });
    await h.stop();
  });

  it('ゲームオーバーの最後のピース（over）の ↓ の点も足す', async () => {
    const h = await harness('c-over', seeds(24));
    const a = await h.join('おわり');
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/columns/start', { options: RANKED }, a.key);
    // 1 列に積み上げてあふれさせる（消えるときは別の列へ）
    const g = new ColumnsGame(mulberry32(st.body.seed), 1);
    const moves: number[][] = [];
    while (g.findBottom(0) > -2 && moves.length < 200) {
      const m = [moves.length % 3 === 2 ? 3 : 0, 0, 0, 1];
      g.place({ x: m[0], rot: m[1], bonus: m[2], t: m[3] });
      moves.push(m);
    }
    expect(g.findBottom(0)).toBeLessThanOrEqual(-2);
    const lim = g.bonusLimit(0);
    clock.t += 120_000;
    const fin = await h.call('POST', '/api/games/columns/finish', { session: st.body.session, moves, over: [0, lim] }, a.key);
    expect(fin.status).toBe(200);
    expect(fin.body.score).toBe(g.score + lim);
    await h.stop();
  });

  it('管理者は Columns の記録も消せる', async () => {
    const h = await harness('c-admin', seeds(25));
    const a = await h.join('けされる');
    const adm = await h.join('かんり');
    await h.walk(a, NEAR.x, NEAR.y);
    await game(h, a, 40);
    const id = (await h.call('GET', '/api/games/columns/ranking')).body.entries[0].id as number;
    expect((await h.call('DELETE', `/api/admin/games/columns/scores/${id}`, undefined, a.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key)).status).toBe(200);
    // ゲームが違えば 404
    expect((await h.call('DELETE', `/api/admin/games/2048/scores/${id}`, undefined, adm.key)).status).toBe(404);
    expect((await h.call('DELETE', `/api/admin/games/columns/scores/${id}`, undefined, adm.key)).status).toBe(200);
    await a.c.waitFor('ranking', (m) => m.game === 'columns' && m.top.length === 0);
    await sleep(10);
    await h.stop();
  });
});

describe('ゲームの記録の DB：detail 列（v0.6.0 の途中で足した）', () => {
  it('detail 列の無い game_scores の表にも起動時に足す・中身は数だけ', () => {
    const file = path.join(tmp, 'c-migrate.db');
    const raw = new DatabaseSync(file);
    raw.exec(`CREATE TABLE game_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, at INTEGER NOT NULL, key_hash TEXT NOT NULL,
      pid TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, max_tile INTEGER NOT NULL, moves INTEGER NOT NULL, ms INTEGER NOT NULL)`);
    raw.exec(`INSERT INTO game_scores (game, at, key_hash, pid, name, score, max_tile, moves, ms) VALUES ('2048', 1, 'k', 'p', 'まえ', 100, 16, 5, 500)`);
    raw.close();
    const s = new Store(file);
    s.addGameScore({ game: 'columns', at: 2, keyHash: 'k', pid: 'p', name: 'あと', score: 300, maxTile: 0, moves: 9, ms: 9000, detail: { startLevel: 4, level: 5, jewels: 60 } });
    expect(s.gameBests('2048')[0]).toMatchObject({ name: 'まえ', score: 100, maxTile: 16 });
    expect(s.gameBests('2048')[0].detail).toBeUndefined();
    expect(s.gameBests('columns')[0]).toMatchObject({ name: 'あと', detail: { startLevel: 4, level: 5, jewels: 60 } });
    s.close();
  });
});
