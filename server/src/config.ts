// 環境変数から読む設定。テストでは createServer の引数で上書きする。

import path from 'node:path';
import {
  DEFAULT_BADGE_KEEP_MS,
  DEFAULT_CABINET_TTL_MS,
  DEFAULT_CRANE_COOLDOWN_MS,
  DEFAULT_CRANE_ODDS,
  DEFAULT_POSTER_MAX_PER_USER,
  DEFAULT_POSTER_MAX_TOTAL,
  NOTE_MAX_TOTAL,
  REQUEST_MAX_TOTAL,
  type BadgeMode,
  type CraneOdds,
} from '@va/shared';
import { ROOT } from './paths';

export interface RateRule {
  /** 窓の中で許す回数 */
  limit: number;
  windowMs: number;
}

export interface Config {
  /** '' か '/arcade' のような形（末尾の / なし） */
  basePath: string;
  /** 同時に店内にいられる人数（管理者は数えるが、満員でも入れる） */
  maxPlayers: number;
  /** 筐体が最後の更新から自動で空きに戻るまで */
  cabinetTtlMs: number;
  /** 管理者の合言葉のハッシュ（scrypt:<塩>:<ハッシュ>。npm run hash-admin で作る）。null = 管理者なし */
  adminPassHash: string | null;
  /** 管理者になってから続く時間（同じブラウザなら再読み込みしても管理者のまま） */
  adminTtlMs: number;
  /** WebSocket 接続の上限（全体 / 同じ IP） */
  maxConnections: number;
  maxConnectionsPerIp: number;
  /** X-Forwarded-For を信頼するか（loopback = 直前の接続元が 127.0.0.1 / ::1 のときだけ、その 1 段だけ信頼） */
  trustProxy: 'loopback' | 'none';
  /** 回数制限（IP ごと。*Key は鍵ごと） */
  rates: {
    /** 初めての入室（名前を決める）。前に来たことのある人の入り直しは数えない */
    enter: RateRule;
    /** WebSocket の hello（再接続を含む） */
    hello: RateRule;
    chat: RateRule;
    chatKey: RateRule;
    api: RateRule;
    admin: RateRule;
    adminKey: RateRule;
    cabinetKey: RateRule;
    emoteKey: RateRule;
    /** クレーンゲームの API（鍵ごと。待ち時間とは別の守り） */
    craneKey: RateRule;
    /** ポスターを貼る・直す（鍵ごと） */
    posterKey: RateRule;
    /** ポスターを貼る（IP ごと） */
    poster: RateRule;
    /** チャットのピン止め（鍵ごと） */
    pinKey: RateRule;
    /** ノートに書く（鍵ごと / IP ごと） */
    noteKey: RateRule;
    note: RateRule;
    /** 要望を送る（鍵ごと / IP ごと） */
    requestKey: RateRule;
    request: RateRule;
    /** v0.5.0：予約する（鍵ごと / IP ごと） */
    reserveKey: RateRule;
    reserve: RateRule;
    /** v0.5.0：予約部屋の合言葉の間違い（鍵ごと / IP ごと。合ったときは数えない） */
    passKey: RateRule;
    pass: RateRule;
    /** v0.6.0：ゲームを始める（鍵ごと / IP ごと）・記録する（鍵ごと） */
    gameKey: RateRule;
    game: RateRule;
    gameFinishKey: RateRule;
  };
  /** サーバの版（welcome で返す。クライアントの版と違えば再読み込みを頼む） */
  version?: string;
  /** クレーンゲーム：1 回ごとの待ち時間 */
  craneCooldownMs: number;
  /** クレーンゲーム：つかめる確率 */
  craneOdds: CraneOdds;
  /** バッジ：unique = 4 種類を 1 つずつ、stack = 重ねて持てる */
  badgeMode: BadgeMode;
  /** バッジ：stack のときの 1 種類の上限 */
  badgeStackMax: number;
  /** バッジ：接続が切れてから消えるまで */
  badgeKeepMs: number;
  /** ポスター：書ける人 */
  posterWho: 'all' | 'admin';
  posterMaxPerUser: number;
  posterMaxTotal: number;
  /** ノート・要望の件数の上限（超えたら古いものから消す） */
  noteMaxTotal: number;
  requestMaxTotal: number;
  /** 乱数（テスト用に差し替える。既定 Math.random） */
  rng?: () => number;
  /** 店内の BGM の差し替え（音声ファイル mp3 / ogg / m4a と任意の bgm.json）を置くフォルダ。無ければ合成の曲だけ */
  bgmDir: string;
  /** 同じ鍵の発言の最短間隔 */
  chatMinIntervalMs: number;
  /** 同じ鍵のエモーションの最短間隔 */
  emoteMinIntervalMs: number;
  /** v0.5.1：チャットの発言を残す時間（これより古い行は消す。部屋ごと。件数の上限 CHAT_KEEP とは別） */
  chatTtlMs: number;
  /** 時計（テスト用に差し替える。既定 Date.now） */
  now?: () => number;
}

const int = (v: string | undefined, fb: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fb;
};

