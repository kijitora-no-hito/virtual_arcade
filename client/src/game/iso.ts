// クオータービュー（アイソメトリック）の座標変換。
// タイル (x, y) の角 (gx, gy) は画面の ((gx - gy) * TW/2, (gx + gy) * TH/2)。高さ z は上へ。
// 奥 = x + y が小さい方。奥の壁は x = 0 の辺（左奥）と y = 0 の辺（右奥）。

import type { Floor } from '@va/shared';

/** タイルの幅・高さ（拡大率 1 のとき） */
export const TW = 64;
export const TH = 32;
/** 奥の壁の高さ */
export const WALL_H = 150;
const TOP_PAD = 44;
const BOTTOM_PAD = 24;

export interface View {
  /** 拡大率 */
  s: number;
  /** 角 (0,0) の画面の位置 */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** 文字の倍率（頭上の名前・吹き出しなど）。無ければ s（PC）。スマホは拡大率を 1.0〜1.4 に収めたもの（camera.ts） */
  ts?: number;
}

/** 店全体が入る拡大率と位置 */
export const fitView = (w: number, h: number, f: Floor): View => {
  const ww = (f.cols + f.rows) * (TW / 2);
  const top = -WALL_H - TOP_PAD;
  const bottom = (f.cols + f.rows) * (TH / 2) + BOTTOM_PAD;
  const s = Math.max(0.3, Math.min((w - 24) / ww, (h - 8) / (bottom - top)));
  const cx = ((f.cols - f.rows) * TW) / 4;
  return { s, ox: w / 2 - cx * s, oy: h / 2 - ((top + bottom) / 2) * s, w, h };
};

export interface SP {
  x: number;
  y: number;
}

export const toScreen = (v: View, gx: number, gy: number, z = 0): SP => ({
  x: v.ox + (gx - gy) * (TW / 2) * v.s,
  y: v.oy + (gx + gy) * (TH / 2) * v.s - z * v.s,
});

/** 画面の点 → 床の上のタイル座標（小数） */
export const fromScreen = (v: View, sx: number, sy: number): { gx: number; gy: number } => {
  const a = (sx - v.ox) / ((TW / 2) * v.s);
  const b = (sy - v.oy) / ((TH / 2) * v.s);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
};

/** 多角形の中に点があるか */
export const inPoly = (pts: SP[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
