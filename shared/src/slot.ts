// スロットマシン（v0.7.0。DESIGN §17）：リールの配列・内部抽選・すべり（止まる位置の決め方）・配当・機械割のシミュレーション。
// 当たり外れ（内部抽選）はサーバが決め、止まる位置はクライアントとサーバが同じ stopReel で計算する（押した位置と押した順だけで決まる）。
// ここは乱数を引数でもらう純粋関数。
//
// リールの向き：リールの位置 x が増えると絵柄は下へ流れる（上から下へ）。x = i のとき i 番目のコマが中段。
// 中段の 1 つ上（上段）は i + 1 番目、下段は i − 1 番目（次に中段へ来るコマが上に見える）。
// 押した位置 = 押した瞬間に次に中段へ来るコマ（x が整数ならそのコマ）。そこから最大 MAX_SLIDE コマすべって止まる。

import { FLOOR, type Face, type Floor, type Point } from './floor';

// ---------------------------------------------------------------- 絵柄と配列

export const SLOT_SYMBOLS = ['seven', 'bar', 'bell', 'suika', 'cherry', 'replay'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** 配列の書き方（1 文字 = 1 コマ）：7 = 赤 7、B = BAR、b = ベル、W = スイカ、C = チェリー、R = リプレイ */
const CODE: Record<string, SlotSymbol> = { '7': 'seven', B: 'bar', b: 'bell', W: 'suika', C: 'cherry', R: 'replay' };

/** 1 本のリールのコマの数 */
export const REEL_LEN = 21;
/** 押してからすべるのは最大何コマか（実機と同じ 4 コマ） */
export const MAX_SLIDE = 4;

/**
 * リールの配列（左・中・右。0 番から上へ）。
 * - ベル・リプレイは**どの 5 コマ（押した位置 + すべり 4 コマ）にも必ずある** → どこで押しても取りこぼさない。
 * - 7・BAR・スイカ・チェリーは 5 コマの中に無い所がある → 狙わないと取りこぼす（目押し）。
 * 7 は左 2 つ（2 コマおき）・中 2 つ（2 コマおき）・右 1 つ、右の BAR は 2 つ（2 コマおき）。スイカは各リール 2 つ、チェリーは左 2 つ（中・右は飾り）。
 * 変えたら `npm test`（shared/test/slot.test.ts が総当たりで確かめる）と、機械割（DESIGN §17.3）を測り直す。
 */
export const REEL_CODES = [
  'bCRWb7R7bBRCbWRbRbRbR',
  'RbWR7b7RbBRWbRbRbCRbb',
  'bRWbRBbBR7bRWbRCbRbRb',
] as const;

export const REELS: readonly SlotSymbol[][] = REEL_CODES.map((s) => [...s].map((c) => CODE[c]));

export const symbolAt = (reel: number, pos: number): SlotSymbol => REELS[reel][((pos % REEL_LEN) + REEL_LEN) % REEL_LEN];

// ---------------------------------------------------------------- 役

/** big = 赤 7 揃い、reg = 7・7・BAR、bell・suika = 3 つ揃い、cherry = 左リールの中段、replay = 3 つ揃い（次の 1 回を掛けずに回せる） */
export const SLOT_ROLES = ['big', 'reg', 'bell', 'replay', 'suika', 'cherry'] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];
export type SlotBonus = 'big' | 'reg';
export const isSlotBonus = (r: unknown): r is SlotBonus => r === 'big' || r === 'reg';

/** 1 回に掛ける枚数（有効ラインは中段 1 本） */
export const SLOT_BET = 3;
/** 配当（枚）。リプレイは 0 枚（次の 1 回が掛けずに回せる） */
export const SLOT_PAYOUT: Record<SlotRole, number> = { big: 250, reg: 100, bell: 8, replay: 0, suika: 10, cherry: 2 };
/** 内部抽選の確率（1/n の n）。BIG・REG は揃えるまで持ち越し、内部中は小役だけ抽選する */
export const SLOT_ODDS: Record<SlotRole, number> = { big: 256, reg: 400, bell: 6.5, replay: 7.3, suika: 64, cherry: 40 };

