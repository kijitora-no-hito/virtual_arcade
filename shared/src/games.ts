// ゲーム筐体で遊べるゲームの一覧と決まり（v0.6.0。DESIGN §16）。今は 2048 だけ。
// 「まず」2048 から：ほかのゲームを足すときは GAMES に足し、floor.json の decor に game / ranking を置く。

import { FLOOR, type Face, type Floor, type Point } from './floor';

export interface GameInfo {
  id: string;
  /** 窓の見出し・看板・チャットの案内に出す名前 */
  title: string;
  /** 窓の中の iframe のページ（クライアントの public/ からの相対パス） */
  page: string;
}

/** 遊べるゲーム（id は URL の /api/games/:game に使う） */
export const GAMES: readonly GameInfo[] = [{ id: '2048', title: '2048', page: 'games/2048/index.html' }];

export const isGameId = (v: unknown): v is string => typeof v === 'string' && GAMES.some((g) => g.id === v);
export const gameInfo = (id: string): GameInfo | undefined => GAMES.find((g) => g.id === id);

/** ゲームの筐体（floor.json の decor の game） */
export interface GameSpot extends Point {
  /** 1 から（decor の中の game の並び順） */
  id: number;
  game: string;
  face: Face;
}

/** ランキングの立て看板（floor.json の decor の ranking） */
export interface RankingSpot extends Point {
  id: number;
  game: string;
  face: Face;
}

/** ゲームの筐体（game を付けるとそのゲームだけ。GAMES に無いゲームは入れない） */
export const gameSpots = (f: Floor = FLOOR, game?: string): GameSpot[] =>
  f.decor
    .filter((d) => d.type === 'game')
    .map((d, i) => ({ id: i + 1, game: d.game ?? '', x: d.x, y: d.y, face: d.face ?? ('S' as Face) }))
    .filter((s) => isGameId(s.game) && (!game || s.game === game));

export const gameSpot = (id: number, f: Floor = FLOOR): GameSpot | undefined => gameSpots(f).find((s) => s.id === id);

export const rankingSpots = (f: Floor = FLOOR, game?: string): RankingSpot[] =>
  f.decor
    .filter((d) => d.type === 'ranking')
    .map((d, i) => ({ id: i + 1, game: d.game ?? '', x: d.x, y: d.y, face: d.face ?? ('S' as Face) }))
    .filter((s) => isGameId(s.game) && (!game || s.game === game));

/** 遊べる距離（チェビシェフ距離。筐体・クレーンゲームと同じ） */
export const GAME_NEAR = 2;

/** 速すぎる手：始めてからの時間が「手の数 × これ」より短ければ断る */
export const GAME_MOVE_MIN_MS = 40;
/** 1 ゲームの手の数の上限 */
export const GAME_MAX_MOVES = 200_000;
/** 始めたゲーム（セッション）を覚えておく時間 */
export const GAME_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** ランキングの窓に出す人数 */
export const RANKING_LIST_MAX = 50;
/** 立て看板に描く人数（総合の上位） */
export const RANKING_POSTER_TOP = 5;
/** チャットに案内する順位（自己ベストで総合 10 位以内か今月 3 位以内） */
export const RANKING_ANNOUNCE = { all: 10, month: 3 } as const;

export type RankingPeriod = 'all' | 'month';
export const isRankingPeriod = (v: unknown): v is RankingPeriod => v === 'all' || v === 'month';

const JST_MS = 9 * 60 * 60 * 1000;

/** その時刻の日本時間の月の初め（ms）。Intl を使わない */
export const jstMonthStart = (now: number): number => {
  const d = new Date(now + JST_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - JST_MS;
};

/** 点数の表示（3 桁ごとのカンマ） */
export const formatScore = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
