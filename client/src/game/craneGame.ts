// クレーンゲームのミニゲーム（窓の中の Canvas）：アームの動き・演出の進み方・描画。
// 当たり外れはサーバが決める。ここはサーバの結果（CranePlayResponse）どおりに動かすだけ。
//
// ケースの床の座標 x（左 0 → 右 1）・z（手前 0 → 奥 1）。高さ h（床 0 → 天井 1）。

import { ARM_HOME, CAPSULE_R, type CapsuleView, type CranePlayResponse } from '@va/shared';
import { suitColor } from '../components/Badges';

/** 画面の大きさ（CSS px） */
export const CRANE_W = 520;
export const CRANE_H = 380;

/** アームが動く速さ（床の座標 / 秒） */
const ARM_SPEED = 0.36;
const ARM_MAX = 0.97;
/** アームの高さ：ふだん / 下りたとき（爪の先がカプセルの中心の高さ） */
const ARM_TOP = 0.9;
const ARM_LOW = 0.13;
/** 何もしないと次へ進むまで */
export const IDLE_MS = 10_000;

export type CranePhase =
  | 'loading'
  | 'ready' // ［→］待ち
  | 'x' // ［→］を押している
  | 'wz' // ［↑］待ち
  | 'z' // ［↑］を押している
  | 'wdrop' // ［下ろす］待ち
  | 'anim' // 下りる〜結果
  | 'done'; // 結果を出している（待ち時間のあと ready）

interface Step {
  /** 何秒目に始まるか（下ろしてから） */
  at: number;
  dur: number;
  kind: 'lower' | 'grab' | 'lift' | 'carry' | 'open' | 'chute' | 'reveal' | 'home';
}

export interface CraneSim {
  phase: CranePhase;
  arm: { x: number; z: number; h: number; open: number };
  capsules: CapsuleView[];
  /** 演出の経過（秒。下ろした瞬間が 0） */
  t: number;
  /** サーバの返事（届くまで null。届くまでは下りるだけ） */
  result: CranePlayResponse | null;
  /** 返事を待たずに下り始めた位置 */
  dropAt: { x: number; z: number } | null;
  steps: Step[];
  /** つかんだカプセル（アームと一緒に動く） */
  carried: CapsuleView | null;
  /** 途中で落ちたカプセル（落ちている途中） */
  falling: { c: CapsuleView; from: { x: number; z: number; h: number }; to: { x: number; z: number }; t0: number } | null;
  /** 出口へ落ちていくカプセル */
  chute: { c: CapsuleView; t0: number } | null;
  /** 結果の表示（開始の時刻 = t） */
  banner: { text: string; sub: string; color: string; t0: number; suit: string | null; complete: boolean } | null;
  /** 紙吹雪 */
  confetti: Array<{ x: number; y: number; vx: number; vy: number; c: string; r: number }>;
  /** 効果音を鳴らす合図（描画のループが取り出して鳴らす） */
  sounds: string[];
  /** 何もしないで待った時間（ms） */
  idle: number;
  /** 演出が終わった */
  finished: boolean;
  /** 新しいカプセルがふわっと出る */
  appear: { id: number; t0: number } | null;
  /** この回でカプセルをつかんだ（1 回だけ） */
  grabbed: boolean;
}

export const newSim = (): CraneSim => ({
  phase: 'loading',
  arm: { x: ARM_HOME.x, z: ARM_HOME.z, h: ARM_TOP, open: 0.15 },
  capsules: [],
  t: 0,
  result: null,
  dropAt: null,
  steps: [],
  carried: null,
  falling: null,
  chute: null,
  banner: null,
  confetti: [],
  sounds: [],
  idle: 0,
  finished: false,
  appear: null,
  grabbed: false,
});

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** ［下ろす］：アームを下ろし始める（サーバの返事は後から setResult） */
export const startDrop = (s: CraneSim): boolean => {
  if (s.phase !== 'wz' && s.phase !== 'z' && s.phase !== 'wdrop') return false;
  s.phase = 'anim';
  s.t = 0;
  s.dropAt = { x: s.arm.x, z: s.arm.z };
  s.result = null;
  s.grabbed = false;
  s.banner = null;
  s.appear = null;
  s.steps = [{ at: 0, dur: 1.1, kind: 'lower' }];
  s.sounds.push('down');
  return true;
};

