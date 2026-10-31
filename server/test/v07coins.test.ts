// v0.7.0：ゲームを遊ぶとスロットのコイン（DESIGN §17.9。ユーザー指定「6枚くらい。良いスコアだったら最大60枚くらい」）・マークの両替は 1 つ 100 枚。

import { countMoves, GAME_COIN_RANGE, gameCoins, replay2048 } from '@va/shared';
import { describe, expect, it } from 'vitest';
import win from '../../shared/test/fixtures/win2048.json';
import { defaultConfig } from '../src/config';
import { clock, harness } from './harness';

type H = Awaited<ReturnType<typeof harness>>;
type Who = Awaited<ReturnType<H['join']>>;

// 2048 の筐体 (14, 4) の前のマス・スロット 1 (17, 4) の前のマス・Columns like game (14, 9) の前のマス・Hextris (15, 4) の前のマス
const NEAR_2048 = { x: 14, y: 5 };
const NEAR_SLOT = { x: 17, y: 5 };
const NEAR_COLUMNS = { x: 14, y: 10 };
const NEAR_HEXTRIS = { x: 15, y: 5 };

/** 種がいつも 2 になる（2048 まで遊んだ記録 win2048.json の種） */
const SEED2 = { rng: () => 2 / 2 ** 32 };

/** win2048 の手の並びのうち、点数が target 以上になる最初の所まで（n 手目の後の点数を返す） */
const prefixFor = (target: number) => {
  for (let i = 1; i <= win.moves.length; i++) {
    const r = replay2048(win.seed, win.moves.slice(0, i));
    if (r.ok && r.score >= target) return { moves: win.moves.slice(0, i), score: r.score };
  }
  throw new Error('届かない');
};

/** 2048 を始めて、その手の並びで記録する（時計を手の数 × 100 ms 進める） */
const play2048 = async (h: H, who: Who, moves: string) => {
  const st = await h.call('POST', '/api/games/2048/start', {}, who.key);
  expect(st.status).toBe(200);
  expect(st.body.seed).toBe(2);
  clock.t += countMoves(moves) * 100;
  return h.call('POST', '/api/games/2048/finish', { session: st.body.session, moves }, who.key);
};

