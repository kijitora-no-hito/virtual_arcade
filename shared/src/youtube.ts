// YouTube の URL から動画 ID を取り出す。受け付けるのは次の 3 つの形だけ（ほかのサイト・形は断る）:
//   https://www.youtube.com/watch?v=<ID>   （youtube.com・m.youtube.com も可。ほかのクエリは無視）
//   https://youtu.be/<ID>
//   https://www.youtube.com/live/<ID>
// ID は英数字と - _ の 11 文字。

export interface YouTubeRef {
  id: string;
  /** youtube.com/live/ の形だった（生配信の可能性が高い。サムネイルは hqdefault_live.jpg を先に試す） */
  live: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/** URL の文字列の上限（それより長いものは見ない） */
export const MAX_URL_LENGTH = 300;

export const parseYouTubeUrl = (input: unknown): YouTubeRef | null => {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > MAX_URL_LENGTH || /\s/.test(s)) return null;
  let u: URL;
  try {
    // スキームを省いた貼り付け（youtu.be/xxx）も受け付ける
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    if (parts.length !== 1 || !ID_RE.test(parts[0])) return null;
    return { id: parts[0], live: false };
  }
  if (!WATCH_HOSTS.has(host)) return null;
  if (parts.length === 1 && parts[0] === 'watch') {
    const vs = u.searchParams.getAll('v');
    if (vs.length !== 1 || !ID_RE.test(vs[0])) return null;
    return { id: vs[0], live: false };
  }
  if (parts.length === 2 && parts[0] === 'live' && ID_RE.test(parts[1])) return { id: parts[1], live: true };
  return null;
};

/** 保存・表示に使う URL（取り出した ID から作り直す。貼られた文字列はそのまま使わない） */
export const canonicalYouTubeUrl = (r: YouTubeRef): string =>
  r.live ? `https://www.youtube.com/live/${r.id}` : `https://www.youtube.com/watch?v=${r.id}`;

/** サムネイルの候補（先頭から試す） */
export const thumbnailUrls = (r: YouTubeRef): string[] =>
  r.live
    ? [`https://i.ytimg.com/vi/${r.id}/hqdefault_live.jpg`, `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`]
    : [`https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`];

/** 店内の小さな埋め込み（音なし・操作なし・自動再生） */
export const embedUrlMini = (id: string): string =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&playsinline=1`;

/** 埋め込みのオリジン（視聴画面の再生の状態は、このオリジンからの postMessage だけを受け取る） */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * 視聴画面の大きな埋め込み（音あり・操作可）。origin（このページのオリジン）を渡すと enablejsapi=1 を付け、
 * 再生の状態（再生が始まった など）を postMessage で受け取れるようにする（店内の BGM をフェードアウトするため）
 */
export const embedUrlFull = (id: string, origin?: string): string =>
  `${YOUTUBE_EMBED_ORIGIN}/embed/${id}?autoplay=1&playsinline=1` +
  (origin ? `&enablejsapi=1&origin=${encodeURIComponent(origin)}` : '');