/** サーバの返事が届いた：その結果どおりの演出を組む */
export const setResult = (s: CraneSim, r: CranePlayResponse): void => {
  s.result = r;
  const lowerEnd = Math.max(1.1, s.t);
  const steps: Step[] = [{ at: 0, dur: lowerEnd, kind: 'lower' }];
  let t = lowerEnd;
  steps.push({ at: t, dur: 0.45, kind: 'grab' });
  t += 0.45;
  steps.push({ at: t, dur: 1.0, kind: 'lift' });
  t += 1.0;
  const from = s.dropAt ?? { x: s.arm.x, z: s.arm.z };
  const dist = Math.hypot(from.x - ARM_HOME.x, from.z - ARM_HOME.z);
  const carry = 0.5 + dist * 1.5;
  steps.push({ at: t, dur: carry, kind: 'carry' });
  t += carry;
  steps.push({ at: t, dur: 0.4, kind: 'open' });
  t += 0.4;
  if (r.outcome === 'win') {
    steps.push({ at: t, dur: 0.6, kind: 'chute' });
    t += 0.6;
    steps.push({ at: t, dur: r.completed ? 3.2 : 2.2, kind: 'reveal' });
  } else {
    steps.push({ at: t, dur: 1.6, kind: 'reveal' });
  }
  s.steps = steps;
};

/** サーバに断られた（待ち時間・遠い など）：アームを戻す */
export const abortDrop = (s: CraneSim): void => {
  const t = s.t;
  s.result = null;
  s.steps = [
    { at: 0, dur: Math.max(0.01, t), kind: 'lower' },
    { at: t, dur: 0.6, kind: 'lift' },
    { at: t + 0.6, dur: 0.9, kind: 'home' },
  ];
  s.dropAt = s.dropAt ?? { x: s.arm.x, z: s.arm.z };
};

const stepOf = (s: CraneSim, kind: Step['kind']) => s.steps.find((x) => x.kind === kind);
const progress = (s: CraneSim, st: Step | undefined) => (st ? clamp((s.t - st.at) / st.dur, 0, 1) : 0);

const CONFETTI = ['#ff3df0', '#22e6ff', '#ffe14d', '#7cff6b', '#ff8a3d', '#ffffff'];

/** 1 フレーム進める。input はボタン・キーを押しているか */
export const stepSim = (s: CraneSim, dt: number, input: { right: boolean; up: boolean }): void => {
  const a = s.arm;
  switch (s.phase) {
    case 'ready':
      if (input.right) {
        s.phase = 'x';
        s.idle = 0;
      }
      break;
    case 'x': {
      if (!input.right) {
        s.phase = 'wz';
        s.idle = 0;
        s.sounds.push('stop');
        break;
      }
      const nx = clamp(a.x + ARM_SPEED * dt, ARM_HOME.x, ARM_MAX);
      if (Math.floor(nx * 20) !== Math.floor(a.x * 20)) s.sounds.push('tick');
      a.x = nx;
      break;
    }
    case 'wz':
      s.idle += dt * 1000;
      if (input.up) {
        s.phase = 'z';
        s.idle = 0;
      } else if (s.idle > IDLE_MS) startDrop(s);
      break;
    case 'z': {
      if (!input.up) {
        s.phase = 'wdrop';
        s.idle = 0;
        s.sounds.push('stop');
        break;
      }
      const nz = clamp(a.z + ARM_SPEED * dt, ARM_HOME.z, ARM_MAX);
      if (Math.floor(nz * 20) !== Math.floor(a.z * 20)) s.sounds.push('tick');
      a.z = nz;
      break;
    }
    case 'wdrop':
      s.idle += dt * 1000;
      if (s.idle > IDLE_MS) startDrop(s);
      break;
    case 'anim':
      animate(s, dt);
      break;
    default:
      break;
  }
  // 紙吹雪
  for (const c of s.confetti) {
    c.vy += 260 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.vx *= 0.995;
  }
  s.confetti = s.confetti.filter((c) => c.y < CRANE_H + 20);
};