describe('ゲームでもらえるスロットのコイン（DESIGN §17.9）', () => {
  it('GAME_COINS_PER_HOUR（既定 300・0 でもらえない・上限 100,000）', () => {
    expect(defaultConfig({}).gameCoinsPerHour).toBe(300);
    expect(defaultConfig({ GAME_COINS_PER_HOUR: '120' }).gameCoinsPerHour).toBe(120);
    expect(defaultConfig({ GAME_COINS_PER_HOUR: '0' }).gameCoinsPerHour).toBe(0);
    expect(defaultConfig({ GAME_COINS_PER_HOUR: '-3' }).gameCoinsPerHour).toBe(0);
    expect(defaultConfig({ GAME_COINS_PER_HOUR: 'x' }).gameCoinsPerHour).toBe(300);
    expect(defaultConfig({ GAME_COINS_PER_HOUR: '9999999' }).gameCoinsPerHour).toBe(100000);
  });

  it('2048 を遊ぶ → 点数に応じたコイン（手元・本人にだけ）→ スロットで使える・sMin 未満は 0 枚', async () => {
    const h = await harness('coins-2048', SEED2);
    const a = await h.join('あそぶ');
    const b = await h.join('みてる');
    await h.walk(a, NEAR_2048.x, NEAR_2048.y);

    // sMin 未満（点数はあるが少ない）：記録はするがコインは 0 枚（理由と sMin）
    const low = prefixFor(GAME_COIN_RANGE['2048'].min - 300);
    expect(low.score).toBeLessThan(GAME_COIN_RANGE['2048'].min);
    const f0 = await play2048(h, a, low.moves);
    expect(f0.body).toMatchObject({ recorded: true, score: low.score, coins: { gained: 0, total: 0, reason: 'low', min: GAME_COIN_RANGE['2048'].min } });

    // ちょうど sMin を超えたくらい：6〜7 枚
    const mid = prefixFor(GAME_COIN_RANGE['2048'].min);
    const f1 = await play2048(h, a, mid.moves);
    const c1 = gameCoins('2048', mid.score);
    expect(c1).toBeGreaterThanOrEqual(6);
    expect(c1).toBeLessThanOrEqual(7);
    expect(f1.body).toMatchObject({ recorded: true, score: mid.score, coins: { gained: c1, total: c1 } });
    expect(f1.body.coins.reason).toBeUndefined();
    await a.c.waitFor('you', (m) => m.you.coins === c1);

    // 2048 を作るまで（20,948 点 ≥ sMax）：60 枚
    const f2 = await play2048(h, a, win.moves);
    expect(f2.body).toMatchObject({ recorded: true, score: win.score, coins: { gained: 60, total: c1 + 60 } });
    await a.c.waitFor('you', (m) => m.you.coins === c1 + 60);
    // コインはほかの人には送らない
    expect(JSON.stringify(b.c.msgs.filter((m) => m.type !== 'welcome' && m.type !== 'chat'))).not.toMatch(/"coins"/);

    // そのコインでスロットを回せる（3 枚）
    clock.t += 2000;
    await h.walk(a, NEAR_SLOT.x, NEAR_SLOT.y);
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body.coins).toBe(c1 + 60);
    const sp = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(sp.status).toBe(200);
    expect(sp.body).toMatchObject({ bet: 3, coins: c1 + 57 });
    await h.stop();
  });

  it('1 時間の上限（GAME_COINS_PER_HOUR）：超えた分は 0 枚（capped・hour）→ 1 時間たつとまたもらえる', async () => {
    const h = await harness('coins-hour', { ...SEED2, gameCoinsPerHour: 100 });
    const a = await h.join('かせぐ');
    await h.walk(a, NEAR_2048.x, NEAR_2048.y);
    const f1 = await play2048(h, a, win.moves);
    expect(f1.body.coins).toEqual({ gained: 60, total: 60 });
    // 残りは 40 枚
    const f2 = await play2048(h, a, win.moves);
    expect(f2.body.coins).toEqual({ gained: 40, total: 100, capped: true, reason: 'hour' });
    const f3 = await play2048(h, a, win.moves);
    expect(f3.body.coins).toEqual({ gained: 0, total: 100, capped: true, reason: 'hour' });
    // 記録（ランキング）はそのまま
    expect(f3.body.recorded).toBe(true);
    // 最初の 60 枚から 1 時間たつと、その分だけ空く（2 回目の 40 枚はまだ 1 時間の中なので、残りは 60 枚）
    const d = countMoves(win.moves) * 100;
    clock.t += 60 * 60 * 1000 - 2.5 * d;
    const f4 = await play2048(h, a, win.moves);
    expect(f4.body.coins).toEqual({ gained: 60, total: 160 });
    // すぐ（2 回目の 40 枚から 1 時間たつ前に）短いゲームでもう一度：上限
    const short = prefixFor(GAME_COIN_RANGE['2048'].min);
    expect(countMoves(short.moves) * 100).toBeLessThan(d / 2);
    const f5 = await play2048(h, a, short.moves);
    expect(f5.body.coins).toEqual({ gained: 0, total: 160, capped: true, reason: 'hour' });
    await h.stop();
  });

  it('0 にするとゲームではもらえない（off）', async () => {
    const h = await harness('coins-off', { ...SEED2, gameCoinsPerHour: 0 });
    const a = await h.join('なし');
    await h.walk(a, NEAR_2048.x, NEAR_2048.y);
    const f = await play2048(h, a, win.moves);
    expect(f.body).toMatchObject({ recorded: true, coins: { gained: 0, total: 0, reason: 'off' } });
    await h.stop();
  });

  it('Columns like game の練習はコインなし・Hextris も同じ式・点数 0 は 0 枚', async () => {
    const h = await harness('coins-other', SEED2);
    const a = await h.join('いろいろ');
    // Columns の練習（Colors 4）
    await h.walk(a, NEAR_COLUMNS.x, NEAR_COLUMNS.y);
    const cs = await h.call('POST', '/api/games/columns/start', { options: { mode: 0, colors: 4, height: 0, start: 1 } }, a.key);
    expect(cs.body.practice).toBe(true);
    clock.t += 5000;
    const cf = await h.call('POST', '/api/games/columns/finish', { session: cs.body.session, moves: [[0, 0, 0, 1]] }, a.key);
    expect(cf.body).toMatchObject({ recorded: false, practice: true, coins: { gained: 0, total: 0, reason: 'practice' } });

    // Hextris：消した記録 [k, m] から点数（3 個ずつ・倍率 1, 2, …）
    await h.walk(a, NEAR_HEXTRIS.x, NEAR_HEXTRIS.y);
    const clears: number[][] = [];
    let score = 0;
    for (let m = 1; score < GAME_COIN_RANGE.hextris.min; m++) {
      clears.push([3, m]);
      score += 9 * m;
    }
    const hs = await h.call('POST', '/api/games/hextris/start', {}, a.key);
    clock.t += 120_000;
    const hf = await h.call('POST', '/api/games/hextris/finish', { session: hs.body.session, score, clears }, a.key);
    expect(hf.body).toMatchObject({ recorded: true, score, coins: { gained: gameCoins('hextris', score), total: gameCoins('hextris', score) } });
    expect(hf.body.coins.gained).toBeGreaterThanOrEqual(6);
    // 点数 0（何も消さずに終わり）
    const h0 = await h.call('POST', '/api/games/hextris/start', {}, a.key);
    clock.t += 10_000;
    const f0 = await h.call('POST', '/api/games/hextris/finish', { session: h0.body.session, score: 0, clears: [] }, a.key);
    expect(f0.body).toMatchObject({ recorded: false, coins: { gained: 0, reason: 'low' } });
    // 断られた記録（速すぎる）にはコインを出さない
    const h1 = await h.call('POST', '/api/games/hextris/start', {}, a.key);
    const bad = await h.call('POST', '/api/games/hextris/finish', { session: h1.body.session, score, clears }, a.key);
    expect(bad.body.code).toBe('too-fast');
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body.coins).toBe(gameCoins('hextris', score));
    await h.stop();
  });

  it('退店したあと（窓を閉じて記録）でも鍵の財布に足す', async () => {
    const h = await harness('coins-left', SEED2);
    const a = await h.join('かえる');
    await h.walk(a, NEAR_2048.x, NEAR_2048.y);
    const st = await h.call('POST', '/api/games/2048/start', {}, a.key);
    clock.t += countMoves(win.moves) * 100;
    expect((await h.call('POST', '/api/leave', {}, a.key)).status).toBe(200);
    const f = await h.call('POST', '/api/games/2048/finish', { session: st.body.session, moves: win.moves }, a.key);
    expect(f.body).toMatchObject({ recorded: true, coins: { gained: 60, total: 60 } });
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body.coins).toBe(60);
    await h.stop();
  });
});
