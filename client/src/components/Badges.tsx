// クレーンゲームのバッジ（♠♡♦♧）を名前の後ろに付けて出す。色は 4 色のトランプ（暗い背景向け）。

import { isSuit } from '@va/shared';

/** 暗い背景での色 / 明るい背景（自分の名札の黄色など）での色 */
export const SUIT_COLORS: Record<string, { dark: string; light: string }> = {
  '♠': { dark: '#ffffff', light: '#1a1300' },
  '♡': { dark: '#ff6b93', light: '#c8102e' },
  '♦': { dark: '#5cc8ff', light: '#0a56c2' },
  '♧': { dark: '#72ff94', light: '#087a2b' },
};

export const suitColor = (s: string, light = false): string => (light ? SUIT_COLORS[s]?.light : SUIT_COLORS[s]?.dark) ?? '#fff';

export const Badges = ({ badges, light = false }: { badges?: string | null; light?: boolean }) => {
  if (!badges) return null;
  return (
    <span className="badges" aria-label={`バッジ ${badges}`}>
      {[...badges].filter(isSuit).map((s, i) => (
        <span key={i} style={{ color: suitColor(s, light) }}>
          {s}
        </span>
      ))}
    </span>
  );
};

/** 名前＋バッジ */
export const NameBadges = ({ name, badges, light }: { name: string; badges?: string | null; light?: boolean }) => (
  <>
    {name}
    <Badges badges={badges} light={light} />
  </>
);
