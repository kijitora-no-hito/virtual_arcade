// 経路探索（A*。8 方向・角をすり抜けない）と、経路に沿った位置の計算（サーバとクライアントで同じ式）。

import { isPassable, type Floor, type Point } from './floor';

/** 歩く速さ（タイル / 秒） */
export const WALK_SPEED = 4;
/** 1 回の経路の長さの上限（マス数） */
export const MAX_PATH = 200;

const SQRT2 = Math.SQRT2;

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** p から 1 歩で行けるマス（斜めは両隣が通れるときだけ） */
export const neighbors = (f: Floor, p: Point): Point[] => {
  const out: Point[] = [];
  for (const [dx, dy] of DIRS) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (!isPassable(f, x, y)) continue;
    if (dx && dy && (!isPassable(f, p.x + dx, p.y) || !isPassable(f, p.x, p.y + dy))) continue;
    out.push({ x, y });
  }
  return out;
};

/** 隣どうしの 1 歩として正しいか（通れる・斜めの角抜けなし） */
export const isStep = (f: Floor, a: Point, b: Point): boolean => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) return false;
  return neighbors(f, a).some((n) => n.x === b.x && n.y === b.y);
};

/** 経路として正しいか（最初のマスから 1 歩ずつ、すべて通れる） */
export const isValidPath = (f: Floor, path: Point[]): boolean => {
  if (!path.length || path.length > MAX_PATH + 1) return false;
  if (!isPassable(f, path[0].x, path[0].y)) return false;
  for (let i = 1; i < path.length; i++) if (!isStep(f, path[i - 1], path[i])) return false;
  return true;
};

const octile = (a: Point, b: Point) => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
};

/**
 * from から to への最短経路（from と to を含む）。行けなければ null。
 * どちらかが通れないマスなら null。同じマスなら [from]。
 */
export const findPath = (f: Floor, from: Point, to: Point): Point[] | null => {
  if (!isPassable(f, from.x, from.y) || !isPassable(f, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [{ x: from.x, y: from.y }];
  const W = f.cols;
  const idx = (p: Point) => p.y * W + p.x;
  const g = new Map<number, number>([[idx(from), 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  // 格子が小さい（数百マス）ので、開いた一覧は配列で十分
  const open: Array<{ p: Point; f: number; g: number }> = [{ p: from, f: octile(from, to), g: 0 }];
  const goal = idx(to);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++)
      if (open[i].f < open[bi].f - 1e-9 || (Math.abs(open[i].f - open[bi].f) <= 1e-9 && open[i].g > open[bi].g)) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ci = idx(cur.p);
    if (closed.has(ci)) continue;
    if (ci === goal) {
      const out: Point[] = [];
      let k: number | undefined = ci;
      while (k !== undefined) {
        out.push({ x: k % W, y: Math.floor(k / W) });
        k = came.get(k);
      }
      out.reverse();
      return out.length > MAX_PATH + 1 ? null : out;
    }
    closed.add(ci);
    for (const n of neighbors(f, cur.p)) {
      const ni = idx(n);
      if (closed.has(ni)) continue;
      const step = n.x !== cur.p.x && n.y !== cur.p.y ? SQRT2 : 1;
      const ng = cur.g + step;
      if (ng < (g.get(ni) ?? Infinity) - 1e-9) {
        g.set(ni, ng);
        came.set(ni, ci);
        open.push({ p: n, f: ng + octile(n, to), g: ng });
      }
    }
  }
  return null;
};

/** 経路の長さ（タイル。斜めは √2） */
export const pathLength = (path: Point[]): number => {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return d;
};

export interface PathPos {
  /** 今の位置（タイルの座標。小数） */
  x: number;
  y: number;
  /** 今いる区間（path[seg] → path[seg + 1]）と、その中の割合 */
  seg: number;
  frac: number;
  /** 歩き終えた */
  done: boolean;
  /** 向き（画面の左右。-1 = 左、1 = 右、0 = 変わらない） */
  dir: -1 | 0 | 1;
}

const screenDir = (a: Point, b: Point): -1 | 0 | 1 => {
  // 画面の x は (x - y) に比例する
  const sx = b.x - a.x - (b.y - a.y);
  return sx > 0 ? 1 : sx < 0 ? -1 : 0;
};

/** startedAt に path[0] を出て speed で歩いたときの、now の位置 */
export const positionAt = (path: Point[], startedAt: number, now: number, speed = WALK_SPEED): PathPos => {
  const last = path[path.length - 1];
  if (path.length < 2) return { x: last.x, y: last.y, seg: 0, frac: 0, done: true, dir: 0 };
  let left = Math.max(0, ((now - startedAt) / 1000) * speed);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left < len) {
      const t = left / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, seg: i, frac: t, done: false, dir: screenDir(a, b) };
    }
    left -= len;
  }
  return { x: last.x, y: last.y, seg: path.length - 2, frac: 1, done: true, dir: screenDir(path[path.length - 2], last) };
};

/**
 * now に「いる」とみなすマス（区間の半分を過ぎたら次のマス）。新しい経路はここから始める。
 */
export const currentTile = (path: Point[], startedAt: number, now: number): Point => {
  const p = positionAt(path, startedAt, now);
  if (p.done) return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  const q = p.frac < 0.5 ? path[p.seg] : path[p.seg + 1];
  return { x: q.x, y: q.y };
};

/** 経路を歩き終える時刻 */
export const arrivalAt = (path: Point[], startedAt: number, speed = WALK_SPEED): number =>
  startedAt + (pathLength(path) / speed) * 1000;
