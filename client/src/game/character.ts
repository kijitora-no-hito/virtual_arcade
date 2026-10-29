// キャラクター（簡単な人形。記号的な絵）。足もとの点 (x, y) を基準に描く。

import { bodyColor, type Look } from '@va/shared';

export interface CharOpts {
  /** 画面の左右の向き */
  dir: -1 | 1;
  /** 歩いているときの足の振り（ラジアン）。null = 止まっている */
  walk: number | null;
  /** 座っている（筐体の前。後ろ姿） */
  sitting: boolean;
  /** 自分（足もとに光る輪） */
  me: boolean;
  /** 時刻（ms。輪の明滅） */
  t: number;
  /** v0.6.0：ベガ立ち（胸の前で腕を組む。止まっているときだけ） */
  crossed?: boolean;
}

const SKIN = '#ffe3c4';
const OUTLINE = 'rgba(10, 8, 30, 0.85)';

const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

const rrect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/**
 * v0.6.0：ベガ立ちの印（胸の前で組んだ腕。肌色の手と赤い袖。中心 (x, y)・幅は約 30 × size）。頭上とエモーションのボタンで使う
 */
export const drawCrossedArms = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, plate = true) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  if (plate) {
    // 下地（暗い丸い札・赤い縁）
    ctx.fillStyle = 'rgba(20, 8, 40, 0.9)';
    ctx.beginPath();
    ctx.roundRect(-16, -17, 32, 33, 9);
    ctx.fill();
    ctx.strokeStyle = '#ff2d55';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = OUTLINE;
  }
  // 胴（赤い軍服。肩は張る）
  ctx.fillStyle = '#b3122d';
  ctx.beginPath();
  ctx.moveTo(-13, -1);
  ctx.quadraticCurveTo(-13, -5, -8, -5);
  ctx.lineTo(8, -5);
  ctx.quadraticCurveTo(13, -5, 13, -1);
  ctx.lineTo(10, 14);
  ctx.lineTo(-10, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 頭と帽子（赤い帽子に金の印）
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -9, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c8193a';
  ctx.beginPath();
  ctx.moveTo(-6.5, -10);
  ctx.quadraticCurveTo(0, -18.5, 6.5, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(0, -12.5, 1.4, 0, Math.PI * 2);
  ctx.fill();
  // 胸の前で組んだ腕：奥の腕（右上から左下へ）と手前の腕（左上から右下へ）、両端に肌色の手
  ctx.lineCap = 'round';
  const arm = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 6.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.2;
    ctx.stroke();
  };
  arm(9, 2.5, -7, 7.5, '#7a0c1f');
  arm(-9, 2.5, 7, 7.5, '#ff4d6d');
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = SKIN;
  for (const [hx, hy] of [
    [-8.5, 8],
    [8.5, 8],
  ]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

/** 頭のてっぺんの高さ（足もとから。拡大率 1） */
export const charTop = (sitting: boolean): number => (sitting ? 46 : 52);

export const drawCharacter = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, look: Look, o: CharOpts) => {
  const body = bodyColor(look.color);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = OUTLINE;

  // 足もと：影と、自分なら光る輪
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.me) {
    const a = 0.65 + 0.35 * Math.sin(o.t / 260);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 225, 77, ${a})`;
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const back = o.sitting;
  let hip = -11;
  if (o.sitting) {
    // 丸い椅子
    ctx.fillStyle = '#3b3b52';
    rrect(ctx, -2, -10, 4, 10, 1);
    ctx.fill();
    ctx.fillStyle = '#e04a6a';
    ctx.beginPath();
    ctx.ellipse(0, -11, 9, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    hip = -13;
  } else {
    // 足（歩くと交互に振る）
    const sw = o.walk === null ? 0 : Math.sin(o.walk) * 2.6;
    ctx.fillStyle = '#2c2a44';
    rrect(ctx, -6, hip - 1 + sw * 0.4, 5, 12 - sw * 0.4, 2);
    ctx.fill();
    ctx.stroke();
    rrect(ctx, 1, hip - 1 - sw * 0.4, 5, 12 + sw * 0.4, 2);
    ctx.fill();
    ctx.stroke();
  }

  const bob = o.walk === null ? 0 : Math.abs(Math.sin(o.walk)) * -1.2;
  ctx.translate(0, bob);

  // 腕（ベガ立ちは上の腕だけ。前で組んだ腕は胴の後に描く）
  const crossed = !!o.crossed && !o.sitting && o.walk === null;
  const arm = o.walk === null ? 0 : Math.sin(o.walk) * 3;
  ctx.fillStyle = shade(body, -0.25);
  rrect(ctx, -12, hip - 18 + arm * 0.3, 4.5, crossed ? 9 : 13, 2.2);
  ctx.fill();
  ctx.stroke();
  rrect(ctx, 7.5, hip - 18 - arm * 0.3, 4.5, crossed ? 9 : 13, 2.2);
  ctx.fill();
  ctx.stroke();

  // 胴
  const g = ctx.createLinearGradient(0, hip - 21, 0, hip);
  g.addColorStop(0, shade(body, 0.25));
  g.addColorStop(1, shade(body, -0.15));
  ctx.fillStyle = g;
  rrect(ctx, -9, hip - 21, 18, 21, 6);
  ctx.fill();
  ctx.stroke();
  if (crossed) {
    // 胸の前で組んだ腕：2 本の前腕を斜めに重ね（奥は濃い色）、両端に手
    ctx.lineCap = 'round';
    const fore = (x0: number, y0: number, x1: number, y1: number, color: string) => {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.4;
      ctx.stroke();
    };
    fore(8.5, hip - 16, -6.5, hip - 11, shade(body, -0.45));
    fore(-8.5, hip - 16, 6.5, hip - 11, shade(body, -0.2));
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(-8, hip - 10.5, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8, hip - 10.5, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 頭
  const hy = hip - 21 - 9;
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, hy, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!back) {
    ctx.fillStyle = '#1b1830';
    const ex = o.dir * 2.5;
    ctx.beginPath();
    ctx.arc(ex - 3, hy - 0.5, 1.5, 0, Math.PI * 2);
    ctx.arc(ex + 3, hy - 0.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // ほっぺ
    ctx.fillStyle = 'rgba(255, 120, 140, 0.45)';
    ctx.beginPath();
    ctx.arc(ex - 5.5, hy + 3, 1.6, 0, Math.PI * 2);
    ctx.arc(ex + 5.5, hy + 3, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 後ろ姿：髪の毛の色で頭の後ろを塗る
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath();
    ctx.arc(0, hy, 9.5, Math.PI * 1.05, Math.PI * 1.95 + Math.PI * 0.1);
    ctx.fill();
  }

  drawHeadwear(ctx, look.hat, hy, o.dir, body, back);
  ctx.restore();
};

const drawHeadwear = (ctx: CanvasRenderingContext2D, hat: string, hy: number, dir: -1 | 1, body: string, back: boolean) => {
  ctx.lineWidth = 1.3;
  switch (hat) {
    case 'cap': {
      ctx.fillStyle = shade(body, -0.35);
      ctx.beginPath();
      ctx.arc(0, hy - 2, 9.8, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (!back) {
        ctx.beginPath();
        ctx.ellipse(dir * 8, hy - 2.5, 7, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, hy - 11.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'beanie': {
      ctx.fillStyle = '#ff5a7a';
      ctx.beginPath();
      ctx.arc(0, hy - 1.5, 10, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3';
      ctx.fillRect(-10, hy - 4, 20, 3);
      ctx.fillStyle = '#ffe3ec';
      ctx.beginPath();
      ctx.arc(0, hy - 12.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'spiky': {
      ctx.fillStyle = '#ffcf33';
      ctx.beginPath();
      ctx.moveTo(-10, hy - 1);
      const tips = [-9, -5, 0, 5, 9];
      tips.forEach((tx, i) => {
        ctx.lineTo(tx - 2, hy - 8);
        ctx.lineTo(tx, hy - 15 - (i % 2) * 3);
        ctx.lineTo(tx + 2, hy - 8);
      });
      ctx.lineTo(10, hy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'headphones': {
      ctx.strokeStyle = '#26243a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, hy - 1, 11, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.fillStyle = '#22e6ff';
      ctx.strokeStyle = 'rgba(10, 8, 30, 0.85)';
      ctx.lineWidth = 1.3;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * 10, hy + 1, 3.2, 4.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'ribbon': {
      ctx.fillStyle = '#ff3df0';
      const rx = back ? 0 : dir * 5;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(rx, hy - 9);
        ctx.lineTo(rx + sx * 7, hy - 14);
        ctx.lineTo(rx + sx * 7, hy - 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(rx, hy - 9.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    default:
      break;
  }
};
