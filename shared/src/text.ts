// 文字列の後始末と NG 語の照合。

import ngJson from '../data/ngwords.json';

/** 消す文字の範囲（制御文字・ゼロ幅・行区切り・書式の文字） */
const CONTROL_RANGES: Array<[number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];
const CONTROL_RE = new RegExp(
  `[${CONTROL_RANGES.map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('')}]`,
  'g',
);

/** 制御文字（改行・タブを含む）・書式の文字（ゼロ幅など）を空白に */
export const stripControl = (s: string): string => s.replace(CONTROL_RE, ' ');

/** 文字数（サロゲートペアを 1 文字として数える） */
export const charLength = (s: string): number => [...s].length;

/** 前後の空白を落とし、続く空白を 1 つにする */
export const tidy = (s: string): string => stripControl(s).replace(/\s+/g, ' ').trim();

/** 長い文を max 文字で切って「…」を付ける */
export const ellipsis = (s: string, max: number): string => {
  const a = [...s];
  return a.length <= max ? s : `${a.slice(0, Math.max(1, max - 1)).join('')}…`;
};

/**
 * 照合用にならす：NFKC（全角英数→半角・半角カナ→全角）、小文字、カタカナ→ひらがな、
 * 空白・記号・長音・句読点を取り除く（「死 ね」「ｼ・ﾈ」のような書き方もまとめる）。
 */
export const normalizeForNg = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}ー〜~・]/gu, '');

const NG_WORDS: string[] = (ngJson as { words: string[] }).words.map(normalizeForNg).filter(Boolean);

/** NG 語を含むか（words を渡さなければ data/ngwords.json の一覧） */
export const hasNgWord = (text: string, words: string[] = NG_WORDS): boolean => {
  const n = normalizeForNg(text);
  if (!n) return false;
  return words.some((w) => {
    const nw = words === NG_WORDS ? w : normalizeForNg(w);
    return !!nw && n.includes(nw);
  });
};
