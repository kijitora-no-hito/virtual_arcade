// ポスター欄（DESIGN §9）：大会・イベントの告知。検証・自動ではがす時刻・並び順の純粋関数。

import { hasNgWord, stripControl, charLength, tidy } from './text';

export const POSTER_KINDS = [
  { id: 'tournament', label: '大会', color: '#ffe14d' },
  { id: 'match', label: '参加型対戦', color: '#22e6ff' },
  { id: 'event', label: 'イベント', color: '#ff3df0' },
  { id: 'other', label: 'そのほか', color: '#7cff6b' },
] as const;
export type PosterKind = (typeof POSTER_KINDS)[number]['id'];
export const isPosterKind = (v: unknown): v is PosterKind => POSTER_KINDS.some((k) => k.id === v);
export const posterKindLabel = (k: string): string => POSTER_KINDS.find((x) => x.id === k)?.label ?? 'そのほか';
export const posterKindColor = (k: string): string => POSTER_KINDS.find((x) => x.id === k)?.color ?? '#7cff6b';

export const POSTER_LIMITS = {
  title: 40,
  game: 30,
  body: 400,
  url: 300,
} as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 終了が無いときは、開始からこの時間ではがす */
export const POSTER_DEFAULT_SPAN_MS = DAY;
/** 終了は開始からこの時間まで（= どのポスターも開始から 7 日でなくなる） */
export const POSTER_MAX_SPAN_MS = 7 * DAY;
/** 開始はいまからこの先まで */
export const POSTER_MAX_AHEAD_MS = 30 * DAY;
/** 既定：1 人が同時に貼れる枚数 */
export const DEFAULT_POSTER_MAX_PER_USER = 2;
/** 既定：店全体の枚数 */
export const DEFAULT_POSTER_MAX_TOTAL = 40;

export interface PosterInput {
  kind: PosterKind;
  title: string;
  game: string;
  body: string;
  url: string | null;
  startsAt: number;
  endsAt: number | null;
}

export interface PosterView extends PosterInput {
  id: number;
  authorName: string;
  authorPid: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** 自動ではがす時刻 */
  expiresAt: number;
}

export interface PosterError {
  code: 'bad-input' | 'too-long' | 'ng' | 'bad-url' | 'bad-time';
  message: string;
}

/** 自動ではがす時刻：終了、終了が無ければ開始から 1 日 */
export const posterExpiresAt = (p: { startsAt: number; endsAt: number | null }): number =>
  p.endsAt ?? p.startsAt + POSTER_DEFAULT_SPAN_MS;

export const isPosterExpired = (p: { startsAt: number; endsAt: number | null }, now: number): boolean => posterExpiresAt(p) <= now;

/** URL の検証：http(s) だけ・ユーザー名とパスワードなし・ホスト名にドットがある。正しければ整えた URL */
export const checkPosterUrl = (raw: string): string | null => {
  const s = raw.trim();
  if (!s || /\s/.test(s) || charLength(s) > POSTER_LIMITS.url) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.') || u.hostname.endsWith('.')) return null;
  return u.toString();
};

/** URL の表示用のドメイン（www. を除く） */
export const urlDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** 内容（改行は残す。ほかの制御文字は空白、3 行以上の空行は 2 行に） */
const tidyBody = (s: string): string =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => stripControl(l).replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * ポスターの検証。now はサーバの時刻（開始が先すぎないか・もう終わっていないかを見る）。
 */
