// サーバ ⇄ クライアントの型（REST の応答・WebSocket のメッセージ）。

import type { BgmMeta } from './bgm';
import type { BadgeMode, CraneMachineView, CraneOutcome, Suit } from './crane';
import type { NoteView } from './notes';
import type { PosterView } from './posters';
import type { ReservationView, RoomId } from './rooms';
import type { Point } from './floor';
import type { Emote, Look, Stance } from './looks';
import type { SpectateInfo } from './spectate';
import type { SlotBonus, SlotRole } from './slot';

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
  /** v0.6.0：遊んでいるゲーム（ゲームの窓を開いている間。頭上の名前の横に 🎮。v0.7.0：'slot' はスロットの窓で 🎰）。null / 無し = 遊んでいない */
  playing?: string | null;
  /** v0.6.0：ポーズ（ベガ立ち = 腕を組む。動くまで続く）。null / 無し = ふつう */
  stance?: Stance | null;
  /** v0.6.0：遊んでいるゲームを見ている人数（観戦。DESIGN §16.10。0 なら無し） */
  viewers?: number;
  /** v0.6.0：観戦を許可していない（窓の［観戦を許可］を切った） */
  noSpectate?: boolean;
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
  /** v0.7.0：スロットのコイン（自分だけに見える。ほかの人には送らない。DESIGN §17） */
  coins?: number;
}

