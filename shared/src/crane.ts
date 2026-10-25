// クレーンゲーム（DESIGN §8）：カプセルの配置・つかめる確率・判定・バッジの付き方。
// 当たり外れはサーバが決める（ほかの人に見えるバッジなので）。ここは乱数を引数でもらう純粋関数。
//
// ケースの床の座標は x（左 0 → 右 1）・z（手前 0 → 奥 1）。出口は手前の左（アームの初めの位置の真下）。

import { FLOOR, type Floor, type Point } from './floor';

// ---------------------------------------------------------------- バッジ

/** バッジ（並び順はこの順に固定） */
export const SUITS = ['♠', '♡', '♦', '♧'] as const;
export type Suit = (typeof SUITS)[number];
export const isSuit = (v: unknown): v is Suit => typeof v === 'string' && (SUITS as readonly string[]).includes(v);

/** unique = 4 種類を 1 つずつ（ダブりなし）、stack = 同じものも重ねて持てる（各 stackMax 個まで） */
export type BadgeMode = 'unique' | 'stack';

/** バッジの文字列を ♠♡♦♧ の順に並べ直す（知らない文字は捨てる） */
export const sortBadges = (badges: string): string =>
  [...badges]
    .filter(isSuit)
    .sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b))
    .join('');

export const countSuit = (badges: string, s: Suit): number => [...badges].filter((c) => c === s).length;

/** 4 種類そろっているか */
export const isComplete = (badges: string): boolean => SUITS.every((s) => badges.includes(s));

export interface AddBadgeResult {
  badges: string;
  /** 新しく付いた */
  gained: boolean;
  /** もう持っている（unique）・上限まで持っている（stack）ので付かなかった */
  duplicate: boolean;
  /** この 1 個で初めて 4 種類そろった */
  completed: boolean;
}

export const addBadge = (badges: string, s: Suit, mode: BadgeMode, stackMax = 3): AddBadgeResult => {
  const cur = sortBadges(badges);
  const max = mode === 'unique' ? 1 : Math.max(1, stackMax);
  if (countSuit(cur, s) >= max) return { badges: cur, gained: false, duplicate: true, completed: false };
  const next = sortBadges(cur + s);
  return { badges: next, gained: true, duplicate: false, completed: !isComplete(cur) && isComplete(next) };
};

/** 名前とバッジ（名前の後ろに付ける） */
export const nameWithBadges = (name: string, badges: string | null | undefined): string => `${name}${badges ?? ''}`;

// ---------------------------------------------------------------- 筐体の場所

export interface CraneSpot extends Point {
  /** 1 から（floor.json の decor の中の crane の並び順） */
  id: number;
}

/** 遊べるクレーンゲーム（floor.json の decor の crane すべて） */
export const craneSpots = (f: Floor = FLOOR): CraneSpot[] =>
  f.decor.filter((d) => d.type === 'crane').map((d, i) => ({ id: i + 1, x: d.x, y: d.y }));

export const craneSpot = (id: number, f: Floor = FLOOR): CraneSpot | undefined => craneSpots(f).find((c) => c.id === id);

/** 遊べる距離（チェビシェフ距離。筐体と同じ） */
export const CRANE_NEAR = 2;

// ---------------------------------------------------------------- ケースとカプセル

/** カプセルの半径（床の座標） */
export const CAPSULE_R = 0.075;
/** ケースに入れておくカプセルの数 */
export const CAPSULE_COUNT = 8;
/** アームの初めの位置（出口の真上） */
export const ARM_HOME = { x: 0.08, z: 0.1 } as const;
/** カプセルが置かれる範囲（出口のまわりは空ける） */
export const CAPSULE_AREA = { x0: 0.26, x1: 0.93, z0: 0.18, z1: 0.92 } as const;
/** カプセルの色（中身とは関係ない） */
export const CAPSULE_COLORS = ['#ff3d6e', '#ffe14d', '#22e6ff', '#7cff6b', '#b07cff', '#ff8a3d'] as const;

export interface Capsule {
  id: number;
  x: number;
  z: number;
  color: string;
  /** 中身（クライアントには送らない） */
  suit: Suit;
}

/** クライアントに送る形（中身なし） */
export type CapsuleView = Omit<Capsule, 'suit'>;
export const capsuleView = (c: Capsule): CapsuleView => ({ id: c.id, x: c.x, z: c.z, color: c.color });

export interface CraneMachine {
  id: number;
  capsules: Capsule[];
  /** 次のカプセルの id */
  nextId: number;
  /** 配置が変わるたびに増える */
  rev: number;
}

export interface CraneMachineView {
  id: number;
  capsules: CapsuleView[];
  rev: number;
}

export const machineView = (m: CraneMachine): CraneMachineView => ({ id: m.id, capsules: m.capsules.map(capsuleView), rev: m.rev });

/** 0 以上 1 未満の乱数 */
export type Rng = () => number;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** ほかのカプセルとなるべく重ならない場所（何度か試していちばん空いている所） */
export const freeSpot = (others: Array<{ x: number; z: number }>, rng: Rng, near?: { x: number; z: number; r: number }) => {
  let best = { x: 0.5, z: 0.5 };
  let bestGap = -Infinity;
  for (let i = 0; i < 24; i++) {
    const p = near
      ? {
          x: clamp(near.x + (rng() * 2 - 1) * near.r, CAPSULE_AREA.x0, CAPSULE_AREA.x1),
          z: clamp(near.z + (rng() * 2 - 1) * near.r, CAPSULE_AREA.z0, CAPSULE_AREA.z1),
        }
      : {
          x: CAPSULE_AREA.x0 + rng() * (CAPSULE_AREA.x1 - CAPSULE_AREA.x0),
          z: CAPSULE_AREA.z0 + rng() * (CAPSULE_AREA.z1 - CAPSULE_AREA.z0),
        };
    const gap = others.length ? Math.min(...others.map((o) => dist(o, p))) : 1;
    if (gap > bestGap) {
      best = p;
      bestGap = gap;
    }
    if (gap >= CAPSULE_R * 2.1) break;
  }
  return { x: Math.round(best.x * 1000) / 1000, z: Math.round(best.z * 1000) / 1000 };
};