export const validatePoster = (input: unknown, now: number): { value?: PosterInput; error?: PosterError } => {
  if (!input || typeof input !== 'object') return { error: { code: 'bad-input', message: '内容が読めません' } };
  const o = input as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : null);
  const kind = o.kind ?? 'other';
  if (!isPosterKind(kind)) return { error: { code: 'bad-input', message: '種類が不正です' } };

  const rawTitle = str(o.title);
  const rawGame = str(o.game);
  const rawBody = str(o.body);
  const rawUrl = str(o.url);
  if (rawTitle === null || rawGame === null || rawBody === null || rawUrl === null)
    return { error: { code: 'bad-input', message: '内容が読めません' } };
  const title = tidy(rawTitle);
  const game = tidy(rawGame);
  const body = tidyBody(rawBody);
  if (!title) return { error: { code: 'bad-input', message: '題名を入れてください' } };
  if (charLength(title) > POSTER_LIMITS.title) return { error: { code: 'too-long', message: `題名は ${POSTER_LIMITS.title} 文字までです` } };
  if (charLength(game) > POSTER_LIMITS.game) return { error: { code: 'too-long', message: `ゲーム名は ${POSTER_LIMITS.game} 文字までです` } };
  if (charLength(body) > POSTER_LIMITS.body) return { error: { code: 'too-long', message: `内容は ${POSTER_LIMITS.body} 文字までです` } };
  for (const [label, v] of [
    ['題名', title],
    ['ゲーム名', game],
    ['内容', body],
    ['URL', rawUrl],
  ] as const)
    if (hasNgWord(v)) return { error: { code: 'ng', message: `${label}に使えない言葉が含まれています` } };

  let url: string | null = null;
  if (rawUrl.trim()) {
    url = checkPosterUrl(rawUrl);
    if (!url)
      return { error: { code: 'bad-url', message: `URL は http:// か https:// で始まるもの（${POSTER_LIMITS.url} 文字まで）だけ書けます` } };
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const startsAt = num(o.startsAt);
  if (startsAt === null) return { error: { code: 'bad-time', message: '開始の日時を入れてください' } };
  const endsAt = o.endsAt === undefined || o.endsAt === null || o.endsAt === '' ? null : num(o.endsAt);
  if (endsAt === null && o.endsAt !== undefined && o.endsAt !== null && o.endsAt !== '')
    return { error: { code: 'bad-time', message: '終了の日時が読めません' } };
  if (startsAt > now + POSTER_MAX_AHEAD_MS) return { error: { code: 'bad-time', message: '開始の日時は 30 日先までです' } };
  if (endsAt !== null) {
    if (endsAt <= startsAt) return { error: { code: 'bad-time', message: '終了の日時は開始より後にしてください' } };
    if (endsAt - startsAt > POSTER_MAX_SPAN_MS) return { error: { code: 'bad-time', message: '終了の日時は開始から 7 日までです' } };
  }
  if (posterExpiresAt({ startsAt, endsAt }) <= now) return { error: { code: 'bad-time', message: 'もう終わった日時です' } };
  return { value: { kind, title, game, body, url, startsAt, endsAt } };
};

/** 一覧の順：ピンのもの → 開始の近い順（始まっているものが先）→ 新しい順 */
export const comparePosters = (a: PosterView, b: PosterView): number =>
  Number(b.pinned) - Number(a.pinned) || a.startsAt - b.startsAt || b.createdAt - a.createdAt || b.id - a.id;

export const sortPosters = (list: PosterView[]): PosterView[] => [...list].sort(comparePosters);

/** 大画面に流す「近日のイベント」：開始が within 以内（始まっているものも）で、まだはがれていないもの */
export const upcomingPosters = (list: PosterView[], now: number, within = 7 * DAY, max = 3): PosterView[] =>
  sortPosters(list.filter((p) => p.expiresAt > now && p.startsAt <= now + within))
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, max);

/** 日時の短い表示（例 10/25(土) 21:00） */
export const formatPosterTime = (t: number): string => {
  const d = new Date(t);
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 開始〜終了の表示 */
export const formatPosterRange = (p: { startsAt: number; endsAt: number | null }): string => {
  if (p.endsAt === null) return formatPosterTime(p.startsAt);
  const a = new Date(p.startsAt);
  const b = new Date(p.endsAt);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return sameDay
    ? `${formatPosterTime(p.startsAt)}〜${String(b.getHours()).padStart(2, '0')}:${String(b.getMinutes()).padStart(2, '0')}`
    : `${formatPosterTime(p.startsAt)}〜${formatPosterTime(p.endsAt)}`;
};
