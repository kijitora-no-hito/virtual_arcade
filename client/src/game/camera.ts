// スマホのレイアウトのカメラ（DESIGN §11.4）。純粋な計算だけ（テストあり）。
// カメラの中心 (cx, cy) は「拡大率 1 のときの画面の座標」（タイルの角 (0,0) が原点。iso.ts の toScreen から ox / oy を除いたもの）。
// PC のレイアウトはカメラを使わない（fitView のまま）。

import type { Floor } from '@va/shared';
import { fitView, TH, TW, WALL_H, type View } from './iso';

export interface Camera {
  cx: number;
  cy: number;
  /** 拡大率 */
  s: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** 既定の倍率 = 店全体が入る倍率 × これ */
export const DEFAULT_ZOOM = 2.4;
/** いちばん拡大したとき = 店全体が入る倍率 × これ（ただし MAX_SCALE まで） */
export const MAX_ZOOM = 5;
export const MAX_SCALE = 2.2;
/** 文字の倍率（頭上の名前・吹き出しなど）：拡大率をこの範囲に収める */
export const TEXT_MIN = 1;
export const TEXT_MAX = 1.4;
/** タップとみなす動いた距離（px） */
export const TAP_SLOP = 10;
/** 長押し（動かさずにこの時間）：物の陰の床でも、指の下の床へ歩く（ms） */
export const LONG_PRESS_MS = 450;
/** 見回してから自分の所へ戻るまで（ms） */
export const FREE_LOOK_MS = 3000;
/** 追従の速さ（1 秒あたり） */
export const FOLLOW_RATE = 6;
/** キャラクターのどの高さを画面の中心にするか（体の真ん中あたり） */
export const FOLLOW_Z = 40;

const TOP_PAD = 44;
const BOTTOM_PAD = 24;
const SIDE_PAD = 24;

/** 店の範囲（拡大率 1 の画面の座標） */
export const floorBounds = (f: Floor) => ({
  minX: -f.rows * (TW / 2) - SIDE_PAD,
  maxX: f.cols * (TW / 2) + SIDE_PAD,
  minY: -WALL_H - TOP_PAD,
  maxY: (f.cols + f.rows) * (TH / 2) + BOTTOM_PAD,
});

/** 倍率の範囲（いちばん縮小 = 店全体が入る） */
export const zoomLimits = (w: number, h: number, f: Floor) => {
  const fit = fitView(w, h, f).s;
  const max = Math.max(fit, Math.min(MAX_SCALE, fit * MAX_ZOOM));
  return { fit, min: fit, max, def: clamp(fit * DEFAULT_ZOOM, fit, max) };
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** カメラ → View（iso.ts の toScreen / fromScreen がそのまま使える）。ts は文字の倍率 */
export const cameraView = (cam: Camera, w: number, h: number): View => ({
  s: cam.s,
  ox: w / 2 - cam.cx * cam.s,
  oy: h / 2 - cam.cy * cam.s,
  w,
  h,
  ts: clamp(cam.s, TEXT_MIN, TEXT_MAX),
});

/**
 * カメラの中心を店の範囲に収める（画面より店が小さい向きは真ん中）。倍率も範囲に収める。
 * margin（画面の px）だけ店の端の外まで動かせる：端のマスを画面の内側（宣伝の吹き出し・ボタンの無い所）まで寄せてタップできるように。
 */
export const clampCamera = (cam: Camera, w: number, h: number, f: Floor, margin: { x: number; y: number } = { x: 0, y: 0 }): Camera => {
  const lim = zoomLimits(w, h, f);
  const s = clamp(cam.s, lim.min, lim.max);
  const b = floorBounds(f);
  const hw = w / 2 / s;
  const hh = h / 2 / s;
  const mx = margin.x / s;
  const my = margin.y / s;
  const cx = b.maxX - b.minX <= 2 * hw ? (b.minX + b.maxX) / 2 : clamp(cam.cx, b.minX + hw - mx, b.maxX - hw + mx);
  const cy = b.maxY - b.minY <= 2 * hh ? (b.minY + b.maxY) / 2 : clamp(cam.cy, b.minY + hh - my, b.maxY - hh + my);
  return { cx, cy, s };
};

/** スマホ：店の端の外まで動かせる量（画面の px）。下は画面の下端に出る宣伝の吹き出しの分を多めに */
export const mobileMargin = (w: number, h: number) => ({ x: Math.round(w * 0.18), y: Math.round(h * 0.3) });

/** 追う先：キャラクター（タイル座標の小数）の体の真ん中 */
export const followTarget = (gx: number, gy: number): Pt => ({
  x: (gx - gy) * (TW / 2),
  y: (gx + gy + 1) * (TH / 2) - FOLLOW_Z,
});

/** なめらかに追う（dt 秒） */
export const stepFollow = (cam: Camera, target: Pt, dt: number, rate = FOLLOW_RATE): Camera => {
  const k = 1 - Math.exp(-dt * rate);
  return { cx: cam.cx + (target.x - cam.cx) * k, cy: cam.cy + (target.y - cam.cy) * k, s: cam.s };
};

/** 1 本指のドラッグ：指の動き (dx, dy) の分だけ店が動く（カメラは逆へ） */
export const dragCamera = (start: Camera, dx: number, dy: number): Camera => ({
  cx: start.cx - dx / start.s,
  cy: start.cy - dy / start.s,
  s: start.s,
});

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 2 本指のピンチ：始めの 2 点 (a0, b0) → 今の 2 点 (a1, b1)。倍率は指の間の距離の比。
 * 始めの指の間の点の下にあった店の点が、今の指の間の点の下に来るように中心を動かす（拡大しながらずらせる）。
 * 倍率は [min, max] に収める（中心の範囲は呼ぶ側が clampCamera で）。
 */
export const pinchCamera = (start: Camera, a0: Pt, b0: Pt, a1: Pt, b1: Pt, w: number, h: number, min: number, max: number): Camera => {
  const d0 = Math.max(1, dist(a0, b0));
  const s = clamp(start.s * (dist(a1, b1) / d0), min, max);
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  // 始めの指の間の点が指していた店の点
  const wx = start.cx + (m0.x - w / 2) / start.s;
  const wy = start.cy + (m0.y - h / 2) / start.s;
  return { cx: wx - (m1.x - w / 2) / s, cy: wy - (m1.y - h / 2) / s, s };
};

/** ホイール（マウス）：カーソルの下の点を動かさずに倍率を factor 倍 */
export const zoomAt = (cam: Camera, p: Pt, factor: number, w: number, h: number, min: number, max: number): Camera => {
  const s = clamp(cam.s * factor, min, max);
  const wx = cam.cx + (p.x - w / 2) / cam.s;
  const wy = cam.cy + (p.y - h / 2) / cam.s;
  return { cx: wx - (p.x - w / 2) / s, cy: wy - (p.y - h / 2) / s, s };
};

/** 指が触れてから離すまで：動いた距離の最大と、2 本目の指が触れたか → タップかどうか */
export const isTap = (maxMove: number, multi: boolean, slop = TAP_SLOP): boolean => !multi && maxMove <= slop;

/** 見回し（ドラッグ・ピンチ）のあと、自分の所へ戻すか */
export const shouldReturn = (freeUntil: number | null, now: number, touching: boolean): boolean =>
  freeUntil !== null && !touching && now >= freeUntil;

/**
 * 床・壁を 1 回だけ描く大きな canvas の View（店全体 + 余白。拡大率 s）。
 * 毎フレームは、この canvas を今の View に合わせてずらして（倍率が違えば拡大して）貼る：
 * この canvas の点 (x, y) → 今の画面の点 (v.ox + (x - wv.ox) * k, v.oy + (y - wv.oy) * k)、k = v.s / wv.s。
 */
export const worldView = (f: Floor, s: number): View => {
  const b = floorBounds(f);
  // 余白：スマホは店の端の外まで少し動かせる（mobileMargin）ので、その分も床の外の背景を描いておく
  const m = 240;
  return { s, ox: (-b.minX + m) * s, oy: (-b.minY + m) * s, w: (b.maxX - b.minX + 2 * m) * s, h: (b.maxY - b.minY + 2 * m) * s };
};

/** 大きな canvas の 1 px あたりの画素（端末の倍率。大きすぎる canvas にならないよう、長い辺 4096・全体 1600 万画素まで） */
export const worldPixelRatio = (wv: View, dpr: number): number =>
  Math.max(0.25, Math.min(dpr, 4096 / Math.max(wv.w, wv.h), Math.sqrt(16_000_000 / (wv.w * wv.h))));

/** 大きな canvas を今の View のどこに貼るか（CSS px） */
export const worldBlit = (wv: View, v: View) => {
  const k = v.s / wv.s;
  return { x: v.ox - wv.ox * k, y: v.oy - wv.oy * k, w: wv.w * k, h: wv.h * k };
};
