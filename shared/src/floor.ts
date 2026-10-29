// 店のレイアウト（data/floor.json）と、通れるマスの格子。

import floorJson from '../data/floor.json';

export interface Point {
  x: number;
  y: number;
}

/** 筐体の画面の向き。S = +y（左手前の面）、E = +x（右手前の面） */
export type Face = 'S' | 'E';

export interface CabinetSpot {
  id: number;
  x: number;
  y: number;
  face: Face;
  /** 看板（マーキー）の色 */
  color: string;
}

/**
 * note = コミュニケーションノートの机（DESIGN §12）、requestbox = 機能追加要望箱（DESIGN §13）、door = 予約部屋の扉・calendar = 予約カレンダー（v0.5.0。DESIGN §14）、
 * game = 遊べるゲームの筐体（v0.6.0。DESIGN §16。ランキングは床の立て看板をやめて壁のポスター rankingWall にした）
 */
export type DecorType = 'bench' | 'plant' | 'vending' | 'crane' | 'note' | 'requestbox' | 'door' | 'calendar' | 'game';

export interface Decor {
  type: DecorType;
  x: number;
  y: number;
  /** v0.6.0：game のゲーム（shared の GAMES の id。例 '2048'） */
  game?: string;
  /** v0.6.0：game の画面の向き */
  face?: Face;
}

/** 奥の壁の上の範囲（left = x = 0 の辺、right = y = 0 の辺。from..to はその辺に沿ったタイルの番号、to は含まない） */
export interface WallSpan {
  wall: 'left' | 'right';
  from: number;
  to: number;
}

/** ランキングのポスター（壁に貼る。DESIGN §16.11）：壁の上の範囲と、貼るゲーム（並びは手前から奥へ = 画面の左から右へ） */
export interface RankingWall extends WallSpan {
  games: string[];
}

export interface FloorJson {
  name: string;
  cols: number;
  rows: number;
  entrance: WallSpan;
  spawn: Point[];
  screen: WallSpan;
  /** ポスターの掲示板（DESIGN §9） */
  board: WallSpan;
  /** ランキングのポスター（v0.6.0。2026-10-30 ユーザー指定で床の立て看板から壁へ） */
  rankingWall?: RankingWall;
  cabinets: CabinetSpot[];
  decor: Decor[];
}

export interface Floor extends FloorJson {
  /** 通れるか（[y][x]） */
  passable: boolean[][];
}

const DECOR_TYPES: DecorType[] = ['bench', 'plant', 'vending', 'crane', 'note', 'requestbox', 'door', 'calendar', 'game'];

/** ランキングのポスターに貼れるゲームの数 */
export const RANKING_WALL_MAX = 4;

/** game・rankingWall の game の形（中身が GAMES にあるかは games.ts で確かめる） */
const GAME_ID_RE = /^[a-z0-9-]{1,20}$/;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 筐体の前のマス（座って遊ぶ所・近づいて使う所） */
export const frontTile = (c: { x: number; y: number; face: Face }): Point =>
  c.face === 'S' ? { x: c.x, y: c.y + 1 } : { x: c.x + 1, y: c.y };

export const inBounds = (f: { cols: number; rows: number }, x: number, y: number): boolean =>
  isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < f.cols && y < f.rows;

/** 通れるマスか（範囲外・筐体・飾りは通れない） */
export const isPassable = (f: Floor, x: number, y: number): boolean => inBounds(f, x, y) && f.passable[y][x];

