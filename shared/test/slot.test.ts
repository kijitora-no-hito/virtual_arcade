// スロットマシン（v0.7.0。DESIGN §17）：配列の決まり・すべりの総当たり・内部抽選・機械割。
import { describe, expect, it } from 'vitest';
import floorJson from '../data/floor.json';
import {
  BANK_CODE_CHARS,
  drawSlot,
  newBankCode,
  normalizeBankCode,
  findPath,
  FLOOR,
  frontTile,
  isPassable,
  lineRole,
  loadFloor,
  MAX_SLIDE,
  parsePresses,
  REEL_LEN,
  REELS,
  roleOfStops,
  simulateSlot,
  SLOT_ODDS,
  SLOT_ROLES,
  slotSpots,
  spinFlag,
  stopAll,
  stopReel,
  symbolAt,
  targetSymbol,
  type FloorJson,
  type SlotRole,
} from '../src';

const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** press から 4 コマ以内に sym があるか */
const reachable = (reel: number, press: number, sym: string) => {
  for (let s = 0; s <= MAX_SLIDE; s++) if (symbolAt(reel, press + s) === sym) return true;
  return false;
};

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('スロットの配列', () => {
  it('3 本 × 21 コマ。ベル・リプレイはどこで押しても 4 コマ以内にある', () => {
    expect(REELS.length).toBe(3);
    for (let r = 0; r < 3; r++) {
      expect(REELS[r].length).toBe(REEL_LEN);
      for (let p = 0; p < REEL_LEN; p++) {
        expect(reachable(r, p, 'bell'), `bell ${r} ${p}`).toBe(true);
        expect(reachable(r, p, 'replay'), `replay ${r} ${p}`).toBe(true);
      }
    }
  });

  it('7・BAR（右）・スイカ・チェリー（左）は 4 コマ以内に無い所がある（目押しが要る）', () => {
    const misses = (r: number, sym: string) => Array.from({ length: REEL_LEN }, (_, p) => p).filter((p) => !reachable(r, p, sym)).length;
    for (let r = 0; r < 3; r++) {
      expect(misses(r, 'seven')).toBeGreaterThan(0);
      expect(misses(r, 'suika')).toBeGreaterThan(0);
      // どのリールにも 7 とスイカはある（狙えば必ず揃う）
      expect(REELS[r]).toContain('seven');
      expect(REELS[r]).toContain('suika');
    }
    expect(misses(2, 'bar')).toBeGreaterThan(0);
    expect(REELS[2]).toContain('bar');
    expect(misses(0, 'cherry')).toBeGreaterThan(0);
    expect(REELS[0]).toContain('cherry');
  });
});

describe('役の決まり', () => {
  it('中段の絵柄から役', () => {
    expect(lineRole(['seven', 'seven', 'seven'])).toBe('big');
    expect(lineRole(['seven', 'seven', 'bar'])).toBe('reg');
    expect(lineRole(['bar', 'bar', 'bar'])).toBeNull();
    expect(lineRole(['bell', 'bell', 'bell'])).toBe('bell');
    expect(lineRole(['replay', 'replay', 'replay'])).toBe('replay');
    expect(lineRole(['suika', 'suika', 'suika'])).toBe('suika');
    expect(lineRole(['cherry', null, null])).toBe('cherry');
    expect(lineRole(['cherry', 'bell', 'seven'])).toBe('cherry');
    expect(lineRole(['bell', 'cherry', 'cherry'])).toBeNull();
    expect(lineRole(['seven', 'seven', null])).toBeNull();
  });

  it('押した記録の形', () => {
    expect(parsePresses([[0, 1], [2, 20], [1, 0]])).toEqual([[0, 1], [2, 20], [1, 0]]);
    expect(parsePresses([[0, 1], [0, 2], [1, 0]])).toBeNull();
    expect(parsePresses([[0, 21], [1, 2], [2, 0]])).toBeNull();
    expect(parsePresses([[0, -1], [1, 2], [2, 0]])).toBeNull();
    expect(parsePresses([[0, 1.5], [1, 2], [2, 0]])).toBeNull();
    expect(parsePresses([[3, 1], [1, 2], [2, 0]])).toBeNull();
    expect(parsePresses([[0, 1], [1, 2]])).toBeNull();
    expect(parsePresses('x')).toBeNull();
    expect(parsePresses([[0, '1'], [1, 2], [2, 0]])).toBeNull();
  });
});

