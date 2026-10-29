// v0.6.0：2048 のなぞり直し（DESIGN §16.3）。元の JS との一致は server/test/game2048-vm.test.ts。

import { describe, expect, it } from 'vitest';
import {
  countMoves,
  findPath,
  FLOOR,
  isPassable,
  formatScore,
  Game2048,
  gameSpots,
  GAMES,
  isGameId,
  jstMonthStart,
  loadFloor,
  mulberry32,
  rankingSpots,
  replay2048,
  type FloorJson,
} from '../src';
import floorJson from '../data/floor.json';
import win from './fixtures/win2048.json';

/** 行ごとに書いた盤（rows[y][x]）を cells[x][y] に */
const board = (rows: number[][]): number[][] => [0, 1, 2, 3].map((x) => rows.map((r) => r[x]));
const rowsOf = (cells: number[][]): number[][] => [0, 1, 2, 3].map((y) => cells.map((c) => c[y]));
/** 決まった値を順に返す乱数 */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe('mulberry32', () => {
  it('同じ種なら同じ並び・0 以上 1 未満・32 bit の種', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(2 ** 32 + 7)()).toBe(mulberry32(7)());
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('Game2048（元の game_manager.js と同じ決まり）', () => {
  it('始めはタイル 2 枚・同じ種なら同じ盤', () => {
    const g = new Game2048(mulberry32(99));
    expect(g.cells.flat().filter(Boolean)).toHaveLength(2);
    expect(new Game2048(mulberry32(99)).cells).toEqual(g.cells);
  });

  it('新しいタイル：先に数字（0.9 未満なら 2）、次に場所（x → y の順に並べた空きの中から）', () => {
    // 空きは (0,0),(0,1),…,(3,3) の 16 個。0.95 → 4、0.0 → 先頭 (0,0)。0.5 → 2、0.5 → 残り 15 個の 7 番目（0 から）= (2,0)
    const g = new Game2048(seq(0.95, 0, 0.5, 0.5));
    expect(g.cells[0][0]).toBe(4);
    expect(g.cells[2][0]).toBe(2);
  });

  it('合体：左へ・1 回の手で 2 回は合体しない・点数は合体してできた数', () => {
    const g = new Game2048(seq(0.5, 0), board([[2, 2, 2, 2], [4, 4, 8, 0], [0, 0, 0, 2], [2, 0, 0, 2]]));
    expect(g.move(3)).toBe(true);
    const r = rowsOf(g.cells);
    expect(r[0]).toEqual([4, 4, 0, 0]);
    expect(r[1]).toEqual([8, 8, 0, 0]);
    expect(r[3]).toEqual([4, 0, 0, 0]);
    expect(g.score).toBe(4 + 4 + 8 + 4);
    // 10 枚 → 合体で 6 枚 → 動いたので新しい 1 枚（空きの先頭 (1,2)）
    expect(g.cells.flat().filter(Boolean)).toHaveLength(7);
    expect(r[2]).toEqual([2, 2, 0, 0]);
  });

  it('右へ：遠い方から（[2,2,2,0] → [0,0,2,4]）', () => {
    const g = new Game2048(seq(0.99, 0), board([[2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
    g.move(1);
    expect(rowsOf(g.cells)[0]).toEqual([4, 0, 2, 4]); // 新しい 4 は空きの先頭 (0,0)
  });

  it('動かない手は何もしない（タイルも増えない）', () => {
    const g = new Game2048(seq(0.5), board([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
    expect(g.move(3)).toBe(false);
    expect(g.move(0)).toBe(false);
    expect(g.cells.flat().filter(Boolean)).toHaveLength(2);
    expect(g.move(2)).toBe(true);
  });

  it('動かせなくなったら終わり', () => {
    const g = new Game2048(
      seq(0.99, 0),
      board([
        [0, 2, 4, 2],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ]),
    );
    // 上の行を左へ寄せると (3,0) が空いて、新しい 4 が入る。どこもそろわない
    expect(g.move(1)).toBe(false); // 右には動かない（右端までうまっている）
    expect(g.move(3)).toBe(true);
    expect(rowsOf(g.cells)[0]).toEqual([2, 4, 2, 4]);
    expect(g.over).toBe(true);
    expect(g.terminated).toBe(true);
    expect(g.move(2)).toBe(false);
  });

  it('2048 を作ると止まり、K（Keep going）で続けられる。続けているのにもう一度 K はできない', () => {
    const g = new Game2048(seq(0.5), board([[1024, 1024, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
    expect(g.keep()).toBe(false); // まだ作っていない
    expect(g.move(3)).toBe(true);
    expect(g.won).toBe(true);
    expect(g.terminated).toBe(true);
    expect(g.maxTile).toBe(2048);
    expect(g.move(2)).toBe(false);
    expect(g.keep()).toBe(true);
    expect(g.terminated).toBe(false);
    expect(g.keep()).toBe(false);
    expect(g.move(2)).toBe(true);
    expect(g.score).toBe(2048);
  });
});

describe('replay2048', () => {
  it('同じ種と手の並びなら同じ点数。動いた手だけで作った並びはどれも通る', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 7919);
      const g = new Game2048(mulberry32(seed));
      let moves = '';
      while (!g.terminated && moves.length < 2000) {
        const d = Math.floor(rng() * 4) as 0 | 1 | 2 | 3;
        if (g.move(d)) moves += d;
      }
      const r = replay2048(seed, moves);
      expect(r.ok).toBe(true);
      expect(r.score).toBe(g.score);
      expect(r.cells).toEqual(g.cells);
      expect(r.moves).toBe(moves.length);
      expect(r.over).toBe(g.over);
    }
  });

  it('おかしな並びは断る（知らない文字・動かない手・終わった後の手・2048 の前の K）', () => {
    const g = new Game2048(mulberry32(5));
    let moves = '';
    const rng = mulberry32(1);
    while (moves.length < 30) {
      const d = Math.floor(rng() * 4) as 0 | 1 | 2 | 3;
      if (g.move(d)) moves += d;
    }
    expect(replay2048(5, moves).ok).toBe(true);
    expect(replay2048(5, moves + 'x')).toMatchObject({ ok: false, error: 'bad-char', at: 30 });
    expect(replay2048(5, 'K' + moves)).toMatchObject({ ok: false, error: 'bad-keep', at: 0 });
    // 動かない手：最後の手のあとに、動かない向きがあればそれを足す
    const stuck = ([0, 1, 2, 3] as const).find((d) => {
      const h = new Game2048(mulberry32(5));
      for (const ch of moves) h.move(Number(ch) as 0);
      return !h.move(d);
    });
    if (stuck !== undefined) expect(replay2048(5, moves + stuck)).toMatchObject({ ok: false, error: 'no-move' });
    expect(replay2048(5, '')).toMatchObject({ ok: true, score: 0, moves: 0 });
    expect(countMoves('01K23')).toBe(4);
  });

  it('2048 まで遊んだ記録（K あり）：点数・2048・K を抜くと「終わった後の手」・K を前に出すと断る', () => {
    const r = replay2048(win.seed, win.moves);
    expect(r).toMatchObject({ ok: true, won: true, score: win.score, maxTile: win.maxTile });
    const k = win.moves.indexOf('K');
    expect(k).toBeGreaterThan(0);
    expect(replay2048(win.seed, win.moves.slice(0, k) + win.moves.slice(k + 1))).toMatchObject({ ok: false, error: 'after-end', at: k });
    expect(replay2048(win.seed, win.moves.slice(0, k - 1) + 'K' + win.moves.slice(k - 1, k) + win.moves.slice(k + 1)).ok).toBe(false);
    // 2048 を作ったところでやめても（K の前まで）通る
    expect(replay2048(win.seed, win.moves.slice(0, k))).toMatchObject({ ok: true, won: true, maxTile: 2048 });
  });
});

describe('ゲームの一覧・置き場所（floor.json）', () => {
  it('2048 の筐体とランキングのポスターがあり、どちらも GAMES にあるゲーム', () => {
    expect(GAMES.map((g) => g.id)).toEqual(['2048', 'columns', 'hextris']);
    expect(isGameId('2048')).toBe(true);
    expect(isGameId('tetris')).toBe(false);
    const g = gameSpots(FLOOR, '2048');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ id: 1, game: '2048', face: 'S' });
    expect(rankingSpots(FLOOR, '2048')).toHaveLength(1);
    for (const d of FLOOR.decor) if (d.type === 'game') expect(isGameId(d.game)).toBe(true);
    for (const g of FLOOR.rankingWall?.games ?? []) expect(isGameId(g)).toBe(true);
    // 配信用の 8 番 (13,4) の隣に 2048 の筐体（ユーザー指定）。右隣 (15,4) は Hextris、16 番の隣 (14,9) はコラムス
    expect(g[0]).toMatchObject({ x: 14, y: 4 });
    expect(gameSpots(FLOOR, 'hextris')[0]).toMatchObject({ x: 15, y: 4, face: 'S' });
    expect(isPassable(FLOOR, 15, 4)).toBe(false);
    // 前のマスと、床の立て看板をやめて空いたマス (17,4)・(16,9)・(20,3)（2026-10-30 ユーザー指定でランキングを壁へ）は通れる
    for (const [x, y] of [
      [15, 5],
      [14, 10],
      [15, 9],
      [17, 4],
      [16, 9],
      [20, 3],
    ])
      expect(isPassable(FLOOR, x, y), `${x},${y}`).toBe(true);
  });

  it('ランキングは左の壁の奥寄り（y 0〜6。掲示板の手前）のポスター 3 枚（2048・Columns like game・Hextris の順）', () => {
    expect(FLOOR.rankingWall).toEqual({ wall: 'left', from: 0, to: 6, games: ['2048', 'columns', 'hextris'] });
    expect(FLOOR.board).toMatchObject({ wall: 'left', from: 6, to: 12 });
    expect(rankingSpots().map((r) => [r.id, r.game, r.index, r.count, r.wall])).toEqual([
      [1, '2048', 0, 3, 'left'],
      [2, 'columns', 1, 3, 'left'],
      [3, 'hextris', 2, 3, 'left'],
    ]);
    expect(rankingSpots(FLOOR, 'columns')).toHaveLength(1);
    // 床の飾りの ranking は無くなった
    expect((floorJson as { decor: Array<{ type: string }> }).decor.some((d) => d.type === 'ranking')).toBe(false);
  });

  it('loadFloor：rankingWall が入口・大画面・掲示板と重なる・おかしなゲーム・狭すぎるとエラー', () => {
    const base = floorJson as FloorJson;
    const withWall = (w: object | undefined) => ({ ...base, rankingWall: w }) as FloorJson;
    expect(() => loadFloor(withWall(undefined))).not.toThrow();
    expect(rankingSpots(loadFloor(withWall(undefined)))).toEqual([]);
    expect(() => loadFloor(withWall({ wall: 'left', from: 0, to: 6, games: ['2048'] }))).not.toThrow();
    // 掲示板 (6〜12)・入口 (12〜14)・大画面（右の壁 5〜15）と重なる
    expect(() => loadFloor(withWall({ wall: 'left', from: 3, to: 7, games: ['2048'] }))).toThrow(/重なって/);
    expect(() => loadFloor(withWall({ wall: 'left', from: 13, to: 16, games: ['2048'] }))).toThrow(/重なって/);
    expect(() => loadFloor(withWall({ wall: 'right', from: 4, to: 8, games: ['2048'] }))).toThrow(/重なって/);
    expect(() => loadFloor(withWall({ wall: 'right', from: 0, to: 4, games: ['2048'] }))).not.toThrow();
    // 範囲外・ゲームが無い・形が不正・同じゲームが 2 枚・1 枚に 1 マス未満
    expect(() => loadFloor(withWall({ wall: 'left', from: 14, to: 17, games: ['2048'] }))).toThrow(/範囲/);
    expect(() => loadFloor(withWall({ wall: 'left', from: 0, to: 6, games: [] }))).toThrow(/games/);
    expect(() => loadFloor(withWall({ wall: 'left', from: 0, to: 6, games: ['Bad Name'] }))).toThrow(/game/);
    expect(() => loadFloor(withWall({ wall: 'left', from: 0, to: 6, games: ['2048', '2048'] }))).toThrow(/重なって/);
    expect(() => loadFloor(withWall({ wall: 'left', from: 0, to: 2, games: ['2048', 'columns', 'hextris'] }))).toThrow(/狭すぎ/);
    // GAMES に無いゲームは形が正しければ読めるが、ポスターには出さない
    expect(rankingSpots(loadFloor(withWall({ wall: 'left', from: 0, to: 6, games: ['tetris', '2048'] }))).map((r) => r.game)).toEqual(['2048']);
  });

  it('3 台（2048・Columns like game・Hextris）を置いても、通れるマスはどこへでも歩ける（立て看板をやめて空いたマスも）', () => {
    const base = floorJson as FloorJson;
    expect(base.decor.some((d) => d.type === 'game' && d.game === 'columns' && d.x === 14 && d.y === 9)).toBe(true);
    expect(base.decor.some((d) => d.type === 'game' && d.game === 'hextris' && d.x === 15 && d.y === 4)).toBe(true);
    for (const fl of [FLOOR]) {
      const s = fl.spawn[0];
      for (let y = 0; y < fl.rows; y++)
        for (let x = 0; x < fl.cols; x++) if (isPassable(fl, x, y)) expect(findPath(fl, s, { x, y }), `${x},${y}`).not.toBeNull();
    }
  });

  it('loadFloor：game の game・face が無い・前のマスがふさがっていればエラー', () => {
    const base = floorJson as FloorJson;
    const withDecor = (d: object) => ({ ...base, decor: [...base.decor.filter((x) => x.type !== 'game'), d] }) as FloorJson;
    expect(() => loadFloor(withDecor({ type: 'game', x: 18, y: 5, face: 'S' }))).toThrow(/game/);
    expect(() => loadFloor(withDecor({ type: 'game', game: '2048', x: 18, y: 5 }))).toThrow(/face/);
    expect(() => loadFloor(withDecor({ type: 'game', game: 'Bad Name', x: 18, y: 5, face: 'S' }))).toThrow(/game/);
    // ベンチ (17,9) の上のマス (17,8) の筐体は前のマスがベンチでふさがる
    expect(() => loadFloor(withDecor({ type: 'game', game: '2048', x: 17, y: 8, face: 'S' }))).toThrow(/前のマス/);
    expect(() => loadFloor(withDecor({ type: 'game', game: '2048', x: 18, y: 5, face: 'S' }))).not.toThrow();
    // 床の立て看板（ranking）は v0.6.0 の途中でやめた（ランキングは壁の rankingWall）
    expect(() => loadFloor(withDecor({ type: 'ranking', game: '2048', x: 18, y: 5 }))).toThrow(/type/);
  });
});

describe('jstMonthStart・formatScore', () => {
  it('日本時間の月の初め', () => {
    // 2026-10-31 15:00 UTC = 11-01 00:00 JST → 11 月
    expect(jstMonthStart(Date.UTC(2026, 9, 31, 15, 0))).toBe(Date.UTC(2026, 9, 31, 15, 0));
    expect(jstMonthStart(Date.UTC(2026, 9, 31, 14, 59))).toBe(Date.UTC(2026, 8, 30, 15, 0));
    expect(jstMonthStart(Date.UTC(2027, 0, 1, 0, 0))).toBe(Date.UTC(2026, 11, 31, 15, 0));
  });
  it('3 桁ごとのカンマ', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(999)).toBe('999');
    expect(formatScore(12345)).toBe('12,345');
    expect(formatScore(1234567)).toBe('1,234,567');
  });
});
