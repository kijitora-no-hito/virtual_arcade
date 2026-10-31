// v0.7.0：ゲームでもらえるスロットのコインの式（DESIGN §17.9）・マークの両替（1 つ = 100 枚）。

import { describe, expect, it } from 'vitest';
import { COINS_PER_BADGE, DEFAULT_GAME_COINS_PER_HOUR, GAME_COIN_MAX, GAME_COIN_MIN, GAME_COIN_RANGE, GAMES, gameCoins } from '../src/index';

describe('ゲームでもらえるコイン（DESIGN §17.9）', () => {
  it('目安：sMin で 6 枚・sMax 以上で 60 枚・sMin 未満は 0 枚', () => {
    expect(GAME_COIN_MIN).toBe(6);
    expect(GAME_COIN_MAX).toBe(60);
    for (const g of GAMES) {
      const r = GAME_COIN_RANGE[g.id];
      expect(r, g.id).toBeDefined();
      expect(r.max).toBeGreaterThan(r.min);
      expect(gameCoins(g.id, 0)).toBe(0);
      expect(gameCoins(g.id, r.min - 1)).toBe(0);
      expect(gameCoins(g.id, r.min)).toBe(6);
      expect(gameCoins(g.id, r.max)).toBe(60);
      expect(gameCoins(g.id, r.max * 100)).toBe(60);
      // 間は対数で：sMin と sMax の相乗平均でちょうど真ん中（33 枚）
      expect(gameCoins(g.id, Math.sqrt(r.min * r.max))).toBe(33);
    }
  });

  it('式 round(6 + 54 × log(s / sMin) / log(sMax / sMin))・点数が増えれば減らない', () => {
    const { min, max } = GAME_COIN_RANGE['2048'];
    for (const s of [min, 3000, 5000, 7777, 12_000, 19_999])
      expect(gameCoins('2048', s)).toBe(Math.round(6 + (54 * Math.log(s / min)) / Math.log(max / min)));
    for (const g of GAMES) {
      let prev = 0;
      for (let s = 0; s <= GAME_COIN_RANGE[g.id].max * 2; s += Math.max(1, Math.floor(GAME_COIN_RANGE[g.id].max / 500))) {
        const c = gameCoins(g.id, s);
        expect(c).toBeGreaterThanOrEqual(prev);
        expect(c === 0 || (c >= 6 && c <= 60)).toBe(true);
        prev = c;
      }
    }
  });

  it('ゲームごとの sMin・sMax（DESIGN §17.9 の表と同じ）', () => {
    expect(GAME_COIN_RANGE['2048']).toEqual({ min: 2_000, max: 20_000 });
    expect(GAME_COIN_RANGE.columns).toEqual({ min: 3_000, max: 50_000 });
    expect(GAME_COIN_RANGE.hextris).toEqual({ min: 800, max: 20_000 });
  });

  it('知らないゲーム・おかしな点数は 0 枚', () => {
    expect(gameCoins('tetris', 100_000)).toBe(0);
    expect(gameCoins('2048', Number.NaN)).toBe(0);
    expect(gameCoins('2048', -5)).toBe(0);
    expect(gameCoins('2048', Infinity)).toBe(0);
  });

  it('1 時間の上限の既定は 300 枚・マークの両替は 1 つ 100 枚', () => {
    expect(DEFAULT_GAME_COINS_PER_HOUR).toBe(300);
    expect(COINS_PER_BADGE).toBe(100);
  });
});