export const SLOT_ROLE_NAMES: Record<SlotRole, string> = {
  big: 'BIG BONUS',
  reg: 'REG BONUS',
  bell: 'ベル',
  replay: 'リプレイ',
  suika: 'スイカ',
  cherry: 'チェリー',
};

/** コインの上限・両替（クレーンゲームのマーク 1 つ = コイン 100 枚。v0.7.0 の途中で 10 → 100（ユーザー指定）） */
export const COIN_MAX = 99_999;
export const COINS_PER_BADGE = 100;
/** 回す間隔の最短（早すぎる連打は待たせる）・押さずにこれだけたったら自動で止める */
export const SLOT_MIN_INTERVAL_MS = 1500;
export const SLOT_AUTO_STOP_MS = 30_000;
/** リールの速さ：1 コマの時間（毎分 80 回転 = 21 コマ × 80 / 60 秒 = 28 コマ/秒） */
export const SLOT_STEP_MS = 60_000 / (80 * REEL_LEN);
/** 遊べる距離（チェビシェフ距離。ゲーム筐体と同じ） */
export const SLOT_NEAR = 2;
/** 頭上の印（PlayerView.playing に入れる値。🎰） */
export const SLOT_PLAYING = 'slot';

// ---------------------------------------------------------------- コインの預かり（v0.7.0 の途中のユーザー指定「コインは残せる方にしましょう。預け入れを選ぶとアルファベット4文字のキーが発行されます。」）

/** 預かりのキーに使う字（大文字。見間違えやすい I と O を外した 24 文字）。4 文字で 24⁴ = 331,776 通り */
export const BANK_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const BANK_CODE_LEN = 4;
/** 預けたコインを残す日数（過ぎたら消える） */
export const BANK_KEEP_MS = 180 * 24 * 60 * 60 * 1000;

/** 入れたキーを形にそろえる（前後の空白・全角・小文字を直す）。アルファベット 4 文字でなければ null */
export const normalizeBankCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}$/.test(s) ? s : null;
};

/** 新しいキー（rnd は 0 以上 1 未満の乱数を返す関数） */
export const newBankCode = (rnd: () => number): string =>
  Array.from({ length: BANK_CODE_LEN }, () => BANK_CODE_CHARS[Math.floor(rnd() * BANK_CODE_CHARS.length) % BANK_CODE_CHARS.length]).join('');

/** そのリールで揃えたい絵柄（役の図柄）。null = この役ではそのリールは何でもよい */
export const targetSymbol = (flag: SlotRole | null, reel: number): SlotSymbol | null => {
  switch (flag) {
    case 'big':
      return 'seven';
    case 'reg':
      return reel < 2 ? 'seven' : 'bar';
    case 'bell':
      return 'bell';
    case 'replay':
      return 'replay';
    case 'suika':
      return 'suika';
    case 'cherry':
      return reel === 0 ? 'cherry' : null;
    default:
      return null;
  }
};

/** 中段の 3 つの絵柄（まだ止まっていないリールは null）から、成立している役。チェリーは左リールだけで決まる */
export const lineRole = (syms: ReadonlyArray<SlotSymbol | null>): SlotRole | null => {
  const [a, b, c] = syms;
  if (a === 'cherry') return 'cherry';
  if (a === null || b === null || c === null) return null;
  if (a === 'seven' && b === 'seven') return c === 'seven' ? 'big' : c === 'bar' ? 'reg' : null;
  if (a === b && b === c) {
    if (a === 'bell') return 'bell';
    if (a === 'replay') return 'replay';
    if (a === 'suika') return 'suika';
  }
  return null;
};

/** 止まったリールの位置（中段のコマの番号。止まっていなければ null）から役 */
export const roleOfStops = (stops: ReadonlyArray<number | null>): SlotRole | null =>
  lineRole(stops.map((p, i) => (p === null ? null : symbolAt(i, p))));

