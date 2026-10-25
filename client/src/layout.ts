// PC / スマホのレイアウトの切り替え（DESIGN §11.1）。判断は純粋な関数（テストあり）、useLayout は画面の大きさ・回転に追従する。

import { useEffect, useState } from 'react';

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

const read = (): Layout =>
  decideLayout({
    width: window.innerWidth,
    height: window.innerHeight,
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    mobileUa: isMobileUa(navigator.userAgent, (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile),
    force: forcedLayout(location.search),
  });

/** 今のレイアウト。<html> の class（layout-mobile・orient-portrait / orient-landscape）も付け替える */
export const useLayout = (): Layout => {
  const [layout, setLayout] = useState<Layout>(read);
  useEffect(() => {
    const update = () =>
      setLayout((prev) => {
        const next = read();
        return prev.kind === next.kind && prev.landscape === next.landscape ? prev : next;
      });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);
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
