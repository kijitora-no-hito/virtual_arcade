// スロットマシンの窓の中（v0.7.0。DESIGN §17）：リールの動き（回す・押す・すべって止まる）と Canvas の描画。
// 止まる位置は shared の stopReel（サーバと同じ計算）。ここは見た目と時間だけ。

import { REEL_LEN, REELS, SLOT_STEP_MS, stopReel, symbolAt, type SlotRole, type SlotSymbol } from '@va/shared';
import type { SfxName } from '../audio/sfx';

/** Canvas の大きさ（CSS ピクセル） */
export const SLOT_W = 420;
export const SLOT_H = 262;

/** リールの窓 */
const CELL = 58;
const WIN_W = 106;
const WIN_GAP = 12;
const WIN_X0 = (SLOT_W - WIN_W * 3 - WIN_GAP * 2) / 2;
const WIN_Y0 = 72;
const WIN_H = CELL * 3;
const LINE_Y = WIN_Y0 + WIN_H / 2;
/** 1 秒に進むコマの数（毎分 80 回転） */
const SPEED = 1000 / SLOT_STEP_MS;
/** 回り始めの加速（秒） */
const ACCEL = 0.22;

export interface ReelAnim {
  /** 位置（コマ。増えると絵柄が下へ流れる。x = i で i 番目のコマが中段） */
  x: number;
  v: number;
  mode: 'stop' | 'spin' | 'brake';
  /** brake のとき止まる位置（巻き戻さない位置。x はここまで進んで止まる） */
  target: number;
  /** 止まってからの時間（跳ね返りの演出） */
  settled: number;
}

export interface SlotSim {
  reels: ReelAnim[];
  /** LUCKY ランプ（内部中のボーナス。リールが全部止まってから光らせる） */
  lamp: boolean;
  /** 揃った役（中段を光らせる）と、その時刻 */
  win: { role: SlotRole; at: number } | null;
  sounds: SfxName[];
}

export const newSlotSim = (pos: number[] = [0, 0, 0]): SlotSim => ({
  reels: pos.map((p) => ({ x: p, v: 0, mode: 'stop' as const, target: p, settled: 1 })),
  lamp: false,
  win: null,
  sounds: [],
});

/** 中段のコマの番号（0〜20） */
export const centerOf = (r: ReelAnim): number => (((Math.round(r.x) % REEL_LEN) + REEL_LEN) % REEL_LEN);

export const anySpinning = (s: SlotSim) => s.reels.some((r) => r.mode !== 'stop');

/** レバー：全部のリールを回す */
export const startSpin = (s: SlotSim): void => {
  s.win = null;
  for (const r of s.reels) {
    r.x = ((r.x % REEL_LEN) + REEL_LEN) % REEL_LEN;
    r.mode = 'spin';
    r.v = 0;
  }
  s.sounds.push('lever');
};

/** 押した瞬間の「押した位置」（次に中段へ来るコマ。ちょうど中段なら そのコマ） */
export const pressPos = (r: ReelAnim): number => Math.ceil(r.x - 1e-6);

/**
 * 止めるボタン：押した位置から stopReel で止まる位置を決めて、そこまで進めて止める。
 * stops = ほかのリールの止まった位置（押した順に決まる。止まりかけのリールも決まった位置で数える）。返り値は押した位置（0〜20）
 */
export const pressReel = (s: SlotSim, reel: number, stops: Array<number | null>, flag: SlotRole | null): number | null => {
  const r = s.reels[reel];
  if (r.mode !== 'spin') return null;
  const p = pressPos(r);
  const press = ((p % REEL_LEN) + REEL_LEN) % REEL_LEN;
  const stop = stopReel(reel, press, stops, flag);
  r.target = p + ((stop - press + REEL_LEN) % REEL_LEN);
  r.mode = 'brake';
  return press;
};

/** 止まる位置をサーバの答えに合わせる（ずれていたときだけ。ふつうは同じ） */
export const snapReel = (r: ReelAnim, pos: number): void => {
  if (centerOf(r) === pos && r.mode === 'stop') return;
  r.x = pos;
  r.target = pos;
  r.mode = 'stop';
  r.v = 0;
};

export const stepSlot = (s: SlotSim, dt: number): void => {
  for (const r of s.reels) {
    if (r.mode === 'stop') {
      r.settled += dt;
      continue;
    }
    r.v = Math.min(SPEED, r.v + (SPEED / ACCEL) * dt);
    // 止める操作のあとは速さを保ったまま決まった位置まで（最大 4 コマ ≒ 0.18 秒）
    if (r.mode === 'brake') r.v = Math.max(r.v, SPEED * 0.8);
    r.x += r.v * dt;
    if (r.mode === 'brake' && r.x >= r.target) {
      r.x = r.target;
      r.mode = 'stop';
      r.v = 0;
      r.settled = 0;
      s.sounds.push('reel');
    }
  }
};

