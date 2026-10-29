// v0.6.0：Columns like game のなぞり直し（DESIGN §16.8）。元の JS との一致は server/test/columns-vm.test.ts。

import { describe, expect, it } from 'vitest';
import {
  checkGameRecord,
  ColumnsGame,
  COLUMNS_COLS,
  COLUMNS_MAX_PIECES,
  FLOOR,
  gameInfo,
  gameSpots,
  isRankedColumns,
  mulberry32,
  parseColumnsOptions,
  parseGameOptions,
  rankingSpots,
  replayColumns,
} from '../src';

/** 決まった値を順に返す乱数（呼んだ回数も数える） */
const seq = (...v: number[]) => {
  let i = 0;
  const f = () => v[i++ % v.length];
  f.calls = () => i;
  return f;
};

/** 下の段から書いた井戸（rows[0] = いちばん下の段。'.' は空き、数字は色） */
const withWell = (g: ColumnsGame, rowsFromBottom: string[]) => {
  for (let i = 0; i < rowsFromBottom.length; i++) {
    const y = 12 - i;
    g.well[y] = [...rowsFromBottom[i].padEnd(COLUMNS_COLS, '.')].map((c) => (c === '.' ? 0 : Number(c)));
  }
};

const game = (start = 1) => new ColumnsGame(seq(0.5), start);

