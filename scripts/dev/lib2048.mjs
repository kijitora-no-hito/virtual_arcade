// 確認の道具用：2048 を種から動かす（shared/src/game2048.ts と同じ決まりを素の JS に写したもの。scene.mjs・game-check.mjs で使う）。
// サーバに記録するときは、始めてから「手の数 × 40 ms」より後に finish すること（速すぎる手は断られる）。

export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const V = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export class Game2048 {
  constructor(rng) {
    this.rng = rng;
    this.cells = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
    this.add();
    this.add();
  }
  get terminated() {
    return this.over || (this.won && !this.keepPlaying);
  }
  empty() {
    const out = [];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) if (!this.cells[x][y]) out.push([x, y]);
    return out;
  }
  add() {
    const e = this.empty();
    if (!e.length) return;
    const v = this.rng() < 0.9 ? 2 : 4;
    const [x, y] = e[Math.floor(this.rng() * e.length)];
    this.cells[x][y] = v;
  }
  movesAvailable() {
    if (this.empty().length) return true;
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (const [dx, dy] of V) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 && this.cells[nx][ny] === this.cells[x][y]) return true;
        }
    return false;
  }
  move(dir) {
    if (this.terminated) return false;
    const [vx, vy] = V[dir];
    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 2, 3];
    if (vx === 1) xs.reverse();
    if (vy === 1) ys.reverse();
    const merged = [0, 1, 2, 3].map(() => [false, false, false, false]);
    const inb = (x, y) => x >= 0 && x < 4 && y >= 0 && y < 4;
    let moved = false;
    for (const x of xs)
      for (const y of ys) {
        const val = this.cells[x][y];
        if (!val) continue;
        let fx = x;
        let fy = y;
        let nx = x + vx;
        let ny = y + vy;
        while (inb(nx, ny) && !this.cells[nx][ny]) {
          fx = nx;
          fy = ny;
          nx += vx;
          ny += vy;
        }
        const next = inb(nx, ny) ? this.cells[nx][ny] : 0;
        if (next && next === val && !merged[nx][ny]) {
          this.cells[x][y] = 0;
          this.cells[nx][ny] = val * 2;
          merged[nx][ny] = true;
          this.score += val * 2;
          if (val * 2 === 2048) this.won = true;
          moved = true;
        } else {
          this.cells[x][y] = 0;
          this.cells[fx][fy] = val;
          if (fx !== x || fy !== y) moved = true;
        }
      }
    if (moved) {
      this.add();
      if (!this.movesAvailable()) this.over = true;
    }
    return moved;
  }
}

/** 種 seed で、盤が動いた手だけを n 手（終わればそこまで）。pickSeed = 手を選ぶ乱数の種 */
export const playRandom = (seed, n, pickSeed = 1) => {
  const g = new Game2048(mulberry32(seed));
  const pick = mulberry32(pickSeed);
  let moves = '';
  while (!g.terminated && moves.length < n) {
    const d = Math.floor(pick() * 4);
    if (g.move(d)) moves += d;
  }
  return { moves, score: g.score };
};