export interface MetaResponse {
  version: string;
  maxPlayers: number;
  online: number;
  cabinetTtlMs: number;
  /** v0.7.0：1 人が同時に持てる（配信を登録できる）筐体の数（部屋ごと） */
  cabinetMaxPerUser?: number;
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

// ---------------------------------------------------------------- スロットマシンとコイン（v0.7.0。DESIGN §17）

/** POST /api/slot/:id/spin（と、GET の pending） */
export interface SlotSpinResponse {
  spinId: string;
  /** この回に揃えられる役（すべりの計算に使う。null = はずれ） */
  flag: SlotRole | null;
  /** 持ち越しているボーナス（内部中。リールが全部止まったら LUCKY ランプを光らせる） */
  internal: SlotBonus | null;
  /** 掛けたあとのコイン */
  coins: number;
  /** 掛けた枚数（リプレイの次の回は 0） */
  bet: number;
}

/** POST /api/slot/:id/stop */
export interface SlotStopResponse {
  /** 止まった位置（中段のコマの番号。左・中・右） */
  reels: number[];
  /** 揃った役（null = はずれ） */
  win: SlotRole | null;
  payout: number;
  coins: number;
  /** 止まったあとの内部中のボーナス（揃えたら null） */
  bonus: SlotBonus | null;
  /** 次の回はリプレイ（掛けずに回せる） */
  replay: boolean;
}

/** GET /api/slot/:id */
export interface SlotStateResponse {
  coins: number;
  badges: string;
  /** 内部中のボーナス（LUCKY ランプ） */
  bonus: SlotBonus | null;
  replay: boolean;
  /** 止めていない回（再読み込みなど。続きを止められる） */
  pending: SlotSpinResponse | null;
  /** 次に回せる時刻（サーバの時刻） */
  nextAt: number;
  serverNow: number;
}

/** POST /api/slot/deposit（手元のコインを全部預ける。v0.7.0） */
export interface SlotDepositResponse {
  /** 預かりのキー（アルファベット大文字 4 文字。引き出すときに入れる。1 回だけ使える） */
  code: string;
  /** 預けた枚数 */
  deposited: number;
  /** 預けたあとの手元のコイン（0） */
  coins: number;
  /** この時刻を過ぎると預けたものは消える */
  expiresAt: number;
}

/** POST /api/slot/withdraw {code} */
export interface SlotWithdrawResponse {
  /** 引き出した枚数 */
  withdrawn: number;
  /** 引き出したあとの手元のコイン */
  coins: number;
}

/** POST /api/slot/exchange {suit} */
export interface SlotExchangeResponse {
  coins: number;
  badges: string;
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
  /** 2048 のいちばん大きいタイル（ほかのゲームは 0） */
  maxTile: number;
  at: number;
  /** ゲームごとの中身（Columns like game：開始レベル・終わりのレベル・消したジュエルの数） */
  detail?: GameDetail;
}

/** 記録のゲームごとの中身（v0.6.0。DESIGN §16.8・§16.9） */
export interface GameDetail {
  startLevel?: number;
  level?: number;
  jewels?: number;
  /** Hextris：いちばん大きいコンボの倍率・消したブロックの数 */
  combo?: number;
  blocks?: number;
}

/** POST /api/games/:game/start（Columns like game は body に options） */
export interface GameStartResponse {
  /** このゲームのセッション（finish で返す） */
  session: string;
  /** 32 bit の種（盤の乱数） */
  seed: number;
  /** サーバに記録された自分のベスト（無ければ 0） */
  best: number;
  /** 練習（ランキングに載らない設定。finish しても記録しない） */
  practice?: boolean;
  /** サーバが受け付けた設定（Columns like game） */
  options?: { mode: number; colors: number; height: number; start: number };
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
  /** 練習の設定だった（記録しない） */
  practice?: boolean;
  /** ゲームごとの中身（Columns like game） */
  detail?: GameDetail;
  /** v0.7.0：このゲームでもらえたスロットのコイン（DESIGN §17.9） */
  coins?: GameCoinsResult;
}

/** v0.7.0：ゲームでもらえたスロットのコイン（gained = 手元に足した数・total = 足したあとの手元） */
export interface GameCoinsResult {
  gained: number;
  total: number;
  /** 1 時間の上限で減った（0 枚になったときも） */
  capped?: boolean;
  /** 0 枚・減ったわけ：low = 点数が少ない（min 点から）・practice = 練習・hour = 1 時間の上限・full = 手元が上限・off = ゲームではもらえない設定 */
  reason?: 'low' | 'practice' | 'hour' | 'full' | 'off';
  /** この点数から GAME_COIN_MIN 枚（reason = low のとき） */
  min?: number;
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
  | { type: 'stance'; stance: Stance | null }
  // ---- v0.6.0：観戦（DESIGN §16.10）
  /** 見る人：pid の人のプレイを見る（null でやめる） */
  | { type: 'spectate'; pid: string | null }
  /** 遊ぶ人：観戦を許可する・しない */
  | { type: 'spectate-allow'; allow: boolean }
  /** 遊ぶ人（Columns like game・Hextris）：画面を縮めた画像（data URL）と添える文字。見る人がいるときだけ */
  | { type: 'spec-frame'; image: string; info?: SpectateInfo }
  /** 遊ぶ人（2048）：今のゲームの手をまとめて（session = 今のセッション。長すぎれば moves = null） */
  | { type: 'spec-sync'; session: string; moves: string | null; score?: number }
  /** 遊ぶ人（2048）：続きの手（from = それまでの手の数） */
  | { type: 'spec-moves'; session: string; from: number; moves: string; score?: number }
  /** 遊ぶ人：状態（ゲームオーバー・一時停止など）と点数 */
  | { type: 'spec-state'; info: SpectateInfo };

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
  /** v0.6.0：ゲームごとのランキングの上位（壁のランキングのポスターに描く。総合の上位 5 人） */
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
  | { type: 'pong'; serverNow?: number }
  // ---- v0.6.0：観戦（DESIGN §16.10）
  /** 遊ぶ人へ：見ている人数・許可しているか。sync = 2048 の手をまとめて送ってほしい */
  | { type: 'spectators'; viewers: number; allow: boolean; sync?: boolean }
  /** 見る人へ：見始めた */
  | { type: 'spec-start'; pid: string; name: string; game: string }
  /** 見る人へ（2048）：reset = 種から始め直してから moves をなぞる。そうでなければ from 手目からの続き */
  | { type: 'spec-2048'; pid: string; reset: boolean; seed?: number; from: number; moves: string; score?: number }
  /** 見る人へ：2048 が長すぎて途中からは見られない */
  | { type: 'spec-unavailable'; pid: string; reason: string }
  /** 見る人へ（Columns like game・Hextris）：画像 */
  | { type: 'spec-frame'; pid: string; image: string; info?: SpectateInfo }
  /** 見る人へ：状態（ゲームオーバー・新しいゲーム・一時停止）と点数 */
  | { type: 'spec-info'; pid: string; info: SpectateInfo }
  /** 見る人へ：見るのが終わった（遊ぶ人が閉じた・部屋を移った・切れた・許可を切った）。score = 最後の点数 */
  | { type: 'spec-end'; pid: string; name: string; reason: string; score: number | null };
