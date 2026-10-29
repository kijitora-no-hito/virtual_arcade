// サーバ ⇄ クライアントの型（REST の応答・WebSocket のメッセージ）。

import type { BgmMeta } from './bgm';
import type { BadgeMode, CraneMachineView, CraneOutcome, Suit } from './crane';
import type { NoteView } from './notes';
import type { PosterView } from './posters';
import type { ReservationView, RoomId } from './rooms';
import type { Point } from './floor';
import type { Emote, Look, Stance } from './looks';

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
  /** v0.5.0：予約部屋の主催者（いまの予約を予約した人。予約部屋の中だけ）。名前の前に「主催」 */
  host?: boolean;
  /** v0.6.0：遊んでいるゲーム（ゲームの窓を開いている間。頭上の名前の横に 🎮）。null / 無し = 遊んでいない */
  playing?: string | null;
  /** v0.6.0：ポーズ（ベガ立ち = 腕を組む。動くまで続く）。null / 無し = ふつう */
  stance?: Stance | null;
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
  /** v0.5.0：予約部屋の主催者の発言 */
  host?: boolean;
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
  /** v0.5.0：部屋ごとの人数 */
  onlineByRoom?: Record<RoomId, number>;
  /** v0.5.0：予約部屋の予約の決まり（DESIGN §14） */
  reservations?: {
    slotMs: number;
    maxTotalMs: number;
    aheadMs: number;
    limits: Record<string, number>;
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

/** GET /api/reservations（v0.5.0。誰でも読める。合言葉・ハッシュは載せない） */
export interface ReservationsResponse {
  reservations: ReservationView[];
  serverNow: number;
  /** いま使っている予約の id（無ければ null） */
  activeId: number | null;
  /** 鍵を付けて読んだとき：その人があと予約できる時間（ms）。入室したことが無ければ null */
  myLeftMs: number | null;
}

/** POST /api/rooms/:room/enter（v0.5.0） */
export interface RoomEnterResponse {
  room: RoomId;
  /** 店内にいたので、その場で部屋を移した（WebSocket に新しい welcome が届く） */
  moved: boolean;
  reservation: ReservationView | null;
}

// ---------------------------------------------------------------- ゲーム筐体とランキング（v0.6.0。DESIGN §16）

/** ランキングの 1 行（鍵ごとのいちばん良い記録。名前はその記録を出したときのもの） */
export interface RankingEntry {
  /** 記録の id（管理者が消すとき） */
  id: number;
  rank: number;
  name: string;
  score: number;
  maxTile: number;
  at: number;
}

/** POST /api/games/:game/start */
export interface GameStartResponse {
  /** このゲームのセッション（finish で返す） */
  session: string;
  /** 32 bit の種（盤の乱数） */
  seed: number;
  /** サーバに記録された自分のベスト（無ければ 0） */
  best: number;
}

/** POST /api/games/:game/finish */
export interface GameFinishResponse {
  /** 記録した（点数が 0 なら記録しない） */
  recorded: boolean;
  /** サーバがなぞり直した点数・いちばん大きいタイル・手の数 */
  score: number;
  maxTile: number;
  moves: number;
  /** 記録のあとの自分のベスト・今回で更新したか */
  best: number;
  newBest: boolean;
  /** 自分の順位（自己ベストで。入っていなければ null） */
  rank: { all: number | null; month: number | null };
}

/** GET /api/games/:game/ranking?period=all|month */
export interface RankingResponse {
  period: 'all' | 'month';
  /** 上位（50 人まで） */
  entries: RankingEntry[];
  /** 自分（鍵を付けて読んだとき。記録が無ければ null） */
  me: RankingEntry | null;
  /** 記録のある人の数 */
  total: number;
}

export interface MeResponse {
  profile: Profile | null;
  /** 入室を止められている（その時刻まで） */
  bannedUntil?: number;
}

// ---------------------------------------------------------------- WebSocket

export type ClientMessage =
  /** proto = PROTOCOL（v0.5.0 から。無ければ古いクライアントとして再読み込みを頼む）・v = クライアントの版・room = 入りたい部屋 */
  | { type: 'hello'; key: string; proto?: number; v?: string; room?: RoomId }
  | { type: 'goto'; x: number; y: number }
  | { type: 'emote'; emoji: Emote }
  | { type: 'watch'; cabinet: number | null }
  /** v0.6.0：ゲームの窓を開いた（game）・閉じた（null）。頭上の 🎮 */
  | { type: 'play'; game: string | null }
  /** v0.6.0：ポーズ（ベガ立ち）を付ける・外す（null）。歩くと外れる */
  | { type: 'stance'; stance: Stance | null };

export interface WelcomeMessage {
  type: 'welcome';
  /** v0.5.0：いまいる部屋（部屋を移ったときもこの welcome が届く） */
  room: RoomId;
  /** サーバの版（クライアントの版と違えば「再読み込みしてください」） */
  version: string;
  /** 予約の一覧（これからの分。誰でも見られる） */
  reservations: ReservationView[];
  /** 部屋を移された理由（予約の時間が終わった など）。画面に一度だけ出す */
  reason?: string;
  you: Profile;
  serverNow: number;
  players: PlayerView[];
  cabinets: CabinetView[];
  chat: ChatMessage[];
  notices: Notice[];
  posters: PosterView[];
  maxPlayers: number;
  /** v0.6.0：ゲームごとのランキングの上位（立て看板に描く。総合の上位 5 人） */
  rankings?: Record<string, RankingEntry[]>;
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
  /** v0.5.0：予約の一覧が変わった（全部の部屋の全員へ） */
  | { type: 'reservations'; reservations: ReservationView[] }
  /** v0.4.0：ノートに書かれた・消された（total = 全体の件数） */
  | { type: 'note'; note: NoteView; total: number }
  | { type: 'note-delete'; id: number; total: number }
  /** v0.4.0：要望の未読の件数（店内にいる管理者にだけ。added = 新しく届いた） */
  | { type: 'requests'; unread: number; added?: boolean }
  /** v0.6.0：ランキングの上位が変わった（全部の部屋の全員へ） */
  | { type: 'ranking'; game: string; top: RankingEntry[] }
  /** 退店した（このタブはつなぎ直さない） */
  | { type: 'bye' }
  | { type: 'you'; you: Profile }
  | { type: 'kicked'; reason: string; until?: number }
  | { type: 'error'; error: string; code?: string }
  /** serverNow（v0.5.0）：時計の差を合わせ直す（予約部屋の残り時間） */
  | { type: 'pong'; serverNow?: number };