describe('ColumnsGame（元の columns.js と同じ決まり）', () => {
  it('ピースの色は乱数で 3 つずつ（2 + floor(乱数 × 5)）。今のピース → 次のピースの順', () => {
    const g = new ColumnsGame(seq(0, 0.21, 0.99, 0.4, 0.6, 0.8));
    expect(g.current.colors).toEqual([2, 3, 6]);
    expect(g.next.colors).toEqual([4, 5, 6]);
    expect(g.findBottom(3)).toBe(10);
  });

  it('縦に 3 つ：消えて 3 × 10 × レベル点・ジュエル 3', () => {
    const g = game(2);
    g.current = { colors: [4, 4, 4], magic: false };
    expect(g.place({ x: 0, rot: 0, bonus: 0, t: 1 })).toBeNull();
    expect(g.jewels).toBe(3);
    expect(g.score).toBe(3 * 10 * 2);
    expect(g.well.flat().every((c) => c === 0)).toBe(true);
    expect(g.lastChain).toBe(0);
  });

  it('横と縦が重なると、重なった宝石は 2 つと数える（元のまま）', () => {
    const g = game();
    withWell(g, ['33']);
    g.current = { colors: [3, 3, 3], magic: false };
    g.place({ x: 2, rot: 0, bonus: 0, t: 1 });
    expect(g.jewels).toBe(6);
    expect(g.score).toBe(60);
  });

  it('斜めは 4 つ並ぶと 4 つの並びと 3 つの並びの両方を数える（7 つ）。井戸の端で折り返さない', () => {
    const g = game();
    withWell(g, ['5243', '253', '43', '3']);
    g.current = { colors: [2, 4, 5], magic: false };
    g.place({ x: 6, rot: 0, bonus: 0, t: 1 });
    expect(g.jewels).toBe(7);
    expect(g.score).toBe(70);
    expect(g.lastChain).toBe(0);
  });

  it('回す：最後の色が先頭へ（rot 回）', () => {
    const g = game();
    g.current = { colors: [2, 3, 4], magic: false };
    g.place({ x: 5, rot: 2, bonus: 0, t: 1 });
    // [2,3,4] → [4,2,3] → [3,4,2]（上から）
    expect([g.well[10][5], g.well[11][5], g.well[12][5]]).toEqual([3, 4, 2]);
  });

  it('連鎖：消えて落ちた宝石がそろうと、点は (連鎖 + 1) 倍', () => {
    const g = game();
    withWell(g, ['332', '..2']);
    g.current = { colors: [4, 3, 2], magic: false };
    g.place({ x: 2, rot: 0, bonus: 0, t: 1 });
    // 縦の 2 が 3 つ（30 点）→ 落ちて下の段が 3,3,3（3 × 10 × 2 = 60 点）
    expect(g.score).toBe(90);
    expect(g.jewels).toBe(6);
    expect(g.lastChain).toBe(1);
    expect(g.well[12]).toEqual([0, 0, 4, 0, 0, 0, 0]);
  });

  it('マジックジュエル：下の宝石の色をすべて消す。連鎖の回でも下を見て、空なら 10,000 点（元のまま）', () => {
    const g = game();
    withWell(g, ['5...35', '3']);
    g.current = { colors: [1, 1, 1], magic: true };
    g.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    // 3 の色 2 つ + 白 3 つ（マジックジュエル）と、縦の白 3 つ → 8 つ・80 点。連鎖の回で下 (0,11) が空 → 10,000 点
    expect(g.jewels).toBe(8);
    expect(g.score).toBe(80 + 10000);
    expect(g.well[12]).toEqual([5, 0, 0, 0, 0, 5, 0]);
  });

  it('マジックジュエルを井戸の底に落とす：10,000 点が 2 回と、縦の白 3 つ', () => {
    const g = game();
    g.current = { colors: [1, 1, 1], magic: true };
    g.place({ x: 3, rot: 0, bonus: 0, t: 1 });
    expect(g.score).toBe(20000 + 30);
  });

  it('マジックジュエルが出るのは、レベル 4 以上で経過 300 秒を超えてから（それまでは乱数を使わない）', () => {
    const r1 = seq(0.5);
    const g1 = new ColumnsGame(r1, 4);
    g1.place({ x: 0, rot: 0, bonus: 0, t: 300 });
    expect(r1.calls()).toBe(9); // 始めの 6 + 次のピースの 3
    const r2 = seq(0.5);
    const g2 = new ColumnsGame(r2, 3);
    g2.place({ x: 0, rot: 0, bonus: 0, t: 999 });
    expect(r2.calls()).toBe(9);
    // レベル 4・301 秒：もう 1 回使い、0.005 未満ならマジックジュエル
    const r3 = seq(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.004);
    const g3 = new ColumnsGame(r3, 4);
    g3.place({ x: 0, rot: 0, bonus: 0, t: 301 });
    expect(r3.calls()).toBe(10);
    expect(g3.next).toEqual({ colors: [1, 1, 1], magic: true });
  });

  it('レベル上げ：開始レベルの分を引いて 50 ずつ＋段ごとに 10 増える。1 回に 1 つ・12 まで。点はレベルが上がる前のレベル', () => {
    const g = game(1);
    g.jewels = 49;
    g.current = { colors: [4, 4, 4], magic: false };
    g.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    expect(g.score).toBe(30);
    expect(g.level).toBe(2);
    // 開始 5：レベル 5 で 250 − 200 + 10 × (4 × 5 / 2) = 150
    const h = game(5);
    h.jewels = 146;
    h.current = { colors: [4, 4, 4], magic: false };
    h.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    expect(h.level).toBe(5);
    h.current = { colors: [4, 4, 4], magic: false };
    h.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    expect(h.level).toBe(6);
    const k = game(12);
    k.jewels = 99999;
    k.current = { colors: [4, 4, 4], magic: false };
    k.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    expect(k.level).toBe(12);
    const m = game(1);
    m.jewels = 99999;
    m.place({ x: 0, rot: 0, bonus: 0, t: 1 });
    expect(m.level).toBe(2);
  });

  it('井戸の上にはみ出して置くと、はみ出した段は捨てる（落とすとゲームオーバーにならない。元のまま）', () => {
    const g = game();
    withWell(g, ['2', '3', '2', '3', '2', '3', '2', '3', '2', '3', '2', '3']);
    expect(g.findBottom(0)).toBe(-2);
    g.current = { colors: [4, 5, 6], magic: false };
    expect(g.place({ x: 0, rot: 0, bonus: 0, t: 1 })).toBeNull();
    expect(g.well[0][0]).toBe(6);
    expect(g.findBottom(0)).toBe(-3);
  });

  it('おかしな記録は断る：列・回した回数・↓ の点の上限・経過秒が減る', () => {
    const g = game(1);
    expect(g.place({ x: 7, rot: 0, bonus: 0, t: 1 })).toBe('bad-x');
    expect(g.place({ x: -1, rot: 0, bonus: 0, t: 1 })).toBe('bad-x');
    expect(g.place({ x: 1.5, rot: 0, bonus: 0, t: 1 })).toBe('bad-x');
    expect(g.place({ x: 0, rot: 3, bonus: 0, t: 1 })).toBe('bad-rot');
    // 空の列は 13 段下りる：13 × (1 + 1) × 2 = 52 点まで
    expect(g.bonusLimit(0)).toBe(52);
    expect(g.place({ x: 0, rot: 0, bonus: 53, t: 1 })).toBe('bad-bonus');
    expect(g.place({ x: 0, rot: 0, bonus: -2, t: 1 })).toBe('bad-bonus');
    expect(g.place({ x: 0, rot: 0, bonus: 0, t: 0 })).toBe('bad-time');
    expect(g.place({ x: 0, rot: 0, bonus: 52, t: 5 })).toBeNull();
    expect(g.place({ x: 1, rot: 0, bonus: 0, t: 4 })).toBe('bad-time');
    expect(g.place({ x: 1, rot: 0, bonus: 0, t: 5 })).toBeNull();
    expect(g.score).toBe(52 + 30 + 30); // どちらのピースも同じ色 3 つ（縦にそろって消える）
  });

  it('ゲームオーバーの最後のピース：その列が本当にあふれている（findBottom ≤ −2）ときだけ。↓ の点の上限', () => {
    const g = game();
    expect(g.over(0, 0)).toBe('bad-over');
    withWell(g, ['2', '3', '2', '3', '2', '3', '2', '3', '2', '3', '2', '3']);
    expect(g.findBottom(0)).toBe(-2);
    expect(g.over(0, 5)).toBe('bad-over');
    expect(g.over(0, 4)).toBeNull();
    expect(g.score).toBe(4);
  });
});