/** その位置で止めてよいか：当たっていない役を揃えない（止めた時点で成立する役が当たった役でなければだめ） */
const safeStop = (reel: number, pos: number, stops: ReadonlyArray<number | null>, flag: SlotRole | null): boolean => {
  const at = (i: number): SlotSymbol | null => (i === reel ? symbolAt(i, pos) : stops[i] === null ? null : symbolAt(i, stops[i]!));
  const r = lineRole([at(0), at(1), at(2)]);
  return r === null || r === flag;
};

/**
 * すべり（止まる位置の決め方。DESIGN §17.4）：押した位置 press から 0〜MAX_SLIDE コマのうち、
 * 1. 当たっている役の図柄をそのリールの中段に引き込めるなら、いちばん近いもの
 * 2. できなければ、当たっていない役を揃えない（蹴る）いちばん近い位置
 * stops = ほかのリールの止まった位置（null = まだ回っている）。押す順はどれでもよい。
 * 返り値は止まる位置（0〜20）。
 */
export const stopReel = (reel: number, press: number, stops: ReadonlyArray<number | null>, flag: SlotRole | null): number => {
  const want = targetSymbol(flag, reel);
  const p0 = ((press % REEL_LEN) + REEL_LEN) % REEL_LEN;
  if (want)
    for (let s = 0; s <= MAX_SLIDE; s++) {
      const pos = (p0 + s) % REEL_LEN;
      if (symbolAt(reel, pos) === want && safeStop(reel, pos, stops, flag)) return pos;
    }
  for (let s = 0; s <= MAX_SLIDE; s++) {
    const pos = (p0 + s) % REEL_LEN;
    if (safeStop(reel, pos, stops, flag)) return pos;
  }
  // 配列の決まり（どの 5 コマにもベルとリプレイがある）があれば来ない（テストで総当たりして確かめている）
  return p0;
};

/** 押した順と位置（[[リール, 押した位置], …]。3 本・リールの重なりなし・0〜20 の整数）から止まる位置を全部計算する */
export const stopAll = (presses: ReadonlyArray<readonly [number, number]>, flag: SlotRole | null): number[] => {
  const stops: Array<number | null> = [null, null, null];
  for (const [reel, press] of presses) stops[reel] = stopReel(reel, press, stops, flag);
  return stops as number[];
};

/** 押した記録の形を確かめる（だめなら null） */
export const parsePresses = (raw: unknown): Array<[number, number]> | null => {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const x of raw) {
    if (!Array.isArray(x) || x.length !== 2) return null;
    const [r, p] = x;
    if (!Number.isInteger(r) || !Number.isInteger(p) || r < 0 || r > 2 || p < 0 || p >= REEL_LEN || seen.has(r)) return null;
    seen.add(r);
    out.push([r, p]);
  }
  return out;
};

// ---------------------------------------------------------------- 内部抽選

/**
 * 1 回の抽選。r は [0, 1) の乱数。internal = 持ち越しているボーナス（内部中）。odds は確認用に差し替えられる（サーバの SLOT_BIG_ODDS など）。
 * 返り値の small = 当たった小役、bonus = 新しく当たったボーナス（内部中は抽選しない）。
 */
export const drawSlot = (
  r: number,
  internal: SlotBonus | null,
  odds: Record<SlotRole, number> = SLOT_ODDS,
): { small: SlotRole | null; bonus: SlotBonus | null } => {
  let acc = 0;
  for (const role of SLOT_ROLES) {
    if (internal && isSlotBonus(role)) continue;
    acc += 1 / odds[role];
    if (r < acc) return isSlotBonus(role) ? { small: null, bonus: role } : { small: role, bonus: null };
  }
  return { small: null, bonus: null };
};

/**
 * この回に揃えられる役（すべりの計算に使う「当たった役」）：小役が当たればそれ（内部中でも小役を先に。ボーナスはこの回は揃わず持ち越し）、
 * 小役が無くボーナスを持っていればボーナス、どちらも無ければ null（はずれ）。
 */
