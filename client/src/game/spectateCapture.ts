// 観戦の画像（v0.6.0。DESIGN §16.10）：遊ぶ人の窓（親）が、同じオリジンの iframe の中の Canvas を読んで縮めた画像にする。
// iframe の中のゲームのコード（Hextris は GPLv3）には手を入れず、親（このアプリ・MIT）の側で読む。
// - Hextris：#canvas を幅 320 に縮める
// - Columns like game：井戸（#grid と #well）と NEXT（#next canvas）が別の canvas なので、見る人に分かる 1 枚にまとめる
//   （左に井戸、右に NEXT と点数・レベル）

import { SPECTATE_DEFAULTS, SPECTATE_FRAME_QUALITY, SPECTATE_FRAME_WIDTH, type SpectateInfo } from '@va/shared';

export interface CapturedFrame {
  image: string;
  info: SpectateInfo;
  /** デコードしたときの大きさ（バイト。base64 から求める） */
  bytes: number;
}

const b64Bytes = (dataUrl: string): number => {
  const i = dataUrl.indexOf(',');
  const b = dataUrl.length - i - 1;
  return Math.floor((b * 3) / 4) - (dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0);
};

/** WebP（使えなければ JPEG）にする。32 KB を超えたら品質を下げてもう一度。それでも大きければ null */
export const encodeFrame = (c: HTMLCanvasElement): { image: string; bytes: number } | null => {
  for (const q of [SPECTATE_FRAME_QUALITY, 0.4, 0.25]) {
    let url = c.toDataURL('image/webp', q);
    // Safari などは WebP を書けず PNG を返す → JPEG
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', q);
    const bytes = b64Bytes(url);
    if (bytes <= SPECTATE_DEFAULTS.frameMaxBytes) return { image: url, bytes };
  }
  return null;
};

const num = (doc: Document, sel: string): number => {
  const n = parseInt((doc.querySelector(sel)?.textContent ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

let work: HTMLCanvasElement | null = null;
const workCanvas = (w: number, h: number): CanvasRenderingContext2D => {
  if (!work) work = document.createElement('canvas');
  if (work.width !== w) work.width = w;
  if (work.height !== h) work.height = h;
  return work.getContext('2d')!;
};

/** iframe の中の画面を 1 枚の画像にする（読めなければ null） */
export const captureGameFrame = (frame: HTMLIFrameElement | null, game: string): CapturedFrame | null => {
  let doc: Document | null = null;
  let win: (Window & Record<string, unknown>) | null = null;
  try {
    doc = frame?.contentDocument ?? null;
    win = (frame?.contentWindow as (Window & Record<string, unknown>) | null) ?? null;
  } catch {
    return null;
  }
  if (!doc || !win) return null;
  if (game === 'hextris') {
    const src = doc.getElementById('canvas') as HTMLCanvasElement | null;
    if (!src || !src.width || !src.height) return null;
    // 幅 320・高さ 480 に収める（スマホの縦長の画面も全体が入るように）
    const k = Math.min(SPECTATE_FRAME_WIDTH / src.width, 480 / src.height);
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const ctx = workCanvas(w, h);
    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const gs = Number(win.gameState);
    const state: SpectateInfo['state'] = gs === 1 ? 'play' : gs === -1 ? 'paused' : gs === 2 ? 'over' : 'idle';
    const enc = encodeFrame(work!);
    return enc && { ...enc, info: { score: Math.max(0, Math.floor(Number(win.score) || 0)), state } };
  }
  if (game === 'columns') {
    const well = doc.getElementById('well') as HTMLCanvasElement | null;
    const grid = doc.getElementById('grid') as HTMLCanvasElement | null;
    const next = doc.querySelector('#next canvas') as HTMLCanvasElement | null;
    if (!well || !well.width) return null;
    const W = SPECTATE_FRAME_WIDTH;
    const H = 400;
    const ctx = workCanvas(W, H);
    // 地（元の Gradient の背景に近い暗い色）
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d1640');
    g.addColorStop(1, '#0b0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const wh = H - 8;
    const ww = Math.round((well.width / well.height) * wh);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(4, 4, ww, wh);
    if (grid && grid.width) ctx.drawImage(grid, 4, 4, ww, wh);
    ctx.drawImage(well, 4, 4, ww, wh);
    // 右の欄：NEXT・点数・レベル
    const x0 = ww + 16;
    const block = wh / 13;
    ctx.fillStyle = '#d29bff';
    ctx.font = '700 13px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('NEXT', x0, 8);
    if (next && next.width) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(x0, 26, block, block * 3);
      ctx.drawImage(next, x0, 26, block, block * 3);
    }
    const score = num(doc, '#score');
    const level = num(doc, '#level');
    const label = (t: string, v: string, y: number) => {
      ctx.fillStyle = '#d29bff';
      ctx.font = '700 12px sans-serif';
      ctx.fillText(t, x0, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 17px sans-serif';
      ctx.fillText(v, x0, y + 15);
    };
    label('SCORE', score.toLocaleString('en-US'), 26 + block * 3 + 14);
    label('LEVEL', String(level), 26 + block * 3 + 58);
    label('JEWELS', String(num(doc, '#jewels')), 26 + block * 3 + 102);
    const over = !!doc.querySelector('#overlay_gameover.open');
    const paused = !!doc.querySelector('#overlay_pause.open');
    const state: SpectateInfo['state'] = over ? 'over' : paused ? 'paused' : 'play';
    const enc = encodeFrame(work!);
    return enc && { ...enc, info: { score, level, state } };
  }
  return null;
};

/** 2048 の iframe の今の点数（画面の点数の欄。足した分の動く字は除く） */
export const score2048 = (frame: HTMLIFrameElement | null): number => {
  try {
    const el = frame?.contentDocument?.querySelector('.score-container');
    const t = el?.firstChild?.nodeValue ?? '0';
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};
