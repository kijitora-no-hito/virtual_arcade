// 視聴画面の動画と店内の BGM の関係（純粋な関数。テストは client/test/videoDuck.test.ts）。
//
// - 視聴画面の大きな埋め込みで動画が実際に再生を始めたら（YouTube の状態 1 = 再生中）、BGM をフェードアウトして止める。
// - 状態が取れないとき（埋め込みが postMessage を送ってこない）の予備：視聴画面を開いて FALLBACK_MS たったら止める。
//   状態が 1 度でも届いていれば予備は使わない（自動再生が止められて再生していないのに BGM を止めないように）。
// - 動画を一時停止・終了しただけ（視聴画面は開いたまま）では戻さない。視聴画面を閉じて店内に戻ったら BGM をフェードインして再開する。
// - 近くの筐体の小さな配信（音なし）は関係しない。

/** 動画の再生の開始で BGM を小さくしていく時間・店内に戻ったときに戻す時間（秒） */
export const VIDEO_FADE_OUT_SEC = 1.8;
export const VIDEO_FADE_IN_SEC = 1.5;
/** 状態が取れないときの予備：視聴画面を開いてから止めるまで（ms） */
export const FALLBACK_MS = 5000;

/** YouTube の埋め込みの状態（IFrame API の PlayerState） */
export const YT_PLAYING = 1;

export interface DuckState {
  /** 視聴画面を開いている */
  watching: boolean;
  /** BGM を止めている（止めるべき） */
  ducked: boolean;
  /** 埋め込みから状態が 1 度でも届いた */
  gotState: boolean;
  /** 視聴画面を開いた時刻（ms） */
  openedAt: number;
}

export type DuckEvent =
  | { type: 'open'; at: number }
  | { type: 'close' }
  | { type: 'player'; state: number }
  | { type: 'tick'; at: number };

export const DUCK_INITIAL: DuckState = { watching: false, ducked: false, gotState: false, openedAt: 0 };

export const duckReducer = (s: DuckState, e: DuckEvent): DuckState => {
  switch (e.type) {
    case 'open':
      // 別の筐体に切り替えたとき（開いたまま）は、止めた状態を保つ
      return s.watching ? { ...s, gotState: false, openedAt: e.at } : { watching: true, ducked: false, gotState: false, openedAt: e.at };
    case 'close':
      return DUCK_INITIAL;
    case 'player':
      if (!s.watching) return s;
      return { ...s, gotState: true, ducked: s.ducked || e.state === YT_PLAYING };
    case 'tick':
      if (!s.watching || s.ducked || s.gotState || e.at - s.openedAt < FALLBACK_MS) return s;
      return { ...s, ducked: true };
  }
};

const YT_ORIGINS = new Set(['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://youtube.com', 'https://m.youtube.com']);

/** postMessage の送り元が YouTube の埋め込みか */
export const isYouTubeOrigin = (origin: string): boolean => YT_ORIGINS.has(origin);

/**
 * YouTube の埋め込みが送ってくるメッセージから再生の状態（-1 未開始・0 終了・1 再生中・2 一時停止・3 バッファ中・5 頭出し）を取り出す。
 * 送り元のオリジンが YouTube でなければ・形が違えば null。
 * 形：{"event":"onStateChange","info":1} / {"event":"infoDelivery","info":{"playerState":1,…}} /
 *     {"event":"initialDelivery","info":{"playerState":-1,…}}（data は JSON の文字列）
 */
export const playerStateFromMessage = (origin: string, data: unknown): number | null => {
  if (!isYouTubeOrigin(origin)) return null;
  let m: unknown = data;
  if (typeof data === 'string') {
    if (data.length > 100_000) return null;
    try {
      m = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const { event, info } = m as { event?: unknown; info?: unknown };
  const ok = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= -1 && v <= 5 ? v : null);
  if (event === 'onStateChange') return ok(info);
  if ((event === 'infoDelivery' || event === 'initialDelivery') && info && typeof info === 'object')
    return ok((info as { playerState?: unknown }).playerState);
  return null;
};

/** 埋め込みに「状態を知らせて」と頼むメッセージ（IFrame API の外部の手順。届くまで繰り返し送る） */
export const listeningMessage = (id: string): string => JSON.stringify({ event: 'listening', id, channel: 'widget' });
