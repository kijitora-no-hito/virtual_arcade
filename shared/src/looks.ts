// キャラクターの見た目・名前・エモーション。

import { charLength, hasNgWord, tidy } from './text';

/** 体の色（8 種） */
export const BODY_COLORS = [
  { id: 'red', label: '赤', color: '#ff4d5e' },
  { id: 'orange', label: 'だいだい', color: '#ff9a3d' },
  { id: 'yellow', label: '黄', color: '#ffd93d' },
  { id: 'green', label: '緑', color: '#4fdc6a' },
  { id: 'cyan', label: '水色', color: '#3dd8ff' },
  { id: 'blue', label: '青', color: '#4d7bff' },
  { id: 'purple', label: '紫', color: '#a970ff' },
  { id: 'pink', label: 'ピンク', color: '#ff70c8' },
] as const;

/** 帽子・髪など（6 種） */
export const HEADWEAR = [
  { id: 'none', label: 'なし' },
  { id: 'cap', label: 'キャップ' },
  { id: 'beanie', label: 'ニット帽' },
  { id: 'spiky', label: 'ツンツン髪' },
  { id: 'headphones', label: 'ヘッドホン' },
  { id: 'ribbon', label: 'リボン' },
] as const;

export type BodyColorId = (typeof BODY_COLORS)[number]['id'];
export type HeadwearId = (typeof HEADWEAR)[number]['id'];

export interface Look {
  color: BodyColorId;
  hat: HeadwearId;
}

export const DEFAULT_LOOK: Look = { color: 'cyan', hat: 'none' };

export const isLook = (v: unknown): v is Look => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return BODY_COLORS.some((c) => c.id === o.color) && HEADWEAR.some((h) => h.id === o.hat);
};

export const bodyColor = (id: string): string => BODY_COLORS.find((c) => c.id === id)?.color ?? '#3dd8ff';

/** 名前の文字数 */
export const NAME_MAX = 20;

/** 名前の検証。正しければ整えた名前、だめなら理由（文字列で返す） */
export const checkName = (v: unknown): { name?: string; error?: string } => {
  if (typeof v !== 'string') return { error: '名前を入れてください' };
  const t = tidy(v);
  const n = charLength(t);
  if (n < 1) return { error: '名前を入れてください' };
  if (n > NAME_MAX) return { error: `名前は ${NAME_MAX} 文字までです` };
  if (hasNgWord(t)) return { error: '名前に使えない言葉が含まれています' };
  return { name: t };
};

/** エモーション（ボタンの並び順） */
export const EMOTES = ['👍', '😂', '😮', '👏', '❤️', '👋', '🎉', '🔥'] as const;
export type Emote = (typeof EMOTES)[number];
export const isEmote = (v: unknown): v is Emote => typeof v === 'string' && (EMOTES as readonly string[]).includes(v);

/**
 * v0.6.0：ポーズ（DESIGN §16.7）。エモーションと違って状態として持ち、動く（歩く・座る・ゲームを始める・部屋を移る）まで続く。
 * vega = ベガ立ち（胸の前で腕を組んで立つ。頭上に腕組みの印）
 */
export const STANCES = ['vega'] as const;
export type Stance = (typeof STANCES)[number];
export const isStance = (v: unknown): v is Stance => typeof v === 'string' && (STANCES as readonly string[]).includes(v);

/** エモーションを頭上に出す時間 */
export const EMOTE_MS = 2600;
/** 吹き出しを出す時間 */
export const BUBBLE_MS = 6000;
/** 吹き出しに出す文字数（超えたら …） */
export const BUBBLE_CHARS = 28;

/** チャットの 1 回の文字数 */
export const CHAT_MAX = 200;
/** チャットを残す件数 */
export const CHAT_KEEP = 200;
/** お知らせの文字数 */
export const NOTICE_MAX = 120;
