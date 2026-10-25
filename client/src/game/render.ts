// 店内の描画（Canvas 2D）。床・壁は変わらないので別の canvas に描いておき、毎フレームは
// 筐体・飾り・人を奥から手前の順（x + y の小さい順）に描いて、名前・吹き出し・札を最後に重ねる。

import {
  BUBBLE_CHARS,
  craneSpots,
  ellipsis,
  EMOTE_MS,
  FLOOR,
  formatPosterTime,
  frontTile,
  isSuit,
  posterKindColor,
  upcomingPosters,
  type CabinetSpot,
  type CabinetView,
  type Decor,
  type Floor,
  type Notice,
  type PosterView,
} from '@va/shared';
import { suitColor } from '../components/Badges';
import { charTop, drawCharacter } from './character';
import type { ArcadeClient, ClientPlayer } from './client';
import { worldBlit } from './camera';
import { TH, toScreen, TW, WALL_H, type SP, type View } from './iso';
import { getThumb } from './thumbs';

const FONT = '"Yu Gothic UI", "Meiryo", "Hiragino Sans", system-ui, sans-serif';
const font = (px: number, weight = 600) => `${weight} ${Math.max(8, px).toFixed(1)}px ${FONT}`;

export interface SceneUi {
  myPid: string | null;
  hoverCab: number | null;
  hoverScreen: boolean;
  /** 宣伝の全文の吹き出しを出す筐体 */
  promoCab: number | null;
  /** 小さな埋め込みを重ねる筐体（その筐体の札は出さない） */
  embedCab: number | null;
  /** クリックした行き先の印 */
  target: { x: number; y: number; at: number } | null;
  /** カーソルの下のクレーンゲーム・掲示板・ポスター */
  hoverCrane: number | null;
  hoverBoard: boolean;
  hoverPoster: number | null;
  /** カーソルの下のノートの机・要望箱（v0.4.0） */
  hoverNote?: boolean;
  hoverRequest?: boolean;
  /** スマホ：宣伝の吹き出しを画面の下端の中央に出す（DESIGN §11.4） */
  promoDock?: boolean;
  /** スマホ：小さな配信の枠に動画ではなくサムネイルを描く（「▶ タップで視聴」） */
  embedThumb?: boolean;
}

/** スマホ：床・壁を描いた大きな canvas と、その View（camera.ts の worldView） */
export interface WorldLayer {
  canvas: HTMLCanvasElement;
  view: View;
}

export interface SceneHits {
  cabinets: Array<{ id: number; poly: SP[] }>;
  screen: SP[];
  /** 小さな埋め込みの置き場所（画面の座標。左上・幅・高さ） */
  embedRect: { x: number; y: number; w: number; h: number; anchor: SP } | null;
  /** 小さな埋め込みを出している筐体（埋め込みのクリック = その筐体のクリック） */
  embedCab: number | null;
  /** 宣伝の吹き出しの置き場所と筐体（吹き出しのクリック = その筐体のクリック） */
  promo: { id: number; x: number; y: number; w: number; h: number } | null;
  /** クレーンゲーム（手前のものが先） */
  cranes: Array<{ id: number; poly: SP[] }>;
  /** 掲示板の全体と、貼られたポスター 1 枚ずつ */
  board: SP[];
  posters: Array<{ id: number; poly: SP[] }>;
  /** ノートの机・要望箱（v0.4.0。DESIGN §12・§13） */
  notes: SP[][];
  requestBoxes: SP[][];
}

// ---------------------------------------------------------------- 小さな道具

const poly = (ctx: CanvasRenderingContext2D, pts: SP[]) => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
};

/** 2 つの数から決まる乱数（模様を毎回同じにする） */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Box {
  /** 床の 4 つの角（奥・右・手前・左）と上の 4 つの角 */
  top: SP[];
  floor: SP[];
  h: number;
}

const boxAt = (v: View, x: number, y: number, inset: number, h: number): Box => {
  const c = [
    [x + inset, y + inset],
    [x + 1 - inset, y + inset],
    [x + 1 - inset, y + 1 - inset],
    [x + inset, y + 1 - inset],
  ];
  return {
    floor: c.map(([gx, gy]) => toScreen(v, gx, gy, 0)),
    top: c.map(([gx, gy]) => toScreen(v, gx, gy, h)),
    h,
  };
};

/** 箱を描く（上・左手前・右手前の 3 面） */
const drawBox = (ctx: CanvasRenderingContext2D, b: Box, top: string, left: string, right: string, edge = 'rgba(0,0,0,0.35)') => {
  ctx.lineWidth = 1;
  ctx.strokeStyle = edge;
  // 左手前の面（+y）：左 [3] → 手前 [2]
  ctx.fillStyle = left;
  poly(ctx, [b.floor[3], b.floor[2], b.top[2], b.top[3]]);
  ctx.fill();
  ctx.stroke();
  // 右手前の面（+x）：手前 [2] → 右 [1]
  ctx.fillStyle = right;
  poly(ctx, [b.floor[2], b.floor[1], b.top[1], b.top[2]]);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = top;
  poly(ctx, b.top);
  ctx.fill();
  ctx.stroke();
};

/** 箱の輪郭（当たり判定用） */
const boxOutline = (b: Box): SP[] => [b.floor[3], b.floor[2], b.floor[1], b.top[1], b.top[0], b.top[3]];

/**
 * 面の上に描く：左端の上の角を原点に、横は画面の x のまま、縦は下向き。
 * face S（+y、左手前）は傾き +0.5、face E（+x、右手前）は -0.5。
 */
const withFace = (
  ctx: CanvasRenderingContext2D,
  v: View,
  x: number,
  y: number,
  face: 'S' | 'E',
  inset: number,
  h: number,
  fn: (fw: number, fh: number) => void,
) => {
  const left = face === 'S' ? toScreen(v, x + inset, y + 1 - inset, h) : toScreen(v, x + 1 - inset, y + 1 - inset, h);
  const fw = (1 - 2 * inset) * (TW / 2) * v.s;
  ctx.save();
  ctx.transform(1, face === 'S' ? 0.5 : -0.5, 0, 1, left.x, left.y);
  fn(fw, h * v.s);
  ctx.restore();
};

/** サムネイル（4:3 の上下の黒帯を除いた 16:9 の部分）を矩形いっぱいに */
const drawThumb = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  // hqdefault は 480×360 で中に 16:9（上下に黒帯）
  const srcH = Math.min(ih, (iw * 9) / 16);
  const sy = (ih - srcH) / 2;
  // 矩形の縦横比に合わせて左右を切る
  const want = w / h;
  let sw = iw;
  let sh = srcH;
  if (iw / srcH > want) sw = srcH * want;
  else sh = iw / want;
  ctx.drawImage(img, (iw - sw) / 2, sy + (srcH - sh) / 2, sw, sh, x, y, w, h);
};

const pill = (ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, px: number, fg: string, bg: string, border?: string) => {
  ctx.font = font(px, 700);
  const w = ctx.measureText(text).width + px * 1.1;
  const h = px * 1.55;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y - h, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y - h / 2 + 0.5);
  return { w, h };
};

/** 文字を幅で折り返す（日本語は 1 文字ずつ） */
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] => {
  const out: string[] = [];
  let line = '';
  for (const ch of [...text]) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      out.push(line);
      line = ch;
      if (out.length === maxLines) break;
    } else line += ch;
  }
  if (out.length < maxLines && line) out.push(line);
  else if (out.length === maxLines && line) out[maxLines - 1] = ellipsis(out[maxLines - 1], [...out[maxLines - 1]].length);
  return out;
};

