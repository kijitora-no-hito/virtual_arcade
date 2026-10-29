// ゲームの記録をなぞり直して点数を決める（v0.6.0。DESIGN §16.3・§16.8・§16.9）。ゲームごとに違う所はここに集める
// （サーバの finish はこれを呼ぶだけ。クライアントの言う点数は使わない）。

import { COLUMNS_PLACE_MIN_MS, isRankedColumns, parseColumnsOptions, replayColumns, type ColumnsOptions } from './columns';
import { countMoves, MOVES_RE, replay2048 } from './game2048';
import { GAME_MAX_MOVES, GAME_MOVE_MIN_MS } from './games';
import { checkHextris } from './hextris';
import type { GameDetail } from './protocol';

/** start のときに決める設定（2048 は無し。Columns like game はオプション） */
export type GameOptions = ColumnsOptions | null;

/** start の options を読む。形が違えば undefined（bad-input）。practice = 練習（ランキングに載らない設定） */
export const parseGameOptions = (game: string, raw: unknown): { options: GameOptions; practice: boolean } | undefined => {
  if (game === 'columns') {
    const o = parseColumnsOptions(raw);
    return o ? { options: o, practice: !isRankedColumns(o) } : undefined;
  }
  return { options: null, practice: false };
};

export type GameRecordResult =
  | { ok: true; score: number; moves: number; maxTile: number; detail?: GameDetail }
  | { ok: false; code: 'bad-moves' | 'too-fast' };

/** Columns like game の経過秒の余裕（t は 1 から始まり 1 秒ごとに増える。ずれの分） */
const COLUMNS_T_SLACK = 3;

/**
 * finish の中身（body）をなぞり直す。elapsedMs = start からの実際の時間（速すぎる記録を断る）。
 * - 2048：body.moves = "0123K…"（盤が動いた手と Keep going）
 * - columns：body.moves = [[x, rot, bonus, t], …]（置いたピース）・body.over = [x, bonus]（ゲームオーバーの最後のピース。途中でやめたら無し）
 * - hextris：body.score（ブラウザの言う点数）・body.clears = [[k, m], …]（消した数・コンボの倍率）。なぞり直さず、点の入り方の決まりと速さだけを見る（hextris.ts）
 */
export const checkGameRecord = (game: string, seed: number, options: GameOptions, body: Record<string, unknown>, elapsedMs: number): GameRecordResult => {
  if (game === '2048') {
    const moves = body.moves;
    if (typeof moves !== 'string' || moves.length > GAME_MAX_MOVES + 1 || !MOVES_RE.test(moves)) return { ok: false, code: 'bad-moves' };
    const n = countMoves(moves);
    if (n > GAME_MAX_MOVES) return { ok: false, code: 'bad-moves' };
    // 速さを見てからなぞり直す（でたらめな長い並びを速く断る）
    if (elapsedMs < n * GAME_MOVE_MIN_MS) return { ok: false, code: 'too-fast' };
    const r = replay2048(seed, moves);
    if (!r.ok) return { ok: false, code: 'bad-moves' };
    return { ok: true, score: r.score, moves: n, maxTile: r.maxTile };
  }
  if (game === 'columns') {
    const moves = body.moves;
    if (!Array.isArray(moves)) return { ok: false, code: 'bad-moves' };
    if (elapsedMs < moves.length * COLUMNS_PLACE_MIN_MS) return { ok: false, code: 'too-fast' };
    const start = options && 'start' in options ? options.start : 1;
    const r = replayColumns(seed, start, moves, body.over);
    if (!r.ok) return { ok: false, code: 'bad-moves' };
    // 経過秒は実際の時間を超えない（マジックジュエルが出るかに効く）
    if (r.maxT > 1 + Math.floor(elapsedMs / 1000) + COLUMNS_T_SLACK) return { ok: false, code: 'too-fast' };
    return { ok: true, score: r.score, moves: r.pieces, maxTile: 0, detail: { startLevel: start, level: r.level, jewels: r.jewels } };
  }
  if (game === 'hextris') {
    const r = checkHextris(body.score, body.clears, elapsedMs);
    if (!r.ok) return r;
    return { ok: true, score: r.score, moves: r.clears, maxTile: 0, detail: { combo: r.maxCombo, blocks: r.blocks } };
  }
  return { ok: false, code: 'bad-moves' };
};
