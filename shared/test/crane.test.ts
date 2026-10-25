import { describe, expect, it } from 'vitest';
import {
  addBadge,
  ARM_HOME,
  CAPSULE_AREA,
  CAPSULE_COUNT,
  craneChance,
  craneSpots,
  DEFAULT_CRANE_ODDS,
  FLOOR,
  isComplete,
  machineView,
  nameWithBadges,
  newMachine,
  normalizeArm,
  resolveCrane,
  sortBadges,
  type CraneMachine,
} from '../src';

/** 決まった並びの乱数（同じ種なら同じ） */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('クレーンゲーム：確率', () => {
  it('ぴったりで 6〜7 割・離れるほど下がり・遠ければ 0', () => {
    const p0 = craneChance(0);
    expect(p0).toBeGreaterThanOrEqual(0.6);
    expect(p0).toBeLessThanOrEqual(0.7);
    expect(craneChance(DEFAULT_CRANE_ODDS.perfect)).toBe(p0);
    let prev = p0;
    for (let d = 0.03; d < 0.12; d += 0.01) {
      const p = craneChance(d);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    expect(craneChance(0.05)).toBeGreaterThan(0.25); // 少しずれても取れる（初めての人向け）
    expect(craneChance(0.11)).toBe(0);
    expect(craneChance(0.5)).toBe(0);
    expect(craneChance(Number.NaN)).toBe(0);
  });

  it('アームの位置は 0〜1 に収める・数でなければ断る', () => {
    expect(normalizeArm(-1, 2)).toEqual({ x: 0, z: 1 });
    expect(normalizeArm(0.3, 0.4)).toEqual({ x: 0.3, z: 0.4 });
    expect(normalizeArm('0.3', 0.4)).toBeNull();
    expect(normalizeArm(Number.NaN, 0.4)).toBeNull();
    expect(normalizeArm(Infinity, 0.4)).toBeNull();
  });
});

describe('クレーンゲーム：ケースと判定', () => {
  it('新しいケースはカプセル 8 個・範囲の中・中身は ♠♡♦♧・送る形に中身は無い', () => {
    const m = newMachine(1, seeded(1));
    expect(m.capsules).toHaveLength(CAPSULE_COUNT);
    for (const c of m.capsules) {
      expect(c.x).toBeGreaterThanOrEqual(CAPSULE_AREA.x0);
      expect(c.x).toBeLessThanOrEqual(CAPSULE_AREA.x1);
      expect(c.z).toBeGreaterThanOrEqual(CAPSULE_AREA.z0);
      expect(c.z).toBeLessThanOrEqual(CAPSULE_AREA.z1);
      expect(['♠', '♡', '♦', '♧']).toContain(c.suit);
    }
    expect(new Set(m.capsules.map((c) => c.id)).size).toBe(CAPSULE_COUNT);
    expect(JSON.stringify(machineView(m))).not.toMatch(/suit|♠|♡|♦|♧/);
  });

  it('当たりの割合はアームの位置で変わる（ぴったり ≒ 65%・ずれると下がる・遠いと空振り）', () => {
    const rng = seeded(42);
    const rate = (offset: number) => {
      let wins = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) {
        const m = newMachine(1, rng);
        const c = m.capsules[0];
        // ほかのカプセルに近くならないよう、1 個だけのケースで試す
        const one: CraneMachine = { ...m, capsules: [c] };
        const r = resolveCrane(one, { x: c.x + offset, z: c.z }, rng);
        if (r.outcome === 'win') wins++;
      }
      return wins / N;
    };
    const perfect = rate(0);
    expect(perfect).toBeGreaterThan(0.6);
    expect(perfect).toBeLessThan(0.7);
    const off = rate(0.06);
    expect(off).toBeLessThan(perfect - 0.15);
    expect(off).toBeGreaterThan(0.05);
    expect(rate(0.2)).toBe(0);
  });

  it('取れた：カプセルが消えて 1 個補充・中身が返る / 落ちた：出口へ向かう途中に動く / 空振り：そのまま', () => {
    const m = newMachine(1, seeded(7));
    const c = m.capsules[3];
    const win = resolveCrane(m, { x: c.x, z: c.z }, () => 0);
    expect(win.outcome).toBe('win');
    expect(win.capsuleId).toBe(c.id);
    expect(win.suit).toBe(c.suit);
    expect(win.machine.capsules).toHaveLength(CAPSULE_COUNT);
    expect(win.machine.capsules.some((x) => x.id === c.id)).toBe(false);
    expect(win.machine.rev).toBe(m.rev + 1);
    expect(m.capsules.some((x) => x.id === c.id)).toBe(true); // 元のケースは変えない

    // 乱数 0.8：ぴったりの確率 0.65 を超え、残りの前半（0.65〜0.825）= 途中で落ちた
    const drop = resolveCrane(m, { x: c.x, z: c.z }, () => 0.8);
    expect(drop.outcome).toBe('drop');
    expect(drop.suit).toBeNull();
    const moved = drop.machine.capsules.find((x) => x.id === c.id)!;
    expect(moved.x).toBe(drop.dropTo!.x);
    // 元の位置より出口に近い
    expect(Math.hypot(moved.x - ARM_HOME.x, moved.z - ARM_HOME.z)).toBeLessThan(Math.hypot(c.x - ARM_HOME.x, c.z - ARM_HOME.z));

    const slip = resolveCrane(m, { x: c.x, z: c.z }, () => 0.95);
    expect(slip.outcome).toBe('slip');
    expect(slip.machine).toBe(m);

    const far = resolveCrane({ ...m, capsules: [c] }, { x: c.x > 0.5 ? 0 : 1, z: c.z }, () => 0);
    expect(far.outcome).toBe('miss');
    expect(far.capsuleId).toBeNull();
  });

  it('店のレイアウトのクレーンゲームは 2 台（decor の crane の並び順で番号）', () => {
    const spots = craneSpots(FLOOR);
    expect(spots.map((s) => s.id)).toEqual([1, 2]);
    expect(spots[0]).toMatchObject({ x: 20, y: 0 });
  });
});