describe('すべり（stopReel）の総当たり：すべての役 × 押す位置 21³ × 押す順 6 通り', () => {
  const flags: Array<SlotRole | null> = [null, ...SLOT_ROLES];
  for (const flag of flags)
    it(`当たった役 = ${flag ?? 'はずれ'}`, () => {
      let count = 0;
      for (const order of ORDERS)
        for (let a = 0; a < REEL_LEN; a++)
          for (let b = 0; b < REEL_LEN; b++)
            for (let c = 0; c < REEL_LEN; c++) {
              const press = [a, b, c];
              const stops: Array<number | null> = [null, null, null];
              for (const reel of order) {
                const pos = stopReel(reel, press[reel], stops, flag);
                // 押した位置から 0〜4 コマ
                const slide = (pos - press[reel] + REEL_LEN) % REEL_LEN;
                if (slide > MAX_SLIDE) throw new Error(`slide ${slide}`);
                stops[reel] = pos;
                // 途中でも当たっていない役（チェリー）が成立しない
                const mid = roleOfStops(stops);
                if (mid !== null && mid !== flag) throw new Error(`途中で ${mid}（${flag} ${press} ${order}）`);
              }
              const win = roleOfStops(stops);
              // 当たっていない役は決して揃わない
              if (win !== null && win !== flag) throw new Error(`${win} が揃った（当たりは ${flag}、押す位置 ${press}、順 ${order}）`);
              // 揃うのは「その役の図柄が全部のリールで 4 コマ以内にある」ときだけ、そのときは必ず揃う
              if (flag) {
                const can = [0, 1, 2].every((r) => {
                  const t = targetSymbol(flag, r);
                  return t === null || reachable(r, press[r], t);
                });
                if (can !== (win === flag)) throw new Error(`${flag}：狙える ${can} なのに結果 ${win}（押す位置 ${press}、順 ${order}）`);
                // ベル・リプレイはどこで押しても取りこぼさない
                if ((flag === 'bell' || flag === 'replay') && win !== flag) throw new Error(`${flag} を取りこぼした`);
              }
              // stopAll も同じ結果
              const all = stopAll(order.map((r) => [r, press[r]] as [number, number]), flag);
              if (all.some((p, i) => p !== stops[i])) throw new Error('stopAll が違う');
              count++;
            }
      expect(count).toBe(6 * REEL_LEN ** 3);
    });

  it('BIG・REG：7（右は REG なら BAR）の位置で押せば必ず揃い、どれか 1 本でも 4 コマ以内に無い所で押せば揃わない', () => {
    for (const flag of ['big', 'reg'] as const) {
      const aim = [0, 1, 2].map((r) => REELS[r].findIndex((s) => s === targetSymbol(flag, r)));
      expect(roleOfStops(stopAll([[0, aim[0]], [1, aim[1]], [2, aim[2]]], flag))).toBe(flag);
      expect(roleOfStops(stopAll([[2, aim[2]], [1, aim[1]], [0, aim[0]]], flag))).toBe(flag);
      // 左だけ外す
      const bad = Array.from({ length: REEL_LEN }, (_, p) => p).find((p) => !reachable(0, p, 'seven'))!;
      expect(roleOfStops(stopAll([[0, bad], [1, aim[1]], [2, aim[2]]], flag))).toBeNull();
    }
  });
});

describe('内部抽選', () => {
  it('確率の区間：BIG 1/256・REG 1/400・ベル 1/6.5・リプレイ 1/7.3・スイカ 1/64・チェリー 1/40', () => {
    expect(drawSlot(0, null)).toEqual({ small: null, bonus: 'big' });
    expect(drawSlot(1 / 256 + 1e-9, null)).toEqual({ small: null, bonus: 'reg' });
    expect(drawSlot(1 / 256 + 1 / 400 + 1e-9, null)).toEqual({ small: 'bell', bonus: null });
    expect(drawSlot(0.999, null)).toEqual({ small: null, bonus: null });
    // 内部中はボーナスを抽選しない（小役の区間が前へずれる）
    expect(drawSlot(0, 'big')).toEqual({ small: 'bell', bonus: null });
    expect(drawSlot(0.999, 'reg')).toEqual({ small: null, bonus: null });
    // 数えて確かめる
    const rng = mulberry(9);
    const n = 400_000;
    const got: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const d = drawSlot(rng(), null);
      const k = d.bonus ?? d.small ?? 'none';
      got[k] = (got[k] ?? 0) + 1;
    }
    for (const r of SLOT_ROLES) expect(got[r] / n).toBeCloseTo(1 / SLOT_ODDS[r], r === 'bell' || r === 'replay' ? 2 : 3);
  });

  it('この回に揃えられる役：小役が先、無ければ持ち越しのボーナス', () => {
    expect(spinFlag('bell', 'big')).toBe('bell');
    expect(spinFlag(null, 'reg')).toBe('reg');
    expect(spinFlag(null, null)).toBeNull();
  });
});

