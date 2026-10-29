// Columns like game（DESIGN §16.8。元は github.com/jcfieldsdev/columns、MIT）の井戸を、種（seed）と「置いた記録」から最初からなぞり直す。
// サーバはこれで点数を決める（クライアントの言う点数は使わない）。
//
// コラムスは時間で落ちてくるが、井戸の中身は「どのピースを・どの列に・何回回して置いたか」だけで決まる
// （積み木は下へ詰まるので、置く高さは列で決まる。ピースが出てすぐ（井戸の上）はどの列へも動ける）。
// iframe（client/public/games/columns/va_bridge.js）はピースが固まるたびに {x, rot, bonus, t} を知らせる：
//   x = 列（0〜6）・rot = 回した回数（0〜2）・bonus = そのピースの ↓ と落下の点・t = ゲームの経過秒（マジックジュエルが出るかに効く）
//
// 元の columns.js の Game.prototype.update（固まったとき）・findMatches・doGravity・Piece と同じ順番にしてある：
// - ピースの色は乱数で 3 つ（上から）。始めに今のピース・次のピースの順に作る
// - 固まったら井戸に書き（井戸の上にはみ出した分は捨てる）、findMatches（マジックジュエル → 横 → 縦 → 斜め → 消す → 点 → 落とす → 消えたらもう一度）
// - 次のピースを作り、Standard でレベル 4 以上・経過 300 秒を超えていたら乱数でマジックジュエル（0.5%）
// - そのあとレベル上げ（1 回に 1 つまで。12 まで）
// - 消えた数は重なりも数える（横と縦の両方でそろった宝石は 2 つ。斜めは 4 つ並ぶと 3 つの並びも別に数える。元のまま）
// - ゲームオーバー：ゆっくり落ちて固まったピースが井戸の上にはみ出していたとき（findBottom ≤ −2 の列）。そのピースは井戸に入らない
// ランキングに載るのは Standard・5 色・Height 0（開始レベルは自由）なので、なぞり直しは Standard・Height 0 だけ。一致はテストで元の JS を vm で動かして確かめる。

import { mulberry32 } from './game2048';

export const COLUMNS_ROWS = 13;
export const COLUMNS_COLS = 7;
const PIECE_SIZE = 3;
const MATCH_SIZE = 3;
export const COLUMNS_LEVELS = 12;
const TIER = 50;
const TIER_INCREASE = 10;
const START_COLOR = 2;
const MAGIC_JEWEL_CHANCE = 0.005;
export const MAGIC_JEWEL_BONUS = 10000;
/** マジックジュエル（白） */
export const COLUMNS_WHITE = 1;

/** 1 ゲームのピースの数の上限 */
export const COLUMNS_MAX_PIECES = 20_000;
/** 速すぎる：始めてからの時間が「ピースの数 × これ」より短ければ断る（元は固まるたびに 250 ms 止まる） */
export const COLUMNS_PLACE_MIN_MS = 200;

/** オプション（元の Options の mode・difficulty・height・start） */
export interface ColumnsOptions {
  /** 0 Standard・1 Flash・2 Time Attack */
  mode: number;
  /** 色の数（3〜6） */
  colors: number;
  /** 最初に積んでおく段（0〜10） */
  height: number;
  /** 開始レベル（1〜12） */
  start: number;
}

export const DEFAULT_COLUMNS_OPTIONS: ColumnsOptions = { mode: 0, colors: 5, height: 0, start: 1 };

const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** start の options を読む（無ければ既定。形が違えば null） */
export const parseColumnsOptions = (raw: unknown): ColumnsOptions | null => {
  if (raw === undefined || raw === null) return { ...DEFAULT_COLUMNS_OPTIONS };
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const mode = intIn(o.mode, 0, 2);
  const colors = intIn(o.colors, 3, 6);
  const height = intIn(o.height, 0, 10);
  const start = intIn(o.start, 1, COLUMNS_LEVELS);
  if (mode === null || colors === null || height === null || start === null) return null;
  return { mode, colors, height, start };
};

/** ランキングに載る設定：Standard・5 色・Height 0（開始レベルは自由）。ほかは練習（記録しない） */
export const isRankedColumns = (o: ColumnsOptions): boolean => o.mode === 0 && o.colors === 5 && o.height === 0;

/** 置いた記録（finish では [x, rot, bonus, t] の配列で送る） */
export interface ColumnsPlacement {
  x: number;
  rot: number;
  bonus: number;
  t: number;
}

interface Piece {
  colors: number[];
  magic: boolean;
}

interface Cell {
  x: number;
  y: number;
}

/** Columns like game の 1 ゲーム（Standard・Height 0。well[y][x] = 色。0 は空き・1 はマジックジュエル・2〜 は宝石） */
export class ColumnsGame {
  well: number[][];
  score = 0;
  level: number;
  jewels = 0;
  /** 置いたピースの数 */
  pieces = 0;
  /** 最後に置いたピースで消えた回数 − 1（0 = 1 回だけ・1 以上 = 連鎖・−1 = 消えなかった。テスト用） */
  lastChain = -1;
  current: Piece;
  next: Piece;
  /** 前に置いたときの経過秒（減ってはいけない） */
  private lastT = 1;