/** BASE_PATH を '' か '/xxx' の形にそろえる（'/', 'arcade/', '/arcade/' → '' / '/arcade' / '/arcade'） */
export const normalizeBasePath = (v: string | undefined): string => {
  const s = (v ?? '').trim().replace(/\/+$/, '').replace(/^\/*/, '');
  if (!s) return '';
  if (!/^[A-Za-z0-9._~\-/]+$/.test(s) || s.split('/').some((p) => !p || p === '.' || p === '..'))
    throw new Error(`BASE_PATH が不正です: ${v}`);
  return `/${s}`;
};

/** 管理者の合言葉のハッシュの形（scrypt:<塩 base64url>:<ハッシュ base64url>） */
export const ADMIN_HASH_RE = /^scrypt:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}$/;

export const defaultConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const h = (env.ADMIN_PASS_HASH ?? '').trim();
  if (h && !ADMIN_HASH_RE.test(h)) throw new Error('ADMIN_PASS_HASH の形が不正です（npm run hash-admin で作った scrypt:… の文字列）');
  return {
    basePath: normalizeBasePath(env.BASE_PATH),
    maxPlayers: int(env.MAX_PLAYERS, 50, 1, 1000),
    cabinetTtlMs: env.CABINET_TTL_HOURS
      ? int(env.CABINET_TTL_HOURS, 6, 1, 24 * 30) * 60 * 60 * 1000
      : DEFAULT_CABINET_TTL_MS,
    adminPassHash: h || null,
    adminTtlMs: int(env.ADMIN_TTL_HOURS, 12, 1, 24 * 30) * 60 * 60 * 1000,
    maxConnections: int(env.MAX_CONNECTIONS, 300, 10, 100000),
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 10, 1, 100000),
    trustProxy: env.TRUST_PROXY === 'none' ? 'none' : 'loopback',
    rates: {
      enter: { limit: 20, windowMs: 60 * 1000 },
      hello: { limit: 60, windowMs: 60 * 1000 },
      chat: { limit: 20, windowMs: 60 * 1000 },
      chatKey: { limit: 6, windowMs: 15 * 1000 },
      api: { limit: 600, windowMs: 60 * 1000 },
      admin: { limit: 5, windowMs: 10 * 60 * 1000 },
      adminKey: { limit: 5, windowMs: 10 * 60 * 1000 },
      cabinetKey: { limit: 20, windowMs: 60 * 1000 },
      emoteKey: { limit: 8, windowMs: 20 * 1000 },
      craneKey: { limit: 60, windowMs: 60 * 1000 },
      posterKey: { limit: 6, windowMs: 10 * 60 * 1000 },
      poster: { limit: 10, windowMs: 10 * 60 * 1000 },
      pinKey: { limit: 10, windowMs: 60 * 1000 },
      noteKey: { limit: 3, windowMs: 10 * 60 * 1000 },
      note: { limit: 10, windowMs: 10 * 60 * 1000 },
      requestKey: { limit: 5, windowMs: 60 * 60 * 1000 },
      request: { limit: 10, windowMs: 60 * 60 * 1000 },
      reserveKey: { limit: 6, windowMs: 60 * 60 * 1000 },
      reserve: { limit: 12, windowMs: 60 * 60 * 1000 },
      passKey: { limit: 5, windowMs: 10 * 60 * 1000 },
      pass: { limit: 20, windowMs: 10 * 60 * 1000 },
      gameKey: { limit: 20, windowMs: 60 * 1000 },
      game: { limit: 60, windowMs: 60 * 1000 },
      gameFinishKey: { limit: 20, windowMs: 60 * 1000 },
    },
    craneCooldownMs: env.CRANE_COOLDOWN_SEC ? int(env.CRANE_COOLDOWN_SEC, 20, 1, 3600) * 1000 : DEFAULT_CRANE_COOLDOWN_MS,
    craneOdds: {
      ...DEFAULT_CRANE_ODDS,
      maxChance: env.CRANE_MAX_CHANCE ? int(env.CRANE_MAX_CHANCE, 65, 5, 100) / 100 : DEFAULT_CRANE_ODDS.maxChance,
    },
    badgeMode: env.BADGE_MODE === 'stack' ? 'stack' : 'unique',
    badgeStackMax: int(env.BADGE_STACK_MAX, 3, 1, 9),
    badgeKeepMs: env.BADGE_KEEP_MIN ? int(env.BADGE_KEEP_MIN, 30, 1, 24 * 60) * 60 * 1000 : DEFAULT_BADGE_KEEP_MS,
    posterWho: env.POSTER_WHO === 'admin' ? 'admin' : 'all',
    posterMaxPerUser: int(env.POSTER_MAX_PER_USER, DEFAULT_POSTER_MAX_PER_USER, 1, 20),
    posterMaxTotal: int(env.POSTER_MAX_TOTAL, DEFAULT_POSTER_MAX_TOTAL, 1, 500),
    noteMaxTotal: int(env.NOTE_MAX_TOTAL, NOTE_MAX_TOTAL, 10, 100000),
    requestMaxTotal: int(env.REQUEST_MAX_TOTAL, REQUEST_MAX_TOTAL, 10, 100000),
    bgmDir: env.BGM_DIR ? path.resolve(env.BGM_DIR) : path.join(ROOT, 'data', 'bgm'),
    chatMinIntervalMs: 1000,
    emoteMinIntervalMs: 800,
    chatTtlMs: int(env.CHAT_TTL_HOURS, 24, 1, 24 * 365) * 60 * 60 * 1000,
  };
};
