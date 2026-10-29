// v0.6.0：同梱した Columns like game の JS（client/public/games/columns の columns.js と va_bridge.js）を Node の vm で動かし（表示・タイマーはスタブ）、
// サーバのなぞり直し（shared/src/columns.ts）と点数・井戸・レベル・ジュエルの数が一致するかを確かめる（DESIGN §16.8）。
// 時間で落ちる部分（setInterval）は動かさず、ピースを回す・動かす・↓・落とす・ゆっくり落ちる 1 段（update を直接呼ぶ）でテストが操作する。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ColumnsGame, mulberry32, replayColumns } from '@va/shared';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../../client/public/games/columns');
const ORIGIN = 'http://va.test';
const STEP = 64;

interface Posted {
  type: string;
  x?: number;
  rot?: number;
  bonus?: number;
  t?: number;
  gen?: number;
  score?: number;
  options?: Record<string, number>;
}

/** 元の JS を 1 つの vm の中で読み込む（ブラウザの代わりのスタブつき） */
const loadGame = () => {
  const posted: Posted[] = [];
  const targets: string[] = [];
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const parent = {
    postMessage: (m: Posted, target: string) => {
      posted.push(m);
      targets.push(target);
    },
  };
  const ctx: Record<string, any> = { console, Math, location: { origin: ORIGIN } };
  ctx.window = ctx;
  ctx.parent = parent;
  ctx.addEventListener = (t: string, fn: (e: unknown) => void) => (listeners[t] ??= []).push(fn);
  // 時間で動く部分は動かさない（テストが update を直接呼ぶ）
  ctx.setInterval = () => 1;
  ctx.clearInterval = () => {};
  ctx.setTimeout = () => 1;
  ctx.focus = () => {};
  vm.createContext(ctx);
  for (const f of ['va_bridge.js', 'columns.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
  // 表示はすべて何もしない（await されるものは解決済みの Promise）
  vm.runInContext(
    `
    for (const k of Object.keys(Display.prototype)) Display.prototype[k] = function () { return Promise.resolve(); };
    // オプション（元は画面の欄から読む）：値の入れ物だけ
    function FakeOptions() { this.values = {}; this.defaults = { start: 1, difficulty: 5, height: 0, mode: 0, ghost: 1, backdrop: 1 }; }
    FakeOptions.prototype.load = function (v) { if (v) this.values = Object.assign({}, v); };
    FakeOptions.prototype.save = function () { return Object.assign({}, this.values); };
    FakeOptions.prototype.read = function (k) { const v = this.values[k]; return Number(v === undefined ? this.defaults[k] : v); };
    var __game = new Game(new FakeOptions(), new Scores());
    VAColumns.attach(__game);
    `,
    ctx,
  );
  const message = (data: unknown, origin = ORIGIN, source: unknown = parent) => listeners.message.forEach((fn) => fn({ origin, source, data }));
  const start = (seed: number, gen: number, start = 1) =>
    message({ type: 'va-columns:start', seed, gen, options: { mode: 0, colors: 5, height: 0, start } });
  const game = ctx.__game as any;
  return { ctx, game, posted, targets, message, start };
};

const wellOf = (g: any): number[][] => g.well.map((r: number[]) => [...r]);

describe('元の Columns の JS とサーバのなぞり直しが一致する', () => {
  it('ランダムな置き方（落とす・↓・ゆっくり落ちる）で 400 ゲーム：置くたびの点数・井戸・レベル・ジュエルと、最後のなぞり直しが一致', async () => {
    const js = loadGame();
    const pick = mulberry32(20261030);
    let pieces = 0;
    let overs = 0;
    let magics = 0;
    let chains = 0;
    let levelUps = 0;
    let lostAbove = 0;
    let bottomMagic = 0;
    for (let n = 1; n <= 400; n++) {
      const seed = Math.floor(pick() * 2 ** 32);
      const startLevel = 1 + Math.floor(pick() * 12);
      if (n > 1) {
        // Reset（元の resetGame）→ 親が記録する → 次の Play
        const k = js.posted.length;
        js.ctx.VAColumns.reset();
        js.game.reset();
        expect(js.posted.slice(k)).toEqual([{ type: 'va-columns:reset', gen: n - 1 }]);
      }
      js.start(seed, n, startLevel);
      expect(js.game.stopped).toBe(false);
      expect(js.game.level).toBe(startLevel);
      const ts = new ColumnsGame(mulberry32(seed), startLevel);
      expect(js.game.currentPiece.colors).toEqual(ts.current.colors);
      expect(js.game.nextPiece.colors).toEqual(ts.next.colors);
      // マジックジュエルの経路を通すため、半分のゲームは経過秒を 300 の近くから
      let t = pick() < 0.5 ? 1 : 280 + Math.floor(pick() * 40);
      const moves: number[][] = [];
      let over: [number, number] | undefined;
      // いちばん低い列に置く（長く続く）か、でたらめな列に置く（早く終わる）
      const careful = pick() < 0.6;
      while (moves.length < 600) {
        t += Math.floor(pick() * 3);
        js.game.time = t;
        const piece = js.game.currentPiece;
        const wasMagic = piece.magic;
        for (let r = Math.floor(pick() * 4); r > 0; r--) piece.rotate();
        let x = Math.floor(pick() * 7);
        if (careful && pick() < 0.8) {
          const tops = [0, 1, 2, 3, 4, 5, 6].map((c) => js.game.findBottom(c));
          x = tops.indexOf(Math.max(...tops));
        }
        while (piece.x > x) js.game.moveLeft();
        while (piece.x < x) js.game.moveRight();
        expect(piece.x).toBe(x);
        const bottom = js.game.findBottom(x);
        if (pick() < 0.6) {
          // ↓ を何回か（段の境目では動かない＝点が入らない）→ 落とす
          for (let d = Math.floor(pick() * 4); d > 0; d--) {
            if (pick() < 0.7) piece.fraction = 1 + Math.floor(pick() * (STEP - 2));
            js.game.moveDown();
          }
          if (pick() < 0.2) piece.fraction = 30; // 固まりかけ（元はここで落とすと点が減った）
          js.game.drop();
        } else {
          // ゆっくり落ちる（1 段ずつ update）。ときどき ↓
          let guard = 0;
          while (!piece.locked && !js.game.stopped && guard++ < 40) {
            piece.fraction = STEP - 1;
            await js.game.update();
            if (pick() < 0.3 && !piece.locked) {
              piece.fraction = 5;
              js.game.moveDown();
            }
          }
          if (js.game.stopped) {
            // ゲームオーバー：最後のピースは井戸に入らない（↓ の点だけ）
            const msg = js.posted[js.posted.length - 1];
            expect(msg.type).toBe('va-columns:over');
            expect(msg.gen).toBe(n);
            expect(ts.over(msg.x, msg.bonus)).toBeNull();
            expect(ts.score).toBe(js.game.score);
            expect(msg.score).toBe(js.game.score);
            over = [msg.x!, msg.bonus!];
            overs++;
            break;
          }
        }
        expect(piece.locked).toBe(true);
        const k = js.posted.length;
        await js.game.update();
        const got = js.posted.slice(k);
        expect(got).toHaveLength(1);
        const m = got[0];
        expect(m).toMatchObject({ type: 'va-columns:place', x, gen: n, t });
        if (bottom < -1) lostAbove++;
        const lvl = ts.level;
        expect(ts.place({ x: m.x!, rot: m.rot!, bonus: m.bonus!, t: m.t! })).toBeNull();
        moves.push([m.x!, m.rot!, m.bonus!, m.t!]);
        if (wasMagic) {
          magics++;
          if (bottom === 10) bottomMagic++;
        }
        if (ts.lastChain >= 1) chains++;
        if (ts.level > lvl) levelUps++;
        expect(ts.well).toEqual(wellOf(js.game));
        expect(ts.score).toBe(js.game.score);
        expect(ts.level).toBe(js.game.level);
        expect(ts.jewels).toBe(js.game.jewels);
        expect(ts.current.colors).toEqual(js.game.currentPiece.colors);
        expect(ts.current.magic).toBe(js.game.currentPiece.magic);
        expect(ts.next.colors).toEqual(js.game.nextPiece.colors);
        pieces++;
      }
      const r = replayColumns(seed, startLevel, moves, over);
      expect(r.ok).toBe(true);
      expect(r.score).toBe(js.game.score);
      expect(r.well).toEqual(wellOf(js.game));
      expect(r.level).toBe(js.game.level);
      expect(r.jewels).toBe(js.game.jewels);
      expect(r.pieces).toBe(moves.length);
    }
    // ちゃんと遊んだこと：終わりまで行ったゲーム・連鎖・レベル上げ・マジックジュエル・井戸の上にはみ出して置いたピース
    expect(pieces).toBeGreaterThan(10000);
    // （2026-10-30 の時点で pieces 16,923・overs 400・連鎖 1,058・レベル上げ 50・マジックジュエル 40（うち底 4）・はみ出し 574）
    expect(overs).toBeGreaterThan(300);
    expect(chains).toBeGreaterThan(300);
    expect(levelUps).toBeGreaterThan(30);
    expect(magics).toBeGreaterThan(10);
    expect(lostAbove).toBeGreaterThan(100);
    expect(new Set(js.targets)).toEqual(new Set([ORIGIN]));
    expect(bottomMagic).toBeGreaterThan(0);
  }, 120_000);

  it('マジックジュエル：見つかる種で、宝石の上に落とす・井戸の底に落とすの両方が元と一致する', async () => {
    // 開始レベル 4・経過 301 秒から、マジックジュエルが早く出る種を探す
    const find = () => {
      for (let seed = 1; seed < 200000; seed++) {
        const g = new ColumnsGame(mulberry32(seed), 4);
        for (let i = 0; i < 6; i++) {
          g.place({ x: i % 7, rot: 0, bonus: 0, t: 301 });
          if (g.next.magic) return { seed, at: i };
        }
      }
      throw new Error('no seed');
    };
    const { seed, at } = find();
    for (const onBottom of [false, true]) {
      const js = loadGame();
      js.start(seed, 1, 4);
      const ts = new ColumnsGame(mulberry32(seed), 4);
      const cols = [0, 1, 2, 3, 4, 5, 6];
      // 置いた at 番目のあとに作られた「次」がマジックジュエル → at + 2 番目に置く
      for (let i = 0; i <= at + 2; i++) {
        js.game.time = 301;
        const piece = js.game.currentPiece;
        // マジックジュエルは、宝石の上（0 列）か、空いている列の底（6 列）へ
        expect(piece.magic).toBe(i === at + 2);
        const x = piece.magic ? (onBottom ? 6 : 0) : cols[i % 6];
        while (piece.x > x) js.game.moveLeft();
        while (piece.x < x) js.game.moveRight();
        js.game.drop();
        await js.game.update();
        const m = js.posted[js.posted.length - 1];
        expect(ts.place({ x: m.x!, rot: m.rot!, bonus: m.bonus!, t: m.t! })).toBeNull();
        expect(ts.score).toBe(js.game.score);
        expect(ts.well).toEqual(wellOf(js.game));
        expect(ts.jewels).toBe(js.game.jewels);
        if (i === at + 2 && onBottom) expect(js.game.score).toBeGreaterThanOrEqual(20000); // 底では 10,000 点が 2 回（元のまま）
      }
    }
  });

  it('↓ は動いたときだけ点（元の不具合の修正）・固まりかけで落としても点は減らない・回した回数を知らせる', async () => {
    const js = loadGame();
    js.start(1234, 1, 1);
    const piece = js.game.currentPiece;
    expect(piece.fraction).toBe(0);
    js.game.moveDown(); // 段の境目：動かない
    js.game.moveDown();
    expect(js.game.score).toBe(0);
    piece.fraction = 10;
    js.game.moveDown(); // 次の段へ動く
    expect(piece.y).toBe(-2);
    expect(js.game.score).toBe(4);
    piece.rotate();
    piece.rotate();
    piece.rotate();
    piece.rotate();
    // 底で固まりかけ（段の途中）から落とす
    piece.y = 10;
    piece.fraction = 0;
    js.game.drop();
    expect(js.game.score).toBe(4 + (10 - 10) * 4);
    await js.game.update();
    const m = js.posted[js.posted.length - 1];
    expect(m).toMatchObject({ type: 'va-columns:place', rot: 1, bonus: 4 });
  });

  it('親の窓とのやりとり：Play は親に頼むだけ・オリジンや送り主が違う start は無視・localStorage を使わない', () => {
    const js = loadGame();
    expect(js.posted[0]).toEqual({ type: 'va-columns:ready' });
    expect(js.game.stopped).toBe(true);
    js.message({ type: 'va-columns:start', seed: 1, gen: 1 }, 'http://evil.test');
    js.message({ type: 'va-columns:start', seed: 1, gen: 1 }, ORIGIN, {});
    expect(js.game.stopped).toBe(true);
    js.ctx.VAColumns.requestPlay();
    expect(js.posted[1]).toEqual({ type: 'va-columns:play', options: { mode: 0, colors: 5, height: 0, start: 1 } });
    expect(js.game.stopped).toBe(true);
    // 親が受け付けた設定で始める（練習の設定も遊べる）
    js.message({ type: 'va-columns:start', seed: 9, gen: 2, options: { mode: 0, colors: 4, height: 0, start: 3 } });
    expect(js.game.stopped).toBe(false);
    expect(js.game.difficulty).toBe(4);
    expect(js.game.level).toBe(3);
    // 遊んでいる間の start は無視
    js.message({ type: 'va-columns:start', seed: 10, gen: 3 });
    expect(js.game.level).toBe(3);
    const src = fs.readFileSync(path.join(DIR, 'columns.js'), 'utf8');
    expect(src).not.toMatch(/new Storage\(/);
    expect(fs.readFileSync(path.join(DIR, 'va_bridge.js'), 'utf8')).not.toMatch(/localStorage/);
    // ゲームに効く乱数は種から（見た目だけの Math.random は描画とグラデーションだけ）
    const uses = src.split('\n').filter((l) => l.includes('Math.random'));
    expect(uses).toHaveLength(3);
    // 外への通信・写真・字体 Dalek Pinpoint を入れていない
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    expect(html).not.toMatch(/manifest|favicon|mailto|Dalek|images\//);
    expect(html).toMatch(/Columns like game/);
    expect(fs.readFileSync(path.join(DIR, 'layout/style.css'), 'utf8')).not.toMatch(/url\(\s*["']?https?:/);
    expect(fs.existsSync(path.join(DIR, 'layout/fonts/OFL-Laila.txt'))).toBe(true);
  });
});