describe('バッジ', () => {
  it('並びは ♠♡♦♧ に固定', () => {
    expect(sortBadges('♧♦♠♡')).toBe('♠♡♦♧');
    expect(sortBadges('♦x♠')).toBe('♠♦');
  });

  it('既定（4 種類を 1 つずつ）：持っているものは「もう持っています」・4 種類でコンプリート', () => {
    let b = '';
    let r = addBadge(b, '♦', 'unique');
    expect(r).toMatchObject({ badges: '♦', gained: true, duplicate: false, completed: false });
    b = r.badges;
    r = addBadge(b, '♦', 'unique');
    expect(r).toMatchObject({ badges: '♦', gained: false, duplicate: true });
    b = addBadge(addBadge(b, '♧', 'unique').badges, '♠', 'unique').badges;
    expect(b).toBe('♠♦♧');
    r = addBadge(b, '♡', 'unique');
    expect(r).toMatchObject({ badges: '♠♡♦♧', gained: true, completed: true });
    expect(isComplete(r.badges)).toBe(true);
  });

  it('重ねて持てる設定：同じものも最大 n 個・コンプリートは初めてそろったときだけ', () => {
    let b = '';
    for (let i = 0; i < 3; i++) b = addBadge(b, '♠', 'stack', 3).badges;
    expect(b).toBe('♠♠♠');
    expect(addBadge(b, '♠', 'stack', 3)).toMatchObject({ gained: false, duplicate: true });
    b = addBadge(addBadge(addBadge(b, '♧', 'stack', 3).badges, '♦', 'stack', 3).badges, '♡', 'stack', 3).badges;
    expect(b).toBe('♠♠♠♡♦♧');
    const again = addBadge(b, '♡', 'stack', 3);
    expect(again).toMatchObject({ badges: '♠♠♠♡♡♦♧', gained: true, completed: false });
  });

  it('名前の後ろに付く（名前の文字数とは別）', () => {
    expect(nameWithBadges('たいよう', '♠♦')).toBe('たいよう♠♦');
    expect(nameWithBadges('あ'.repeat(20), '♠♡♦♧')).toHaveLength(24);
    expect(nameWithBadges('たいよう', '')).toBe('たいよう');
  });
});