const newCapsule = (m: { capsules: Capsule[]; nextId: number }, rng: Rng): Capsule => {
  const p = freeSpot(m.capsules, rng);
  return {
    id: m.nextId,
    ...p,
    color: CAPSULE_COLORS[Math.floor(rng() * CAPSULE_COLORS.length) % CAPSULE_COLORS.length],
    suit: SUITS[Math.floor(rng() * SUITS.length) % SUITS.length],
  };
};

/** 新しいケース（カプセル CAPSULE_COUNT 個） */
export const newMachine = (id: number, rng: Rng): CraneMachine => {
  const m: CraneMachine = { id, capsules: [], nextId: 1, rev: 1 };
  for (let i = 0; i < CAPSULE_COUNT; i++) {
    m.capsules.push(newCapsule(m, rng));
    m.nextId++;
  }
  return m;
};

// ---------------------------------------------------------------- 確率と判定

export interface CraneOdds {
  /** ぴったりのときの確率（既定 0.65） */
  maxChance: number;
  /** この距離までは「ぴったり」 */
  perfect: number;
  /** この距離で 0 になる */
  zero: number;
}

export const DEFAULT_CRANE_ODDS: CraneOdds = { maxChance: 0.65, perfect: 0.025, zero: 0.11 };

/** アームとカプセルの中心の距離 d から、つかめる確率 */
export const craneChance = (d: number, odds: CraneOdds = DEFAULT_CRANE_ODDS): number => {
  if (!Number.isFinite(d) || d >= odds.zero) return 0;
  if (d <= odds.perfect) return odds.maxChance;
  const t = (d - odds.perfect) / (odds.zero - odds.perfect);
  return odds.maxChance * Math.pow(1 - t, 1.3);
};

/** win = 取れた、drop = 持ち上げたが途中で落ちた、slip = 触れたがつかみ損ね、miss = 空振り */
export type CraneOutcome = 'win' | 'drop' | 'slip' | 'miss';

export interface CraneResolve {
  outcome: CraneOutcome;
  /** つかんだ（触れた）カプセル。空振りなら null */
  capsuleId: number | null;
  /** そのカプセルの元の位置 */
  grabAt: { x: number; z: number } | null;
  /** 途中で落ちた先 */
  dropTo: { x: number; z: number } | null;
  /** 取れたカプセルの中身 */
  suit: Suit | null;
  /** 確率（テスト・確認用。クライアントには送らない） */
  chance: number;
  /** 判定のあとのケース */
  machine: CraneMachine;
}

/** アームの位置は 0〜1 に収める（数でなければ null） */
export const normalizeArm = (x: unknown, z: unknown): { x: number; z: number } | null => {
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: clamp(x, 0, 1), z: clamp(z, 0, 1) };
};

/** アームを (arm.x, arm.z) で下ろしたときの判定。ケースは新しいものを返す（元は変えない） */
export const resolveCrane = (m: CraneMachine, arm: { x: number; z: number }, rng: Rng, odds: CraneOdds = DEFAULT_CRANE_ODDS): CraneResolve => {
  let target: Capsule | null = null;
  let d = Infinity;
  for (const c of m.capsules) {
    const dd = dist(c, arm);
    if (dd < d) {
      d = dd;
      target = c;
    }
  }
  const chance = target ? craneChance(d, odds) : 0;
  if (!target || d >= odds.zero) {
    return { outcome: 'miss', capsuleId: null, grabAt: null, dropTo: null, suit: null, chance: 0, machine: m };
  }
  const r = rng();
  const grabAt = { x: target.x, z: target.z };
  if (r < chance) {
    // 取れた：ケースから消して 1 つ補充
    const rest = m.capsules.filter((c) => c.id !== target!.id);
    const next: CraneMachine = { ...m, capsules: rest, rev: m.rev + 1 };
    next.capsules = [...rest, newCapsule(next, rng)];
    next.nextId = m.nextId + 1;
    return { outcome: 'win', capsuleId: target.id, grabAt, dropTo: null, suit: target.suit, chance, machine: next };
  }
  if (r < chance + (1 - chance) * 0.5) {
    // 持ち上げたが、出口へ運ぶ途中で落ちた（出口へ向かう線の上のどこか）
    const f = 0.25 + rng() * 0.5;
    const line = { x: target.x + (ARM_HOME.x - target.x) * f, z: target.z + (ARM_HOME.z - target.z) * f };
    const others = m.capsules.filter((c) => c.id !== target!.id);
    const p = freeSpot(others, rng, { ...line, r: 0.06 });
    const capsules = m.capsules.map((c) => (c.id === target!.id ? { ...c, ...p } : c));
    return { outcome: 'drop', capsuleId: target.id, grabAt, dropTo: p, suit: null, chance, machine: { ...m, capsules, rev: m.rev + 1 } };
  }
  return { outcome: 'slip', capsuleId: target.id, grabAt, dropTo: null, suit: null, chance, machine: m };
};

/** 既定：1 回ごとの待ち時間 */
export const DEFAULT_CRANE_COOLDOWN_MS = 20_000;
/** 既定：接続が切れてからバッジが消えるまで */
export const DEFAULT_BADGE_KEEP_MS = 30 * 60 * 1000;