  constructor(
    private rng: () => number,
    readonly startLevel = 1,
    readonly difficulty = 5,
  ) {
    this.well = Array.from({ length: COLUMNS_ROWS }, () => Array.from({ length: COLUMNS_COLS }, () => 0));
    this.level = startLevel;
    // 元の play()：今のピース → 次のピース（Height 0 なので fillHeight は乱数を使わない）
    this.current = this.newPiece();
    this.next = this.newPiece();
  }

  private newPiece(): Piece {
    const colors: number[] = [];
    for (let i = 0; i < PIECE_SIZE; i++) colors.push(START_COLOR + Math.floor(this.rng() * this.difficulty));
    return { colors, magic: false };
  }

  /** その列でピースが止まる位置（ピースの上の段。元の findBottom） */
  findBottom(x: number): number {
    let y = 0;
    while (y < COLUMNS_ROWS) {
      if (this.well[y][x] > 0) break;
      y++;
    }
    return y - PIECE_SIZE;
  }

  /** そのピースで ↓ と落下で取れる点の上限（下りた段の分。元の moveDown・drop の点） */
  bonusLimit(x: number): number {
    return Math.max(0, this.findBottom(x) + PIECE_SIZE) * (this.level + 1) * 2;
  }

  /** ピースを 1 つ置く。おかしければ理由（置かない） */
  place(p: ColumnsPlacement): 'bad-x' | 'bad-rot' | 'bad-bonus' | 'bad-time' | null {
    const x = intIn(p.x, 0, COLUMNS_COLS - 1);
    if (x === null) return 'bad-x';
    const rot = intIn(p.rot, 0, PIECE_SIZE - 1);
    if (rot === null) return 'bad-rot';
    const bonus = intIn(p.bonus, 0, this.bonusLimit(x));
    if (bonus === null) return 'bad-bonus';
    if (intIn(p.t, this.lastT, 10_000_000) === null) return 'bad-time';
    this.lastT = p.t;
    this.score += bonus;

    // 回す（元の rotate：最後の色を先頭へ）
    const piece = this.current;
    for (let i = 0; i < rot; i++) piece.colors.unshift(piece.colors.pop()!);
    // 井戸に書く（はみ出した段は捨てる）
    const y = this.findBottom(x);
    for (let i = 0; i < PIECE_SIZE; i++) {
      const row = this.well[y + i];
      if (row === undefined) continue;
      row[x] = piece.colors[i];
    }
    this.lastChain = -1;
    this.findMatches(piece, x, y, 0);
    this.pieces++;

    // 次のピース（Standard でレベル 4 以上・経過 300 秒を超えていたらマジックジュエルの乱数）
    this.current = this.next;
    this.next = this.newPiece();
    if (this.level > 3 && p.t > 300 && this.rng() < MAGIC_JEWEL_CHANCE) {
      this.next.colors = Array.from({ length: PIECE_SIZE }, () => COLUMNS_WHITE);
      this.next.magic = true;
    }

    // レベル上げ（開始レベルの分を引き、Standard では段ごとに 10 ずつ増える）
    let adjusted = this.level * TIER - (this.startLevel - 1) * TIER;
    if (this.level > 1) {
      const l = this.level - 1;
      adjusted += (TIER_INCREASE * (l * (l + 1))) / 2;
    }
    if (this.jewels >= adjusted && this.level < COLUMNS_LEVELS) this.level++;
    return null;
  }

  /** ゲームオーバーになった最後のピース（井戸に入らない。↓ の点だけ足す）。その列が本当にあふれているか */
  over(rawX: unknown, rawBonus: unknown): 'bad-over' | null {
    const x = intIn(rawX, 0, COLUMNS_COLS - 1);
    if (x === null || this.findBottom(x) > -2) return 'bad-over';
    const bonus = intIn(rawBonus, 0, this.bonusLimit(x));
    if (bonus === null) return 'bad-over';
    this.score += bonus;
    return null;
  }