const animate = (s: CraneSim, dt: number) => {
  const prevT = s.t;
  s.t += dt;
  const a = s.arm;
  const r = s.result;
  const from = s.dropAt!;
  const crossed = (st: Step | undefined) => !!st && prevT < st.at && s.t >= st.at;

  // 下りる（返事が来るまでは下りきった所で待つ）
  const low = stepOf(s, 'lower');
  const kLow = progress(s, low);
  a.h = ARM_TOP + (ARM_LOW - ARM_TOP) * ease(kLow);
  a.open = 0.15 + 0.85 * Math.min(1, kLow * 1.6);
  if (!r && !stepOf(s, 'home')) {
    if (s.t > 1.1) s.t = 1.1; // 返事待ち
    return;
  }
  // 断られた：戻る
  const home = stepOf(s, 'home');
  if (home) {
    const kl = progress(s, stepOf(s, 'lift'));
    if (kl > 0) a.h = ARM_LOW + (ARM_TOP - ARM_LOW) * ease(kl);
    const kh = progress(s, home);
    a.x = from.x + (ARM_HOME.x - from.x) * ease(kh);
    a.z = from.z + (ARM_HOME.z - from.z) * ease(kh);
    a.open = 0.15 + 0.85 * (1 - kl);
    if (s.t >= home.at + home.dur) s.finished = true;
    return;
  }
  if (!r) return;

  // つかんだカプセル（ほかの人が遊んで配置が変わっていたら、サーバの位置で）
  const known = r.capsuleId !== null ? s.capsules.find((c) => c.id === r.capsuleId) : undefined;
  const target: CapsuleView | null =
    r.capsuleId !== null && r.grabAt
      ? { id: r.capsuleId, x: r.grabAt.x, z: r.grabAt.z, color: known?.color ?? r.machine.capsules.find((c) => c.id === r.capsuleId)?.color ?? '#ffe14d' }
      : null;
  const holds = r.outcome === 'win' || r.outcome === 'drop';

  const grab = stepOf(s, 'grab');
  if (crossed(grab)) s.sounds.push('grab');
  const kg = progress(s, grab);
  if (kg > 0) a.open = 1 - kg * (holds ? 0.75 : r.outcome === 'slip' ? 0.7 : 1);
  if (kg >= 1 && holds && target && !s.grabbed) {
    s.grabbed = true;
    s.carried = target;
    s.capsules = s.capsules.filter((c) => c.id !== target.id);
  }

  const lift = stepOf(s, 'lift');
  if (crossed(lift)) s.sounds.push('up');
  const kl = progress(s, lift);
  if (kl > 0) a.h = ARM_LOW + (ARM_TOP - ARM_LOW) * ease(kl);
  // 触れたがつかみ損ね：持ち上げ始めにカプセルが少し揺れる（位置はそのまま）

  const carry = stepOf(s, 'carry');
  const kc = progress(s, carry);
  if (kc > 0) {
    a.x = from.x + (ARM_HOME.x - from.x) * ease(kc);
    a.z = from.z + (ARM_HOME.z - from.z) * ease(kc);
  }
  // 途中で落ちる：アームが落ちた先の上あたりに来たら離す
  if (r.outcome === 'drop' && s.carried && r.dropTo && carry) {
    const L = Math.hypot(from.x - ARM_HOME.x, from.z - ARM_HOME.z) || 1;
    const proj = clamp(
      ((r.dropTo.x - from.x) * (ARM_HOME.x - from.x) + (r.dropTo.z - from.z) * (ARM_HOME.z - from.z)) / (L * L),
      0.05,
      0.9,
    );
    const at = carry.at + carry.dur * invEase(proj);
    if (s.t >= at) {
      s.falling = { c: s.carried, from: { x: a.x, z: a.z, h: a.h }, to: r.dropTo, t0: s.t };
      s.carried = null;
      s.sounds.push('fall');
    }
  }
  if (s.falling && s.t - s.falling.t0 > 0.55) {
    s.capsules = [...s.capsules, { ...s.falling.c, x: s.falling.to.x, z: s.falling.to.z }];
    s.falling = null;
  }

  const open = stepOf(s, 'open');
  if (crossed(open)) s.sounds.push('release');
  const ko = progress(s, open);
  if (ko > 0) a.open = 0.25 + 0.75 * ko;
  if (ko > 0.2 && s.carried) {
    s.chute = { c: s.carried, t0: s.t };
    s.carried = null;
  }
  if (ko >= 1) a.open = Math.max(0.15, a.open - dt * 2);

  const rev = stepOf(s, 'reveal');
  if (crossed(rev)) {
    s.chute = null;
    if (r.outcome === 'win') {
      const suit = r.suit ?? '';
      s.banner = r.duplicate
        ? { text: `${suit} はもう持っています`, sub: 'ほかのマークをねらおう', color: '#ffe14d', t0: s.t, suit, complete: false }
        : r.completed
          ? { text: '4 種類コンプリート！', sub: `${suit} をゲット！ 名前の後ろに付きました`, color: '#ffe14d', t0: s.t, suit, complete: true }
          : { text: `${suit} をゲット！`, sub: '名前の後ろに付きました（退店まで）', color: suitColor(suit), t0: s.t, suit, complete: false };
      s.sounds.push(r.completed ? 'complete' : r.duplicate ? 'lose' : 'win');
      if (!r.duplicate) {
        const n = r.completed ? 140 : 60;
        for (let i = 0; i < n; i++)
          s.confetti.push({
            x: CRANE_W / 2 + (Math.random() - 0.5) * 120,
            y: CRANE_H * 0.42,
            vx: (Math.random() - 0.5) * 520,
            vy: -150 - Math.random() * 300,
            c: CONFETTI[i % CONFETTI.length],
            r: 2 + Math.random() * 3,
          });
      }
    } else {
      s.banner =
        r.outcome === 'drop'
          ? { text: 'おしい！', sub: '運ぶ途中で落ちてしまった', color: '#ff8a3d', t0: s.t, suit: null, complete: false }
          : r.outcome === 'slip'
            ? { text: 'つかめなかった…', sub: 'カプセルの真ん中をねらおう', color: '#a99ff0', t0: s.t, suit: null, complete: false }
            : { text: '空振り…', sub: '床の影をカプセルに重ねてから下ろそう', color: '#a99ff0', t0: s.t, suit: null, complete: false };
      s.sounds.push('lose');
    }
    // 新しい配置（取れたら補充された 1 個がふわっと出る）
    const before = new Set(s.capsules.map((c) => c.id));
    s.capsules = r.machine.capsules;
    const added = r.machine.capsules.find((c) => !before.has(c.id) && c.id !== r.capsuleId);
    s.appear = added ? { id: added.id, t0: s.t } : null;
  }
  if (rev && s.t >= rev.at + rev.dur) s.finished = true;
};

