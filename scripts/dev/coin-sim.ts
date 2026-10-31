// ゲームでもらえるコインの目安のシミュレーション（v0.7.0。DESIGN §17.9）。sMin・sMax を変えるときに回して DESIGN の数字を直す。
//   npx tsx scripts/dev/coin-sim.ts [ゲームの数（既定 2048 は 300・Columns は 300）] [種（既定 1）]
// 2048：random = 動く手からでたらめ・corner = 下 → 左 → 右 → 上の順に動く手（角に寄せる簡単な戦略）・
//       greedy = 1 手先の点・空きマス・角の並びで選ぶ（少し考える人）・expecti = 2 手先までの期待値（上手な人の代わり）。
// Columns like game：random = でたらめな列・回し方（入らなくなったら終わり）・greedy = すべての置き方を試して消える数の多いもの（無ければ低い列）。
//       ↓ と落下の点（bonus）は 0 と、上限まで（スペースで落とし続ける人）の 2 通り。
// Hextris はなぞり直しの TS が無いので、ブラウザで元のゲームを自動で遊ばせる scripts/dev/hextris-sim.mjs。
import { Game2048, mulberry32, type Dir2048, ColumnsGame, COLUMNS_COLS, gameCoins, GAME_COIN_RANGE } from '../../shared/src/index';

const N = Number(process.argv[2] ?? 300);
const seed0 = Number(process.argv[3] ?? 1);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const report = (game: string, name: string, scores: number[], extra = '') => {
  const coins = scores.map((s) => gameCoins(game, s));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `${game} ${name.padEnd(14)} 点数 中央値 ${fmt(pct(scores, 0.5)).padStart(7)}・10% ${fmt(pct(scores, 0.1)).padStart(7)}・90% ${fmt(pct(scores, 0.9)).padStart(7)}・最大 ${fmt(Math.max(...scores)).padStart(7)}` +
      ` → コイン 平均 ${avg(coins).toFixed(1).padStart(5)}・中央値 ${String(pct(coins, 0.5)).padStart(2)}・0 枚 ${((coins.filter((c) => c === 0).length / coins.length) * 100).toFixed(0).padStart(3)}%・60 枚 ${((coins.filter((c) => c >= 60).length / coins.length) * 100).toFixed(0).padStart(3)}%${extra}`,
  );
};

// ---------------------------------------------------------------- 2048
const clone2048 = (g: Game2048): Game2048 => {
  const c = new Game2048(() => 0, g.cells);
  c.score = g.score;
  return c;
};
const empties = (g: Game2048) => g.cells.flat().filter((v) => !v).length;
/** 盤の良さ：空きマス・大きいタイルが角（左下 = cells[0][3]）にある・並びがなめらか */
const evalBoard = (g: Game2048): number => {
  let mono = 0;
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++) {
      const v = g.cells[x][y];
      if (!v) continue;
      if (x < 3 && g.cells[x + 1][y]) mono -= Math.abs(Math.log2(v) - Math.log2(g.cells[x + 1][y]));
      if (y < 3 && g.cells[x][y + 1]) mono -= Math.abs(Math.log2(v) - Math.log2(g.cells[x][y + 1]));
    }
  const corner = g.cells[0][3] === g.maxTile ? Math.log2(g.maxTile) * 2 : 0;
  return empties(g) * 2.7 + mono * 0.6 + corner + Math.log2(Math.max(2, g.score)) * 0.2;
};
const expect = (g: Game2048, depth: number): number => {
  if (depth === 0) return evalBoard(g);
  // 置かれるタイル（空きマスの一部だけ見る）
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) if (!g.cells[x][y]) cells.push([x, y]);
  if (!cells.length) return evalBoard(g);
  const pick = cells.length > 6 ? cells.filter((_, i) => i % Math.ceil(cells.length / 6) === 0) : cells;
  let sum = 0;
  for (const [x, y] of pick)
    for (const [v, w] of [
      [2, 0.9],
      [4, 0.1],
    ] as const) {
      const c = clone2048(g);
      c.cells[x][y] = v;
      let best = -1e9;
      for (const d of [0, 1, 2, 3] as Dir2048[]) {
        const m = clone2048(c);
        // 置くタイルの乱数は使わない（rng = 0 で置かれるが、評価の前に消す）
        if (!moveNoSpawn(m, d)) continue;
        best = Math.max(best, expect(m, depth - 1));
      }
      sum += w * (best === -1e9 ? -100 : best);
    }
  return sum / pick.length;
};
/** 新しいタイルを置かずに動かす（先読み用） */
const moveNoSpawn = (g: Game2048, d: Dir2048): boolean => {
  const before = JSON.stringify(g.cells);
  const save = g.addRandomTile;
  g.addRandomTile = () => {};
  const moved = g.move(d);
  g.addRandomTile = save;
  g.over = false;
  return moved && JSON.stringify(g.cells) !== before;
};
const strategies2048: Record<string, (g: Game2048, r: () => number) => Dir2048 | null> = {
  random: (g, r) => {
    const ok = ([0, 1, 2, 3] as Dir2048[]).filter((d) => moveNoSpawn(clone2048(g), d));
    return ok.length ? ok[Math.floor(r() * ok.length)] : null;
  },
  corner: (g) => ([2, 3, 1, 0] as Dir2048[]).find((d) => moveNoSpawn(clone2048(g), d)) ?? null,
  greedy: (g) => {
    let best: Dir2048 | null = null;
    let bv = -1e9;
    for (const d of [2, 3, 1, 0] as Dir2048[]) {
      const c = clone2048(g);
      if (!moveNoSpawn(c, d)) continue;
      const v = evalBoard(c) + (d === 0 ? -3 : 0);
      if (v > bv) [bv, best] = [v, d];
    }
    return best;
  },
  expecti: (g) => {
    let best: Dir2048 | null = null;
    let bv = -1e9;
    for (const d of [2, 3, 1, 0] as Dir2048[]) {
      const c = clone2048(g);
      if (!moveNoSpawn(c, d)) continue;
      const v = expect(c, empties(c) > 6 ? 1 : 2);
      if (v > bv) [bv, best] = [v, d];
    }
    return best;
  },
};
/** ONLY=2048 / ONLY=columns で片方だけ */
const only = process.env.ONLY;
for (const [name, pick] of Object.entries(strategies2048)) {
  if (only && only !== '2048') break;
  const n = name === 'expecti' ? Math.min(N, 40) : N;
  const scores: number[] = [];
  const tiles: number[] = [];
  const steps: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = mulberry32(seed0 * 7919 + i);
    const g = new Game2048(mulberry32(seed0 * 104729 + i));
    let k = 0;
    while (!g.over && k < 100_000) {
      if (g.won && !g.keepPlaying) g.keep();
      const d = pick(g, r);
      if (d === null) break;
      g.move(d);
      k++;
    }
    scores.push(g.score);
    tiles.push(g.maxTile);
    steps.push(k);
  }
  const t2048 = tiles.filter((t) => t >= 2048).length;
  const tileStr = [128, 256, 512, 1024, 2048].map((t) => `${t}:${((tiles.filter((v) => v >= t).length / n) * 100).toFixed(0)}%`).join(' ');
  report('2048', `${name}(${n})`, scores, `  タイル ${tileStr}・手の数 中央値 ${pct(steps, 0.5)}${t2048 ? '' : ''}`);
}