export const spinFlag = (small: SlotRole | null, internal: SlotBonus | null): SlotRole | null => small ?? internal;

// ---------------------------------------------------------------- 台の場所

export interface SlotSpot extends Point {
  /** 1 から（floor.json の decor の中の slot の並び順） */
  id: number;
  face: Face;
}

export const slotSpots = (f: Floor = FLOOR): SlotSpot[] =>
  f.decor.filter((d) => d.type === 'slot').map((d, i) => ({ id: i + 1, x: d.x, y: d.y, face: d.face ?? ('S' as Face) }));

export const slotSpot = (id: number, f: Floor = FLOOR): SlotSpot | undefined => slotSpots(f).find((s) => s.id === id);

// ---------------------------------------------------------------- 機械割のシミュレーション（テスト・DESIGN の数字）

/** perfect = 当たった役を知っていて、いつも引き込める所で押す（目押しの上限）、random = でたらめな位置・順で押す */
export type SlotPlayStyle = 'perfect' | 'random';

export interface SlotSimResult {
  spins: number;
  /** 掛けた枚数（リプレイの回も 3 枚掛けたと数える）・払い出し（リプレイは 3 枚戻ったと数える） */
  coinIn: number;
  coinOut: number;
  /** 機械割（coinOut / coinIn） */
  rate: number;
  wins: Record<SlotRole, number>;
  /** 当たったのに取りこぼした小役 */
  missed: Record<SlotRole, number>;
  /** ボーナスを揃えるまでの回数の平均（当たった回を 0 として） */
  bonusWait: number;
}

const ORDERS: Array<[number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** そのリールの want の絵柄のある位置（その位置で押せば、すべらずに中段に止まる＝いちばん確かな目押し） */
const SYMBOL_POS: number[][][] = REELS.map((reel) => SLOT_SYMBOLS.map((sym) => reel.flatMap((x, i) => (x === sym ? [i] : []))));
const aimPress = (reel: number, want: SlotSymbol, rnd: number): number => {
  const list = SYMBOL_POS[reel][SLOT_SYMBOLS.indexOf(want)];
  return list[Math.floor(rnd * list.length) % list.length];
};

export const simulateSlot = (spins: number, style: SlotPlayStyle, rng: () => number): SlotSimResult => {
  const zero = () => Object.fromEntries(SLOT_ROLES.map((r) => [r, 0])) as Record<SlotRole, number>;
  const wins = zero();
  const missed = zero();
  let internal: SlotBonus | null = null;
  let waitFrom = 0;
  let waitSum = 0;
  let coinIn = 0;
  let coinOut = 0;
  for (let i = 0; i < spins; i++) {
    coinIn += SLOT_BET;
    const d = drawSlot(rng(), internal);
    if (d.bonus) {
      internal = d.bonus;
      waitFrom = i;
    }
    const flag = spinFlag(d.small, internal);
    const order = ORDERS[Math.floor(rng() * 6) % 6];
    const stops: Array<number | null> = [null, null, null];
    for (const reel of order) {
      const start = Math.floor(rng() * REEL_LEN) % REEL_LEN;
      let press = start;
      const want = targetSymbol(flag, reel);
      if (style === 'perfect' && want) press = aimPress(reel, want, rng());
      stops[reel] = stopReel(reel, press, stops, flag);
    }
    const win = roleOfStops(stops);
    if (win) {
      wins[win]++;
      coinOut += win === 'replay' ? SLOT_BET : SLOT_PAYOUT[win];
      if (isSlotBonus(win)) {
        waitSum += i - waitFrom;
        internal = null;
      }
    } else if (d.small) missed[d.small]++;
  }
  const bonusCount = wins.big + wins.reg;
  return { spins, coinIn, coinOut, rate: coinIn ? coinOut / coinIn : 0, wins, missed, bonusWait: bonusCount ? waitSum / bonusCount : 0 };
};
