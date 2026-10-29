// v0.6.0：Hextris の記録の確かめ方（DESIGN §16.9）と観戦の決まり（§16.10）
import { describe, expect, it } from 'vitest';
import {
  checkGameRecord,
  checkHextris,
  cleanSpectateInfo,
  frameBytes,
  HEXTRIS_BLOCKS_PER_SEC,
  HEXTRIS_MAX_CLEARS,
  HEXTRIS_SCORE_PER_SEC,
  isFrameGame,
  SELF_REPORTED_GAMES,
  gameInfo,
} from '../src';

const sum = (clears: number[][]) => clears.reduce((a, [k, m]) => a + k * k * m, 0);

describe('Hextris の記録（なぞり直さず、点の入り方の決まりと速さを見る）', () => {
  it('k × k × m の合計が点数と一致すれば受け付ける（コンボは 1 に戻るか 1 つ上がる）', () => {
    const clears = [
      [3, 1],
      [4, 2],
      [3, 3],
      [5, 1],
      [3, 2],
    ];
    const r = checkHextris(sum(clears), clears, 60_000);
    expect(r).toEqual({ ok: true, score: 9 + 32 + 27 + 25 + 18, clears: 5, blocks: 18, maxCombo: 3 });
    expect(checkHextris(0, [], 1000)).toMatchObject({ ok: true, score: 0, clears: 0 });
  });

  it('合計が合わない・おかしな形・飛んだコンボ・3 個未満は bad-moves', () => {
    expect(checkHextris(10, [[3, 1]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(9, [[2, 1]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(18, [[3, 2]], 60_000)).toEqual({ ok: false, code: 'bad-moves' }); // 最初から 2
    expect(checkHextris(9 + 27, [[3, 1], [3, 3]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(9, [[3, 1, 0]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(9, [['3', 1]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris('9', [[3, 1]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(9.5, [[3, 1]], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(-1, [], 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(9, 'x', 60_000)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkHextris(61 * 61, [[61, 1]], 600_000)).toEqual({ ok: false, code: 'bad-moves' });
    const many = Array.from({ length: HEXTRIS_MAX_CLEARS + 1 }, () => [3, 1]);
    expect(checkHextris(sum(many), many, 1e9)).toEqual({ ok: false, code: 'bad-moves' });
  });

  it('点数が「経過秒 × 上限」を超える・消した数が多すぎると too-fast', () => {
    // 10 秒で上限ちょうどまでは受け付け、それを超えると断る
    const ok = Array.from({ length: 10 }, (_, i) => [3, i + 1]); // 9 × (1 + … + 10) = 495
    expect(sum(ok)).toBeLessThanOrEqual(10 * HEXTRIS_SCORE_PER_SEC);
    expect(checkHextris(sum(ok), ok, 10_000).ok).toBe(true);
    const fast = Array.from({ length: 20 }, (_, i) => [5, i + 1]); // 25 × 210 = 5250
    expect(checkHextris(sum(fast), fast, 10_000)).toEqual({ ok: false, code: 'too-fast' });
    expect(checkHextris(sum(fast), fast, Math.ceil((sum(fast) / HEXTRIS_SCORE_PER_SEC) * 1000)).ok).toBe(true);
    // 消した数：1 秒に HEXTRIS_BLOCKS_PER_SEC 個まで（コンボなしの 3 個ずつは点数の上限より先にこちらに当たる）
    const n = HEXTRIS_BLOCKS_PER_SEC / 3 + 1;
    const blocks = Array.from({ length: n }, () => [3, 1]);
    expect(checkHextris(sum(blocks), blocks, 1000)).toEqual({ ok: false, code: 'too-fast' });
    expect(checkHextris(sum(blocks), blocks, 2000).ok).toBe(true);
  });

  it('checkGameRecord の hextris：detail に最大のコンボと消した数', () => {
    const clears = [
      [3, 1],
      [3, 2],
    ];
    expect(checkGameRecord('hextris', 1, null, { score: 27, clears }, 30_000)).toEqual({
      ok: true,
      score: 27,
      moves: 2,
      maxTile: 0,
      detail: { combo: 2, blocks: 6 },
    });
    expect(checkGameRecord('hextris', 1, null, { score: 28, clears }, 30_000)).toEqual({ ok: false, code: 'bad-moves' });
  });

  it('GAMES の Hextris・ブラウザの申告のゲーム', () => {
    expect(gameInfo('hextris')).toMatchObject({ title: 'Hextris', page: 'games/hextris/index.html', sign: 'HEXTRIS' });
    expect(SELF_REPORTED_GAMES).toEqual(['hextris']);
  });
});

describe('観戦の決まり', () => {
  it('画像で見せるのは Columns like game と Hextris（2048 は手の中継）', () => {
    expect(isFrameGame('columns')).toBe(true);
    expect(isFrameGame('hextris')).toBe(true);
    expect(isFrameGame('2048')).toBe(false);
    expect(isFrameGame(null)).toBe(false);
  });

  it('画像は JPEG / WebP の data URL・32 KB まで', () => {
    const b64 = (n: number) => btoa(String.fromCharCode(...new Array<number>(n).fill(7)));
    expect(frameBytes(`data:image/jpeg;base64,${b64(1000)}`)).toBe(1000);
    expect(frameBytes(`data:image/webp;base64,${b64(32 * 1024)}`)).toBe(32 * 1024);
    expect(frameBytes(`data:image/webp;base64,${b64(32 * 1024 + 1)}`)).toBe(-1);
    expect(frameBytes(`data:image/png;base64,${b64(100)}`)).toBe(-1);
    expect(frameBytes(`data:image/jpeg;base64,abc`)).toBe(-1);
    expect(frameBytes(`data:image/jpeg;base64,${b64(10)}<script>`)).toBe(-1);
    expect(frameBytes(`data:image/jpeg;base64,`)).toBe(-1);
    expect(frameBytes(123)).toBe(-1);
    expect(frameBytes(`data:image/jpeg;base64,${b64(100)}`, 50)).toBe(-1);
  });

  it('添える文字は点数・レベル・状態だけ', () => {
    expect(cleanSpectateInfo({ score: 12.7, level: 3, state: 'play', name: 'x' })).toEqual({ score: 12, level: 3, state: 'play' });
    expect(cleanSpectateInfo({ score: 5, state: 'hack' })).toEqual({ score: 5 });
    expect(cleanSpectateInfo({ score: -1 })).toBeNull();
    expect(cleanSpectateInfo({ score: 'a' })).toBeNull();
    expect(cleanSpectateInfo(null)).toBeNull();
  });
});
