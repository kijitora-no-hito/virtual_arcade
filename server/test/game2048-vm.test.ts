// v0.6.0：同梱した元の 2048 の JS（client/public/games/2048/js の tile.js・grid.js・game_manager.js と va_bridge.js）を
// Node の vm で動かし（入力・表示はスタブ）、サーバのなぞり直し（shared/src/game2048.ts）と点数・盤・終わりが一致するかを確かめる（DESIGN §16.3）。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Game2048, mulberry32, replay2048, type Dir2048 } from '@va/shared';
import { describe, expect, it } from 'vitest';
import win from '../../shared/test/fixtures/win2048.json';

const DIR = path.resolve(import.meta.dirname, '../../client/public/games/2048/js');
const ORIGIN = 'http://va.test';

interface Posted {
  type: string;
  dir?: number;
  gen?: number;
  score?: number;
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
  ctx.requestAnimationFrame = (fn: () => void) => fn();
  ctx.focus = () => {};
  vm.createContext(ctx);
  // 入力（外から move / restart / keepPlaying を起こす）と表示（最後の盤と点数を覚えるだけ）
  vm.runInContext(
    `
    function KeyboardInputManager() { this.events = {}; window.__input = this; }
    KeyboardInputManager.prototype.on = function (ev, cb) { (this.events[ev] = this.events[ev] || []).push(cb); };
    KeyboardInputManager.prototype.emit = function (ev, d) { (this.events[ev] || []).forEach(function (cb) { cb(d); }); };
    function HTMLActuator() { window.__actuated = 0; }
    HTMLActuator.prototype.actuate = function (grid, meta) { window.__grid = grid; window.__meta = meta; window.__actuated++; };
    HTMLActuator.prototype.continueGame = function () {};
    `,
    ctx,
  );
  for (const f of ['tile.js', 'grid.js', 'va_bridge.js', 'game_manager.js'])
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
  ctx.VA2048.ready();
  const message = (data: unknown, origin = ORIGIN, source: unknown = parent) => listeners.message.forEach((fn) => fn({ origin, source, data }));
  const start = (seed: number, gen: number, best = 0) => message({ type: 'va2048:start', seed, gen, best });
  const emit = (ev: string, d?: unknown) => ctx.__input.emit(ev, d);
  /** 今の盤（cells[x][y]。0 は空き） */
  const cells = (): number[][] => ctx.__grid.cells.map((col: Array<{ value: number } | null>) => col.map((t) => (t ? t.value : 0)));
  return { ctx, posted, targets, message, start, emit, cells, meta: () => ctx.__meta as { score: number; over: boolean; won: boolean; bestScore: number } };
};

