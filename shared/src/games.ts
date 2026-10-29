// ゲーム筐体で遊べるゲームの一覧と決まり（v0.6.0。DESIGN §16）。2048 と Columns like game（§16.8）と Hextris（§16.9）。
// ゲームを足すときは GAMES に足し、floor.json の decor に game を置いて rankingWall の games に足し、gameRecord.ts になぞり直しを足し、
// クライアントの GameDialog（iframe とのやりとり）・render.ts（筐体の画面の絵）に足す。

import { FLOOR, type Face, type Floor, type Point, type WallSpan } from './floor';

export interface GameInfo {
  id: string;
  /** 窓の見出し・看板・チャットの案内に出す名前 */
  title: string;
  /** 窓の中の iframe のページ（クライアントの public/ からの相対パス） */
  page: string;
  /** 筐体の看板・ランキングのポスターの見出し（英大文字。ポスターは「〇〇」と「RANKING」） */
  sign: string;
}

/** 遊べるゲーム（id は URL の /api/games/:game に使う。並びはランキングの窓のタブの順） */
export const GAMES: readonly GameInfo[] = [
  { id: '2048', title: '2048', page: 'games/2048/index.html', sign: '2048' },
  // 「Columns」はセガのゲームの名前（元のコードは非公式のクローン）なので、画面には「Columns like game」と出す（DESIGN §16.8 ✅ ユーザー指定）
  { id: 'columns', title: 'Columns like game', page: 'games/columns/index.html', sign: 'COLUMNS LIKE' },
  // Hextris（GNU GPL v3。client/public/games/hextris/ のフォルダだけ GPLv3。DESIGN §16.9）。記録はブラウザの申告（なぞり直さない）
  { id: 'hextris', title: 'Hextris', page: 'games/hextris/index.html', sign: 'HEXTRIS' },
];

/** 記録をサーバがなぞり直さない（ブラウザの申告の）ゲーム。ランキングの窓に注意書きを出す */
export const SELF_REPORTED_GAMES: readonly string[] = ['hextris'];

export const isGameId = (v: unknown): v is string => typeof v === 'string' && GAMES.some((g) => g.id === v);
export const gameInfo = (id: string): GameInfo | undefined => GAMES.find((g) => g.id === id);

/** ゲームの筐体（floor.json の decor の game） */
export interface GameSpot extends Point {
  /** 1 から（decor の中の game の並び順） */
  id: number;
  game: string;
  face: Face;
}

/** ランキングのポスター（floor.json の rankingWall。壁に貼る。DESIGN §16.11） */
export interface RankingSpot {
  /** 1 から（rankingWall の games の並び順） */
  id: number;
  game: string;
  /** 壁の上の何枚目か（0 から。手前から奥へ）と枚数 */
  index: number;
  count: number;
  wall: WallSpan['wall'];
}

/** ゲームの筐体（game を付けるとそのゲームだけ。GAMES に無いゲームは入れない） */
export const gameSpots = (f: Floor = FLOOR, game?: string): GameSpot[] =>
  f.decor
    .filter((d) => d.type === 'game')
    .map((d, i) => ({ id: i + 1, game: d.game ?? '', x: d.x, y: d.y, face: d.face ?? ('S' as Face) }))
    .filter((s) => isGameId(s.game) && (!game || s.game === game));

export const gameSpot = (id: number, f: Floor = FLOOR): GameSpot | undefined => gameSpots(f).find((s) => s.id === id);

/** ランキングのポスター（game を付けるとそのゲームだけ。GAMES に無いゲームは入れない。並びの場所は貼った順のまま） */
export const rankingSpots = (f: Floor = FLOOR, game?: string): RankingSpot[] => {
  const w = f.rankingWall;
  if (!w) return [];
  return w.games
    .map((g, i) => ({ id: i + 1, game: g, index: i, count: w.games.length, wall: w.wall }))
    .filter((s) => isGameId(s.game) && (!game || s.game === game));
};

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
/** ランキングのポスターに描く人数（総合の上位） */
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