// ---------------------------------------------------------------- 絵柄

const FONT = '"Yu Gothic UI", "Meiryo", "Hiragino Sans", system-ui, sans-serif';

/** 絵柄を (cx, cy) を中心に、高さ h ほどで描く（店内の台の画面でも使う） */
export const drawSymbol = (ctx: CanvasRenderingContext2D, sym: SlotSymbol, cx: number, cy: number, h: number): void => {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (sym) {
    case 'seven': {
      ctx.font = `italic 900 ${(h * 0.92).toFixed(1)}px ${FONT}`;
      const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
      g.addColorStop(0, '#ff7a6b');
      g.addColorStop(0.5, '#ff1a1a');
      g.addColorStop(1, '#a00000');
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.5, h * 0.12);
      ctx.strokeStyle = '#3a0000';
      ctx.strokeText('7', cx, cy + h * 0.04);
      ctx.lineWidth = Math.max(1, h * 0.05);
      ctx.strokeStyle = '#fff3c4';
      ctx.strokeText('7', cx, cy + h * 0.04);
      ctx.fillStyle = g;
      ctx.fillText('7', cx, cy + h * 0.04);
      break;
    }
    case 'bar': {
      const w = h * 1.35;
      const hh = h * 0.46;
      ctx.fillStyle = '#121218';
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - hh / 2, w, hh, hh * 0.22);
      ctx.fill();
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = Math.max(1, h * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${(hh * 0.72).toFixed(1)}px ${FONT}`;
      ctx.fillText('BAR', cx, cy + hh * 0.04);
      break;
    }
    case 'bell': {
      const w = h * 0.78;
      const top = cy - h * 0.38;
      const bot = cy + h * 0.26;
      const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      g.addColorStop(0, '#c98a00');
      g.addColorStop(0.35, '#ffe45c');
      g.addColorStop(1, '#d99a00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, bot);
      ctx.quadraticCurveTo(cx - w * 0.36, bot - h * 0.12, cx - w * 0.33, cy - h * 0.06);
      ctx.quadraticCurveTo(cx - w * 0.3, top, cx, top);
      ctx.quadraticCurveTo(cx + w * 0.3, top, cx + w * 0.33, cy - h * 0.06);
      ctx.quadraticCurveTo(cx + w * 0.36, bot - h * 0.12, cx + w / 2, bot);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#6b4300';
      ctx.lineWidth = Math.max(1, h * 0.04);
      ctx.stroke();
      ctx.fillStyle = '#8a5a00';
      ctx.beginPath();
      ctx.arc(cx, bot + h * 0.06, h * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, top - h * 0.03, h * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'suika': {
      // 切ったスイカ（半月：赤い身・白と緑の皮・黒い種）
      const r = h * 0.44;
      const y = cy - h * 0.12;
      ctx.fillStyle = '#1f8a3a';
      ctx.beginPath();
      ctx.arc(cx, y, r, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8ffd8';
      ctx.beginPath();
      ctx.arc(cx, y, r * 0.86, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff3d55';
      ctx.beginPath();
      ctx.arc(cx, y, r * 0.78, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a1010';
      for (const [dx, dy] of [
        [-0.42, 0.22],
        [0, 0.42],
        [0.42, 0.22],
        [-0.2, 0.6],
        [0.2, 0.6],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * r, y + dy * r, r * 0.06, r * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'cherry': {
      const r = h * 0.17;
      const ly = cy + h * 0.2;
      ctx.strokeStyle = '#2f9e3a';
      ctx.lineWidth = Math.max(1, h * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.2, ly - r * 0.6);
      ctx.quadraticCurveTo(cx - h * 0.12, cy - h * 0.2, cx + h * 0.06, cy - h * 0.38);
      ctx.moveTo(cx + h * 0.2, ly - r * 0.6);
      ctx.quadraticCurveTo(cx + h * 0.12, cy - h * 0.16, cx + h * 0.06, cy - h * 0.38);
      ctx.stroke();
      ctx.fillStyle = '#3fbf4a';
      ctx.beginPath();
      ctx.ellipse(cx + h * 0.2, cy - h * 0.34, h * 0.13, h * 0.06, -0.4, 0, Math.PI * 2);
      ctx.fill();
      for (const dx of [-0.2, 0.2]) {
        const g = ctx.createRadialGradient(cx + dx * h - r * 0.35, ly - r * 0.35, r * 0.1, cx + dx * h, ly, r);
        g.addColorStop(0, '#ff9aa8');
        g.addColorStop(1, '#c4001f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + dx * h, ly, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'replay': {
      const w = h * 1.4;
      const hh = h * 0.42;
      ctx.fillStyle = '#1e5bff';
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - hh / 2, w, hh, hh / 2);
      ctx.fill();
      ctx.strokeStyle = '#bfe0ff';
      ctx.lineWidth = Math.max(1, h * 0.04);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${(hh * 0.58).toFixed(1)}px ${FONT}`;
      ctx.fillText('REPLAY', cx, cy + hh * 0.04, w * 0.86);
      break;
    }
  }
  ctx.restore();
};