/** レイアウトを確かめて、通れるマスの格子を作る。おかしければ投げる */
export const loadFloor = (j: FloorJson): Floor => {
  if (!isInt(j.cols) || !isInt(j.rows) || j.cols < 4 || j.rows < 4 || j.cols > 64 || j.rows > 64)
    throw new Error('floor: cols / rows が不正です');
  const passable = Array.from({ length: j.rows }, () => Array.from({ length: j.cols }, () => true));
  const block = (x: number, y: number, what: string) => {
    if (!inBounds(j, x, y)) throw new Error(`floor: ${what} (${x},${y}) が範囲外です`);
    if (!passable[y][x]) throw new Error(`floor: ${what} (${x},${y}) がほかの物と重なっています`);
    passable[y][x] = false;
  };
  const ids = new Set<number>();
  for (const c of j.cabinets) {
    if (!isInt(c.id) || c.id < 1 || ids.has(c.id)) throw new Error(`floor: 筐体の id ${c.id} が不正です`);
    if (c.face !== 'S' && c.face !== 'E') throw new Error(`floor: 筐体 ${c.id} の face が不正です`);
    ids.add(c.id);
    block(c.x, c.y, `筐体 ${c.id}`);
  }
  for (const d of j.decor) {
    if (!DECOR_TYPES.includes(d.type)) throw new Error(`floor: 飾りの type ${d.type} が不正です`);
    if (d.type === 'game') {
      if (typeof d.game !== 'string' || !GAME_ID_RE.test(d.game)) throw new Error(`floor: ${d.type} (${d.x},${d.y}) の game が不正です`);
      if (d.face !== 'S' && d.face !== 'E') throw new Error(`floor: ${d.type} (${d.x},${d.y}) の face が不正です`);
    }
    block(d.x, d.y, d.type);
  }
  for (const c of j.cabinets) {
    const f = frontTile(c);
    if (!inBounds(j, f.x, f.y) || !passable[f.y][f.x]) throw new Error(`floor: 筐体 ${c.id} の前のマスが通れません`);
  }
  // v0.6.0：ゲームの筐体も前のマスが通れること
  for (const d of j.decor) {
    if (d.type !== 'game') continue;
    const f = frontTile({ x: d.x, y: d.y, face: d.face ?? 'S' });
    if (!inBounds(j, f.x, f.y) || !passable[f.y][f.x]) throw new Error(`floor: ${d.type} (${d.x},${d.y}) の前のマスが通れません`);
  }
  if (!j.spawn.length) throw new Error('floor: spawn がありません');
  for (const s of j.spawn)
    if (!inBounds(j, s.x, s.y) || !passable[s.y][s.x]) throw new Error(`floor: spawn (${s.x},${s.y}) が通れません`);
  if (!j.board) throw new Error('floor: board がありません');
  const rw = j.rankingWall;
  if (rw) {
    if (!Array.isArray(rw.games) || !rw.games.length || rw.games.length > RANKING_WALL_MAX)
      throw new Error(`floor: rankingWall の games は 1〜${RANKING_WALL_MAX} 個です`);
    for (const g of rw.games) if (typeof g !== 'string' || !GAME_ID_RE.test(g)) throw new Error(`floor: rankingWall の game ${g} が不正です`);
    if (new Set(rw.games).size !== rw.games.length) throw new Error('floor: rankingWall の games が重なっています');
    // 1 枚に壁 1 マス以上（狭いと字が読めない）
    if (isInt(rw.from) && isInt(rw.to) && rw.to - rw.from < rw.games.length) throw new Error('floor: rankingWall が狭すぎます（1 枚に 1 マス以上）');
  }
  const spans = rw ? [j.entrance, j.screen, j.board, rw] : [j.entrance, j.screen, j.board];
  for (const w of spans) {
    const len = w.wall === 'left' ? j.rows : j.cols;
    if ((w.wall !== 'left' && w.wall !== 'right') || !isInt(w.from) || !isInt(w.to) || w.from < 0 || w.to > len || w.from >= w.to)
      throw new Error('floor: entrance / screen / board / rankingWall の範囲が不正です');
  }
  // 同じ壁の上で重ならないこと（入口・大画面・掲示板・ランキングのポスター）
  for (let a = 0; a < spans.length; a++)
    for (let b = a + 1; b < spans.length; b++) {
      const A = spans[a];
      const B = spans[b];
      if (A.wall === B.wall && A.from < B.to && B.from < A.to) throw new Error('floor: entrance / screen / board / rankingWall が壁の上で重なっています');
    }
  return { ...j, passable };
};

/** この店のレイアウト（ビルド時に data/floor.json を取り込む） */
export const FLOOR: Floor = loadFloor(floorJson as FloorJson);

export const cabinetSpot = (id: number, f: Floor = FLOOR): CabinetSpot | undefined => f.cabinets.find((c) => c.id === id);

/** マス p と筐体の距離（チェビシェフ距離。斜めも 1） */
export const cabinetDistance = (p: Point, c: { x: number; y: number }): number =>
  Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
