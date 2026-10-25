// PC / スマホのレイアウトの切り替え（DESIGN §11.1）。判断は純粋な関数（テストあり）、useLayout は画面の大きさ・回転に追従する。

import { useEffect, useMemo, useState } from 'react';

export type LayoutKind = 'pc' | 'mobile';

export interface Layout {
  kind: LayoutKind;
  mobile: boolean;
  /** 横向き（幅 > 高さ） */
  landscape: boolean;
}

/** この幅未満ならスマホのレイアウト */
export const MOBILE_MAX_WIDTH = 900;
/** 指で操作する端末で、短い辺がこれ未満ならスマホのレイアウト（横向きの大きいスマホ） */
export const COARSE_SHORT_SIDE = 600;

/** ?layout=pc / ?layout=mobile（確認用の強制） */
export const forcedLayout = (search: string): LayoutKind | null => {
  const v = new URLSearchParams(search).get('layout');
  return v === 'pc' || v === 'mobile' ? v : null;
};

/**
 * スマホの端末か（ブラウザの申告）。User-Agent Client Hints の mobile、無ければ User-Agent の iPhone / Android の Mobile など。
 * タブレット（iPad・Mobile の無い Android）は入れない（大きさで決める）
 */
export const isMobileUa = (ua: string, uaDataMobile?: boolean): boolean =>
  uaDataMobile === true || /iPhone|iPod|Android.+Mobile|Mobile.+Firefox|Windows Phone|BlackBerry|Opera Mini/i.test(ua);

export const decideLayout = (o: { width: number; height: number; coarse: boolean; mobileUa?: boolean; force?: LayoutKind | null }): Layout => {
  const landscape = o.width > o.height;
  const kind: LayoutKind =
    o.force ??
    (o.mobileUa || o.width < MOBILE_MAX_WIDTH || (o.coarse && Math.min(o.width, o.height) < COARSE_SHORT_SIDE) ? 'mobile' : 'pc');
  return { kind, mobile: kind === 'mobile', landscape };
};

/**
 * 文字を打つ欄か（フォーカスがあるとスマホではソフトキーボードが出る）。input の text 系・textarea・contenteditable。
 * チェックボックス・ボタンなどは入れない
 */
export const isTextEntry = (el: Element | null | undefined): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (tag === 'INPUT') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !(el as HTMLInputElement).readOnly && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(t);
  }
  return (el as HTMLElement).isContentEditable === true;
};

/** レイアウトと、それを決めたときの大きさ（次の判断で「キーボードで高さだけ縮んだ」を見分けるため） */
export interface LayoutState extends Layout {
  width: number;
  height: number;
  /** 端末の画面（screen.orientation）が横か。分からなければ null */
  screenLandscape: boolean | null;
}

export interface LayoutInput {
  width: number;
  height: number;
  coarse: boolean;
  mobileUa?: boolean;
  force?: LayoutKind | null;
  /** 文字の欄にフォーカスがある（スマホではキーボードが出ている・出ようとしている） */
  editing?: boolean;
  /** 端末の画面が横か（screen.orientation。キーボードでは変わらず、回転でだけ変わる）。分からなければ null */
  screenLandscape?: boolean | null;
}

/**
 * 大きさが変わったときの次のレイアウト（v0.4.1）。
 * interactive-widget=resizes-content なので、スマホでキーボードが出ると表示域の高さが縮み（縦向きの 412×915 → 412×400 など）、
 * 幅と高さだけで決めると横向き（・タブレットでは PC → スマホ）に切り替わって、打っている欄が作り直されキーボードが閉じてしまう。そこで
 *  1. 文字の欄にフォーカスがある間は今のレイアウトのまま（大きさは覚え直さない。離れたら決め直す）
 *  2. 幅が同じで高さだけが縮んだ（キーボード・アドレスバー）なら今のレイアウトのまま。ただし端末の画面の向きが変わったら回転として決め直す
 *  3. それ以外（幅が変わった・高さが戻った・回転）は decideLayout で決め直す
 * 回転は幅が変わる（か screen.orientation が変わる）ので、欄から離れていればすぐに切り替わる。
 */
export const nextLayout = (prev: LayoutState | null, o: LayoutInput): LayoutState => {
  const screenLandscape = o.screenLandscape ?? null;
  if (prev) {
    if (o.editing) return prev;
    const rotated = screenLandscape !== null && prev.screenLandscape !== null && screenLandscape !== prev.screenLandscape;
    if (!rotated && o.width === prev.width && o.height < prev.height) return prev;
  }
  return { ...decideLayout(o), width: o.width, height: o.height, screenLandscape };
};

const screenLandscapeNow = (): boolean | null => {
  const t = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  return t ? t.startsWith('landscape') : null;
};

const readInput = (): LayoutInput => ({
  width: window.innerWidth,
  height: window.innerHeight,
  coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  mobileUa: isMobileUa(navigator.userAgent, (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile),
  force: forcedLayout(location.search),
  editing: isTextEntry(document.activeElement),
  screenLandscape: screenLandscapeNow(),
});

/** 今のレイアウト。<html> の class（layout-mobile・orient-portrait / orient-landscape）も付け替える */
export const useLayout = (): Layout => {
  const [state, setState] = useState<LayoutState>(() => nextLayout(null, { ...readInput(), editing: false }));
  useEffect(() => {
    const update = () =>
      setState((prev) => {
        const next = nextLayout(prev, readInput());
        return next === prev ? prev : next;
      });
    // 欄から離れたら決め直す（フォーカスが次の欄へ移るだけのときもあるので、移り終わってから）
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocusOut = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 50);
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    screen.orientation?.addEventListener?.('change', update);
    document.addEventListener('focusout', onFocusOut);
    const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    mq?.addEventListener?.('change', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      screen.orientation?.removeEventListener?.('change', update);
      document.removeEventListener('focusout', onFocusOut);
      mq?.removeEventListener?.('change', update);
    };
  }, []);
  // 向き・種類が同じなら同じオブジェクトを返す（大きさだけ覚え直したときに作り直さない）
  const { kind, landscape } = state;
  const layout = useMemo<Layout>(() => ({ kind, mobile: kind === 'mobile', landscape }), [kind, landscape]);
  useEffect(() => {
    const c = document.documentElement.classList;
    c.toggle('layout-mobile', layout.mobile);
    c.toggle('orient-landscape', layout.mobile && layout.landscape);
    c.toggle('orient-portrait', layout.mobile && !layout.landscape);
  }, [layout]);
  return layout;
};

// ---- スマホの設定（localStorage `va:mobile`）

export interface MobilePrefs {
  /** 近くの筐体の小さな配信を動画で出す（既定はサムネイルの枠） */
  embed: boolean;
  /** 横向き：右のチャットの欄をたたむ */
  chatCollapsed: boolean;
}

const PREFS_KEY = 'va:mobile';

export const loadMobilePrefs = (): MobilePrefs => {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    return { embed: !!v?.embed, chatCollapsed: !!v?.chatCollapsed };
  } catch {
    return { embed: false, chatCollapsed: false };
  }
};

export const saveMobilePrefs = (p: MobilePrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 保存できなくても動く */
  }
};
