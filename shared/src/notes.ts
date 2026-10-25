// コミュニケーションノート（DESIGN §12）と機能追加要望箱（DESIGN §13）：検証・ページ分けの純粋関数。

import { FLOOR, type Floor } from './floor';
import { NAME_MAX } from './looks';
import { charLength, hasNgWord, stripControl, tidy } from './text';

// ---------------------------------------------------------------- ノート

export const NOTE_LIMITS = {
  name: NAME_MAX,
  /** 文章の文字数（改行は数えない） */
  text: 90,
  /** 行数（改行は 2 回まで） */
  lines: 3,
} as const;
/** 1 ページの件数 */
export const NOTES_PER_PAGE = 4;
/** 残す件数（超えたら古いものから消す） */
export const NOTE_MAX_TOTAL = 2000;
/** 一覧を 1 回に読む件数 */
export const NOTE_FETCH = 120;
/** ノート・要望箱まで「近い」（チェビシェフ距離） */
export const NOTE_NEAR = 2;

export interface NoteView {
  id: number;
  at: number;
  /** 書いた人の公開 ID（自分の分を消せるか見るため） */
  pid: string;
  name: string;
  text: string;
}

export interface NoteInput {
  name: string;
  text: string;
}

export interface NotesResponse {
  /** 全体の件数 */
  total: number;
  /** 古い順（新しいものから NOTE_FETCH 件、before があればそれより古いもの） */
  notes: NoteView[];
}

export interface ItemError {
  code: 'bad-input' | 'too-long' | 'ng';
  message: string;
}

/** 文章を整える：改行は残す（\r\n → \n）・ほかの制御文字は空白・行ごとに前後の空白を落とす・空の行を詰める */
export const tidyNoteText = (s: string): string =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => stripControl(l).replace(/\s+/g, ' ').trim())
    .filter((l) => l)
    .join('\n');

export const validateNote = (input: unknown): { value?: NoteInput; error?: ItemError } => {
  if (!input || typeof input !== 'object') return { error: { code: 'bad-input', message: '内容が読めません' } };
  const o = input as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.text !== 'string') return { error: { code: 'bad-input', message: '名前と文章を入れてください' } };
  const name = tidy(o.name);
  const text = tidyNoteText(o.text);
  if (!name) return { error: { code: 'bad-input', message: '名前を入れてください' } };
  if (charLength(name) > NOTE_LIMITS.name) return { error: { code: 'too-long', message: `名前は ${NOTE_LIMITS.name} 文字までです` } };
  if (!text) return { error: { code: 'bad-input', message: '文章を入れてください' } };
  if (text.split('\n').length > NOTE_LIMITS.lines) return { error: { code: 'too-long', message: `文章は ${NOTE_LIMITS.lines} 行までです` } };
  if (charLength(text.replace(/\n/g, '')) > NOTE_LIMITS.text) return { error: { code: 'too-long', message: `文章は ${NOTE_LIMITS.text} 文字までです` } };
  if (hasNgWord(name)) return { error: { code: 'ng', message: '名前に使えない言葉が含まれています' } };
  if (hasNgWord(text)) return { error: { code: 'ng', message: '文章に使えない言葉が含まれています' } };
  return { value: { name, text } };
};

/** ページの数（0 件でも 1 ページ） */
export const notePageCount = (total: number, perPage = NOTES_PER_PAGE): number => Math.max(1, Math.ceil(total / perPage));

/** 見開き（perView = 2）・1 ページずつ（perView = 1）の数 */
export const noteViewCount = (total: number, perView: number, perPage = NOTES_PER_PAGE): number =>
  Math.ceil(notePageCount(total, perPage) / perView);

/** view 番目の見開きのページの番号（0 から。ページ数を超えるものは入れない） */
export const viewPages = (view: number, perView: number, total: number, perPage = NOTES_PER_PAGE): number[] => {
  const pages = notePageCount(total, perPage);
  const out: number[] = [];
  for (let i = 0; i < perView; i++) {
    const p = view * perView + i;
    if (p < pages) out.push(p);
  }
  return out;
};

/** page 番目のページに載る件（古い順の通し番号の範囲。end は含まない） */
export const pageRange = (page: number, total: number, perPage = NOTES_PER_PAGE): { start: number; end: number } => {
  const start = Math.min(total, page * perPage);
  return { start, end: Math.min(total, start + perPage) };
};

