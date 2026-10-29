// 2048（DESIGN §16。元は github.com/gabrielecirulli/2048、MIT）の盤を、種（seed）と手の並びから最初からなぞり直す。
// サーバはこれで点数を決める（クライアントの言う点数は使わない）。
//
// 元の js/game_manager.js・js/grid.js と同じ順番・同じ合体の決まり・同じ乱数の使い方にしてある：
// - 新しいタイル：先に数字（乱数 < 0.9 なら 2、ほかは 4）、次に置き場所（空いているマスを x → y の順に並べた中から 1 つ）
// - 動かす：進む向きの遠い方から順に。1 回の手で 1 つのタイルは 1 回しか合体しない
// - 盤が動いたときだけ新しいタイルを置き、そのあと動かせる手が無ければ終わり
// - 2048 を作ると止まる（「Keep going」= K で続けられる）
// 乱数は mulberry32（iframe 側の js/va_bridge.js にも同じ式がある）。一致はテストで元の JS を動かして確かめる（shared/test/game2048.test.ts）。

/** 盤の大きさ */
export const SIZE_2048 = 4;

/** 0 上・1 右・2 下・3 左（元の game_manager.js と同じ番号） */
export type Dir2048 = 0 | 1 | 2 | 3;

/** 32 bit の種から [0, 1) の数を作る乱数（mulberry32） */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const VECTORS: Record<Dir2048, { x: number; y: number }> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

/** 2048 の 1 ゲーム（cells[x][y] = タイルの数。0 は空き） */
export class Game2048 {
  cells: number[][];
  score = 0;
  over = false;
  won = false;
  keepPlaying = false;

  /** cells を渡すとその盤から（テスト用。最初のタイルは置かない） */
  constructor(
    private rng: () => number,
    cells?: number[][],
  ) {
    if (cells) this.cells = cells.map((c) => [...c]);
    else {
      this.cells = Array.from({ length: SIZE_2048 }, () => Array.from({ length: SIZE_2048 }, () => 0));
      // 最初のタイル 2 枚
      this.addRandomTile();
      this.addRandomTile();
    }
  }

  /** 終わっている（動かせない、または 2048 を作って続けていない） */
  get terminated(): boolean {
    return this.over || (this.won && !this.keepPlaying);
  }

  get maxTile(): number {
    return Math.max(0, ...this.cells.flat());
  }

  private within(x: number, y: number): boolean {
    return x >= 0 && x < SIZE_2048 && y >= 0 && y < SIZE_2048;
  }

  private availableCells(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < SIZE_2048; x++) for (let y = 0; y < SIZE_2048; y++) if (!this.cells[x][y]) out.push({ x, y });
    return out;
  }

  /** 空いているマスに 2 か 4 を置く（数字が先、場所が後） */
  addRandomTile(): void {
    const cells = this.availableCells();
    if (!cells.length) return;
    const value = this.rng() < 0.9 ? 2 : 4;
    const c = cells[Math.floor(this.rng() * cells.length)];
    this.cells[c.x][c.y] = value;
  }

  private movesAvailable(): boolean {
    if (this.availableCells().length) return true;
    for (let x = 0; x < SIZE_2048; x++)
      for (let y = 0; y < SIZE_2048; y++) {
        const v = this.cells[x][y];
        if (!v) continue;
        for (const d of [0, 1, 2, 3] as Dir2048[]) {
          const nx = x + VECTORS[d].x;
          const ny = y + VECTORS[d].y;
          if (this.within(nx, ny) && this.cells[nx][ny] === v) return true;
        }
      }
    return false;
  }

  /** 1 手動かす。盤が動いたら true（動かなければ何もしない。終わっていれば false） */
  move(dir: Dir2048): boolean {
    if (this.terminated) return false;
    const v = VECTORS[dir];
    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 2, 3];
    if (v.x === 1) xs.reverse();
    if (v.y === 1) ys.reverse();
    /** この手で合体してできたタイルのあるマス（1 回の手で 2 回は合体しない） */
    const merged = Array.from({ length: SIZE_2048 }, () => Array.from({ length: SIZE_2048 }, () => false));
    let moved = false;
    for (const x of xs)
      for (const y of ys) {
        const value = this.cells[x][y];
        if (!value) continue;
        // 進む向きに、ぶつかるまで進める
        let fx = x;
        let fy = y;
        let nx = x + v.x;
        let ny = y + v.y;
        while (this.within(nx, ny) && !this.cells[nx][ny]) {
          fx = nx;
          fy = ny;
          nx += v.x;
          ny += v.y;
        }
        const next = this.within(nx, ny) ? this.cells[nx][ny] : 0;
        if (next && next === value && !merged[nx][ny]) {
          this.cells[x][y] = 0;
          this.cells[nx][ny] = value * 2;
          merged[nx][ny] = true;
          this.score += value * 2;
          if (value * 2 === 2048) this.won = true;
          moved = true;
        } else {
          this.cells[x][y] = 0;
          this.cells[fx][fy] = value;
          if (fx !== x || fy !== y) moved = true;
        }
      }
    if (moved) {
      this.addRandomTile();
      if (!this.movesAvailable()) this.over = true;
    }
    return moved;
  }

  /** 「Keep going」（2048 を作ったあと続ける）。できなければ false */
  keep(): boolean {
    if (!this.won || this.keepPlaying || this.over) return false;
    this.keepPlaying = true;
    return true;
  }
}

/** 手の並びの形（0〜3 = 向き、K = Keep going） */
export const MOVES_RE = /^[0-3K]*$/;

/** 手の並びの中の、向きの手の数（K は数えない） */
export const countMoves = (moves: string): number => {
  let n = 0;
  for (let i = 0; i < moves.length; i++) if (moves.charCodeAt(i) !== 75) n++;
  return n;
};

export type Replay2048Error = 'bad-char' | 'no-move' | 'after-end' | 'bad-keep';

export interface Replay2048Result {
  ok: boolean;
  score: number;
  maxTile: number;
  /** 向きの手の数 */
  moves: number;
  over: boolean;
  won: boolean;
  /** おかしかった理由と、その手の位置（0 から） */
  error?: Replay2048Error;
  at?: number;
  /** なぞり終わった盤（テスト用） */
  cells: number[][];
}

/**
 * 種と手の並びから盤をなぞり直して点数を出す。
 * 盤が動かない手・終わった後の手・2048 を作っていないのに K（続けているのにもう一度 K も）・知らない文字があれば ok = false
 */
export const replay2048 = (seed: number, moves: string): Replay2048Result => {
  const g = new Game2048(mulberry32(seed));
  let count = 0;
  const result = (error?: Replay2048Error, at?: number): Replay2048Result => ({
    ok: !error,
    score: g.score,
    maxTile: g.maxTile,
    moves: count,
    over: g.over,
    won: g.won,
    ...(error ? { error, at } : {}),
    cells: g.cells,
  });
  for (let i = 0; i < moves.length; i++) {
    const ch = moves[i];
    if (ch === 'K') {
      if (!g.keep()) return result('bad-keep', i);
      continue;
    }
    if (ch !== '0' && ch !== '1' && ch !== '2' && ch !== '3') return result('bad-char', i);
    if (g.terminated) return result('after-end', i);
    if (!g.move(Number(ch) as Dir2048)) return result('no-move', i);
    count++;
  }
  return result();
};
