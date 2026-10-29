// 店内の描画（Canvas 2D）。床・壁は変わらないので別の canvas に描いておき、毎フレームは
// 筐体・飾り・人を奥から手前の順（x + y の小さい順）に描いて、名前・吹き出し・札を最後に重ねる。

import {
  BUBBLE_CHARS,
  craneSpots,
  ellipsis,
  formatScore,
  gameInfo,
  gameSpots,
  rankingSpots,
  type GameSpot,
  type RankingEntry,
  type RankingSpot,
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
  type RoomId,
} from '@va/shared';
import { suitColor } from '../components/Badges';
import { charTop, drawCharacter, drawCrossedArms } from './character';
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
  /** v0.5.0：いる部屋と、扉・予約カレンダーの札（DESIGN §14） */
  room?: RoomId;
  hoverDoor?: boolean;
  hoverCalendar?: boolean;
  /** 扉の上の札（「🔑 予約部屋　次 19:00「〇〇」」など） */
  doorSign?: string;
  /** 扉のランプ（予約部屋が開いているか） */
  doorOpen?: boolean;
  /** 予約部屋：店内の上の中央に出す部屋名の帯 */
  roomBanner?: string;
  /** v0.6.0：カーソルの下のゲーム筐体・ランキングのポスター（id）と、ポスターに描く上位（ゲームごと） */
  hoverGame?: number | null;
  hoverRanking?: number | null;
  rankings?: Record<string, RankingEntry[]>;
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
  /** v0.5.0：予約部屋の扉・予約カレンダー */
  doors: SP[][];
  calendars: SP[][];
  /** v0.6.0：ゲーム筐体（手前のものが先）・ランキングのポスター（壁。画面の左から） */
  games: Array<{ id: number; game: string; poly: SP[] }>;
  rankings: Array<{ id: number; game: string; poly: SP[] }>;
  /** v0.6.0：遊んでいる人（自分以外）の頭上の名札（🎮。クリックでその人のプレイを見る。手前の人が先） */
  playTags: Array<{ pid: string; game: string; x: number; y: number; w: number; h: number }>;
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

/** 部屋ごとの色（v0.5.0。オープン部屋は v0.4 までと同じ色・予約部屋は琥珀と青緑で見分ける） */
const THEMES = {
  open: {
    bg: ['#141033', '#05040f'],
    wallL: ['#2a1a4d', '#130c2b'],
    wallR: ['#22205a', '#0f0d2e'],
    floor: ['#1c1740', '#221c4b'],
    neonL: ['#ff3df0', 'rgba(255, 61, 240, 0.7)'],
    neonR: ['#22e6ff', 'rgba(34, 230, 255, 0.7)'],
    sign: ['VIRTUAL ARCADE', 'バーチャルゲームセンター', '#ff3df0', '#ffd1fb'],
  },
  reserved: {
    bg: ['#1a1408', '#070503'],
    wallL: ['#3d2a12', '#1a1006'],
    wallR: ['#13343a', '#071518'],
    floor: ['#1e1a12', '#262014'],
    neonL: ['#ffb43d', 'rgba(255, 180, 61, 0.7)'],
    neonR: ['#3dffd0', 'rgba(61, 255, 208, 0.7)'],
    sign: ['RESERVED ROOM', '予約部屋（貸し切り）', '#ffb43d', '#ffe9c2'],
  },
} as const;