describe('機械割（シミュレーション。DESIGN §17.3）', () => {
  it('目押しが完璧なら 103% 前後、でたらめに押すと 85〜90% 前後', () => {
    const n = 300_000;
    const perfect = simulateSlot(n, 'perfect', mulberry(1));
    const random = simulateSlot(n, 'random', mulberry(2));
    // 完璧なら小役もボーナスも取りこぼさない
    expect(Object.values(perfect.missed).every((v) => v === 0)).toBe(true);
    expect(perfect.bonusWait).toBe(0);
    // でたらめでもベル・リプレイは取りこぼさない。スイカ・チェリーは取りこぼす。ボーナスは揃うまで何十回もかかる
    expect(random.missed.bell + random.missed.replay).toBe(0);
    expect(random.missed.suika).toBeGreaterThan(0);
    expect(random.missed.cherry).toBeGreaterThan(0);
    expect(random.bonusWait).toBeGreaterThan(20);
    expect(perfect.rate).toBeGreaterThan(1.0);
    expect(perfect.rate).toBeLessThan(1.06);
    expect(random.rate).toBeGreaterThan(0.84);
    expect(random.rate).toBeLessThan(0.9);
  });
});

describe('スロット台の置き場所', () => {
  it('3 台（(17,4)・(18,4)・(19,4)・face S）。前のマスが通れて、店のどこへでも歩ける', () => {
    const spots = slotSpots();
    expect(spots.map((s) => [s.id, s.x, s.y, s.face])).toEqual([
      [1, 17, 4, 'S'],
      [2, 18, 4, 'S'],
      [3, 19, 4, 'S'],
    ]);
    for (const s of spots) {
      const f = frontTile(s);
      expect(isPassable(FLOOR, f.x, f.y)).toBe(true);
    }
    const s0 = FLOOR.spawn[0];
    for (let y = 0; y < FLOOR.rows; y++)
      for (let x = 0; x < FLOOR.cols; x++) if (isPassable(FLOOR, x, y)) expect(findPath(FLOOR, s0, { x, y }), `${x},${y}`).not.toBeNull();
  });

  it('loadFloor：slot の face が無い・前のマスがふさがっていればエラー', () => {
    const base = floorJson as FloorJson;
    const withDecor = (...d: object[]) => ({ ...base, decor: [...base.decor.filter((x) => x.type !== 'slot'), ...d] }) as FloorJson;
    expect(() => loadFloor(withDecor({ type: 'slot', x: 18, y: 6 }))).toThrow(/face/);
    expect(() => loadFloor(withDecor({ type: 'slot', x: 18, y: 6, face: 'S' }, { type: 'plant', x: 18, y: 7 }))).toThrow(/前のマス/);
    expect(slotSpots(loadFloor(withDecor({ type: 'slot', x: 18, y: 6, face: 'E' })))).toEqual([{ id: 1, x: 18, y: 6, face: 'E' }]);
  });
});

describe('コインの預かりのキー（DESIGN §17.7）', () => {
  it('アルファベット大文字 4 文字（見間違えやすい I・O は使わない）。入れたキーは小文字・全角・空白を直す', () => {
    expect(BANK_CODE_CHARS).toHaveLength(24);
    expect(BANK_CODE_CHARS).not.toMatch(/[IO]/);
    const rng = mulberry(5);
    for (let i = 0; i < 2000; i++) expect(newBankCode(rng)).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(newBankCode(() => 0)).toBe('AAAA');
    expect(newBankCode(() => 0.9999)).toBe('ZZZZ');
    expect(normalizeBankCode('qxkf')).toBe('QXKF');
    expect(normalizeBankCode(' Q X k f ')).toBe('QXKF');
    expect(normalizeBankCode('ＱＸＫＦ')).toBe('QXKF');
    expect(normalizeBankCode('QXK')).toBeNull();
    expect(normalizeBankCode('QXKF1')).toBeNull();
    expect(normalizeBankCode('QX1F')).toBeNull();
    expect(normalizeBankCode(1234)).toBeNull();
  });
});