/** ease の逆（0〜1） */
const invEase = (y: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (ease(m) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

// ---------------------------------------------------------------- 描画

const NEAR_Y = 340;
const FAR_Y = 168;
const NEAR_W = 400;
const FAR_W = 290;
const CEIL_H = 172;

/** 床の点 → 画面 */
const proj = (x: number, z: number, h = 0) => {
  const k = 1 + (FAR_W / NEAR_W - 1) * z;
  const y = NEAR_Y + (FAR_Y - NEAR_Y) * z;
  return { x: CRANE_W / 2 + (x - 0.5) * NEAR_W * k, y: y - h * CEIL_H * k, k };
};

const FONT = '"Yu Gothic UI", "Meiryo", "Hiragino Sans", system-ui, sans-serif';

const drawCapsule = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, alpha = 1, tilt = 0) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  // 下半分（半透明の白）
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = 'rgba(235, 240, 255, 0.88)';
  ctx.fill();
  // 上半分（色）
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.5, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fill();
  // 継ぎ目と光
  ctx.strokeStyle = 'rgba(20, 10, 40, 0.45)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(10, 5, 30, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.5, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/** カプセルの床の上の中心（画面）と半径 */
const capsuleAt = (x: number, z: number, h = 0) => {
  const p = proj(x, z);
  const r = CAPSULE_R * NEAR_W * p.k * 0.92;
  return { x: p.x, y: p.y - r * 0.92 - h * CEIL_H * p.k, r };
};

const drawClaw = (ctx: CanvasRenderingContext2D, s: CraneSim, t: number) => {
  const a = s.arm;
  const top = proj(a.x, a.z, 1);
  const head = proj(a.x, a.z, a.h + 0.11);
  const k = head.k;
  // ケーブル
  ctx.strokeStyle = '#c9c4e8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y + 8 * k);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
  // 頭
  const w = 26 * k;
  const hh = 14 * k;
  const g = ctx.createLinearGradient(head.x - w / 2, 0, head.x + w / 2, 0);
  g.addColorStop(0, '#8d87b8');
  g.addColorStop(0.5, '#f2f0ff');
  g.addColorStop(1, '#8d87b8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(head.x - w / 2, head.y, w, hh, 4 * k);
  ctx.fill();
  ctx.fillStyle = '#ff3df0';
  ctx.fillRect(head.x - w / 2 + 3 * k, head.y + hh * 0.4, w - 6 * k, 2.5 * k);
  // 爪（左・右・奥）
  const open = a.open;
  const len = 34 * k;
  const base = { x: head.x, y: head.y + hh };
  const prong = (side: number, depth: number) => {
    const ang = side * (0.12 + open * 0.75);
    ctx.save();
    ctx.translate(base.x + side * w * 0.32, base.y);
    ctx.rotate(-ang);
    ctx.strokeStyle = depth ? '#9a94c4' : '#e6e3ff';
    ctx.lineWidth = 4 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len * 0.6);
    ctx.lineTo(-side * 7 * k, len);
    ctx.stroke();
    ctx.restore();
  };
  prong(0.0001, 1); // 奥（まん中）
  prong(-1, 0);
  prong(1, 0);
  void t;
};

/** 1 フレーム描く */
export const drawCrane = (ctx: CanvasRenderingContext2D, s: CraneSim, now: number) => {
  const W = CRANE_W;
  const H = CRANE_H;
  ctx.clearRect(0, 0, W, H);
  // 奥の壁
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#24145a');
  bg.addColorStop(1, '#0c0726');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // 奥の壁の模様（トランプのマーク）
  ctx.font = `700 22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const marks = ['♠', '♡', '♦', '♧'];
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 2; j++) {
      const m = marks[(i + j) % 4];
      ctx.fillStyle = suitColor(m);
      ctx.globalAlpha = 0.1;
      ctx.fillText(m, 70 + i * 47 + (j % 2) * 23, 96 + j * 40);
    }
  ctx.globalAlpha = 1;
  // 看板
  ctx.save();
  ctx.font = `900 24px ${FONT}`;
  ctx.shadowColor = '#ff3df0';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffd1fb';
  ctx.fillText('CAPSULE CATCHER', W / 2, 26);
  ctx.restore();

  // 床
  const fl = [proj(0, 0), proj(1, 0), proj(1, 1), proj(0, 1)];
  const fg = ctx.createLinearGradient(0, FAR_Y, 0, NEAR_Y);
  fg.addColorStop(0, '#3b2a7a');
  fg.addColorStop(1, '#5a3fa8');
  ctx.fillStyle = fg;
  ctx.beginPath();
  fl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  // 床の格子
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const a = proj(i / 10, 0);
    const b = proj(i / 10, 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = proj(0, i / 10);
    const d = proj(1, i / 10);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  // 出口（手前の左）
  const ch = [proj(0, 0), proj(0.17, 0), proj(0.17, 0.21), proj(0, 0.21)];
  ctx.fillStyle = '#05030f';
  ctx.beginPath();
  ch.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  // 出口の囲い（透明の板）
  const up = (p: { x: number; y: number; k: number }, hh: number) => ({ x: p.x, y: p.y - hh * CEIL_H * p.k });
  ctx.fillStyle = 'rgba(160, 240, 255, 0.14)';
  ctx.strokeStyle = 'rgba(160, 240, 255, 0.55)';
  ctx.lineWidth = 1.2;
  for (const [p, q] of [
    [ch[1], ch[2]],
    [ch[2], ch[3]],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    const qu = up(q, 0.16);
    const pu = up(p, 0.16);
    ctx.lineTo(qu.x, qu.y);
    ctx.lineTo(pu.x, pu.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.font = `800 11px ${FONT}`;
  ctx.fillStyle = '#ffe14d';
  const lab = proj(0.085, 0.0);
  ctx.fillText('出口', lab.x, lab.y - 6);

  // 爪の影（ねらう目安）
  const a = s.arm;
  if (s.phase !== 'loading') {
    const sh = proj(a.x, a.z);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 20 * sh.k, 7 * sh.k, 0, 0, Math.PI * 2);
    ctx.fill();
    if (s.phase === 'x' || s.phase === 'wz' || s.phase === 'z' || s.phase === 'wdrop') {
      ctx.strokeStyle = 'rgba(255, 225, 77, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, 20 * sh.k, 7 * sh.k, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // カプセルと爪（奥から手前へ）
  type Item = { z: number; draw: () => void };
  const items: Item[] = [];
  const r = s.result;
  for (const c of s.capsules) {
    let tilt = 0;
    let lift = 0;
    // つかみ損ね：少し持ち上がって揺れて落ちる
    if (r && r.outcome === 'slip' && c.id === r.capsuleId) {
      const lt = stepOf(s, 'lift');
      if (lt) {
        const k = clamp((s.t - lt.at) / 0.6, 0, 1);
        lift = Math.sin(k * Math.PI) * 0.05;
        tilt = Math.sin(k * Math.PI * 3) * 0.25 * (1 - k);
      }
    }
    const appear = s.appear && s.appear.id === c.id ? clamp((s.t - s.appear.t0) / 0.6, 0, 1) : 1;
    items.push({
      z: c.z,
      draw: () => {
        const p = capsuleAt(c.x, c.z, lift);
        drawCapsule(ctx, p.x, p.y - (1 - appear) * 30, p.r, c.color, appear, tilt);
      },
    });
  }
  if (s.falling) {
    const f = s.falling;
    const k = clamp((s.t - f.t0) / 0.55, 0, 1);
    const x = f.from.x + (f.to.x - f.from.x) * k;
    const z = f.from.z + (f.to.z - f.from.z) * k;
    const hh = Math.max(0, (f.from.h - 0.02) * (1 - k * k) + (k > 0.8 ? Math.sin(((k - 0.8) / 0.2) * Math.PI) * 0.03 : 0));
    items.push({
      z,
      draw: () => {
        const p = capsuleAt(x, z, hh);
        drawCapsule(ctx, p.x, p.y, p.r, f.c.color, 1, k * 3);
      },
    });
  }
  items.push({
    z: a.z - 0.001,
    draw: () => {
      drawClaw(ctx, s, now);
      if (s.carried) {
        const p = capsuleAt(a.x, a.z, a.h - ARM_LOW);
        drawCapsule(ctx, p.x, p.y, p.r, s.carried.color);
        // 爪を前にもう一度（カプセルを抱えているように）
        drawClaw(ctx, s, now);
      }
    },
  });
  if (s.chute) {
    const k = clamp((s.t - s.chute.t0) / 0.5, 0, 1);
    const c = s.chute.c;
    items.push({
      z: ARM_HOME.z - 0.002,
      draw: () => {
        const p = capsuleAt(ARM_HOME.x, ARM_HOME.z, (a.h - ARM_LOW) * (1 - k * k) - k * 0.25);
        drawCapsule(ctx, p.x, p.y, p.r, c.color, 1 - k * 0.6);
      },
    });
  }
  items.sort((p, q) => q.z - p.z);
  for (const it of items) it.draw();

  // ねらいの目安（動かしている間）：爪の真下の床の輪と、爪からの点線
  if (s.phase === 'x' || s.phase === 'wz' || s.phase === 'z' || s.phase === 'wdrop') {
    const sh = proj(a.x, a.z);
    const head = proj(a.x, a.z, a.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 225, 77, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(sh.x, sh.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 9 * sh.k, 3.5 * sh.k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 天井のレール（手前）
  const rl = proj(0, 0, 1);
  const rr = proj(1, 0, 1);
  const rail = proj(0, a.z, 1);
  const rail2 = proj(1, a.z, 1);
  ctx.strokeStyle = '#6d64a8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rail.x, rail.y);
  ctx.lineTo(rail2.x, rail2.y);
  ctx.stroke();
  const car = proj(a.x, a.z, 1);
  ctx.fillStyle = '#d8d4f5';
  ctx.fillRect(car.x - 12 * car.k, car.y - 4 * car.k, 24 * car.k, 10 * car.k);
  void rl;
  void rr;

  // ガラスの枠と光
  ctx.strokeStyle = '#ff70c8';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff3df0';
  ctx.shadowBlur = 10;
  ctx.strokeRect(6, 44, W - 12, H - 50);
  ctx.shadowBlur = 0;
  const gl = ctx.createLinearGradient(0, 44, W * 0.6, H);
  gl.addColorStop(0, 'rgba(255,255,255,0.08)');
  gl.addColorStop(0.45, 'rgba(255,255,255,0)');
  gl.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  gl.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(6, 44, W - 12, H - 50);

  // 結果
  if (s.banner) {
    const b = s.banner;
    const k = clamp((s.t - b.t0) / 0.35, 0, 1);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(8, 4, 24, 0.72)';
    ctx.fillRect(0, H * 0.24, W, H * 0.44);
    if (b.suit && b.suit.length) {
      // カプセルが開いてマークが出る
      const cx = W / 2;
      const cy = H * 0.4;
      const open = clamp((s.t - b.t0) / 0.5, 0, 1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.6 + 0.6 * ease(open), 0.6 + 0.6 * ease(open));
      ctx.font = `900 64px "Segoe UI Symbol", ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = suitColor(b.suit);
      ctx.shadowBlur = 24;
      ctx.fillStyle = suitColor(b.suit);
      ctx.fillText(b.suit, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${b.complete ? 30 : 28}px ${FONT}`;
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.fillText(b.text, W / 2, b.suit ? H * 0.56 : H * 0.42);
    ctx.shadowBlur = 0;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#e6e2ff';
    ctx.fillText(b.sub, W / 2, b.suit ? H * 0.63 : H * 0.52);
    ctx.restore();
  }
  for (const c of s.confetti) {
    ctx.fillStyle = c.c;
    ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 1.3);
  }
};