// ---------------------------------------------------------------- 床と壁（変わらない部分）

const drawWallFace = (ctx: CanvasRenderingContext2D, pts: SP[], top: string, bottom: string) => {
  const ys = pts.map((p) => p.y);
  const g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  poly(ctx, pts);
  ctx.fill();
};

const neonLine = (ctx: CanvasRenderingContext2D, a: SP, b: SP, color: string, width: number) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = width * 4;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
};

/** 床・壁・入口・壁の飾り（大画面以外）を描く */
export const drawStatic = (ctx: CanvasRenderingContext2D, v: View, f: Floor = FLOOR) => {
  const s = v.s;
  // 背景
  const bg = ctx.createRadialGradient(v.w / 2, v.h * 0.55, 50, v.w / 2, v.h * 0.55, Math.max(v.w, v.h) * 0.75);
  bg.addColorStop(0, '#141033');
  bg.addColorStop(1, '#05040f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, v.w, v.h);

  // 奥の壁：左（x = 0 の辺）と右（y = 0 の辺）
  const L0 = toScreen(v, 0, f.rows);
  const C0 = toScreen(v, 0, 0);
  const R0 = toScreen(v, f.cols, 0);
  const up = (p: SP, z: number) => ({ x: p.x, y: p.y - z * s });
  drawWallFace(ctx, [L0, C0, up(C0, WALL_H), up(L0, WALL_H)], '#2a1a4d', '#130c2b');
  drawWallFace(ctx, [C0, R0, up(R0, WALL_H), up(C0, WALL_H)], '#22205a', '#0f0d2e');
  // 壁の縦の目地
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let y = 1; y < f.rows; y++) {
    const p = toScreen(v, 0, y);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - WALL_H * s);
    ctx.stroke();
  }
  for (let x = 1; x < f.cols; x++) {
    const p = toScreen(v, x, 0);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - WALL_H * s);
    ctx.stroke();
  }

  // 床：市松模様＋ゲームセンターのじゅうたんの点々
  for (let y = 0; y < f.rows; y++)
    for (let x = 0; x < f.cols; x++) {
      const pts = [toScreen(v, x, y), toScreen(v, x + 1, y), toScreen(v, x + 1, y + 1), toScreen(v, x, y + 1)];
      ctx.fillStyle = (x + y) % 2 ? '#1c1740' : '#221c4b';
      poly(ctx, pts);
      ctx.fill();
      for (let k = 0; k < 2; k++) {
        const r = hash(x, y, k);
        const colors = ['#ff3df0', '#22e6ff', '#ffe14d', '#7cff6b'];
        const gx = x + 0.2 + hash(y, x, k + 7) * 0.6;
        const gy = y + 0.2 + hash(x + 31, y, k + 3) * 0.6;
        const p = toScreen(v, gx, gy);
        ctx.fillStyle = colors[Math.floor(r * 4)];
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 3 * s, 1.5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  // 床の格子
  ctx.strokeStyle = 'rgba(120, 100, 255, 0.10)';
  for (let y = 0; y <= f.rows; y++) {
    const a = toScreen(v, 0, y);
    const b = toScreen(v, f.cols, y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let x = 0; x <= f.cols; x++) {
    const a = toScreen(v, x, 0);
    const b = toScreen(v, x, f.rows);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // 壁の上端と床ぎわのネオン
  neonLine(ctx, up(L0, WALL_H), up(C0, WALL_H), '#ff3df0', 2.2 * s);
  neonLine(ctx, up(C0, WALL_H), up(R0, WALL_H), '#22e6ff', 2.2 * s);
  neonLine(ctx, up(L0, 6), up(C0, 6), 'rgba(255, 61, 240, 0.7)', 1.2 * s);
  neonLine(ctx, up(C0, 6), up(R0, 6), 'rgba(34, 230, 255, 0.7)', 1.2 * s);

  // 入口（左の壁）
  const e = f.entrance;
  if (e.wall === 'left') {
    const a = toScreen(v, 0, e.to);
    const b = toScreen(v, 0, e.from);
    const dh = WALL_H * 0.62 * s;
    const g = ctx.createLinearGradient(0, a.y - dh, 0, a.y);
    g.addColorStop(0, '#4b3f8f');
    g.addColorStop(1, '#bfe9ff');
    ctx.fillStyle = g;
    poly(ctx, [a, b, { x: b.x, y: b.y - dh }, { x: a.x, y: a.y - dh }]);
    ctx.fill();
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    // ドアの中央の線
    const m = toScreen(v, 0, (e.from + e.to) / 2);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x, m.y - dh);
    ctx.strokeStyle = 'rgba(30, 20, 60, 0.6)';
    ctx.stroke();
    // 看板
    const sign = toScreen(v, 0, (e.from + e.to) / 2, WALL_H * 0.78);
    ctx.save();
    ctx.translate(sign.x, sign.y);
    ctx.transform(1, -0.5, 0, 1, 0, 0);
    ctx.font = font(15 * s, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffe14d';
    ctx.fillText('入口 ENTRANCE', 0, 0);
    ctx.restore();
  }

  // 左の壁のネオンサイン（店の名前）
  const signAt = toScreen(v, 0, Math.max(2.5, (e.from - 3) / 2), WALL_H * 0.62);
  ctx.save();
  ctx.translate(signAt.x, signAt.y);
  ctx.transform(1, -0.5, 0, 1, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(24 * s, 900);
  ctx.shadowColor = '#ff3df0';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd1fb';
  ctx.fillText('VIRTUAL ARCADE', 0, 0);
  ctx.font = font(14 * s, 800);
  ctx.shadowColor = '#22e6ff';
  ctx.fillStyle = '#cffaff';
  ctx.fillText('バーチャルゲームセンター', 0, 22 * s);
  ctx.restore();

  // 掲示板の枠（貼られたポスターは drawBoard で毎フレーム）
  drawBoardFrame(ctx, v, f);
};

// ---------------------------------------------------------------- 掲示板（ポスター欄。左か右の壁）

const BOARD_TOP = 0.44;
const BOARD_BOTTOM = 0.06;
const BOARD_HEAD = 0.18;
const BOARD_COLS = 4;
const BOARD_ROWS = 1;

/** 掲示板の面の座標系：左上が原点、u = 右へ（px）、w = 下へ（px）。面の上の点 → 画面 */
const boardFrame = (v: View, f: Floor = FLOOR) => {
  const b = f.board;
  const s = v.s;
  const bw = (b.to - b.from) * (TW / 2) * s;
  const bh = WALL_H * (BOARD_TOP - BOARD_BOTTOM) * s;
  const origin = b.wall === 'right' ? toScreen(v, b.from, 0, WALL_H * BOARD_TOP) : toScreen(v, 0, b.to, WALL_H * BOARD_TOP);
  const skew = b.wall === 'right' ? 0.5 : -0.5;
  const at = (u: number, w: number): SP => ({ x: origin.x + u, y: origin.y + w + skew * u });
  return { bw, bh, origin, skew, at };
};

/** 掲示板の輪郭（当たり判定） */
export const boardPoly = (v: View, f: Floor = FLOOR): SP[] => {
  const { bw, bh, at } = boardFrame(v, f);
  return [at(0, 0), at(bw, 0), at(bw, bh), at(0, bh)];
};

/** ポスター 1 枚の置き場所（面の座標） */
const posterSlot = (bw: number, bh: number, i: number, s: number) => {
  const head = bh * BOARD_HEAD;
  const pad = 4 * s;
  const cw = (bw - pad * (BOARD_COLS + 1)) / BOARD_COLS;
  const chh = (bh - head - pad * (BOARD_ROWS + 1)) / BOARD_ROWS;
  const col = i % BOARD_COLS;
  const row = Math.floor(i / BOARD_COLS);
  return { u: pad + col * (cw + pad), w: head + pad + row * (chh + pad), cw, ch: chh };
};

const drawBoardFrame = (ctx: CanvasRenderingContext2D, v: View, f: Floor) => {
  const s = v.s;
  const { bw, bh, origin, skew } = boardFrame(v, f);
  ctx.save();
  ctx.transform(1, skew, 0, 1, origin.x, origin.y);
  // 木の枠とコルク
  ctx.fillStyle = '#3a2412';
  ctx.beginPath();
  ctx.roundRect(-4 * s, -4 * s, bw + 8 * s, bh + 8 * s, 3 * s);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#9a6b3e');
  g.addColorStop(1, '#7a4f2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, bw, bh);
  // コルクの粒
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(60, 30, 10, 0.25)' : 'rgba(255, 220, 170, 0.12)';
    ctx.fillRect(hash(i, 3) * bw, hash(i, 7) * bh, 1.4 * s, 1.4 * s);
  }
  // 見出し（ネオン）
  const head = bh * BOARD_HEAD;
  ctx.fillStyle = 'rgba(15, 8, 30, 0.85)';
  ctx.fillRect(0, 0, bw, head);
  ctx.font = font(head * 0.62, 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffe14d';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#fff3a8';
  ctx.fillText('📌 EVENT BOARD　ポスター欄', bw / 2, head / 2 + 0.5);
  ctx.restore();
};

/** 貼られたポスター（毎フレーム。手前に人がいても壁なので先に描く） */
const drawBoard = (
  ctx: CanvasRenderingContext2D,
  v: View,
  posters: PosterView[],
  hoverBoard: boolean,
  hoverPoster: number | null,
): Array<{ id: number; poly: SP[] }> => {
  const s = v.s;
  const { bw, bh, origin, skew, at } = boardFrame(v);
  const shown = posters.slice(0, BOARD_COLS * BOARD_ROWS - (posters.length > BOARD_COLS * BOARD_ROWS ? 1 : 0));
  const hits: Array<{ id: number; poly: SP[] }> = [];
  ctx.save();
  ctx.transform(1, skew, 0, 1, origin.x, origin.y);
  if (hoverBoard) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.strokeRect(-4 * s, -4 * s, bw + 8 * s, bh + 8 * s);
    ctx.restore();
  }
  shown.forEach((p, i) => {
    const r = posterSlot(bw, bh, i, s);
    const tilt = (hash(p.id, 11) - 0.5) * 0.06;
    ctx.save();
    ctx.translate(r.u + r.cw / 2, r.w + r.ch / 2);
    ctx.rotate(tilt);
    const x0 = -r.cw / 2;
    const y0 = -r.ch / 2;
    // 紙
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = hoverPoster === p.id ? '#ffffff' : '#f4efe2';
    ctx.fillRect(x0, y0, r.cw, r.ch);
    ctx.shadowColor = 'transparent';
    // 種類の色の帯
    ctx.fillStyle = posterKindColor(p.kind);
    ctx.fillRect(x0, y0, r.cw, r.ch * 0.16);
    // 題名（頭の数文字）と日時
    ctx.fillStyle = '#1a1030';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const fs = Math.max(6, Math.min(r.ch * 0.19, 9.5 * s));
    ctx.font = font(fs, 800);
    const lines = wrap(ctx, p.title, r.cw - 4 * s, Math.max(1, Math.floor((r.ch * 0.62) / (fs * 1.15))));
    lines.forEach((l, k) => ctx.fillText(l, x0 + 2.5 * s, y0 + r.ch * 0.2 + k * fs * 1.15));
    ctx.font = font(fs * 0.82, 700);
    ctx.fillStyle = '#7a2a6e';
    const d = new Date(p.startsAt);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x0 + 2 * s, y0 + r.ch - fs * 1.05);
    // ピン（固定は赤い大きいピン）
    ctx.fillStyle = p.pinned ? '#ff2d55' : '#3dd8ff';
    ctx.beginPath();
    ctx.arc(0, y0 + 1 * s, (p.pinned ? 3.2 : 2.2) * s, 0, Math.PI * 2);
    ctx.fill();
    if (hoverPoster === p.id) {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 1, y0 - 1, r.cw + 2, r.ch + 2);
    }
    ctx.restore();
    hits.push({ id: p.id, poly: [at(r.u, r.w), at(r.u + r.cw, r.w), at(r.u + r.cw, r.w + r.ch), at(r.u, r.w + r.ch)] });
  });
  if (posters.length > shown.length) {
    const r = posterSlot(bw, bh, shown.length, s);
    ctx.fillStyle = 'rgba(15, 8, 30, 0.75)';
    ctx.fillRect(r.u, r.w, r.cw, r.ch);
    ctx.fillStyle = '#fff3a8';
    ctx.font = font(Math.min(r.ch * 0.22, 10 * s), 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ほか ${posters.length - shown.length} 枚`, r.u + r.cw / 2, r.w + r.ch / 2);
  }
  if (!posters.length) {
    ctx.fillStyle = 'rgba(255, 245, 220, 0.85)';
    ctx.font = font(10 * s, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('クリックで大会・イベントの告知を貼れます', bw / 2, bh * (BOARD_HEAD + (1 - BOARD_HEAD) / 2));
  }
  ctx.restore();
  return hits;
};

// ---------------------------------------------------------------- 大画面（右の壁）

const SCREEN_TOP = 0.9;
const SCREEN_H = 0.68;

export const screenPoly = (v: View, f: Floor = FLOOR): SP[] => {
  const sc = f.screen;
  const along = (i: number, z: number) => (sc.wall === 'right' ? toScreen(v, i, 0, z) : toScreen(v, 0, i, z));
  const zt = WALL_H * SCREEN_TOP;
  const zb = WALL_H * (SCREEN_TOP - SCREEN_H);
  return [along(sc.from, zt), along(sc.to, zt), along(sc.to, zb), along(sc.from, zb)];
};

const liveList = (client: ArcadeClient): CabinetView[] =>
  [...client.cabinets.values()].filter((c) => c.videoId).sort((a, b) => a.id - b.id);

const drawBigScreen = (ctx: CanvasRenderingContext2D, v: View, client: ArcadeClient, t: number, hover: boolean) => {
  const f = FLOOR;
  const sc = f.screen;
  const s = v.s;
  const n = sc.to - sc.from;
  const bw = n * (TW / 2) * s;
  const bh = WALL_H * SCREEN_H * s;
  const origin = sc.wall === 'right' ? toScreen(v, sc.from, 0, WALL_H * SCREEN_TOP) : toScreen(v, 0, sc.to, WALL_H * SCREEN_TOP);
  ctx.save();
  ctx.transform(1, sc.wall === 'right' ? 0.5 : -0.5, 0, 1, origin.x, origin.y);

  // 枠
  ctx.fillStyle = '#05050c';
  ctx.beginPath();
  ctx.roundRect(-5 * s, -5 * s, bw + 10 * s, bh + 10 * s, 4 * s);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = hover ? '#ffffff' : '#22e6ff';
  ctx.shadowColor = '#22e6ff';
  ctx.shadowBlur = hover ? 22 : 12;
  ctx.lineWidth = 2.2 * s;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bw, bh);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, '#0d1d44');
  g.addColorStop(1, '#130830');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, bw, bh);

  const head = bh * 0.17;
  const foot = bh * 0.18;
  const lives = liveList(client);
  // 見出し
  ctx.fillStyle = 'rgba(255, 61, 110, 0.85)';
  ctx.fillRect(0, 0, bw, head);
  ctx.fillStyle = '#fff';
  ctx.font = font(head * 0.62, 800);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const dot = Math.sin(t / 300) > 0 ? '●' : '○';
  ctx.fillText(`${dot} NOW ON AIR　配信中の筐体`, 8 * s, head / 2 + 0.5);
  ctx.textAlign = 'right';
  ctx.fillText(`${lives.length} 台`, bw - 8 * s, head / 2 + 0.5);

  // 本体：数秒ごとに切り替え
  const bodyY = head + 4 * s;
  const bodyH = bh - head - foot - 8 * s;
  if (lives.length) {
    const idx = Math.floor(t / 6000) % lives.length;
    const c = lives[idx];
    const th = bodyH;
    const tw = (th * 16) / 9;
    const img = getThumb(c.videoId!, c.live);
    if (img) drawThumb(ctx, img, 8 * s, bodyY, tw, th);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(8 * s, bodyY, tw, th);
    }
    ctx.fillStyle = '#ff2d55';
    ctx.fillRect(8 * s, bodyY, 30 * s, 12 * s);
    ctx.fillStyle = '#fff';
    ctx.font = font(9 * s, 800);
    ctx.textAlign = 'center';
    ctx.fillText('LIVE', 8 * s + 15 * s, bodyY + 6.5 * s);
    const tx = 8 * s + tw + 10 * s;
    const maxW = bw - tx - 8 * s;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22e6ff';
    ctx.font = font(11 * s, 800);
    ctx.fillText(`No.${c.id}`, tx, bodyY + 8 * s);
    ctx.fillStyle = '#ffe14d';
    ctx.font = font(15 * s, 800);
    const ev = wrap(ctx, c.eventName || '（イベント名なし）', maxW, 1);
    ctx.fillText(ev[0] ?? '', tx, bodyY + 26 * s);
    ctx.fillStyle = '#fff';
    ctx.font = font(12 * s, 700);
    ctx.fillText(wrap(ctx, c.gameName || '', maxW, 1)[0] ?? '', tx, bodyY + 44 * s);
    ctx.fillStyle = '#cfc8ff';
    ctx.font = font(11 * s, 600);
    ctx.fillText(wrap(ctx, c.playerName ? `プレイヤー：${c.playerName}` : '', maxW, 1)[0] ?? '', tx, bodyY + 60 * s);
    // ページの点
    const dots = Math.min(lives.length, 12);
    for (let i = 0; i < dots; i++) {
      ctx.fillStyle = i === idx % 12 ? '#ffe14d' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(tx + i * 9 * s + 3 * s, bodyY + bodyH - 3 * s, 2.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6e2ff';
    ctx.font = font(14 * s, 800);
    ctx.fillText('いま配信中の筐体はありません', bw / 2, bodyY + bodyH * 0.38);
    ctx.fillStyle = '#a99ff0';
    ctx.font = font(11 * s, 600);
    ctx.fillText('空いている筐体を「使う」と、配信と宣伝を出せます', bw / 2, bodyY + bodyH * 0.7);
  }

  // お知らせの流れる帯
  const fy = bh - foot;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, fy, bw, foot);
  const notices: Notice[] = client.notices;
  const events = upcomingPosters(client.posters, client.serverNow());
  const parts = [
    ...notices.slice(0, 3).map((x) => `📢 ${x.text}`),
    ...(events.length ? [`📅 近日のイベント：${events.map((p) => `${formatPosterTime(p.startsAt)} ${p.title}`).join('　／　')}`] : []),
  ];
  const text = parts.length
    ? parts.join('　　　')
    : '🎮 ようこそ バーチャルゲームセンターへ！　大画面をクリックすると配信中の筐体の一覧が開きます';
  ctx.font = font(foot * 0.58, 700);
  ctx.fillStyle = parts.length ? '#ffe14d' : '#cffaff';
  ctx.textAlign = 'left';
  const tw2 = ctx.measureText(text).width;
  const span = tw2 + bw;
  const off = bw - ((t / 1000) * 60 * s) % span;
  ctx.fillText(text, off, fy + foot / 2 + 0.5);
  ctx.restore();

  // 走査線
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#000';
  for (let y = 0; y < bh; y += 3 * s) ctx.fillRect(0, y, bw, 1);
  ctx.globalAlpha = 1;
  ctx.restore();
};

// ---------------------------------------------------------------- 筐体・飾り

const CAB_INSET = 0.1;
const CAB_H = 84;

const cabinetBox = (v: View, c: CabinetSpot) => boxAt(v, c.x, c.y, CAB_INSET, CAB_H);

const drawCabinet = (
  ctx: CanvasRenderingContext2D,
  v: View,
  spot: CabinetSpot,
  cab: CabinetView | undefined,
  t: number,
  highlight: boolean,
) => {
  const s = v.s;
  const b = cabinetBox(v, spot);
  const live = !!cab?.videoId;
  if (highlight) {
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.01)';
    poly(ctx, boxOutline(b));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  drawBox(ctx, b, '#2d2856', spot.face === 'S' ? '#17132f' : '#211b45', spot.face === 'S' ? '#211b45' : '#17132f');

  // 横の面の帯（筐体の色）
  const side: 'S' | 'E' = spot.face === 'S' ? 'E' : 'S';
  withFace(ctx, v, spot.x, spot.y, side, CAB_INSET, CAB_H, (fw, fh) => {
    ctx.fillStyle = spot.color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(0, fh * 0.55);
    ctx.lineTo(fw, fh * 0.3);
    ctx.lineTo(fw, fh * 0.4);
    ctx.lineTo(0, fh * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // 正面：看板・画面・操作盤
  withFace(ctx, v, spot.x, spot.y, spot.face, CAB_INSET, CAB_H, (fw, fh) => {
    // 看板（光る）
    ctx.save();
    ctx.shadowColor = spot.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = spot.color;
    ctx.fillRect(1, 1, fw - 2, fh * 0.12);
    ctx.restore();
    ctx.fillStyle = '#10091f';
    ctx.font = font(fh * 0.09, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(spot.id), fw / 2, fh * 0.065);

    // 画面
    const sx = fw * 0.1;
    const sy = fh * 0.17;
    const sw = fw * 0.8;
    const sh = fh * 0.36;
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 1.5, sy - 1.5, sw + 3, sh + 3);
    const img = live ? getThumb(cab!.videoId!, cab!.live) : null;
    if (img) drawThumb(ctx, img, sx, sy, sw, sh);
    else if (live) {
      ctx.fillStyle = '#301020';
      ctx.fillRect(sx, sy, sw, sh);
    } else {
      // 待ち受けの画面（色の帯がゆっくり動く）
      const g = ctx.createLinearGradient(sx, sy, sx, sy + sh);
      g.addColorStop(0, '#0a1440');
      g.addColorStop(1, '#1b0a33');
      ctx.fillStyle = g;
      ctx.fillRect(sx, sy, sw, sh);
      const ph = ((t / 1400 + spot.id * 0.37) % 1) * sh;
      ctx.fillStyle = spot.color;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(sx, sy + ph, sw, sh * 0.12);
      ctx.globalAlpha = 0.5;
      const px = sx + sw * (0.2 + 0.6 * hash(spot.id, Math.floor(t / 900)));
      ctx.fillRect(px, sy + sh * 0.55, sw * 0.12, sh * 0.15);
      ctx.globalAlpha = 1;
    }
    if (live) {
      // 光の点滅
      const a = 0.55 + 0.45 * Math.sin(t / 220 + spot.id);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 45, 85, ${a})`;
      ctx.shadowColor = '#ff2d55';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 1, sy - 1, sw + 2, sh + 2);
      ctx.restore();
      ctx.fillStyle = `rgba(255, 45, 85, ${0.6 + 0.4 * a})`;
      ctx.beginPath();
      ctx.arc(sx + 3.5, sy + 3.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 操作盤
    ctx.fillStyle = '#3a3470';
    ctx.fillRect(1, fh * 0.58, fw - 2, fh * 0.08);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(fw * 0.28, fh * 0.6, Math.max(1.5, fw * 0.06), 0, Math.PI * 2);
    ctx.fill();
    ['#ff3d6e', '#ffe14d', '#22e6ff'].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(fw * (0.52 + i * 0.13), fh * 0.62, Math.max(1, fw * 0.045), 0, Math.PI * 2);
      ctx.fill();
    });
    // コイン口
    ctx.fillStyle = '#ff8a3d';
    ctx.fillRect(fw * 0.42, fh * 0.76, fw * 0.16, fh * 0.05);
    void s;
  });
};

