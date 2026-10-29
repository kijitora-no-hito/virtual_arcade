// ほかの人のプレイを見る（観戦。v0.6.0。DESIGN §16.10）の決まり。同じ部屋の人だけ・サーバは中継だけ（保存しない）。
// - 2048：遊ぶ人の手（0〜3 と K）を中継し、見る人の iframe が「見るだけ」でなぞる（途中から見る人には、それまでの手をまとめて）
// - Columns like game・Hextris：見る人がいる間だけ、遊ぶ人の画面（Canvas）を縮めた画像を 1 秒に数枚送る

/** 既定の上限（環境変数で変えられる：SPECTATE_MAX_VIEWERS・SPECTATE_FPS・SPECTATE_MAX_STREAMS） */
export const SPECTATE_DEFAULTS = {
  /** 1 人を見られる人数 */
  maxViewers: 8,
  /** 画像は 1 秒に何枚まで */
  fps: 5,
  /** 同時に見られている人（遊んでいる人）の合計 */
  maxStreams: 6,
  /** 1 枚の画像の大きさ（バイト） */
  frameMaxBytes: 32 * 1024,
} as const;

/** WebSocket の 1 通の大きさの上限：ふつうは 4 KB、観戦の画像と 2048 の手のまとめだけ 48 KB */
export const WS_MAX_BYTES = 4 * 1024;
export const WS_SPECTATE_MAX_BYTES = 48 * 1024;
/** 大きなメッセージを送ってよい種類 */
export const WS_BIG_TYPES: readonly string[] = ['spec-frame', 'spec-sync'];

/** 画像の幅（遊ぶ人のブラウザが Canvas をこの幅に縮める）と品質 */
export const SPECTATE_FRAME_WIDTH = 320;
export const SPECTATE_FRAME_QUALITY = 0.6;

/** 画像で見せるゲーム（Canvas のゲーム）。2048 は手の中継 */
export const FRAME_GAMES: readonly string[] = ['columns', 'hextris'];
export const isFrameGame = (game: string | null | undefined): boolean => !!game && FRAME_GAMES.includes(game);

/** 2048 の手のまとめ（spec-sync）の上限の文字数。超えたら途中からは見られない（とても長いゲーム） */
export const SPECTATE_2048_SYNC_MAX = 45_000;
/** 2048 の手（spec-moves）の 1 通の上限の文字数 */
export const SPECTATE_2048_MOVES_MAX = 2_000;

/** 見る人の窓に添える文字（画像とは別。点数など） */
export interface SpectateInfo {
  score: number;
  /** Columns like game のレベル */
  level?: number;
  /** play = 遊んでいる・paused = 一時停止・over = ゲームオーバー・idle = 始める前 */
  state?: 'play' | 'paused' | 'over' | 'idle';
}

const STATES = ['play', 'paused', 'over', 'idle'];

/** 添える文字の形を確かめて整える（おかしければ null） */
export const cleanSpectateInfo = (raw: unknown): SpectateInfo | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const score = Number(o.score);
  if (!Number.isFinite(score) || score < 0 || score > 1e12) return null;
  const info: SpectateInfo = { score: Math.floor(score) };
  if (o.level !== undefined) {
    const lv = Number(o.level);
    if (Number.isInteger(lv) && lv >= 0 && lv <= 1000) info.level = lv;
  }
  if (typeof o.state === 'string' && STATES.includes(o.state)) info.state = o.state as SpectateInfo['state'];
  return info;
};

const FRAME_RE = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** 画像（data URL）の形と大きさを確かめる。よければデコードしたバイト数、だめなら -1 */
export const frameBytes = (raw: unknown, maxBytes: number = SPECTATE_DEFAULTS.frameMaxBytes): number => {
  if (typeof raw !== 'string' || raw.length > 64 + Math.ceil((maxBytes * 4) / 3) + 4) return -1;
  const m = FRAME_RE.exec(raw);
  if (!m) return -1;
  const b64 = m[2];
  if (b64.length % 4 !== 0) return -1;
  const bytes = (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return bytes > 0 && bytes <= maxBytes ? bytes : -1;
};

/** 2048 の手の並び（spec-sync・spec-moves）の形 */
export const SPEC_MOVES_RE = /^[0-3K]*$/;