/** その通し番号の件が載っている見開き */
export const viewOfIndex = (index: number, perView: number, perPage = NOTES_PER_PAGE): number => Math.floor(Math.floor(index / perPage) / perView);

/** 見開きを変えたとき（1 ページずつ ⇄ 見開き）、今見ているページが入る見開き */
export const convertView = (view: number, fromPerView: number, toPerView: number): number => Math.floor((view * fromPerView) / toPerView);

/** 日時の表示（例 10/25 21:03） */
export const formatNoteTime = (t: number): string => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- 要望箱

export const REQUEST_KINDS = [
  { id: 'feature', label: '新しい機能', color: '#22e6ff' },
  { id: 'bug', label: '不具合', color: '#ff6b93' },
  { id: 'other', label: 'そのほか', color: '#7cff6b' },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]['id'];
export const isRequestKind = (v: unknown): v is RequestKind => REQUEST_KINDS.some((k) => k.id === v);
export const requestKindLabel = (k: string): string => REQUEST_KINDS.find((x) => x.id === k)?.label ?? 'そのほか';
export const requestKindColor = (k: string): string => REQUEST_KINDS.find((x) => x.id === k)?.color ?? '#7cff6b';

export const REQUEST_STATUSES = ['new', 'read', 'done'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const isRequestStatus = (v: unknown): v is RequestStatus => (REQUEST_STATUSES as readonly unknown[]).includes(v);

export const REQUEST_LIMITS = { text: 500, name: NAME_MAX } as const;
/** 残す件数（超えたら古いものから消す） */
export const REQUEST_MAX_TOTAL = 1000;

export interface RequestInput {
  kind: RequestKind;
  text: string;
  /** null = 名前を出さない */
  name: string | null;
}

/** 管理者だけが読む */
export interface RequestView extends RequestInput {
  id: number;
  at: number;
  status: RequestStatus;
}

export interface RequestsResponse {
  requests: RequestView[];
  unread: number;
}

/** 本文を整える：改行は残す・ほかの制御文字は空白・3 行以上の空行は 2 行に */
const tidyLong = (s: string): string =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => stripControl(l).replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** 要望の検証。NG 語では断らない（要望の中身なので）。長さの上限は守る */
export const validateRequest = (input: unknown): { value?: RequestInput; error?: ItemError } => {
  if (!input || typeof input !== 'object') return { error: { code: 'bad-input', message: '内容が読めません' } };
  const o = input as Record<string, unknown>;
  const kind = o.kind ?? 'other';
  if (!isRequestKind(kind)) return { error: { code: 'bad-input', message: '種類が不正です' } };
  if (typeof o.text !== 'string') return { error: { code: 'bad-input', message: '要望を書いてください' } };
  const text = tidyLong(o.text);
  if (!text) return { error: { code: 'bad-input', message: '要望を書いてください' } };
  if (charLength(text) > REQUEST_LIMITS.text) return { error: { code: 'too-long', message: `要望は ${REQUEST_LIMITS.text} 文字までです` } };
  let name: string | null = null;
  if (o.name !== null && o.name !== undefined) {
    if (typeof o.name !== 'string') return { error: { code: 'bad-input', message: '名前が読めません' } };
    name = tidy(o.name) || null;
    if (name && charLength(name) > REQUEST_LIMITS.name) return { error: { code: 'too-long', message: `名前は ${REQUEST_LIMITS.name} 文字までです` } };
  }
  return { value: { kind, text, name } };
};

// ---------------------------------------------------------------- 店内の置き場所（floor.json の decor）

export interface DecorSpot {
  x: number;
  y: number;
}

/** ノートの机（floor.json の decor の note） */
export const noteSpots = (f: Floor = FLOOR): DecorSpot[] => f.decor.filter((d) => d.type === 'note').map((d) => ({ x: d.x, y: d.y }));
/** 要望箱（floor.json の decor の requestbox） */
export const requestBoxSpots = (f: Floor = FLOOR): DecorSpot[] =>
  f.decor.filter((d) => d.type === 'requestbox').map((d) => ({ x: d.x, y: d.y }));
