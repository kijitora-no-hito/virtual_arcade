// スロットの機械割のシミュレーション（v0.7.0。DESIGN §17.3）。配列・確率・配当を変えたら回して DESIGN の数字を直す。
//   npx tsx scripts/dev/slot-sim.ts [回数（既定 1,000,000）] [種（既定 1）]
// perfect = 当たった役を知っていて、いつも引き込める所で押す（目押しの上限）、random = でたらめな位置・順で押す。
// 機械割 = 払い出し / 掛けた枚数（リプレイは 3 枚掛けて 3 枚戻ったと数える）。
import { REELS, REEL_LEN, MAX_SLIDE, SLOT_ODDS, SLOT_PAYOUT, SLOT_BET, simulateSlot, type SlotRole } from '../../shared/src/slot';

const n = Number(process.argv[2] ?? 1_000_000);
let seed = Number(process.argv[3] ?? 1);
const rng = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// 押して 4 コマ以内に届く位置の数（21 のうち）
for (let r = 0; r < 3; r++) {
  const cov: string[] = [];
  for (const sym of ['seven', 'bar', 'suika', 'cherry', 'bell', 'replay']) {
    let c = 0;
    for (let p = 0; p < REEL_LEN; p++)
      for (let k = 0; k <= MAX_SLIDE; k++)
        if (REELS[r][(p + k) % REEL_LEN] === sym) {
          c++;
          break;
        }
    cov.push(`${sym} ${c}`);
  }
  console.log(`リール ${'左中右'[r]}：${cov.join('・')}`);
}
// 目押しが完璧なときの理論値（ボーナスは当たった回に揃う）
const ev = (Object.keys(SLOT_ODDS) as SlotRole[]).reduce((a, r) => a + (r === 'replay' ? SLOT_BET : SLOT_PAYOUT[r]) / SLOT_ODDS[r], 0);
console.log(`完璧な目押しの理論値 ${((ev / SLOT_BET) * 100).toFixed(2)}%`);
for (const style of ['perfect', 'random'] as const) {
  const t0 = Date.now();
  const r = simulateSlot(n, style, rng);
  console.log(
    `${style}：${n.toLocaleString('en-US')} 回 機械割 ${(r.rate * 100).toFixed(2)}%  ` +
      `揃った ${JSON.stringify(r.wins)}  取りこぼし ${JSON.stringify(r.missed)}  ボーナスを揃えるまで平均 ${r.bonusWait.toFixed(1)} 回（${Date.now() - t0} ms）`,
  );
}