/** 床・壁・入口・壁の飾り（大画面以外）を描く。room = 部屋の色（v0.5.0） */
export const drawStatic = (ctx: CanvasRenderingContext2D, v: View, f: Floor = FLOOR, room: RoomId = 'open') => {
  const s = v.s;
  const th = THEMES[room];
  // 背景
  const bg = ctx.createRadialGradient(v.w / 2, v.h * 0.55, 50, v.w / 2, v.h * 0.55, Math.max(v.w, v.h) * 0.75);
  bg.addColorStop(0, th.bg[0]);
  bg.addColorStop(1, th.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, v.w, v.h);

  // 奥の壁：左（x = 0 の辺）と右（y = 0 の辺）
  const L0 = toScreen(v, 0, f.rows);
  const C0 = toScreen(v, 0, 0);
  const R0 = toScreen(v, f.cols, 0);
  const up = (p: SP, z: number) => ({ x: p.x, y: p.y - z * s });
  drawWallFace(ctx, [L0, C0, up(C0, WALL_H), up(L0, WALL_H)], th.wallL[0], th.wallL[1]);
  drawWallFace(ctx, [C0, R0, up(R0, WALL_H), up(C0, WALL_H)], th.wallR[0], th.wallR[1]);
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
      ctx.fillStyle = (x + y) % 2 ? th.floor[0] : th.floor[1];
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
  neonLine(ctx, up(L0, WALL_H), up(C0, WALL_H), th.neonL[0], 2.2 * s);
  neonLine(ctx, up(C0, WALL_H), up(R0, WALL_H), th.neonR[0], 2.2 * s);
  neonLine(ctx, up(L0, 6), up(C0, 6), th.neonL[1], 1.2 * s);
  neonLine(ctx, up(C0, 6), up(R0, 6), th.neonR[1], 1.2 * s);

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
    // 看板（v0.6.0：店の名前のネオンを掲示板の上へ移したので、それと重ならないよう少し高く）
    const sign = toScreen(v, 0, (e.from + e.to) / 2, WALL_H * 0.86);
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

  // 左の壁のネオンサイン（店の名前）。v0.6.0：奥寄り（rankingWall）にランキングのポスターを貼ったので、
  // 左の壁に掲示板があればその上へ（掲示板の幅に収まるよう字を小さく）。無ければ前と同じ所
  const bd = f.board.wall === 'left' ? f.board : null;
  const signAt = bd
    ? toScreen(v, 0, (bd.from + bd.to) / 2, WALL_H * 0.73)
    : toScreen(v, 0, Math.max(2.5, (e.from - 3) / 2), WALL_H * 0.62);
  const signMaxW = bd ? (bd.to - bd.from) * (TW / 2) * s : Infinity;
  ctx.save();
  ctx.translate(signAt.x, signAt.y);
  ctx.transform(1, -0.5, 0, 1, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(24 * s, 900);
  const k = Math.min(1, signMaxW / Math.max(1, ctx.measureText(th.sign[0]).width));
  ctx.font = font(24 * s * k, 900);
  ctx.shadowColor = th.sign[2];
  ctx.shadowBlur = 18;
  ctx.fillStyle = th.sign[3];
  ctx.fillText(th.sign[0], 0, 0);
  ctx.font = font(14 * s * Math.max(k, 0.85), 800);
  ctx.shadowColor = th.neonR[0];
  ctx.fillStyle = '#cffaff';
  ctx.fillText(th.sign[1], 0, 22 * s * Math.max(k, 0.85));
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

/** 予約部屋の扉・予約カレンダー（v0.5.0。奥の壁ぎわに立つ薄い板） */
const DOOR_H = 118;
const CAL_H = 82;
const CAL_LEG = 26;
/** 壁ぎわの薄い板の箱（x は inset〜1-inset、y は壁から depth まで、高さ z0〜z1） */
const panelBox = (v: View, x: number, y: number, inset: number, depth: number, z0: number, z1: number): Box => {
  const c = [
    [x + inset, y + 0.02],
    [x + 1 - inset, y + 0.02],
    [x + 1 - inset, y + depth],
    [x + inset, y + depth],
  ];
  return {
    floor: c.map(([gx, gy]) => toScreen(v, gx, gy, z0)),
    top: c.map(([gx, gy]) => toScreen(v, gx, gy, z1)),
    h: z1 - z0,
  };
};
/** 板の手前の面（+y）に描く：左上が原点・横は画面の x・縦は下向き */
const onPanel = (
  ctx: CanvasRenderingContext2D,
  v: View,
  x: number,
  y: number,
  inset: number,
  depth: number,
  z1: number,
  h: number,
  fn: (fw: number, fh: number) => void,
) => {
  const left = toScreen(v, x + inset, y + depth, z1);
  ctx.save();
  ctx.transform(1, 0.5, 0, 1, left.x, left.y);
  fn((1 - 2 * inset) * (TW / 2) * v.s, h * v.s);
  ctx.restore();
};

const drawDoor = (ctx: CanvasRenderingContext2D, v: View, d: Decor, t: number, room: RoomId, open: boolean) => {
  const res = room === 'reserved';
  const frame = panelBox(v, d.x, d.y, 0.08, 0.2, 0, DOOR_H);
  drawBox(ctx, frame, res ? '#7a5cff' : '#ffb43d', res ? '#3b2a8f' : '#8f5a12', res ? '#4d38b0' : '#a86b18');
  onPanel(ctx, v, d.x, d.y, 0.08, 0.2, DOOR_H, DOOR_H, (fw, fh) => {
    // 扉の板（2 枚）と窓・取っ手
    ctx.fillStyle = res ? '#1d1546' : '#2a1606';
    ctx.fillRect(fw * 0.1, fh * 0.12, fw * 0.8, fh * 0.88);
    ctx.fillStyle = res ? '#5a46c9' : '#c98a2c';
    ctx.fillRect(fw * 0.14, fh * 0.16, fw * 0.34, fh * 0.82);
    ctx.fillRect(fw * 0.52, fh * 0.16, fw * 0.34, fh * 0.82);
    ctx.fillStyle = res ? 'rgba(160, 200, 255, 0.55)' : 'rgba(255, 230, 170, 0.55)';
    ctx.fillRect(fw * 0.2, fh * 0.24, fw * 0.22, fh * 0.2);
    ctx.fillRect(fw * 0.58, fh * 0.24, fw * 0.22, fh * 0.2);
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.arc(fw * 0.45, fh * 0.6, Math.max(1.2, fw * 0.03), 0, Math.PI * 2);
    ctx.arc(fw * 0.55, fh * 0.6, Math.max(1.2, fw * 0.03), 0, Math.PI * 2);
    ctx.fill();
    // 札
    ctx.fillStyle = res ? '#e9e4ff' : '#fff3d6';
    ctx.fillRect(fw * 0.12, fh * 0.015, fw * 0.76, fh * 0.09);
    ctx.fillStyle = res ? '#3b2a8f' : '#8f5a12';
    ctx.font = font(Math.min(fw * 0.16, fh * 0.07), 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(res ? 'オープン部屋' : '予約部屋', fw / 2, fh * 0.062);
  });
  // ランプ（予約部屋が開いていれば緑、閉まっていれば赤。予約部屋の中では出口の緑）
  const lamp = toScreen(v, d.x + 0.5, d.y + 0.2, DOOR_H + 7);
  const on = res || open;
  const a = 0.75 + 0.25 * Math.sin(t / 300);
  ctx.save();
  ctx.fillStyle = (on ? 'rgba(93, 255, 138, ' : 'rgba(255, 45, 85, ') + a.toFixed(3) + ')';
  ctx.shadowColor = on ? '#5dff8a' : '#ff2d55';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(lamp.x, lamp.y, 4 * v.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawCalendar = (ctx: CanvasRenderingContext2D, v: View, d: Decor) => {
  const s = v.s;
  // 脚（2 本）
  ctx.strokeStyle = '#8a6a4a';
  ctx.lineWidth = 2.2 * s;
  for (const gx of [d.x + 0.25, d.x + 0.75]) {
    const a = toScreen(v, gx, d.y + 0.34, 0);
    const b = toScreen(v, gx, d.y + 0.16, CAL_LEG + 4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const board = panelBox(v, d.x, d.y, 0.12, 0.2, CAL_LEG, CAL_H);
  drawBox(ctx, board, '#fffaf0', '#d8cfb8', '#e8dfc8', 'rgba(60, 40, 20, 0.5)');
  onPanel(ctx, v, d.x, d.y, 0.12, 0.2, CAL_H, CAL_H - CAL_LEG, (fw, fh) => {
    ctx.fillStyle = '#ff3d6e';
    ctx.fillRect(0, 0, fw, fh * 0.22);
    ctx.fillStyle = '#fff';
    ctx.font = font(Math.min(fw * 0.17, fh * 0.15), 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('予約', fw / 2, fh * 0.115);
    // 7 × 4 のます（予約の入った日に色）
    const cw = (fw * 0.86) / 7;
    const ch = (fh * 0.66) / 4;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 7; c++) {
        const k = (r * 7 + c) % 5;
        ctx.fillStyle = k === 1 ? '#ffb43d' : k === 3 ? '#3dffd0' : '#e9e2cf';
        ctx.fillRect(fw * 0.07 + c * cw + 0.6, fh * 0.28 + r * ch + 0.6, cw - 1.2, ch - 1.2);
      }
  });
};

// ---------------------------------------------------------------- ゲーム筐体とランキングのポスター（v0.6.0。DESIGN §16）

/** ゲーム筐体：配信用の筐体（CAB_H 84）より少し高く、画面を大きく */
const GAME_INSET = 0.06;
const GAME_H = 96;
/** 筐体の上の看板（画面に平行な板）の高さ */
const TOPPER_Z = GAME_H + 6;
/** 2048 のタイルの色（元の style/main.css と同じ） */
const TILE_COLORS: Record<number, string> = {
  2: '#eee4da',
  4: '#ede0c8',
  8: '#f2b179',
  16: '#f59563',
  32: '#f67c5f',
  64: '#f65e3b',
  128: '#edcf72',
  256: '#edcc61',
  512: '#edc850',
  1024: '#edc53f',
  2048: '#edc22e',
};
const GOLD = '#edc22e';
/** 筐体の画面に出す盤（いくつかを順に。ゲームの画面らしく見せるだけ） */
const DEMO_BOARDS = [
  [2, 0, 0, 4, 0, 8, 2, 0, 16, 32, 4, 2, 128, 64, 16, 8],
  [0, 2, 0, 0, 4, 8, 0, 2, 16, 32, 8, 4, 256, 64, 16, 2],
  [2, 0, 2, 0, 8, 4, 0, 0, 32, 16, 4, 2, 2048, 128, 32, 4],
];

/** 2048 の画面：盤の地 #bbada0 に 4×4 のタイル（3 つの盤を順に） */
const drawScreen2048 = (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, t: number) => {
  ctx.fillStyle = '#bbada0';
  ctx.fillRect(sx, sy, sw, sh);
  const demo = DEMO_BOARDS[Math.floor(t / 1600) % DEMO_BOARDS.length];
  const gap = Math.max(0.6, sw * 0.03);
  const cw = (sw - gap * 5) / 4;
  const ch = (sh - gap * 5) / 4;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const n = demo[r * 4 + c];
      ctx.fillStyle = n ? TILE_COLORS[n] : 'rgba(238, 228, 218, 0.35)';
      ctx.fillRect(sx + gap + c * (cw + gap), sy + gap + r * (ch + gap), cw, ch);
    }
};

/** Columns like game の宝石の色（client/public/games/columns/columns.js の COLORS の明るい方。5 色の分） */
const JEWELS = ['#ff7ac6', '#7cc4ff', '#d8ff6b', '#ffd47a', '#d29bff'];
/** 筐体の画面の井戸（6 列 × 9 段。下から。-1 は空き）。ゲームの画面らしく見せるだけ */
const COLUMNS_DEMO = [
  [0, 3, 1, 4, 2, 1],
  [2, 3, 3, 3, 1, 0],
  [4, 0, 2, 1, 3, 2],
  [1, 4, 3, 2, 4, -1],
  [3, 2, -1, -1, 0, -1],
  [-1, 1, -1, -1, -1, -1],
];
/** 落ちてくるピース（縦 3 つ）の色の組。1 回ごとに次の組 */
const COLUMNS_PIECES = [
  [1, 3, 0],
  [4, 2, 2],
  [0, 1, 3],
  [3, 4, 1],
];

/** Columns like game の画面：黒い井戸に宝石が積もり、縦 3 つのピースが落ちてきて、ときどき並びが光って消える */
const drawScreenColumns = (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, t: number) => {
  ctx.fillStyle = '#0c0820';
  ctx.fillRect(sx, sy, sw, sh);
  const cols = 6;
  const rows = 9;
  const cw = sw / cols;
  const ch = sh / rows;
  // 井戸の縦の線
  ctx.fillStyle = 'rgba(120, 110, 170, 0.22)';
  for (let c = 1; c < cols; c++) ctx.fillRect(sx + c * cw - 0.25, sy, 0.5, sh);
  const gem = (c: number, r: number, color: string, glow = 0) => {
    const x = sx + c * cw + cw * 0.08;
    const y = sy + sh - (r + 1) * ch + ch * 0.08;
    const w = cw * 0.84;
    const h = ch * 0.84;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + glow * 0.6})`;
    ctx.fillRect(x, y, w * 0.45, h * 0.3);
    if (glow > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${glow * 0.7})`;
      ctx.fillRect(x, y, w, h);
    }
  };
  // 4.2 秒で 1 回：ピースが列 3 の上まで落ちる → 1 秒ほど 2 段目の 3 つ（2,1,4 列…）が光る
  const cycle = 4200;
  const k = Math.floor(t / cycle);
  const ph = (t % cycle) / cycle;
  const flash = ph > 0.72 ? Math.max(0, Math.sin(((ph - 0.72) / 0.28) * Math.PI * 3)) : 0;
  for (let r = 0; r < COLUMNS_DEMO.length; r++)
    for (let c = 0; c < cols; c++) {
      const j = COLUMNS_DEMO[r][c];
      if (j < 0) continue;
      // 下から 2 段目の左の 3 つを、そろって消える宝石に見せる
      const lit = r === 1 && c >= 1 && c <= 3 ? flash : 0;
      gem(c, r, JEWELS[j], lit);
    }
  const piece = COLUMNS_PIECES[k % COLUMNS_PIECES.length];
  const landed = 4; // 列 3 の積もった宝石の上（下から 5 段目）
  const fall = Math.min(1, ph / 0.7);
  const top = rows + 1 - (rows + 1 - (landed + 3)) * fall; // いちばん上の宝石の段（下から）
  for (let i = 0; i < 3; i++) {
    const r = top - 1 - i;
    if (r < rows && r >= landed) gem(3, r, JEWELS[piece[i]]);
  }
  // 画面の光
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(sx, sy, sw, sh * 0.3);
};

/** Hextris の色（元のゲームの 4 色）と、画面の絵の積もったブロック（辺ごとに真ん中から外へ） */
const HEX_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71'];
const HEX_STACKS = [[0, 2, 2], [1], [3, 3, 0, 1], [2], [1, 0], [0, 3]];

/** Hextris の画面：真ん中の六角形のまわりに色のブロックが積もり、ときどき回り、外からブロックが寄ってくる */
const drawScreenHextris = (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, t: number) => {
  ctx.fillStyle = '#ecf0f1';
  ctx.fillRect(sx, sy, sw, sh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, sw, sh);
  ctx.clip();
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  const R = Math.min(sw, sh) * 0.46; // 外の灰色の六角形（頂点まで）
  const r0 = R * 0.3; // 真ん中の六角形
  const C = Math.cos(Math.PI / 6);
  const bh = ((R - r0) * C) / 6; // ブロックの厚み
  const at = (a: number, rho: number) => ({ x: cx + rho * Math.cos(a), y: cy + rho * Math.sin(a) });
  const hexPath = (rho: number, rot: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const q = at(rot + i * (Math.PI / 3) + Math.PI / 6, rho);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    }
    ctx.closePath();
  };
  /** 辺の向き a・真ん中からの距離 d0〜d1 の台形（ブロック 1 つ） */
  const block = (a: number, d0: number, d1: number, color: string) => {
    const p = [at(a - Math.PI / 6, d0 / C), at(a + Math.PI / 6, d0 / C), at(a + Math.PI / 6, d1 / C), at(a - Math.PI / 6, d1 / C)];
    ctx.fillStyle = color;
    ctx.beginPath();
    p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
  };
  // 回転：2.4 秒ごとに 60 度、最初の 0.3 秒で回る
  const step = Math.floor(t / 2400);
  const ph = Math.min(1, (t % 2400) / 300);
  const rot = (step + (1 - (1 - ph) ** 3)) * (Math.PI / 3);
  hexPath(R, 0);
  ctx.fillStyle = '#bdc3c7';
  ctx.fill();
  const base = r0 * C;
  HEX_STACKS.forEach((stack, i) => {
    const a = rot + i * (Math.PI / 3);
    stack.forEach((c, j) => block(a, base + j * bh, base + (j + 1) * bh - 0.4, HEX_COLORS[c]));
  });
  // 外から寄ってくるブロック（向きは固定の 2 本の筋）
  for (const [lane, color, off] of [
    [1, 2, 0],
    [4, 0, 900],
  ] as const) {
    const k = ((t + off) % 1800) / 1800;
    const d = R * 1.25 - k * (R * 1.25 - base - 4 * bh);
    block(lane * (Math.PI / 3), d, d + bh - 0.4, HEX_COLORS[color]);
  }
  hexPath(r0, rot);
  ctx.fillStyle = '#2c3e50';
  ctx.fill();
  ctx.restore();
};

/** ゲームごとの筐体・ランキングのポスターの色と画面の絵 */
interface GameLook {
  /** 箱の上・暗い面・明るい面 */
  top: string;
  dark: string;
  mid: string;
  /** 看板・帯の色と、その上の字の色 */
  accent: string;
  signFg: string;
  /** 上の看板の幅（s = 1 のとき）と字の大きさ */
  topperW: number;
  topperPx: number;
  /** 上の看板をこの分だけ高く（隣の筐体の看板と重ならないように。Hextris は 2048 の右隣） */
  topperLift?: number;
  screen: (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, t: number) => void;
  /** 操作盤：台・十字キー・ボタン 2 つ */
  panel: [string, string, string, string];
  /** ランキングのポスター：地・縁・見出し・見出しの字・縞・点数・名前・空き */
  board: { bg: string; border: string; head: string; headFg: string; stripe: string; score: string; name: string; empty: string };
}

const GAME_LOOKS: Record<string, GameLook> = {
  '2048': {
    top: '#6b5236',
    dark: '#3a2a1a',
    mid: '#4d3824',
    accent: GOLD,
    signFg: '#ffffff',
    topperW: 46,
    topperPx: 13.5,
    screen: drawScreen2048,
    panel: ['#2a1c10', '#776e65', '#f67c5f', GOLD],
    board: {
      bg: '#faf8ef',
      border: '#bbada0',
      head: GOLD,
      headFg: '#ffffff',
      stripe: 'rgba(187, 173, 160, 0.18)',
      score: '#776e65',
      name: '#4d453d',
      empty: 'rgba(119, 110, 101, 0.45)',
    },
  },
  // Columns like game（DESIGN §16.8）：藍色の箱・紫の看板「COLUMNS LIKE」・黒い井戸に新しい色の宝石
  columns: {
    top: '#3a2f6e',
    dark: '#1a1436',
    mid: '#262050',
    accent: '#9a5cf0',
    signFg: '#ffffff',
    topperW: 74,
    topperPx: 10.5,
    screen: drawScreenColumns,
    panel: ['#120d26', '#5b5290', '#ff7ac6', '#7cc4ff'],
    board: {
      bg: '#171130',
      border: '#7a33cc',
      head: '#7a33cc',
      headFg: '#ffffff',
      stripe: 'rgba(210, 155, 255, 0.12)',
      score: '#ffd47a',
      name: '#f2ecff',
      empty: 'rgba(242, 236, 255, 0.45)',
    },
  },
  // Hextris（DESIGN §16.9）：紺の箱・青い看板「HEXTRIS」・画面は六角形のまわりに色のブロック
  hextris: {
    top: '#3d566e',
    dark: '#1b2836',
    mid: '#2c3e50',
    accent: '#3498db',
    signFg: '#ffffff',
    topperW: 62,
    topperPx: 12,
    topperLift: 40,
    screen: drawScreenHextris,
    panel: ['#16212c', '#7f8c8d', '#e74c3c', '#f1c40f'],
    board: {
      bg: '#ecf0f1',
      border: '#3498db',
      head: '#2c3e50',
      headFg: '#ffffff',
      stripe: 'rgba(52, 152, 219, 0.12)',
      score: '#c0392b',
      name: '#2c3e50',
      empty: 'rgba(44, 62, 80, 0.45)',
    },
  },
};
const lookOf = (game: string): GameLook => GAME_LOOKS[game] ?? GAME_LOOKS['2048'];

/** 幅に収まる大きさで字を書く（小さな看板。font() の 8px の下限は使わない） */
const fitText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, weight = 900) => {
  let size = px;
  ctx.font = `${weight} ${size.toFixed(1)}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    size = Math.max(3, (size * maxW) / w);
    ctx.font = `${weight} ${size.toFixed(1)}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
};

const drawGameCabinet = (ctx: CanvasRenderingContext2D, v: View, spot: GameSpot, t: number) => {
  const s = v.s;
  const look = lookOf(spot.game);
  const sign = gameInfo(spot.game)?.sign ?? spot.game.toUpperCase();
  const b = boxAt(v, spot.x, spot.y, GAME_INSET, GAME_H);
  drawBox(ctx, b, look.top, spot.face === 'S' ? look.dark : look.mid, spot.face === 'S' ? look.mid : look.dark);
  // 横の面の帯
  const side: 'S' | 'E' = spot.face === 'S' ? 'E' : 'S';
  withFace(ctx, v, spot.x, spot.y, side, GAME_INSET, GAME_H, (fw, fh) => {
    ctx.fillStyle = look.accent;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, fh * 0.5);
    ctx.lineTo(fw, fh * 0.26);
    ctx.lineTo(fw, fh * 0.36);
    ctx.lineTo(0, fh * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  // 正面：看板・大きな画面・操作盤
  withFace(ctx, v, spot.x, spot.y, spot.face, GAME_INSET, GAME_H, (fw, fh) => {
    ctx.save();
    ctx.shadowColor = look.accent;
    ctx.shadowBlur = 10;
    ctx.fillStyle = look.accent;
    ctx.fillRect(1, 1, fw - 2, fh * 0.11);
    ctx.restore();
    ctx.fillStyle = look.signFg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, sign, fw / 2, fh * 0.06, fw - 4, Math.max(8, fh * 0.085));
    // 画面
    const sx = fw * 0.07;
    const sy = fh * 0.14;
    const sw = fw * 0.86;
    const sh = fh * 0.46;
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 1.5, sy - 1.5, sw + 3, sh + 3);
    look.screen(ctx, sx, sy, sw, sh, t + spot.id * 700);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(sx, sy, sw, sh * 0.35);
    // 操作盤（十字キーとボタン）
    const [base, stick, b1, b2] = look.panel;
    ctx.fillStyle = base;
    ctx.fillRect(1, fh * 0.64, fw - 2, fh * 0.08);
    ctx.fillStyle = stick;
    ctx.fillRect(fw * 0.2, fh * 0.655, fw * 0.16, fh * 0.05);
    ctx.fillRect(fw * 0.26, fh * 0.64, fw * 0.04, fh * 0.08);
    ctx.fillStyle = b1;
    ctx.beginPath();
    ctx.arc(fw * 0.66, fh * 0.68, Math.max(1, fw * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b2;
    ctx.beginPath();
    ctx.arc(fw * 0.8, fh * 0.68, Math.max(1, fw * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.accent;
    ctx.fillRect(fw * 0.42, fh * 0.8, fw * 0.16, fh * 0.04);
  });
  // 上の看板（画面に平行。遠くからでも何の台か分かるように）
  const top = toScreen(v, spot.x + 0.5, spot.y + 0.5, TOPPER_Z + (look.topperLift ?? 0));
  const w = look.topperW * s;
  const h = 19 * s;
  const glow = 0.7 + 0.3 * Math.sin(t / 500 + spot.id);
  ctx.save();
  ctx.shadowColor = look.accent;
  ctx.shadowBlur = 14 * glow;
  ctx.fillStyle = look.accent;
  ctx.beginPath();
  ctx.roundRect(top.x - w / 2, top.y - h, w, h, 4 * s);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 250, 230, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(top.x - w / 2, top.y - h, w, h, 4 * s);
  ctx.stroke();
  ctx.fillStyle = look.signFg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, sign, top.x, top.y - h / 2 + 0.5 * s, w - 6 * s, look.topperPx * s);
  // 看板の支え
  ctx.strokeStyle = look.dark;
  ctx.lineWidth = 2 * s;
  const foot = toScreen(v, spot.x + 0.5, spot.y + 0.5, GAME_H);
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
};

/** ゲーム筐体の当たり判定（箱と上の看板） */
const gameCabinetPoly = (v: View, spot: GameSpot): SP[] => {
  const b = boxAt(v, spot.x, spot.y, GAME_INSET, GAME_H);
  const top = toScreen(v, spot.x + 0.5, spot.y + 0.5, TOPPER_Z + (lookOf(spot.game).topperLift ?? 0));
  const w = lookOf(spot.game).topperW * v.s;
  const h = 19 * v.s;
  // 箱の輪郭（左手前の下 → 手前の下 → 右の下 → 右の上 → 奥の上 → 左の上）の上に看板の四角を足す
  return [b.floor[3], b.floor[2], b.floor[1], b.top[1], { x: top.x + w / 2, y: top.y }, { x: top.x + w / 2, y: top.y - h }, { x: top.x - w / 2, y: top.y - h }, { x: top.x - w / 2, y: top.y }, b.top[3]];
};

/**
 * ランキングのポスター（v0.6.0。2026-10-30 ユーザー指定で床の立て看板から左の壁へ。DESIGN §16.11）。
 * floor.json の rankingWall の範囲にゲームごとに 1 枚ずつ、画面の左から右へ並べて貼る。
 * 高さは壁ぎわの植木（葉の上は壁の高さ 37 ほど）に隠れないよう、掲示板より高い所（壁の 27%〜95%）。
 */
const RANK_TOP = 0.95;
const RANK_BOTTOM = 0.27;
/** 範囲の両端の余白（マス。奥の角の側は扉の札と重ならないよう広め）と、ポスターの間（s = 1 のとき px） */
const RANK_MARGIN = 0.1;
const RANK_MARGIN_CORNER = 0.75;
const RANK_GAP = 4;

/** ポスター 1 枚の面の座標系：左上が原点、u = 右へ（px）、w = 下へ（px）。at は面の上の点 → 画面 */
const rankingFrame = (v: View, spot: RankingSpot, f: Floor = FLOOR) => {
  const rw = f.rankingWall!;
  const s = v.s;
  const span = (rw.to - rw.from - RANK_MARGIN - RANK_MARGIN_CORNER) * (TW / 2) * s;
  const gap = RANK_GAP * s;
  const pw = (span - gap * (spot.count - 1)) / spot.count;
  const ph = WALL_H * (RANK_TOP - RANK_BOTTOM) * s;
  const z = WALL_H * RANK_TOP;
  const origin = rw.wall === 'right' ? toScreen(v, rw.from + RANK_MARGIN_CORNER, 0, z) : toScreen(v, 0, rw.to - RANK_MARGIN, z);
  const skew = rw.wall === 'right' ? 0.5 : -0.5;
  const u0 = spot.index * (pw + gap);
  const at = (u: number, w: number): SP => ({ x: origin.x + u0 + u, y: origin.y + w + skew * (u0 + u) });
  return { pw, ph, origin, skew, u0, at };
};

/** ポスターの輪郭（当たり判定） */
const rankingPoly = (v: View, spot: RankingSpot): SP[] => {
  const { pw, ph, at } = rankingFrame(v, spot);
  return [at(0, 0), at(pw, 0), at(pw, ph), at(0, ph)];
};

/** ポスターの中身は変わったときだけ描き直す（上位・大きさ・画素の比が同じなら前の絵を貼る） */
const rankingCache = new Map<string, HTMLCanvasElement>();
/** 確認用（#dev の __va.rankingFace）：ゲームごとに、いちばん新しく壁に貼った中身（上位の名前と点数） */
const rankingDrawn = new Map<string, Array<[string, number]>>();
export const rankingFaceOf = (game: string) => rankingDrawn.get(game) ?? null;

/** 幅の狭い縦長の紙なので、1 人を 2 行（順位と名前／点数）で描く。字は紙の大きさに比例させる（font() の 8px の下限を使わない。スマホは拡大で読む） */
const drawRankingFace = (w: number, h: number, s: number, top: RankingEntry[], game: string): HTMLCanvasElement => {
  const dpr = window.devicePixelRatio || 1;
  const key = `${game}|${w.toFixed(1)}|${h.toFixed(1)}|${dpr}|${JSON.stringify(top.map((e) => [e.name, e.score]))}`;
  rankingDrawn.set(game, top.slice(0, 5).map((e) => [e.name, e.score]));
  const hit = rankingCache.get(key);
  if (hit) return hit;
  const look = lookOf(game).board;
  const sign = gameInfo(game)?.sign ?? game.toUpperCase();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const x = c.getContext('2d')!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 紙（2048 は元の 2048 の色：地 #faf8ef・文字 #776e65）
  x.fillStyle = look.bg;
  x.beginPath();
  x.roundRect(0, 0, w, h, 4 * s);
  x.fill();
  x.strokeStyle = look.border;
  x.lineWidth = 2 * s;
  x.stroke();
  // 見出し：ゲームの名前と RANKING の 2 行（長い名前は幅に収まるよう小さく）
  const pad = 3 * s;
  const hh = 22 * s;
  x.fillStyle = look.head;
  x.beginPath();
  x.roundRect(pad, pad, w - pad * 2, hh, 3 * s);
  x.fill();
  x.fillStyle = look.headFg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  fitText(x, sign, w / 2, pad + hh * 0.36, w - pad * 2 - 4 * s, 10.5 * s);
  fitText(x, 'RANKING', w / 2, pad + hh * 0.76, w - pad * 2 - 4 * s, 6.5 * s, 800);
  // 上位 5 人：1 行目に順位（大きく）と名前、2 行目に点数（右寄せ）
  const y0 = pad + hh + 2 * s;
  const rowH = (h - y0 - pad) / 5;
  const medal = ['#edc22e', '#b8b8c8', '#d0915a'];
  const nameX = 13 * s;
  for (let i = 0; i < 5; i++) {
    const e = top[i];
    const ry = y0 + rowH * i;
    if (i % 2 === 0) {
      x.fillStyle = look.stripe;
      x.fillRect(pad, ry, w - pad * 2, rowH);
    }
    x.textBaseline = 'middle';
    x.font = `900 ${(10 * s).toFixed(1)}px ${FONT}`;
    x.textAlign = 'center';
    x.fillStyle = medal[i] ?? look.score;
    x.fillText(String(i + 1), pad + 4.5 * s, ry + rowH / 2);
    x.textAlign = 'left';
    if (!e) {
      x.fillStyle = look.empty;
      x.font = `600 ${(7 * s).toFixed(1)}px ${FONT}`;
      if (i === 0 && !top.length) {
        fitText(x, 'まだ記録が', nameX, ry + rowH * 0.3, w - nameX - pad, 7 * s, 600);
        fitText(x, 'ありません', nameX, ry + rowH * 0.74, w - nameX - pad, 7 * s, 600);
      } else x.fillText('―', nameX, ry + rowH / 2);
      continue;
    }
    x.font = `700 ${(7.5 * s).toFixed(1)}px ${FONT}`;
    x.fillStyle = look.name;
    const room = w - nameX - pad - 1 * s;
    let name = e.name;
    while (name.length > 1 && x.measureText(name).width > room) name = name.slice(0, -1);
    if (name !== e.name) name = ellipsis(name, Math.max(1, [...name].length - 1));
    x.fillText(name, nameX, ry + rowH * 0.3);
    x.textAlign = 'right';
    x.fillStyle = look.score;
    fitText(x, formatScore(e.score), w - pad - 1.5 * s, ry + rowH * 0.74, w - nameX - pad, 8 * s, 900);
  }
  if (rankingCache.size > 16) rankingCache.clear();
  rankingCache.set(key, c);
  return c;
};

/** 壁のランキングのポスター（毎フレーム。掲示板と同じく壁なので人より先に描く。中身の絵は変わったときだけ作り直す） */
const drawRankingWall = (
  ctx: CanvasRenderingContext2D,
  v: View,
  spots: RankingSpot[],
  rankings: Record<string, RankingEntry[]> | undefined,
  hover: number | null | undefined,
) => {
  const s = v.s;
  for (const spot of spots) {
    const { pw, ph, origin, skew, u0 } = rankingFrame(v, spot);
    ctx.save();
    ctx.transform(1, skew, 0, 1, origin.x, origin.y);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2 * s;
    ctx.drawImage(drawRankingFace(pw, ph, s, rankings?.[spot.game] ?? [], spot.game), u0, 0, pw, ph);
    ctx.shadowColor = 'transparent';
    // 画鋲（上の 2 か所）
    ctx.fillStyle = '#ff3d6e';
    for (const k of [0.18, 0.82]) {
      ctx.beginPath();
      ctx.arc(u0 + pw * k, 1.5 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hover === spot.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#ffe14d';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.strokeRect(u0 - 2 * s, -2 * s, pw + 4 * s, ph + 4 * s);
    }
    ctx.restore();
  }
};

/** 床の上の 4 点（タイル座標）を高さ z で多角形にする */
const flat = (v: View, pts: Array<[number, number]>, z: number): SP[] => pts.map(([gx, gy]) => toScreen(v, gx, gy, z));

const drawDecor = (ctx: CanvasRenderingContext2D, v: View, d: Decor, t: number, ui?: SceneUi) => {
  const s = v.s;
  switch (d.type) {
    case 'door':
      drawDoor(ctx, v, d, t, ui?.room ?? 'open', !!ui?.doorOpen);
      break;
    case 'calendar':
      drawCalendar(ctx, v, d);
      break;
    case 'game': {
      const spot = gameSpots().find((g) => g.x === d.x && g.y === d.y);
      if (spot) drawGameCabinet(ctx, v, spot, t);
      break;
    }
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
  d.type === 'game'
    ? boxAt(v, d.x, d.y, GAME_INSET, GAME_H)
    : d.type === 'door'
    ? panelBox(v, d.x, d.y, 0.08, 0.2, 0, DOOR_H)
    : d.type === 'calendar'
      ? panelBox(v, d.x, d.y, 0.12, 0.34, 0, CAL_H)
      : d.type === 'note'
    ? boxAt(v, d.x, d.y, 0.1, NOTE_H)
    : d.type === 'requestbox'
      ? boxAt(v, d.x, d.y, REQUEST_INSET, REQUEST_H)
      : boxAt(v, d.x, d.y, 0.06, CRANE_H);

// ---------------------------------------------------------------- 頭上のもの

const drawNameTag = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: ClientPlayer, me: boolean) => {
  // v0.6.0：ゲームの窓を開いている人は名前の横に 🎮
  // 観戦（DESIGN §16.10）：見ている人がいれば 👀 と人数
  const label = `${p.playing ? (p.viewers ? `🎮👀${p.viewers} ` : '🎮 ') : ''}${p.admin ? '★ ' : ''}${p.host ? '［主催］' : ''}${p.name}`;
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
  // v0.6.0：ランキングのポスター（左の壁）
  const rankBoards = rankingSpots();
  drawRankingWall(ctx, v, rankBoards, ui.rankings, ui.hoverRanking);

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
  const games = gameSpots();
  for (const d of FLOOR.decor) {
    const crane = d.type === 'crane' ? cranes.find((c) => c.x === d.x && c.y === d.y) : undefined;
    const gameSpot = d.type === 'game' ? games.find((c) => c.x === d.x && c.y === d.y) : undefined;
    const hlPoly = gameSpot ? gameCabinetPoly(v, gameSpot) : null;
    const hl =
      (!!gameSpot && ui.hoverGame === gameSpot.id) ||
      (!!crane && ui.hoverCrane === crane.id) ||
      (d.type === 'note' && !!ui.hoverNote) ||
      (d.type === 'requestbox' && !!ui.hoverRequest) ||
      (d.type === 'door' && !!ui.hoverDoor) ||
      (d.type === 'calendar' && !!ui.hoverCalendar);
    items.push({
      d: d.x + d.y + 1,
      draw: () => {
        if (hl) {
          ctx.save();
          ctx.shadowColor = '#fff';
          ctx.shadowBlur = 16;
          poly(ctx, hlPoly ?? boxOutline(decorBox(v, d)));
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        drawDecor(ctx, v, d, t, ui);
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
          crossed: pose.p.stance === 'vega' && !pose.walking,
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
  /** v0.6.0：遊んでいる人の名札（クリックでその人のプレイを見る。手前の人が先） */
  const playTags: SceneHits['playTags'] = [];
  for (const pose of sorted) {
    const p = pose.p;
    const me = p.pid === ui.myPid;
    const c = toScreen(v, pose.x + 0.5, pose.y + 0.5);
    let y = c.y - (charTop(p.watching !== null) + 6) * s;
    const th = drawNameTag(ctx, c.x, y, ts, p, me);
    if (p.playing && !me) {
      ctx.font = font(11.5 * ts, 700);
      const w = ctx.measureText(`🎮👀0 ${p.name}${p.badges ?? ''}`).width + 11.5 * ts * 1.4;
      playTags.unshift({ pid: p.pid, game: p.playing, x: c.x - w / 2, y: y - th, w, h: th });
    }
    y -= th + 2 * ts;
    // ふつうの発言の吹き出しが出ている間はそちら、消えたらピン止めの吹き出し（出しっぱなし）
    if (p.bubble) {
      const left = p.bubble.until - now;
      y -= drawBubble(ctx, c.x, y, ts, p.bubble.text, p.pinned ? 1 : Math.min(1, left / 400)) + 2 * ts;
    } else if (p.pinned) {
      y -= drawBubble(ctx, c.x, y, ts, p.pinned.text, 1, true) + 2 * ts;
    }
    if (p.emote) drawEmote(ctx, c.x, y - 4 * ts, ts, p.emote.emoji, now - p.emote.at);
    // ベガ立ち（v0.6.0）：動くまで頭上に腕組みの印。一時的なエモーション・吹き出しが出ている間はそちらを出す
    else if (p.stance === 'vega' && !p.bubble) drawCrossedArms(ctx, c.x, y - 19 * ts, ts * 1.05);
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
    doors: FLOOR.decor.filter((d) => d.type === 'door').map((d) => boxOutline(decorBox(v, d))),
    calendars: FLOOR.decor.filter((d) => d.type === 'calendar').map((d) => boxOutline(decorBox(v, d))),
    games: games
      .slice()
      .sort((a, b) => b.x + b.y - (a.x + a.y))
      .map((g) => ({ id: g.id, game: g.game, poly: gameCabinetPoly(v, g) })),
    rankings: rankBoards.map((g) => ({ id: g.id, game: g.game, poly: rankingPoly(v, g) })),
    playTags,
  };
  // ゲーム筐体・ランキングのポスターの札（カーソルを置いたとき。v0.6.0）
  if (ui.hoverGame) {
    const g = games.find((x) => x.id === ui.hoverGame);
    if (g) {
      const top = toScreen(v, g.x + 0.5, g.y + 0.5, TOPPER_Z + 26 + (lookOf(g.game).topperLift ?? 0));
      const title = gameInfo(g.game)?.title ?? g.game;
      const { h } = pill(ctx, top.x, top.y, `${title}　クリックで遊ぶ`, 10.5 * ts, '#fff', 'rgba(20, 8, 40, 0.92)', GOLD);
      pill(ctx, top.x, top.y - h - 3 * ts, 'スコアはランキングに残ります', 9.5 * ts, '#1a1300', GOLD);
    }
  }
  if (ui.hoverRanking) {
    const g = rankBoards.find((x) => x.id === ui.hoverRanking);
    if (g) {
      const { pw, at } = rankingFrame(v, g);
      const p = at(pw / 2, 0);
      pill(ctx, p.x, p.y - 6 * ts, `${gameInfo(g.game)?.title ?? g.game} ランキング　クリックで見る`, 10.5 * ts, '#fff', 'rgba(20, 8, 40, 0.92)', GOLD);
    }
  }
  // 予約部屋の扉・予約カレンダーの札（いつも出す。カーソルを置いたら説明。v0.5.0）
  for (const d of FLOOR.decor) {
    if (d.type !== 'door' && d.type !== 'calendar') continue;
    const door = d.type === 'door';
    const top = toScreen(v, d.x + 0.5, d.y + 0.2, (door ? DOOR_H + 14 : CAL_H) + 8);
    const res = ui.room === 'reserved';
    const color = door ? (res ? '#7a5cff' : '#ffb43d') : '#ff3d6e';
    const label = door ? (ui.doorSign ?? (res ? '🚪 オープン部屋へ' : '🔑 予約部屋')) : '📅 予約カレンダー';
    const { h } = pill(ctx, top.x, top.y, label, 9.5 * ts, '#fff', 'rgba(20, 8, 40, 0.88)', color);
    const hover = door ? !!ui.hoverDoor : !!ui.hoverCalendar;
    if (hover)
      pill(
        ctx,
        top.x,
        top.y - h - 3 * ts,
        door ? (res ? 'クリックでオープン部屋へ戻る' : '予約部屋の扉　クリックで入る') : '予約カレンダー　クリックで予約表',
        10.5 * ts,
        '#fff',
        'rgba(20, 8, 40, 0.92)',
        color,
      );
  }
  // 予約部屋：上の中央に部屋名の帯
  if (ui.roomBanner) {
    ctx.save();
    ctx.shadowColor = '#ffb43d';
    ctx.shadowBlur = 10;
    pill(ctx, v.w / 2, 12 + 22 * ts, ui.roomBanner, 13 * ts, '#1a1006', '#ffcf73', '#fff1cf');
    ctx.restore();
  }
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