// ---------------------------------------------------------------- 描画

/** LUCKY ランプ（光っている間は色が回る） */
const drawLamp = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, t: number) => {
  ctx.save();
  if (lit) {
    const hue = (t / 6) % 360;
    const pulse = 0.65 + 0.35 * Math.sin(t / 130);
    ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
    ctx.shadowBlur = 26 * pulse;
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, `hsl(${hue}, 100%, 62%)`);
    g.addColorStop(0.5, `hsl(${(hue + 60) % 360}, 100%, 70%)`);
    g.addColorStop(1, `hsl(${(hue + 120) % 360}, 100%, 62%)`);
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#2a2438';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = lit ? '#fffbe0' : '#4a4160';
  ctx.stroke();
  ctx.fillStyle = lit ? '#2a0a00' : '#5a5170';
  ctx.font = `italic 900 ${(h * 0.6).toFixed(1)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LUCKY', x + w / 2, y + h / 2 + 1);
  ctx.restore();
};

export const drawSlotMachine = (ctx: CanvasRenderingContext2D, s: SlotSim, t: number): void => {
  ctx.clearRect(0, 0, SLOT_W, SLOT_H);
  // 台の地
  const bg = ctx.createLinearGradient(0, 0, 0, SLOT_H);
  bg.addColorStop(0, '#3a0d4a');
  bg.addColorStop(1, '#14061f');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, SLOT_W, SLOT_H, 12);
  ctx.fill();
  // 上：LUCKY ランプと両側の 7
  drawLamp(ctx, SLOT_W / 2 - 70, 14, 140, 40, s.lamp, t);
  drawSymbol(ctx, 'seven', 52, 34, 40);
  drawSymbol(ctx, 'seven', SLOT_W - 52, 34, 40);
  // リールの窓
  for (let i = 0; i < 3; i++) {
    const wx = WIN_X0 + i * (WIN_W + WIN_GAP);
    const r = s.reels[i];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(wx, WIN_Y0, WIN_W, WIN_H, 6);
    ctx.clip();
    ctx.fillStyle = '#fbf7ee';
    ctx.fillRect(wx, WIN_Y0, WIN_W, WIN_H);
    // 止まった直後の小さな跳ね返り
    const bounce = r.mode === 'stop' && r.settled < 0.14 ? Math.sin((r.settled / 0.14) * Math.PI) * 4 : 0;
    const base = Math.floor(r.x);
    const frac = r.x - base;
    for (let k = -2; k <= 2; k++) {
      const idx = base + k;
      const y = LINE_Y - (k - frac) * CELL + bounce;
      const blur = r.mode !== 'stop' && r.v > 6;
      if (blur) ctx.globalAlpha = 0.85;
      drawSymbol(ctx, symbolAt(i, idx), wx + WIN_W / 2, y, CELL * 0.78);
      ctx.globalAlpha = 1;
    }
    // 筒の陰（上下を暗く）
    const sh = ctx.createLinearGradient(0, WIN_Y0, 0, WIN_Y0 + WIN_H);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(0.25, 'rgba(0,0,0,0)');
    sh.addColorStop(0.75, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = sh;
    ctx.fillRect(wx, WIN_Y0, WIN_W, WIN_H);
    // 揃ったとき：中段を光らせる
    if (s.win && (s.win.role !== 'cherry' || i === 0)) {
      const blink = Math.floor((t - s.win.at) / 180) % 2 === 0;
      if (blink) {
        ctx.fillStyle = 'rgba(255, 236, 120, 0.35)';
        ctx.fillRect(wx, LINE_Y - CELL / 2, WIN_W, CELL);
      }
    }
    ctx.restore();
    ctx.strokeStyle = r.mode === 'spin' ? '#ffe14d' : '#8a6bb8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(wx, WIN_Y0, WIN_W, WIN_H, 6);
    ctx.stroke();
  }
  // 有効ライン（中段）
  ctx.strokeStyle = 'rgba(255, 45, 85, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIN_X0 - 14, LINE_Y);
  ctx.lineTo(WIN_X0 + WIN_W * 3 + WIN_GAP * 2 + 14, LINE_Y);
  ctx.stroke();
  ctx.fillStyle = '#ff2d55';
  for (const [x, d] of [
    [WIN_X0 - 14, 1],
    [WIN_X0 + WIN_W * 3 + WIN_GAP * 2 + 14, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, LINE_Y - 7);
    ctx.lineTo(x + d * 10, LINE_Y);
    ctx.lineTo(x, LINE_Y + 7);
    ctx.closePath();
    ctx.fill();
  }
};

/** 押したリールのいま中段に見えているコマ（確認用） */
export const visibleCenter = (r: ReelAnim): number => centerOf(r);
export { REELS, REEL_LEN };