describe('元の 2048 の JS とサーバのなぞり直しが一致する', () => {
  it('ランダムな手（動かない手も混ぜる）で 300 ゲーム：1 手ごとの盤・点数・終わりと、最後のなぞり直しが一致', () => {
    const js = loadGame();
    const pick = mulberry32(20261030);
    let totalMoves = 0;
    let overs = 0;
    for (let game = 1; game <= 300; game++) {
      const seed = Math.floor(pick() * 2 ** 32);
      if (game > 1) {
        // 2 回目からは New Game → 親が新しい種で始め直す（元の restart の中身 = newGame）
        const n = js.posted.length;
        js.emit('restart');
        expect(js.posted.slice(n)).toEqual([{ type: 'va2048:restart', gen: game - 1 }]);
      }
      js.start(seed, game);
      const ts = new Game2048(mulberry32(seed));
      expect(js.cells()).toEqual(ts.cells);
      let moves = '';
      // 半分くらいは途中でやめる（途中までの記録も同じになること）
      const limit = pick() < 0.5 ? 40 + Math.floor(pick() * 200) : 5000;
      while (!ts.terminated && moves.length < limit) {
        const d = Math.floor(pick() * 4) as Dir2048;
        const n = js.posted.length;
        js.emit('move', d);
        const moved = ts.move(d);
        const got = js.posted.slice(n);
        if (moved) {
          expect(got[0]).toEqual({ type: 'va2048:move', dir: d, gen: game });
          moves += d;
        } else expect(got).toEqual([]);
        expect(js.cells()).toEqual(ts.cells);
        expect(js.meta().score).toBe(ts.score);
        expect(js.meta().over).toBe(ts.over);
        if (ts.over) {
          expect(got[1]).toEqual({ type: 'va2048:over', score: ts.score, gen: game });
          overs++;
        }
      }
      const r = replay2048(seed, moves);
      expect(r.ok).toBe(true);
      expect(r.score).toBe(js.meta().score);
      expect(r.cells).toEqual(js.cells());
      expect(r.over).toBe(js.meta().over);
      expect(r.maxTile).toBe(Math.max(...js.cells().flat()));
      totalMoves += moves.length;
    }
    // ちゃんと遊んだこと（終わりまで行ったゲームもある）
    expect(totalMoves).toBeGreaterThan(20000);
    expect(overs).toBeGreaterThan(100);
    expect(new Set(js.targets)).toEqual(new Set([ORIGIN]));
  });

  it('2048 まで遊んだ記録（K = Keep going あり）も一致する。2048 の前の Keep going は効かない', () => {
    const js = loadGame();
    js.start(win.seed, 1);
    // 2048 を作る前の Keep going は何もしない（親にも知らせない）
    const n0 = js.posted.length;
    js.emit('keepPlaying');
    expect(js.posted.length).toBe(n0);
    for (const ch of win.moves) {
      const n = js.posted.length;
      if (ch === 'K') {
        expect(js.meta().won).toBe(true);
        expect(js.meta().score).toBeGreaterThan(0);
        // 止まっている間の手は動かない
        js.emit('move', 0);
        js.emit('move', 2);
        expect(js.posted.length).toBe(n);
        js.emit('keepPlaying');
        expect(js.posted.slice(n)).toEqual([{ type: 'va2048:keep', gen: 1 }]);
        // 続けているのにもう一度押しても何もしない
        js.emit('keepPlaying');
        expect(js.posted.length).toBe(n + 1);
      } else {
        js.emit('move', Number(ch));
        expect(js.posted[n]).toEqual({ type: 'va2048:move', dir: Number(ch), gen: 1 });
      }
    }
    const r = replay2048(win.seed, win.moves);
    expect(r.ok).toBe(true);
    expect(js.meta().score).toBe(win.score);
    expect(r.score).toBe(js.meta().score);
    expect(r.cells).toEqual(js.cells());
    expect(Math.max(...js.cells().flat())).toBeGreaterThanOrEqual(2048);
  });

  it('親の窓とのやりとり：オリジン・送り主が違う start は無視・ベストは親から・始め直すと新しい盤', () => {
    const js = loadGame();
    expect(js.posted[0]).toEqual({ type: 'va2048:ready' });
    // ほかのオリジン・親でない送り主からは始めない
    js.message({ type: 'va2048:start', seed: 1, gen: 1, best: 0 }, 'http://evil.test');
    js.message({ type: 'va2048:start', seed: 1, gen: 1, best: 0 }, ORIGIN, {});
    expect(js.ctx.__grid).toBeUndefined();
    js.start(7, 3, 12345);
    expect(js.meta().bestScore).toBe(12345);
    expect(js.cells()).toEqual(new Game2048(mulberry32(7)).cells);
    js.start(8, 4, 12345);
    expect(js.cells()).toEqual(new Game2048(mulberry32(8)).cells);
    expect(js.meta().score).toBe(0);
    // 途中の盤は保存しない（localStorage を使わない）
    expect(fs.readFileSync(path.join(DIR, 'va_bridge.js'), 'utf8')).not.toMatch(/localStorage/);
    expect(fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8')).not.toMatch(/local_storage_manager/);
  });
});
