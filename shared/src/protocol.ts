// サーバ ⇄ クライアントの型（REST の応答・WebSocket のメッセージ）。

import type { BgmMeta } from './bgm';
import type { BadgeMode, CraneMachineView, CraneOutcome, Suit } from './crane';
import type { NoteView } from './notes';
import type { PosterView } from './posters';
import type { Point } from './floor';
import type { Emote, Look } from './looks';

/** ほかの人に見える人の情報（鍵・ハッシュは載せない。pid は公開 ID） */
export interface PlayerView {
  pid: string;
  name: string;
  look: Look;
  /** 歩く経路（path[0] を startedAt に出る）。止まっているときは 1 マス */
  path: Point[];
  /** サーバの時刻（ms） */
  startedAt: number;
  /** 視聴中の筐体（その前に座っている）。null = 立っている */
  watching: number | null;
  admin: boolean;
  /** クレーンゲームのバッジ（♠♡♦♧ の順。名前の後ろに付ける） */
  badges: string;
  /** ピン止めした自分の発言（頭上に出しっぱなしの吹き出し）。1 人 1 つ */
  pinned: PinnedChat | null;
}

export interface PinnedChat {
  /** チャットの発言の id */
  id: number;
  text: string;
}

/** 筐体の公開情報（持ち主の鍵は載せない） */
export interface CabinetView {
  id: number;
  owned: boolean;
  ownerName: string | null;
  ownerPid: string | null;
  videoId: string | null;
  live: boolean;
  url: string | null;
  eventName: string;
  gameName: string;
  playerName: string;
  note: string;
  updatedAt: number;
  /** 自動で空きに戻る時刻（何も設定されていなければ null） */
  expiresAt: number | null;
}

export type ChatKind = 'user' | 'system' | 'notice';

export interface ChatMessage {
  id: number;
  at: number;
  kind: ChatKind;
  pid: string | null;
  name: string | null;
  text: string;
  /** 発言したときのバッジ（名前の後ろに付ける） */
  badges?: string;
}

export interface Notice {
  id: number;
  at: number;
  text: string;
}

export interface Profile {
  pid: string;
  name: string;
  look: Look;
  admin: boolean;
  /** クレーンゲームのバッジ */
  badges: string;
}

export interface MetaResponse {
  version: string;
  maxPlayers: number;
  online: number;
  cabinetTtlMs: number;
  adminEnabled: boolean;
  limits: {
    name: number;
    chat: number;
    notice: number;
    promo: Record<string, number>;
  };
  /** 店内の BGM の差し替え（サーバの data/bgm/ に置いた音声ファイル）。無ければ合成の曲だけ */
  bgm: BgmMeta;
  crane: {
    cooldownMs: number;
    badgeMode: BadgeMode;
    stackMax: number;
    badgeKeepMs: number;
  };
  posters: {
    /** 書ける人（all = 店内の全員、admin = 管理者だけ） */
    who: 'all' | 'admin';
    maxPerUser: number;
    maxTotal: number;
    limits: Record<string, number>;
  };
}

/** GET /api/crane/:id */
export interface CraneStateResponse {
  machine: CraneMachineView;
  /** 次に遊べる時刻（サーバの時刻） */
  cooldownUntil: number;
  serverNow: number;
  badges: string;
}

/** POST /api/crane/:id/play */
export interface CranePlayResponse {
  outcome: CraneOutcome;
  /** アームを下ろした位置（サーバが 0〜1 に収めたもの） */
  arm: { x: number; z: number };
  capsuleId: number | null;
  grabAt: { x: number; z: number } | null;
  dropTo: { x: number; z: number } | null;
  /** 取れたカプセルの中身 */
  suit: Suit | null;
  /** 新しくバッジが付いた */
  gained: boolean;
  /** もう持っている（付かなかった） */
  duplicate: boolean;
  /** この 1 個で 4 種類そろった */
  completed: boolean;
  badges: string;
  cooldownUntil: number;
  serverNow: number;
  /** 判定のあとのケース（演出が終わったらこれに差し替える） */
  machine: CraneMachineView;
}

export interface MeResponse {
  profile: Profile | null;
  /** 入室を止められている（その時刻まで） */
  bannedUntil?: number;
}

// ---------------------------------------------------------------- WebSocket

export type ClientMessage =
  | { type: 'hello'; key: string }
  | { type: 'goto'; x: number; y: number }
  | { type: 'emote'; emoji: Emote }
  | { type: 'watch'; cabinet: number | null };

export interface WelcomeMessage {
  type: 'welcome';
  you: Profile;
  serverNow: number;
  players: PlayerView[];
  cabinets: CabinetView[];
  chat: ChatMessage[];
  notices: Notice[];
  posters: PosterView[];
  maxPlayers: number;
}

export type ServerMessage =
  | WelcomeMessage
  | { type: 'join'; player: PlayerView }
  | { type: 'leave'; pid: string }
  | { type: 'player'; player: PlayerView }
  | { type: 'move'; pid: string; path: Point[]; startedAt: number; watching: number | null }
  | { type: 'emote'; pid: string; emoji: Emote; at: number }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat-delete'; id: number }
  | { type: 'cabinet'; cabinet: CabinetView }
  | { type: 'notices'; notices: Notice[] }
  | { type: 'posters'; posters: PosterView[] }
  /** v0.4.0：ノートに書かれた・消された（total = 全体の件数） */
  | { type: 'note'; note: NoteView; total: number }
  | { type: 'note-delete'; id: number; total: number }
  /** v0.4.0：要望の未読の件数（店内にいる管理者にだけ。added = 新しく届いた） */
  | { type: 'requests'; unread: number; added?: boolean }
  /** 退店した（このタブはつなぎ直さない） */
  | { type: 'bye' }
  | { type: 'you'; you: Profile }
  | { type: 'kicked'; reason: string; until?: number }
  | { type: 'error'; error: string; code?: string }
  | { type: 'pong' };