// ---------------------------------------------------------------- Columns like game（Standard・5 色・Height 0・開始レベル 1）
type CG = ColumnsGame & { current: { colors: number[]; magic: boolean } };
const cloneCols = (g: ColumnsGame): ColumnsGame => {
  const c = Object.create(ColumnsGame.prototype) as ColumnsGame;
  Object.assign(c, g);
  (c as unknown as { rng: () => number }).rng = () => 0.5;
  c.well = g.well.map((row) => [...row]);
  (c as CG).current = { colors: [...(g as CG).current.colors], magic: (g as CG).current.magic };
  (c as CG).next = { colors: [...(g as CG).next.colors], magic: (g as CG).next.magic };
  return c;
};
// miss50 / miss30 / miss15 = greedy だが、そのピースを (50% / 30% / 15%) + レベル × 3% の割合ででたらめな列に置く（速くなると手が追いつかない人の代わり）
const MISS: Record<string, number> = { random: 1, miss50: 0.5, miss30: 0.3, miss15: 0.15, greedy: 0 };
for (const name of only && only !== 'columns' ? [] : (['random', 'miss50', 'miss30', 'miss15', 'greedy'] as const))
  for (const drop of name === 'random' ? [false, true] : [true]) {
    const scores: number[] = [];
    const pieces: number[] = [];
    for (let i = 0; i < (name === 'greedy' ? Math.min(N, 20) : N); i++) {
      const r = mulberry32(seed0 * 31337 + i);
      const g = new ColumnsGame(mulberry32(seed0 * 65537 + i), 1);
      let t = 1;
      for (;;) {
        let x: number;
        let rot: number;
        if (name === 'random' || r() < MISS[name] + (name === 'greedy' ? 0 : g.level * 0.03)) {
          x = Math.floor(r() * COLUMNS_COLS);
          rot = Math.floor(r() * 3);
          // 入らない列に置いたら終わり（ゆっくり落ちて固まると上にはみ出してゲームオーバー）
          if (g.findBottom(x) < 0) break;
        } else {
          let best: [number, number] | null = null;
          let bv = -1e9;
          for (let cx = 0; cx < COLUMNS_COLS; cx++) {
            if (g.findBottom(cx) < 0) continue;
            for (let cr = 0; cr < 3; cr++) {
              const c = cloneCols(g);
              const before = c.score;
              c.place({ x: cx, rot: cr, bonus: 0, t });
              const v = (c.score - before) * 10 + c.findBottom(cx) - (cx === 3 ? 2 : 0);
              if (v > bv) [bv, best] = [v, [cx, cr]];
            }
          }
          if (!best) break;
          [x, rot] = best;
        }
        const err = g.place({ x, rot, bonus: drop ? g.bonusLimit(x) : 0, t });
        if (err) throw new Error(`置けなかった：${err}`);
        // ゲームの経過秒（1 ピース約 1.2 秒。t は整数）
        t = 1 + Math.floor(g.pieces * 1.2);
        // greedy は速さで負けない（いつまでも続く）ので 1,000 ピースで打ち切る
        if (g.pieces >= 1000) break;
      }
      scores.push(g.score);
      pieces.push(g.pieces);
    }
    report('columns', `${name}${drop ? '+drop' : ''}(${scores.length})`, scores, `  ピース 中央値 ${pct(pieces, 0.5)}`);
  }
console.log(`範囲 ${JSON.stringify(GAME_COIN_RANGE)}`);