describe('replayColumns・checkGameRecord', () => {
  /** でたらめに置いた記録を作る（なぞり直しと同じ ColumnsGame で） */
  const randomGame = (seed: number, start: number, n: number) => {
    const pick = mulberry32(seed ^ 0x5a5a);
    const g = new ColumnsGame(mulberry32(seed), start);
    const moves: number[][] = [];
    let t = 1;
    for (let i = 0; i < n; i++) {
      const x = Math.floor(pick() * 7);
      const bonus = Math.floor(pick() * (g.bonusLimit(x) + 1));
      t += Math.floor(pick() * 3);
      const m = [x, Math.floor(pick() * 3), bonus, t];
      expect(g.place({ x: m[0], rot: m[1], bonus: m[2], t: m[3] })).toBeNull();
      moves.push(m);
    }
    return { g, moves };
  };

  it('同じ種・開始レベル・記録なら同じ点数（途中でやめた記録も通る）', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const start = 1 + (seed % 12);
      const { g, moves } = randomGame(seed, start, 40);
      const r = replayColumns(seed, start, moves);
      expect(r).toMatchObject({ ok: true, score: g.score, level: g.level, jewels: g.jewels, pieces: 40 });
      expect(r.well).toEqual(g.well);
      expect(r.maxT).toBe(moves[moves.length - 1][3]);
    }
  });

  it('形のおかしな記録は断る', () => {
    const { moves } = randomGame(3, 1, 10);
    expect(replayColumns(3, 1, 'abc')).toMatchObject({ ok: false, error: 'bad-format' });
    expect(replayColumns(3, 1, [[0, 0, 0]])).toMatchObject({ ok: false, error: 'bad-format', at: 0 });
    expect(replayColumns(3, 1, [...moves, [9, 0, 0, 99]])).toMatchObject({ ok: false, error: 'bad-x', at: 10 });
    expect(replayColumns(3, 1, [...moves, [0, 0, 10000, 99]])).toMatchObject({ ok: false, error: 'bad-bonus', at: 10 });
    expect(replayColumns(3, 1, Array.from({ length: COLUMNS_MAX_PIECES + 1 }, () => [0, 0, 0, 1]))).toMatchObject({ ok: false, error: 'too-many' });
    // 途中（あふれていない）で over は断る
    expect(replayColumns(3, 1, moves, [0, 0]).ok).toBe(false);
    expect(replayColumns(3, 1, [], null)).toMatchObject({ ok: true, score: 0, pieces: 0 });
  });

  it('checkGameRecord：速すぎる（ピースの数 × 200 ms）・経過秒が実際の時間を超える・2048 の手の並び', () => {
    const { g, moves } = randomGame(11, 1, 30);
    const opt = parseColumnsOptions({ mode: 0, colors: 5, height: 0, start: 1 });
    const t = moves[moves.length - 1][3];
    expect(checkGameRecord('columns', 11, opt, { moves }, 30 * 200 - 1)).toEqual({ ok: false, code: 'too-fast' });
    expect(checkGameRecord('columns', 11, opt, { moves }, (t - 5) * 1000)).toEqual({ ok: false, code: 'too-fast' });
    expect(checkGameRecord('columns', 11, opt, { moves }, t * 1000)).toEqual({
      ok: true,
      score: g.score,
      moves: 30,
      maxTile: 0,
      detail: { startLevel: 1, level: g.level, jewels: g.jewels },
    });
    expect(checkGameRecord('columns', 11, opt, { moves: '0123' }, 1e9)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkGameRecord('2048', 11, null, { moves: [[0, 0, 0, 1]] }, 1e9)).toEqual({ ok: false, code: 'bad-moves' });
    expect(checkGameRecord('nope', 11, null, { moves: '' }, 1e9)).toEqual({ ok: false, code: 'bad-moves' });
  });

  it('設定：ランキングに載るのは Standard・5 色・Height 0（開始レベルは自由）。ほかは練習', () => {
    expect(parseColumnsOptions(undefined)).toEqual({ mode: 0, colors: 5, height: 0, start: 1 });
    expect(parseColumnsOptions({ mode: 0, colors: 5, height: 0, start: 13 })).toBeNull();
    expect(parseColumnsOptions({ mode: 3, colors: 5, height: 0, start: 1 })).toBeNull();
    expect(parseColumnsOptions('x')).toBeNull();
    for (let s = 1; s <= 12; s++) expect(isRankedColumns(parseColumnsOptions({ mode: 0, colors: 5, height: 0, start: s })!)).toBe(true);
    expect(isRankedColumns({ mode: 1, colors: 5, height: 2, start: 1 })).toBe(false);
    expect(isRankedColumns({ mode: 0, colors: 4, height: 0, start: 1 })).toBe(false);
    expect(isRankedColumns({ mode: 0, colors: 5, height: 1, start: 1 })).toBe(false);
    expect(parseGameOptions('columns', { mode: 2, colors: 5, height: 0, start: 1 })).toMatchObject({ practice: true });
    expect(parseGameOptions('columns', { mode: 'x' })).toBeUndefined();
    expect(parseGameOptions('2048', { anything: 1 })).toEqual({ options: null, practice: false });
  });
});

describe('置き場所（floor.json）', () => {
  it('16 番 (13,9) の隣 (14,9) に Columns like game の筐体（画面は S）、立て看板は (16,9)。名前は「Columns like game」', () => {
    expect(gameInfo('columns')).toMatchObject({ title: 'Columns like game', sign: 'COLUMNS LIKE', page: 'games/columns/index.html' });
    const g = gameSpots(FLOOR, 'columns');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ game: 'columns', x: 14, y: 9, face: 'S' });
    expect(rankingSpots(FLOOR, 'columns')[0]).toMatchObject({ x: 16, y: 9 });
    // 筐体の番号は decor の中の game の並び順（2048 が 1）
    expect(gameSpots().map((s) => [s.id, s.game])).toEqual([
      [1, '2048'],
      [2, 'columns'],
      [3, 'hextris'],
    ]);
  });
});