/** クレーンゲームの高さ */
const CRANE_H = 104;
/** ノートの机・要望箱の高さ（当たり判定の箱） */
const NOTE_H = 34;
const REQUEST_H = 60;
const REQUEST_INSET = 0.26;

/** 床の上の 4 点（タイル座標）を高さ z で多角形にする */
const flat = (v: View, pts: Array<[number, number]>, z: number): SP[] => pts.map(([gx, gy]) => toScreen(v, gx, gy, z));

const drawDecor = (ctx: CanvasRenderingContext2D, v: View, d: Decor, t: number) => {
  const s = v.s;
  switch (d.type) {
    case 'plant': {
      const b = boxAt(v, d.x, d.y, 0.3, 16);
      drawBox(ctx, b, '#8a5a3c', '#5b3a26', '#6e4630');
      const c = toScreen(v, d.x + 0.5, d.y + 0.5, 34);
      const leaves: Array<[number, number, number]> = [
        [0, -6, 13],
        [-9, 2, 10],
        [9, 2, 10],
        [0, 8, 10],
      ];
      for (const [dx, dy, r] of leaves) {
        ctx.fillStyle = '#2fae5a';
        ctx.beginPath();
        ctx.arc(c.x + dx * s, c.y + dy * s, r * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(160, 255, 170, 0.25)';
        ctx.beginPath();
        ctx.arc(c.x + dx * s - 3 * s, c.y + dy * s - 3 * s, r * 0.45 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'bench': {
      const b = boxAt(v, d.x, d.y, 0.12, 16);
      drawBox(ctx, b, '#ff5a7a', '#a8324f', '#c43d5f');
      break;
    }
    case 'vending': {
      const b = boxAt(v, d.x, d.y, 0.08, 96);
      drawBox(ctx, b, '#d8e6ff', '#3b69c9', '#5a86e0');
      withFace(ctx, v, d.x, d.y, 'S', 0.08, 96, (fw, fh) => {
        ctx.save();
        ctx.shadowColor = '#bfe9ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#e9f7ff';
        ctx.fillRect(fw * 0.1, fh * 0.08, fw * 0.8, fh * 0.5);
        ctx.restore();
        const cols = ['#ff3d6e', '#ffe14d', '#22e6ff', '#7cff6b', '#ff8a3d'];
        for (let r = 0; r < 3; r++)
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = cols[(r * 4 + i + d.x) % cols.length];
            ctx.fillRect(fw * (0.15 + i * 0.18), fh * (0.12 + r * 0.15), fw * 0.12, fh * 0.1);
          }
        ctx.fillStyle = '#10142a';
        ctx.fillRect(fw * 0.2, fh * 0.72, fw * 0.6, fh * 0.1);
      });
      break;
    }
    case 'note': {
      // 机（木）と、開いたノート・ペン（DESIGN §12）
      const desk = boxAt(v, d.x, d.y, 0.1, 28);
      drawBox(ctx, desk, '#c99a62', '#7a5230', '#946539');
      const z = 29;
      const { x, y } = d;
      const left = flat(v, [[x + 0.24, y + 0.26], [x + 0.5, y + 0.3], [x + 0.5, y + 0.76], [x + 0.24, y + 0.72]], z);
      const right = flat(v, [[x + 0.5, y + 0.3], [x + 0.76, y + 0.26], [x + 0.76, y + 0.72], [x + 0.5, y + 0.76]], z);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      poly(ctx, flat(v, [[x + 0.22, y + 0.24], [x + 0.78, y + 0.24], [x + 0.78, y + 0.8], [x + 0.22, y + 0.8]], z - 0.5));
      ctx.fill();
      ctx.fillStyle = '#fbf5e4';
      poly(ctx, left);
      ctx.fill();
      ctx.fillStyle = '#fffaf0';
      poly(ctx, right);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 100, 70, 0.55)';
      ctx.lineWidth = 0.8;
      for (let i = 1; i <= 3; i++) {
        const k = 0.3 + i * 0.11;
        for (const [a, b] of [
          [x + 0.28, x + 0.47],
          [x + 0.53, x + 0.72],
        ]) {
          const p = toScreen(v, a, y + k, z);
          const q = toScreen(v, b, y + k, z);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
      // ペン
      const p0 = toScreen(v, x + 0.62, y + 0.8, z + 1);
      const p1 = toScreen(v, x + 0.86, y + 0.56, z + 1);
      ctx.strokeStyle = '#ff3df0';
      ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'requestbox': {
      // ポストのような箱（DESIGN §13）
      const b = boxAt(v, d.x, d.y, REQUEST_INSET, REQUEST_H);
      drawBox(ctx, b, '#ff6b7e', '#a8243a', '#c42e45');
      withFace(ctx, v, d.x, d.y, 'S', REQUEST_INSET, REQUEST_H, (fw, fh) => {
        // 投入口と札
        ctx.fillStyle = '#2a0710';
        ctx.fillRect(fw * 0.18, fh * 0.16, fw * 0.64, Math.max(1.5, fh * 0.05));
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(fw * 0.14, fh * 0.34, fw * 0.72, fh * 0.26);
        ctx.fillStyle = '#a8243a';
        ctx.font = font(Math.min(fw * 0.26, fh * 0.13), 900);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('要望', fw / 2, fh * 0.47);
      });
      break;
    }
    case 'crane': {
      const base = boxAt(v, d.x, d.y, 0.06, 40);
      drawBox(ctx, base, '#ff70c8', '#a3317f', '#c4459b');
      // ガラスの箱
      const glass = boxAt(v, d.x, d.y, 0.06, CRANE_H);
      const lift = (p: SP) => ({ x: p.x, y: p.y - 40 * s });
      ctx.fillStyle = 'rgba(160, 240, 255, 0.16)';
      poly(ctx, [lift(base.floor[3]), lift(base.floor[2]), glass.top[2], glass.top[3]]);
      ctx.fill();
      poly(ctx, [lift(base.floor[2]), lift(base.floor[1]), glass.top[1], glass.top[2]]);
      ctx.fill();
      // 景品
      const cc = toScreen(v, d.x + 0.5, d.y + 0.5, 46);
      ['#ffe14d', '#22e6ff', '#7cff6b', '#ff8a3d'].forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cc.x + (i - 1.5) * 6 * s, cc.y + (i % 2) * 3 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
      });
      // クレーン
      const sway = Math.sin(t / 900 + d.x) * 5 * s;
      const top = toScreen(v, d.x + 0.5, d.y + 0.5, 100);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(top.x + sway, top.y);
      ctx.lineTo(top.x + sway, top.y + 28 * s);
      ctx.stroke();
      ctx.fillStyle = '#ccc';
      ctx.fillRect(top.x + sway - 4 * s, top.y + 28 * s, 8 * s, 4 * s);
      // 枠と天井の看板
      ctx.strokeStyle = '#ff3df0';
      ctx.lineWidth = 1.4;
      poly(ctx, [lift(base.floor[3]), lift(base.floor[2]), glass.top[2], glass.top[3]]);
      ctx.stroke();
      poly(ctx, [lift(base.floor[2]), lift(base.floor[1]), glass.top[1], glass.top[2]]);
      ctx.stroke();
      ctx.fillStyle = '#ff70c8';
      poly(ctx, glass.top);
      ctx.fill();
      break;
    }
  }
};

/** 飾りの当たり判定の箱 */
const decorBox = (v: View, d: Decor): Box =>
  d.type === 'note'
    ? boxAt(v, d.x, d.y, 0.1, NOTE_H)
    : d.type === 'requestbox'
      ? boxAt(v, d.x, d.y, REQUEST_INSET, REQUEST_H)
      : boxAt(v, d.x, d.y, 0.06, CRANE_H);

// ---------------------------------------------------------------- 頭上のもの

const drawNameTag = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: ClientPlayer, me: boolean) => {
  const label = `${p.admin ? '★ ' : ''}${p.name}`;
  const badges = [...(p.badges ?? '')].filter(isSuit);
  let h: number;
  if (!badges.length)
    ({ h } = pill(ctx, x, y, label, 11.5 * s, me ? '#1a1300' : '#ffffff', me ? '#ffe14d' : 'rgba(12, 10, 30, 0.78)', me ? '#fff6c2' : 'rgba(255,255,255,0.25)'));
  else {
    // 名前の後ろにバッジ（4 色）
    const px = 11.5 * s;
    ctx.font = font(px, 700);
    const nw = ctx.measureText(label).width;
    const bwid = badges.map((b) => ctx.measureText(b).width);
    const total = nw + bwid.reduce((a, b) => a + b, 0) + px * 0.15;
    const w = total + px * 1.1;
    h = px * 1.55;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h, w, h, h / 2);
    ctx.fillStyle = me ? '#ffe14d' : 'rgba(12, 10, 30, 0.78)';
    ctx.fill();
    ctx.strokeStyle = me ? '#fff6c2' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cx = x - total / 2;
    ctx.fillStyle = me ? '#1a1300' : '#ffffff';
    ctx.fillText(label, cx, y - h / 2 + 0.5);
    cx += nw + px * 0.15;
    badges.forEach((b, i) => {
      ctx.fillStyle = suitColor(b, me);
      ctx.fillText(b, cx, y - h / 2 + 0.5);
      cx += bwid[i];
    });
  }
  if (me) {
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    const ty = y - h - 3 * s;
    ctx.moveTo(x - 5 * s, ty - 6 * s);
    ctx.lineTo(x + 5 * s, ty - 6 * s);
    ctx.lineTo(x, ty);
    ctx.closePath();
    ctx.fill();
  }
  return h + (me ? 9 * s : 0);
};

const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, text: string, alpha: number, pinned = false) => {
  const t = ellipsis(text, BUBBLE_CHARS);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font(13 * s, 600);
  const lines = wrap(ctx, t, 170 * s, 2);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * s;
  const lh = 16 * s;
  const h = lines.length * lh + 10 * s;
  const bx = x - w / 2;
  const by = y - h - 8 * s;
  // ピン止めの吹き出しは黄色っぽい紙・黄色の枠・左上にピン
  const paper = pinned ? '#fff7cc' : '#ffffff';
  ctx.fillStyle = paper;
  ctx.strokeStyle = pinned ? '#e0a800' : 'rgba(30, 20, 70, 0.6)';
  ctx.lineWidth = pinned ? 1.8 : 1.2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 8 * s);
  ctx.moveTo(x - 6 * s, by + h);
  ctx.lineTo(x, by + h + 8 * s);
  ctx.lineTo(x + 6 * s, by + h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = paper;
  ctx.fillRect(x - 5 * s, by + h - 1.5, 10 * s, 3);
  if (pinned) {
    ctx.font = `${(12 * s).toFixed(1)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📌', bx + 2 * s, by + 2 * s);
    ctx.font = font(13 * s, 600);
  }
  ctx.fillStyle = '#16122e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x, by + 5 * s + lh * (i + 0.5)));
  ctx.restore();
  return h + 8 * s;
};

const drawEmote = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, emoji: string, age: number) => {
  const k = age / EMOTE_MS;
  const pop = age < 220 ? 0.4 + (age / 220) * 0.9 : age < 360 ? 1.3 - ((age - 220) / 140) * 0.3 : 1;
  const alpha = k > 0.8 ? (1 - k) / 0.2 : 1;
  let dx = 0;
  let rot = 0;
  let scale = pop;
  if (emoji === '👋') rot = Math.sin(age / 90) * 0.45;
  else if (emoji === '👏') dx = Math.sin(age / 50) * 3 * s;
  else if (emoji === '❤️') scale *= 1 + 0.12 * Math.sin(age / 110);
  else if (emoji === '🎉' || emoji === '🔥') rot = Math.sin(age / 160) * 0.2;
  const dy = -k * 14 * s - (emoji === '😂' ? Math.abs(Math.sin(age / 120)) * 6 * s : 0);
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(x + dx, y + dy);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.font = `${(34 * s).toFixed(1)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
};

/** 筐体の頭上の短い札（イベント名・ゲーム名） */
const drawCabinetTag = (ctx: CanvasRenderingContext2D, v: View, spot: CabinetSpot, c: CabinetView) => {
  const top = toScreen(v, spot.x + 0.5, spot.y + 0.5, CAB_H + 10);
  const words = [c.eventName, c.gameName].filter(Boolean).join('｜');
  const s = v.ts ?? v.s;
  const { h } = pill(ctx, top.x, top.y, ellipsis(words || '配信中', 14), 10 * s, '#fff', 'rgba(20, 8, 40, 0.88)', spot.color);
  pill(ctx, top.x, top.y - h - 3 * s, 'LIVE', 8.5 * s, '#fff', '#ff2d55');
};

/** 宣伝の全文の吹き出し */
const drawPromo = (
  ctx: CanvasRenderingContext2D,
  v: View,
  spot: CabinetSpot,
  c: CabinetView,
  mine: boolean,
  avoid: { x: number; y: number; w: number; h: number } | null,
  ownerBadges = '',
  dock = false,
): { x: number; y: number; w: number; h: number } => {
  const s = v.ts ?? v.s;
  const anchor = toScreen(v, spot.x + 0.5, spot.y + 0.5, CAB_H * 0.6);
  const W = dock ? Math.min(250 * s, v.w - 12) : 250 * s;
  const pad = 10 * s;
  ctx.save();
  const rows: Array<{ text: string; font: string; color: string; lines: number }> = [];
  rows.push({ text: `No.${c.id}${c.videoId ? '　● LIVE' : ''}${c.owned ? `　持ち主：${c.ownerName ?? ''}${ownerBadges}` : ''}`, font: font(10.5 * s, 700), color: '#9fe9ff', lines: 1 });
  if (c.eventName) rows.push({ text: c.eventName, font: font(14 * s, 800), color: '#ffe14d', lines: 2 });
  if (c.gameName) rows.push({ text: `ゲーム：${c.gameName}`, font: font(12 * s, 700), color: '#ffffff', lines: 2 });
  if (c.playerName) rows.push({ text: `プレイヤー：${c.playerName}`, font: font(12 * s, 600), color: '#e6e0ff', lines: 1 });
  // スマホ（画面の下端に出す）は備考を 2 行までにして、店内を隠しすぎない
  if (c.note) rows.push({ text: c.note, font: font(11.5 * s, 500), color: '#d7d2f5', lines: dock ? 2 : 5 });
  if (!c.eventName && !c.gameName && !c.playerName && !c.note)
    rows.push({ text: c.videoId ? '（宣伝の文はまだありません）' : '（まだ設定されていません）', font: font(11.5 * s, 500), color: '#bbb', lines: 1 });
  rows.push({
    text: `${dock ? 'タップ' : 'クリック'}：${c.videoId ? '視聴する / YouTube で開く' : mine ? '設定する' : 'くわしく'}`,
    font: font(10 * s, 600),
    color: '#ff9bf3',
    lines: 1,
  });
  const laid = rows.map((r) => {
    ctx.font = r.font;
    return { ...r, wrapped: wrap(ctx, r.text, W - pad * 2, r.lines) };
  });
  const lh = (f: string) => parseFloat(f.split(' ')[1]) * 1.35;
  const H = laid.reduce((a, r) => a + r.wrapped.length * lh(r.font), 0) + pad * 2 + 4 * s * (laid.length - 1);
  // 小さな埋め込みがあれば、その横に出す（重ならないように）
  const gap = avoid ? avoid.w / 2 + 10 : 26 * s;
  let x = anchor.x + gap;
  if (x + W > v.w - 6) x = anchor.x - gap - W;
  let y = Math.max(6, Math.min(v.h - H - 6, anchor.y - H / 2));
  if (dock) {
    // スマホ：画面の下端の中央（筐体の横に出すと画面からはみ出す。上は筐体の上の小さな配信の枠と重なる）
    x = (v.w - W) / 2;
    y = v.h - H - 8;
  } else if (x < 6) x = 6;
  ctx.fillStyle = 'rgba(14, 10, 34, 0.94)';
  ctx.strokeStyle = spot.color;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = spot.color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.roundRect(x, y, W, H, 9 * s);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (dock) {
    // 筐体への細い線
    const bx = Math.max(x + 14, Math.min(x + W - 14, anchor.x));
    if (anchor.y < y - 4) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.lineTo(anchor.x, anchor.y);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // 筐体へのしっぽ
    ctx.beginPath();
    const tx = x > anchor.x ? x : x + W;
    ctx.moveTo(tx, anchor.y - 7 * s);
    ctx.lineTo(anchor.x + (x > anchor.x ? 12 : -12) * s, anchor.y);
    ctx.lineTo(tx, anchor.y + 7 * s);
    ctx.fillStyle = 'rgba(14, 10, 34, 0.94)';
    ctx.fill();
    ctx.stroke();
  }
  let cy = y + pad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const r of laid) {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    for (const l of r.wrapped) {
      ctx.fillText(l, x + pad, cy);
      cy += lh(r.font);
    }
    cy += 4 * s;
  }
  ctx.restore();
  return { x, y, w: W, h: H };
};

/** スマホ：近くの筐体の小さな配信の枠に、動画の代わりにサムネイルと「▶ タップで視聴」 */
const drawEmbedThumb = (ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, c: CabinetView, color: string, t: number) => {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 6);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.clip();
  const img = getThumb(c.videoId!, c.live);
  if (img) drawThumb(ctx, img, r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // 再生の印
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 - 6;
  ctx.fillStyle = 'rgba(255, 45, 85, 0.92)';
  ctx.beginPath();
  ctx.roundRect(cx - 22, cy - 15, 44, 30, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 8);
  ctx.lineTo(cx + 9, cy);
  ctx.lineTo(cx - 6, cy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = font(12, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillText('タップで視聴', cx, r.y + r.h - 12);
  ctx.shadowBlur = 0;
  // LIVE
  const a = 0.6 + 0.4 * Math.sin(t / 220);
  ctx.fillStyle = `rgba(255, 45, 85, ${a})`;
  ctx.fillRect(r.x + 6, r.y + 6, 34, 15);
  ctx.fillStyle = '#fff';
  ctx.font = font(10, 900);
  ctx.fillText('LIVE', r.x + 23, r.y + 14);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 6);
  ctx.stroke();
  ctx.restore();
};

// ---------------------------------------------------------------- 全体

export interface PlayerPose {
  p: ClientPlayer;
  x: number;
  y: number;
  walking: boolean;
}

/**
 * 1 フレーム描く。static は床・壁を描いた canvas（同じ大きさ）。
 * poses は描画中の人の位置（タイル座標）。
 */
export const drawScene = (
  ctx: CanvasRenderingContext2D,
  v: View,
  staticLayer: HTMLCanvasElement | WorldLayer | null,
  client: ArcadeClient,
  poses: PlayerPose[],
  ui: SceneUi,
  t: number,
): SceneHits => {
  const s = v.s;
  /** 文字の倍率（PC は s。スマホは拡大率を 1.0〜1.4 に収めたもの） */
  const ts = v.ts ?? s;
  ctx.clearRect(0, 0, v.w, v.h);
  if (staticLayer instanceof HTMLCanvasElement) ctx.drawImage(staticLayer, 0, 0, v.w, v.h);
  else if (staticLayer) {
    // スマホ：店全体の大きな canvas をずらして（倍率が違えば拡大して）貼る
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, v.w, v.h);
    const r = worldBlit(staticLayer.view, v);
    ctx.drawImage(staticLayer.canvas, r.x, r.y, r.w, r.h);
  }
  drawBigScreen(ctx, v, client, t, ui.hoverScreen);
  const posterHits = drawBoard(ctx, v, client.posters, ui.hoverBoard && ui.hoverPoster === null, ui.hoverPoster);

  // 行き先の印
  if (ui.target && t - ui.target.at < 1200) {
    const k = (t - ui.target.at) / 1200;
    const c = toScreen(v, ui.target.x + 0.5, ui.target.y + 0.5);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, (10 + k * 14) * s, (5 + k * 7) * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 奥から手前へ
  type Item = { d: number; draw: () => void };
  const items: Item[] = [];
  for (const spot of FLOOR.cabinets) {
    const cab = client.cabinets.get(spot.id);
    const hl = ui.hoverCab === spot.id;
    items.push({ d: spot.x + spot.y + 1, draw: () => drawCabinet(ctx, v, spot, cab, t, hl) });
  }
  const cranes = craneSpots();
  for (const d of FLOOR.decor) {
    const crane = d.type === 'crane' ? cranes.find((c) => c.x === d.x && c.y === d.y) : undefined;
    const hl =
      (!!crane && ui.hoverCrane === crane.id) || (d.type === 'note' && !!ui.hoverNote) || (d.type === 'requestbox' && !!ui.hoverRequest);
    items.push({
      d: d.x + d.y + 1,
      draw: () => {
        if (hl) {
          ctx.save();
          ctx.shadowColor = '#fff';
          ctx.shadowBlur = 16;
          poly(ctx, boxOutline(decorBox(v, d)));
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        drawDecor(ctx, v, d, t);
      },
    });
  }
  for (const pose of poses) {
    const me = pose.p.pid === ui.myPid;
    items.push({
      d: pose.x + pose.y + 1 + 0.001,
      draw: () => {
        const c = toScreen(v, pose.x + 0.5, pose.y + 0.5);
        drawCharacter(ctx, c.x, c.y, s, pose.p.look, {
          dir: pose.p.dir,
          walk: pose.walking ? t / 85 : null,
          sitting: pose.p.watching !== null,
          me,
          t,
        });
      },
    });
  }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.draw();

  // 筐体の札（配信中）
  for (const spot of FLOOR.cabinets) {
    const c = client.cabinets.get(spot.id);
    if (c?.videoId && ui.embedCab !== spot.id) drawCabinetTag(ctx, v, spot, c);
  }

  // 名前・吹き出し・エモーション（手前の人ほど上に）
  const now = performance.now();
  const sorted = [...poses].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const pose of sorted) {
    const p = pose.p;
    const me = p.pid === ui.myPid;
    const c = toScreen(v, pose.x + 0.5, pose.y + 0.5);
    let y = c.y - (charTop(p.watching !== null) + 6) * s;
    y -= drawNameTag(ctx, c.x, y, ts, p, me) + 2 * ts;
    // ふつうの発言の吹き出しが出ている間はそちら、消えたらピン止めの吹き出し（出しっぱなし）
    if (p.bubble) {
      const left = p.bubble.until - now;
      y -= drawBubble(ctx, c.x, y, ts, p.bubble.text, p.pinned ? 1 : Math.min(1, left / 400)) + 2 * ts;
    } else if (p.pinned) {
      y -= drawBubble(ctx, c.x, y, ts, p.pinned.text, 1, true) + 2 * ts;
    }
    if (p.emote) drawEmote(ctx, c.x, y - 4 * ts, ts, p.emote.emoji, now - p.emote.at);
  }

  // 当たり判定と、埋め込みの置き場所
  const hits: SceneHits = {
    cabinets: FLOOR.cabinets
      .slice()
      .sort((a, b) => b.x + b.y - (a.x + a.y))
      .map((spot) => ({ id: spot.id, poly: boxOutline(cabinetBox(v, spot)) })),
    screen: screenPoly(v),
    embedRect: null,
    embedCab: ui.embedCab,
    promo: null,
    cranes: cranes
      .slice()
      .sort((a, b) => b.x + b.y - (a.x + a.y))
      .map((c) => ({ id: c.id, poly: boxOutline(boxAt(v, c.x, c.y, 0.06, CRANE_H)) })),
    board: boardPoly(v),
    posters: posterHits,
    notes: FLOOR.decor.filter((d) => d.type === 'note').map((d) => boxOutline(decorBox(v, d))),
    requestBoxes: FLOOR.decor.filter((d) => d.type === 'requestbox').map((d) => boxOutline(decorBox(v, d))),
  };
  // ノートの机・要望箱の小さな札（いつも出す。カーソルを置いたら説明）
  for (const d of FLOOR.decor) {
    if (d.type !== 'note' && d.type !== 'requestbox') continue;
    const note = d.type === 'note';
    const top = toScreen(v, d.x + 0.5, d.y + 0.5, (note ? NOTE_H : REQUEST_H) + 8);
    const hover = note ? !!ui.hoverNote : !!ui.hoverRequest;
    const { h } = pill(ctx, top.x, top.y, note ? '📖 ノート' : '📮 要望箱', 9.5 * ts, '#fff', 'rgba(20, 8, 40, 0.85)', note ? '#ffe14d' : '#ff6b7e');
    if (hover)
      pill(
        ctx,
        top.x,
        top.y - h - 3 * ts,
        note ? 'コミュニケーションノート　クリックで開く' : '機能追加要望箱　クリックで要望を送る',
        10.5 * ts,
        '#fff',
        'rgba(20, 8, 40, 0.92)',
        note ? '#ffe14d' : '#ff6b7e',
      );
  }
  // クレーンゲームの札（カーソルを置いたとき）
  if (ui.hoverCrane !== null) {
    const c = cranes.find((x) => x.id === ui.hoverCrane);
    if (c) {
      const top = toScreen(v, c.x + 0.5, c.y + 0.5, CRANE_H + 12);
      const { h } = pill(ctx, top.x, top.y, 'クレーンゲーム　クリックで遊ぶ', 10.5 * ts, '#fff', 'rgba(20, 8, 40, 0.92)', '#ff70c8');
      pill(ctx, top.x, top.y - h - 3 * ts, '♠ ♡ ♦ ♧ のバッジ', 9.5 * ts, '#1a1300', '#ffe14d');
    }
  }
  if (ui.embedCab !== null) {
    const spot = FLOOR.cabinets.find((x) => x.id === ui.embedCab);
    if (spot) {
      // 筐体の画面の中心
      const f = spot.face === 'S' ? { gx: spot.x + 0.5, gy: spot.y + 1 - CAB_INSET } : { gx: spot.x + 1 - CAB_INSET, gy: spot.y + 0.5 };
      const anchor = toScreen(v, f.gx, f.gy, CAB_H * (1 - 0.35));
      const w = Math.round(224 * Math.min(1.2, Math.max(0.8, s)));
      const h = Math.round((w * 9) / 16);
      const top = toScreen(v, spot.x + 0.5, spot.y + 0.5, CAB_H + 14).y - h;
      hits.embedRect = { x: Math.round(anchor.x - w / 2), y: Math.round(Math.max(4, top)), w, h, anchor };
      // 埋め込みから画面へのしっぽ
      const r = hits.embedRect;
      ctx.save();
      ctx.strokeStyle = spot.color;
      ctx.shadowColor = spot.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(anchor.x, r.y + r.h);
      ctx.lineTo(anchor.x, anchor.y - 6 * s);
      ctx.stroke();
      ctx.fillStyle = spot.color;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y - 6 * s, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // スマホ：動画の代わりにサムネイルの枠（DESIGN §11.4）
      const c = client.cabinets.get(spot.id);
      if (ui.embedThumb && c?.videoId) drawEmbedThumb(ctx, r, c, spot.color, t);
    }
  }
  // 宣伝の吹き出し
  if (ui.promoCab !== null) {
    const spot = FLOOR.cabinets.find((x) => x.id === ui.promoCab);
    const c = client.cabinets.get(ui.promoCab);
    if (spot && c) {
      const r = drawPromo(
        ctx,
        v,
        spot,
        c,
        !!c.ownerPid && c.ownerPid === ui.myPid,
        ui.promoCab === ui.embedCab ? hits.embedRect : null,
        client.badgesOf(c.ownerPid),
        !!ui.promoDock,
      );
      hits.promo = { id: spot.id, ...r };
    }
  }

  return hits;
};

/** 筐体の前のマス（歩いて行く先） */
export const cabinetFront = (id: number) => {
  const spot = FLOOR.cabinets.find((x) => x.id === id);
  return spot ? frontTile(spot) : null;
};

export { TH };