  /** 元の findMatches（マジックジュエル → 横 → 縦 → 斜め → 消す → 点 → 落とす → 消えたらもう一度） */
  private findMatches(piece: Piece, px: number, py: number, chain: number): void {
    const well = this.well;
    const matches: Cell[][] = [];

    if (piece.magic) {
      // 元は連鎖のたびにも見る（置いた位置の下の宝石の色をすべて消す。下が空なら点）
      const y = py + PIECE_SIZE;
      if (well[y] !== undefined && well[y][px] > 0) doMagicJewel(well[y][px]);
      else this.score += MAGIC_JEWEL_BONUS;
    }

    scanMatrix(well, false);
    scanMatrix(transpose(well), true);
    scanDiagonals();

    const cleared = clearMatches();
    this.jewels += cleared;
    this.score += cleared * 10 * this.level * (chain + 1);
    doGravity();
    if (cleared > 0) {
      this.lastChain = chain;
      this.findMatches(piece, px, py, chain + 1);
    }

    function scanMatrix(grid: number[][], invert: boolean) {
      for (let y = 0; y < grid.length; y++) {
        let current = 0;
        let prev = 0;
        let count = 0;
        let match: Cell[] = [];
        let found = false;
        for (let x = 0; x < grid[y].length; x++) {
          prev = current;
          current = grid[y][x];
          if (current === 0 || current !== prev) {
            if (found) {
              found = false;
              matches.push(match);
            }
            count = 0;
            match = [];
          }
          count++;
          match.push(invert ? { x: y, y: x } : { x, y });
          if (count >= MATCH_SIZE) found = true;
        }
        if (found) matches.push(match);
      }
    }

    function scanDiagonals() {
      // 元は井戸の右・左の外を読むと undefined になって並びが切れる（折り返さない）
      const at = (y: number, x: number): number | undefined => (x >= 0 && x < COLUMNS_COLS ? well[y][x] : undefined);
      for (let y = 0; y < well.length; y++) {
        for (let x = 0; x < well[y].length; x++) {
          if (well[y][x] === 0) continue;
          const m1: Cell[] = [];
          let x1 = x;
          let y1 = y;
          do {
            m1.push({ x: x1, y: y1 });
            x1++;
            y1++;
          } while (well[y1] !== undefined && well[y][x] === at(y1, x1));
          if (m1.length >= MATCH_SIZE) matches.push(m1);
          const m2: Cell[] = [];
          let x2 = x;
          let y2 = y;
          do {
            m2.push({ x: x2, y: y2 });
            x2--;
            y2++;
          } while (well[y2] !== undefined && well[y][x] === at(y2, x2));
          if (m2.length >= MATCH_SIZE) matches.push(m2);
        }
      }
    }

    function transpose(g: number[][]): number[][] {
      const t = Array.from({ length: COLUMNS_COLS }, () => Array.from({ length: COLUMNS_ROWS }, () => 0));
      for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) t[x][y] = g[y][x];
      return t;
    }

    function doMagicJewel(color: number) {
      const match: Cell[] = [];
      for (let y = 0; y < well.length; y++)
        for (let x = 0; x < well[y].length; x++) if (well[y][x] === color || well[y][x] === COLUMNS_WHITE) match.push({ x, y });
      matches.push(match);
    }

    /** 消えた数（重なりも数える。元の cleared.length） */
    function clearMatches(): number {
      let n = 0;
      while (matches.length > 0) {
        const row = matches.pop()!;
        for (const c of row) {
          n++;
          well[c.y][c.x] = 0;
        }
      }
      return n;
    }

    function doGravity() {
      for (let y = well.length - 1; y >= 0; y--) {
        for (let x = 0; x < well[y].length; x++) {
          if (well[y][x] > 0) continue;
          let n = 1;
          while (well[y - n] !== undefined) {
            if (well[y - n][x] > 0) break;
            n++;
          }
          if (well[y - n] === undefined || well[y - n][x] === 0) continue;
          well[y][x] = well[y - n][x];
          well[y - n][x] = 0;
        }
      }
    }
  }
}

export interface ColumnsReplay {
  ok: boolean;
  score: number;
  level: number;
  jewels: number;
  pieces: number;
  well: number[][];
  /** ok = false のとき：理由と、何番目（0 から）の記録か */
  error?: 'bad-format' | 'too-many' | 'bad-x' | 'bad-rot' | 'bad-bonus' | 'bad-time' | 'bad-over';
  at?: number;
  /** 記録の中でいちばん大きい経過秒（サーバが実際の時間と比べる） */
  maxT: number;
}

/**
 * 種と開始レベルと置いた記録（[x, rot, bonus, t] の配列）からなぞり直す。over = ゲームオーバーの最後のピース [x, bonus]（途中でやめたときは無し）
 */
export const replayColumns = (seed: number, startLevel: number, moves: unknown, over?: unknown): ColumnsReplay => {
  const g = new ColumnsGame(mulberry32(seed), startLevel);
  const result = (extra: Partial<ColumnsReplay> = {}): ColumnsReplay => ({
    ok: true,
    score: g.score,
    level: g.level,
    jewels: g.jewels,
    pieces: g.pieces,
    well: g.well.map((r) => [...r]),
    maxT: 0,
    ...extra,
  });
  if (!Array.isArray(moves)) return result({ ok: false, error: 'bad-format', at: 0 });
  if (moves.length > COLUMNS_MAX_PIECES) return result({ ok: false, error: 'too-many', at: COLUMNS_MAX_PIECES });
  let maxT = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i] as unknown;
    if (!Array.isArray(m) || m.length !== 4) return result({ ok: false, error: 'bad-format', at: i });
    const [x, rot, bonus, t] = m as number[];
    const err = g.place({ x, rot, bonus, t });
    if (err) return result({ ok: false, error: err, at: i });
    maxT = Math.max(maxT, t);
  }
  if (over !== undefined && over !== null) {
    if (!Array.isArray(over) || over.length !== 2 || g.over(over[0], over[1]))
      return result({ ok: false, error: 'bad-over', at: moves.length, maxT });
  }
  return result({ maxT });
};
