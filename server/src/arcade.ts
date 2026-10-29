// 店の状態（店内にいる人・筐体・チャット・お知らせ）と操作。HTTP・WebSocket からは app.ts が呼ぶ。
// 人の位置はサーバが持つ（経路と出発時刻。歩いている途中の位置は positionAt で同じ式を使って求める）。
// v0.5.0：部屋が 2 つ（オープン部屋・予約部屋。DESIGN §14）。人・チャット・お知らせ・筐体・クレーンゲームは部屋ごと、
// ノート・要望・ポスター・バッジは店全体で 1 つ。

import crypto from 'node:crypto';
import {
  checkGameRecord,
  formatScore,
  GAME_NEAR,
  GAME_SESSION_TTL_MS,
  GAMES,
  gameInfo,
  gameSpots,
  isGameId,
  isRankingPeriod,
  jstMonthStart,
  RANKING_ANNOUNCE,
  RANKING_LIST_MAX,
  RANKING_POSTER_TOP,
  parseGameOptions,
  type GameOptions,
  type GameFinishResponse,
  type GameStartResponse,
  type RankingEntry,
  type RankingResponse,
  activeReservation,
  checkReservationPass,
  closedRoomText,
  doorFront,
  formatReservationRange,
  isRoomId,
  jstTime,
  overlaps,
  RESERVATION_KEEP_MS,
  RESERVATION_KEY_TOTAL_MS,
  RESERVATION_MAX_ROWS,
  RESERVATION_WARN_MS,
  reservedTotalMs,
  ROOM_IDS,
  validateReservation,
  type ReservationsResponse,
  type ReservationView,
  type RoomEnterResponse,
  type RoomId,
  NOTE_FETCH,
  validateNote,
  validateRequest,
  isRequestStatus,
  type NoteView,
  type NotesResponse,
  type RequestView,
  type RequestsResponse,
  addBadge,
  applyCabinetInput,
  CRANE_NEAR,
  craneSpot,
  formatPosterRange,
  machineView,
  newMachine,
  normalizeArm,
  resolveCrane,
  sortPosters,
  validatePoster,
  type CraneMachine,
  type CranePlayResponse,
  type CraneStateResponse,
  type PinnedChat,
  type PosterView,
  cabinetDistance,
  cabinetSpot,
  CHAT_MAX,
  checkName,
  claimCabinet,
  claimError,
  currentTile,
  emptyCabinet,
  expireCabinets,
  findPath,
  FLOOR,
  frontTile,
  hasNgWord,
  isBlank,
  isEmote,
  isLook,
  isStance,
  type Stance,
  isPassable,
  NOTICE_MAX,
  charLength,
  releaseCabinet,
  tidy,
  validateCabinetInput,
  type CabinetRecord,
  type CabinetView,
  type ChatKind,
  type ChatMessage,
  type Emote,
  type Look,
  type Notice,
  type PlayerView,
  type Point,
  type Profile,
  type ServerMessage,
  type WelcomeMessage,
} from '@va/shared';
import type { Config } from './config';
import type { GameScoreRow, PosterRow, ReservationRow, Store, UserRow } from './db';
import { dbRoomData, MemRoomData, type RoomData } from './roomData';
import { checkPassphrase, hashPassphrase, newPid } from './secret';

export class ArcadeError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

interface Online {
  keyHash: string;
  pid: string;
  name: string;
  look: Look;
  path: Point[];
  startedAt: number;
  watching: number | null;
  /** v0.5.0：いる部屋 */
  room: RoomId;
  /** v0.6.0：遊んでいるゲーム（ゲームの窓を開いている間。頭上の 🎮） */
  playing: string | null;
  /** v0.6.0：ポーズ（ベガ立ち）。動く（歩く・座る・ゲームを始める・部屋を移る）と外れる。メモリだけ */
  stance: Stance | null;
}

/** v0.6.0：始めたゲーム（鍵ごとに 1 つ。メモリだけ。1 回だけ記録に使える） */
interface GameSession {
  id: string;
  game: string;
  seed: number;
  startedAt: number;
  /** 始めたときの設定（Columns like game のオプション。2048 は null） */
  options: GameOptions;
  /** 練習（ランキングに載らない設定。記録しない） */
  practice: boolean;
}

/** 部屋ごとの状態（v0.5.0。DESIGN §14）：チャット・お知らせ・筐体・クレーンゲームのケースと待ち時間 */
interface RoomState {
  id: RoomId;
  data: RoomData;
  cabinets: CabinetRecord[];
  /** クレーンゲームのケース（台ごと。メモリだけ） */
  machines: Map<number, CraneMachine>;
  /** クレーンゲームの次に遊べる時刻（鍵ごと） */
  craneNext: Map<string, number>;
}

export interface Hooks {
  /** room の部屋にいる全員へ（room を省くと全部の部屋の全員へ） */
  broadcast: (msg: ServerMessage, room?: RoomId) => void;
  /** 1 人へ（その鍵の接続） */
  send: (keyHash: string, msg: ServerMessage) => void;
  /** その鍵の接続を切る（msg を送ってから） */
  drop: (keyHash: string, msg: ServerMessage) => void;
}

/** 入室の停止の上限（分）= 7 日 */
export const MAX_BAN_MINUTES = 7 * 24 * 60;

/** バッジとピン止めの発言（メモリだけ。退店・切断から badgeKeepMs・再起動で消える） */
interface BadgeHold {
  badges: string;
  pinned: PinnedChat | null;
  /** 接続が切れた時刻（店内にいる間は null） */
  offSince: number | null;
}

/** 予約の時間が終わって（取り消されて）オープン部屋へ戻したときの文 */
export const ROOM_ENDED_TEXT = '予約の時間が終わったので、オープン部屋に戻りました';
export const ROOM_CANCELLED_TEXT = '予約が取り消されたので、オープン部屋に戻りました';
export const ROOM_CLOSED_BY_HOST_TEXT = '主催者が予約部屋を閉じたので、オープン部屋に戻りました';
export const ROOM_REMOVED_TEXT = '主催者により、オープン部屋に戻されました（この予約の間は予約部屋に入れません）';

export class Arcade {
  private online = new Map<string, Online>();
  private rooms: Record<RoomId, RoomState>;
  private hooks: Hooks = { broadcast: () => {}, send: () => {}, drop: () => {} };
  private now: () => number;
  private rng: () => number;
  private badges = new Map<string, BadgeHold>();
  /** ノートに書いたことをチャットに流した時刻（鍵ごと。控えめにするため） */
  private noteAnnounced = new Map<string, number>();
  /** v0.5.0：まだ終わっていない予約（DB の写し。開始の順） */
  private reservations: ReservationRow[] = [];
  /** 予約部屋がいま開いている予約の id と、終わる前の案内を出したしきい値 */
  private slot: { id: number | null; warned: Set<number> } = { id: null, warned: new Set() };
  /** 合言葉を入れて予約部屋に入れるようになった鍵 → その予約の id（予約の時間が終わると消える。メモリだけ） */
  private grants = new Map<string, number>();
  /** 次に予約部屋を閉じるときの理由（取り消したとき） */
  private closeReason: string | null = null;
  /** 主催者に予約部屋から出された鍵（この予約の間は入れない。予約が終わると消える） */
  private roomBans = new Set<string>();
  /** v0.6.0：始めたゲーム（鍵 → セッション。再起動で消える） */
  private gameSessions = new Map<string, GameSession>();

  constructor(
    private store: Store,
    private cfg: Config,
  ) {
    this.now = cfg.now ?? Date.now;
    this.rng = cfg.rng ?? Math.random;
    this.rooms = {
      open: this.newRoom('open', dbRoomData(store)),
      reserved: this.newRoom('reserved', new MemRoomData()),
    };
    this.reservations = store.listReservations(this.now());
    this.slot = { id: activeReservation(this.reservations, this.now())?.id ?? null, warned: new Set() };
  }

  private newRoom(id: RoomId, data: RoomData): RoomState {
    const saved = new Map(data.loadCabinets().map((c) => [c.id, c]));
    const cabinets = FLOOR.cabinets.map((s) => {
      const c = saved.get(s.id);
      return c ? { ...emptyCabinet(s.id), ...c, id: s.id } : emptyCabinet(s.id);
    });
    return { id, data, cabinets, machines: new Map(), craneNext: new Map() };
  }

  private room(id: RoomId): RoomState {
    return this.rooms[id];
  }

  /** その鍵の人がいる部屋（店内にいなければオープン部屋） */
  roomOf(keyHash: string | null): RoomId {
    return (keyHash && this.online.get(keyHash)?.room) || 'open';
  }

  private inRoom(room: RoomId): Online[] {
    return [...this.online.values()].filter((p) => p.room === room);
  }

  setHooks(h: Hooks): void {
    this.hooks = h;
  }

  // ---------------------------------------------------------------- 表示用

  private playerView(p: Online): PlayerView {
    return {
      pid: p.pid,
      name: p.name,
      look: p.look,
      path: p.path,
      startedAt: p.startedAt,
      watching: p.watching,
      admin: this.isAdmin(p.keyHash),
      badges: this.badgesOf(p.keyHash),
      pinned: this.badges.get(p.keyHash)?.pinned ?? null,
      ...(p.room === 'reserved' && this.isRoomHost(p.keyHash) ? { host: true } : {}),
      ...(p.playing ? { playing: p.playing } : {}),
      ...(p.stance ? { stance: p.stance } : {}),
    };
  }

  /** 予約部屋の主催者か（いま開いている予約を予約した鍵。予約の時間の間だけ） */
  isRoomHost(keyHash: string | null): boolean {
    if (!keyHash || this.slot.id === null) return false;
    const r = this.reservations.find((x) => x.id === this.slot.id);
    return !!r && r.ownerKey === keyHash && r.startAt <= this.now() && this.now() < r.endAt;
  }

  /**
   * 部屋の管理の操作（発言・お知らせの削除、お知らせ、筐体を空ける、人を出す…）ができるか。
   * サイトの管理者はどの部屋でも。予約部屋の主催者は、その予約の時間に予約部屋の中にいるときだけ（オープン部屋・ほかの予約では何もできない）
   */
  private requireRoomPower(keyHash: string | null): { k: string; room: RoomId; admin: boolean } {
    const k = this.requireKey(keyHash);
    this.syncSlot();
    const room = this.roomOf(k);
    if (this.isAdmin(k)) return { k, room, admin: true };
    if (room === 'reserved' && this.isRoomHost(k)) return { k, room, admin: false };
    throw new ArcadeError(403, '管理者（予約部屋ではその予約の主催者）だけができる操作です', 'not-admin');
  }

  private hold(keyHash: string): BadgeHold {
    let h = this.badges.get(keyHash);
    if (!h) {
      h = { badges: '', pinned: null, offSince: this.online.has(keyHash) ? null : this.now() };
      this.badges.set(keyHash, h);
    }
    return h;
  }

  /** バッジもピン止めも無ければ消す */
  private tidyHold(keyHash: string): void {
    const h = this.badges.get(keyHash);
    if (h && !h.badges && !h.pinned) this.badges.delete(keyHash);
  }

  /** その鍵のバッジ（♠♡♦♧ の順） */
  badgesOf(keyHash: string | null): string {
    return (keyHash && this.badges.get(keyHash)?.badges) || '';
  }

  cabinetView(c: CabinetRecord): CabinetView {
    return {
      id: c.id,
      owned: !!c.ownerId,
      ownerName: c.ownerName,
      ownerPid: c.ownerPid,
      videoId: c.videoId,
      live: c.live,
      url: c.url,
      eventName: c.eventName,
      gameName: c.gameName,
      playerName: c.playerName,
      note: c.note,
      updatedAt: c.updatedAt,
      expiresAt: isBlank(c) ? null : c.updatedAt + this.cfg.cabinetTtlMs,
    };
  }

  private profileOf(u: UserRow): Profile {
    return { pid: u.pid, name: u.name, look: u.look, admin: u.admin_until > this.now(), badges: this.badgesOf(u.key_hash) };
  }

  // ---------------------------------------------------------------- 来た人・入室

  profile(keyHash: string | null): Profile | null {
    if (!keyHash) return null;
    const u = this.store.getUser(keyHash);
    return u ? this.profileOf(u) : null;
  }

  /** 入室を止められていればその時刻 */
  bannedUntil(keyHash: string | null): number | null {
    if (!keyHash) return null;
    const t = this.store.banUntil(keyHash);
    return t > this.now() ? t : null;
  }

  isAdmin(keyHash: string | null): boolean {
    if (!keyHash) return false;
    const u = this.store.getUser(keyHash);
    return !!u && u.admin_until > this.now();
  }

  isOnline(keyHash: string | null): boolean {
    return !!keyHash && this.online.has(keyHash);
  }

  /** 店内にいる人数（room を付けるとその部屋だけ） */
  onlineCount(room?: RoomId): number {
    return room ? this.inRoom(room).length : this.online.size;
  }

  onlineByRoom(): Record<RoomId, number> {
    return { open: this.inRoom('open').length, reserved: this.inRoom('reserved').length };
  }

  private requireKey(keyHash: string | null): string {
    if (!keyHash) throw new ArcadeError(401, '識別用の鍵がありません。ページを開き直してください', 'no-key');
    return keyHash;
  }

  private requireBanFree(keyHash: string): void {
    const until = this.bannedUntil(keyHash);
    if (until)
      throw new ArcadeError(403, `管理者により入室が止められています（${new Date(until).toLocaleString('ja-JP')} まで）`, 'banned');
  }

  /** 店内にいる人だけができる操作 */
  private requireOnline(keyHash: string | null): Online {
    const k = this.requireKey(keyHash);
    const p = this.online.get(k);
    if (!p) throw new ArcadeError(409, '先に入室してください（ページを開き直してください）', 'not-online');
    return p;
  }

  /** 名前と見た目を決めて入る（同じ鍵なら同じ人。名前・見た目を変えられる） */
  enter(keyHash: string | null, rawName: unknown, rawLook: unknown): Profile {
    const k = this.requireKey(keyHash);
    this.requireBanFree(k);
    const { name, error } = checkName(rawName);
    if (!name) throw new ArcadeError(400, error ?? '名前が不正です', 'bad-name');
    if (!isLook(rawLook)) throw new ArcadeError(400, '見た目の指定が不正です', 'bad-look');
    const look: Look = { color: rawLook.color, hat: rawLook.hat };
    const now = this.now();
    const old = this.store.getUser(k);
    if (!old && !this.online.has(k) && this.inRoom('open').length >= this.cfg.maxPlayers)
      throw new ArcadeError(503, `満員です（${this.cfg.maxPlayers} 人まで）。少し待ってから入ってください`, 'full');
    const u: UserRow = old
      ? { ...old, name, look, last_seen: now }
      : { key_hash: k, pid: newPid(), name, look, x: null, y: null, created_at: now, last_seen: now, admin_until: 0 };
    this.store.upsertUser(u);
    const p = this.online.get(k);
    if (p) {
      p.name = name;
      p.look = look;
      this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
      this.hooks.send(k, { type: 'you', you: this.profileOf(u) });
    }
    return this.profileOf(u);
  }

  /**
   * WebSocket がつながった。店内に入れて、最初の状態を返す（同じ部屋のほかの人には join）。
   * wantRoom = 'reserved' なら、予約部屋に入れる人（予約した人・管理者・この予約の合言葉を入れた人）は予約部屋へ。
   * 入れなければオープン部屋に入れて、reason に理由を書く。すでに店内にいる（別のタブ・再接続）なら、位置はそのまま。
   */
  connect(keyHash: string | null, wantRoom: unknown = 'open'): WelcomeMessage {
    const k = this.requireKey(keyHash);
    const u = this.store.getUser(k);
    if (!u) throw new ArcadeError(409, '先に名前と見た目を決めてください', 'need-enter');
    this.requireBanFree(k);
    this.syncSlot();
    const now = this.now();
    const want: RoomId = isRoomId(wantRoom) ? wantRoom : 'open';
    let reason: string | undefined;
    let room: RoomId = 'open';
    if (want === 'reserved') {
      const why = this.reservedRefusal(k);
      if (why) reason = `${why}（オープン部屋に入りました）`;
      else room = 'reserved';
    }
    const admin = this.isAdmin(k);
    let p = this.online.get(k);
    if (!p) {
      if (room === 'reserved' && this.inRoom('reserved').length >= this.cfg.maxPlayers && !admin) {
        reason = '予約部屋は満員です（オープン部屋に入りました）';
        room = 'open';
      }
      if (this.inRoom(room).length >= this.cfg.maxPlayers && !admin)
        throw new ArcadeError(503, `満員です（${this.cfg.maxPlayers} 人まで）。少し待ってから入ってください`, 'full');
      const start =
        room === 'reserved'
          ? doorFront()
          : u.x !== null && u.y !== null && isPassable(FLOOR, u.x, u.y)
            ? { x: u.x, y: u.y }
            : FLOOR.spawn[Math.floor(Math.random() * FLOOR.spawn.length)];
      p = { keyHash: k, pid: u.pid, name: u.name, look: u.look, path: [{ ...start }], startedAt: now, watching: null, room, playing: null, stance: null };
      this.online.set(k, p);
      const hold = this.badges.get(k);
      if (hold) hold.offSince = null;
      this.hooks.broadcast({ type: 'join', player: this.playerView(p) }, p.room);
    } else if (room !== p.room && (room === 'open' || this.inRoom('reserved').length < this.cfg.maxPlayers || admin)) {
      // 別のタブで店内にいる人が、別の部屋を選んで入り直した（このあと古い接続は切れる。welcome はこの戻り値で送る）
      this.moveTo(p, room, false);
    }
    this.store.upsertUser({ ...u, last_seen: now });
    this.expire();
    // 管理者には要望の未読の件数（welcome の後に届くよう、次の順番で）
    if (admin) queueMicrotask(() => this.hooks.send(k, { type: 'requests', unread: this.store.countUnreadRequests() }));
    return this.welcome(p, reason);
  }

  /** その人がいる部屋の最初の状態 */
  private welcome(p: Online, reason?: string): WelcomeMessage {
    const r = this.room(p.room);
    const u = this.store.getUser(p.keyHash);
    const msg: WelcomeMessage = {
      type: 'welcome',
      room: p.room,
      version: this.cfg.version ?? '',
      reservations: this.reservationViews(),
      you: u ? this.profileOf(u) : { pid: p.pid, name: p.name, look: p.look, admin: false, badges: this.badgesOf(p.keyHash) },
      serverNow: this.now(),
      players: this.inRoom(p.room).map((x) => this.playerView(x)),
      cabinets: r.cabinets.map((c) => this.cabinetView(c)),
      chat: this.recentChat(p.room),
      notices: r.data.recentNotices(),
      posters: this.listPosters(),
      maxPlayers: this.cfg.maxPlayers,
      rankings: Object.fromEntries(GAMES.map((g) => [g.id, this.rankingTop(g.id)])),
    };
    if (reason) msg.reason = reason;
    return msg;
  }

  /**
   * 部屋を移す（扉・メニュー・予約の時間の終わり）。名前・見た目・バッジはそのまま。ピン止めの吹き出しは部屋ごとなので外す。
   * 移った先では扉の前のマスに立つ。notify = その人に新しい部屋の welcome を送る
   */
  private moveTo(p: Online, to: RoomId, notify: boolean, reason?: string): void {
    if (p.room === to) return;
    const from = p.room;
    const now = this.now();
    if (from === 'open') {
      // オープン部屋の位置を覚えておく（次にオープン部屋へ入り直したときに戻る所）
      const at = currentTile(p.path, p.startedAt, now);
      const u = this.store.getUser(p.keyHash);
      if (u) this.store.upsertUser({ ...u, x: at.x, y: at.y, last_seen: now });
    }
    this.hooks.broadcast({ type: 'leave', pid: p.pid }, from);
    const h = this.badges.get(p.keyHash);
    if (h?.pinned) {
      h.pinned = null;
      this.tidyHold(p.keyHash);
    }
    p.room = to;
    p.path = [doorFront()];
    p.startedAt = now;
    p.watching = null;
    p.playing = null;
    p.stance = null;
    this.hooks.broadcast({ type: 'join', player: this.playerView(p) }, to);
    if (notify) this.hooks.send(p.keyHash, this.welcome(p, reason));
  }

  /** 接続が切れた（店を出た）。位置を覚えておく（オープン部屋にいたときだけ） */
  disconnect(keyHash: string): void {
    const p = this.online.get(keyHash);
    if (!p) return;
    this.online.delete(keyHash);
    const now = this.now();
    const u = this.store.getUser(keyHash);
    if (u) {
      const at = p.room === 'open' ? currentTile(p.path, p.startedAt, now) : null;
      this.store.upsertUser({ ...u, ...(at ? { x: at.x, y: at.y } : {}), last_seen: now });
    }
    const hold = this.badges.get(keyHash);
    if (hold) hold.offSince = now;
    this.hooks.broadcast({ type: 'leave', pid: p.pid }, p.room);
  }

  /** 退店（バッジを消して、接続を切る。名前と見た目・最後の位置は残る） */
  leave(keyHash: string | null): void {
    const k = this.requireKey(keyHash);
    this.badges.delete(k);
    for (const r of ROOM_IDS) this.room(r).craneNext.delete(k);
    this.hooks.drop(k, { type: 'bye' });
    this.disconnect(k);
  }

  /** 切断から badgeKeepMs たったバッジを消す */
  expireBadges(): void {
    const now = this.now();
    for (const [k, h] of this.badges)
      if (h.offSince !== null && now - h.offSince >= this.cfg.badgeKeepMs && !this.online.has(k)) this.badges.delete(k);
    for (const r of ROOM_IDS) for (const [k, t] of this.room(r).craneNext) if (t < now - 60_000) this.room(r).craneNext.delete(k);
    for (const [k, t] of this.noteAnnounced) if (t < now - NOTE_ANNOUNCE_MS) this.noteAnnounced.delete(k);
  }

  // ---------------------------------------------------------------- 移動・エモーション・視聴

  private tileOf(p: Online): Point {
    return currentTile(p.path, p.startedAt, this.now());
  }

  /** 目的地へ歩く（経路はサーバが A* で決める）。通れないマス・行けないマスは断る */
  goto(keyHash: string | null, x: unknown, y: unknown): void {
    const p = this.requireOnline(keyHash);
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y))
      throw new ArcadeError(400, '移動先が不正です', 'bad-input');
    if (!isPassable(FLOOR, x, y)) throw new ArcadeError(400, 'そこへは行けません', 'blocked');
    const from = this.tileOf(p);
    const path = findPath(FLOOR, from, { x, y });
    if (!path) throw new ArcadeError(400, 'そこへは行けません', 'unreachable');
    p.path = path;
    p.startedAt = this.now();
    p.watching = null;
    this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: null }, p.room);
    // 歩いたらゲームの 🎮・ベガ立ちは外す（v0.6.0）
    if (p.playing || p.stance) {
      p.playing = null;
      p.stance = null;
      this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
    }
  }

  /** v0.6.0：ポーズ（ベガ立ち）を付ける・外す（null）。DESIGN §16.7 */
  setStance(keyHash: string | null, raw: unknown): void {
    const p = this.requireOnline(keyHash);
    if (raw !== null && !isStance(raw)) throw new ArcadeError(400, 'そのポーズはありません', 'bad-input');
    if (p.stance === raw) return;
    p.stance = raw;
    this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
  }

  emote(keyHash: string | null, emoji: unknown): Emote {
    const p = this.requireOnline(keyHash);
    if (!isEmote(emoji)) throw new ArcadeError(400, 'そのエモーションはありません', 'bad-input');
    this.hooks.broadcast({ type: 'emote', pid: p.pid, emoji, at: this.now() }, p.room);
    return emoji;
  }

  /** 筐体の前に座って視聴する（cabinet = null で立つ）。座るときは前のマスへ移る */
  watch(keyHash: string | null, cabinet: unknown): void {
    const p = this.requireOnline(keyHash);
    if (cabinet === null) {
      if (p.watching === null) return;
      p.watching = null;
    } else {
      const id = Number(cabinet);
      const spot = Number.isInteger(id) ? cabinetSpot(id) : undefined;
      if (!spot) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
      const c = this.cabinetRecord(p.room, id);
      if (!c.videoId) throw new ArcadeError(409, 'この筐体には配信が設定されていません', 'no-stream');
      p.path = [frontTile(spot)];
      p.startedAt = this.now();
      p.watching = id;
    }
    this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: p.watching }, p.room);
    // 座ったらベガ立ちは外す（v0.6.0）
    if (p.watching !== null && p.stance) {
      p.stance = null;
      this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
    }
  }

  // ---------------------------------------------------------------- チャット（部屋ごと）

  say(keyHash: string | null, raw: unknown): ChatMessage {
    const p = this.requireOnline(keyHash);
    const text = checkChat(raw);
    return this.addChat(p.room, 'user', p.pid, p.name, text, this.badgesOf(p.keyHash), p.room === 'reserved' && this.isRoomHost(p.keyHash));
  }

  /** 自分の発言を 1 つだけピン止めする（頭上の吹き出しが出しっぱなしになる）。pinned = false で外す */
  pinChat(keyHash: string | null, rawId: unknown, pinned: unknown): PinnedChat | null {
    const p = this.requireOnline(keyHash);
    this.expireChat(); // 残す時間を過ぎた発言はピン止めできない（掃除の 1 分の間も）
    const id = Number(rawId);
    const row = Number.isInteger(id) ? this.room(p.room).data.getChatRow(id) : undefined;
    if (!row) throw new ArcadeError(404, 'その発言はありません', 'not-found');
    if (row.kind !== 'user' || row.pid !== p.pid) throw new ArcadeError(403, 'ピン止めできるのは自分の発言だけです', 'not-owner');
    const h = this.hold(p.keyHash);
    if (pinned === false) {
      if (h.pinned?.id === id) h.pinned = null;
    } else h.pinned = { id, text: row.text };
    const now = h.pinned;
    this.tidyHold(p.keyHash);
    this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
    return now;
  }

  /** 消された発言のピン止めを外す */
  private unpinDeleted(chatId: number): void {
    for (const [k, h] of this.badges)
      if (h.pinned?.id === chatId) {
        h.pinned = null;
        this.tidyHold(k);
        const p = this.online.get(k);
        if (p) this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
      }
  }

  private addChat(room: RoomId, kind: ChatKind, pid: string | null, name: string | null, text: string, badges = '', host = false): ChatMessage {
    const at = this.now();
    const id = this.room(room).data.addChat({ at, kind, pid, name, text, badges, ...(host ? { host } : {}) });
    const message: ChatMessage = { id, at, kind, pid, name, text };
    if (badges) message.badges = badges;
    if (host) message.host = true;
    this.hooks.broadcast({ type: 'chat', message }, room);
    return message;
  }

  /** その部屋の発言（残す時間を過ぎたものは入れない。v0.5.1） */
  recentChat(room: RoomId = 'open'): ChatMessage[] {
    const before = this.now() - this.cfg.chatTtlMs;
    return this.room(room).data.recentChat().filter((m) => m.at >= before);
  }

  /**
   * v0.5.1：残す時間（cfg.chatTtlMs、既定 24 時間）を過ぎた発言を消す（起動時と 1 分ごとの掃除）。
   * 開いている画面からも消し（chat-delete）、ピン止めも外す。お知らせの行が消えても、お知らせそのもの（大画面の帯・一覧）は消さない
   */
  expireChat(): void {
    const before = this.now() - this.cfg.chatTtlMs;
    for (const room of ['open', 'reserved'] as const) {
      for (const id of this.room(room).data.expireChat(before)) {
        this.hooks.broadcast({ type: 'chat-delete', id }, room);
        this.unpinDeleted(id);
      }
    }
  }

  // ---------------------------------------------------------------- 筐体（部屋ごと）

  private cabinetRecord(room: RoomId, id: number): CabinetRecord {
    const c = this.room(room).cabinets.find((x) => x.id === id);
    if (!c) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    return c;
  }

  private putCabinet(room: RoomId, c: CabinetRecord): CabinetView {
    const r = this.room(room);
    r.cabinets = r.cabinets.map((x) => (x.id === c.id ? c : x));
    r.data.saveCabinet(c);
    const v = this.cabinetView(c);
    this.hooks.broadcast({ type: 'cabinet', cabinet: v }, room);
    // 配信が外れた筐体を視聴していた人は立たせる
    if (!c.videoId)
      for (const p of this.inRoom(room))
        if (p.watching === c.id) {
          p.watching = null;
          this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: null }, room);
        }
    return v;
  }

  /** 時間切れの筐体を空きにする（定期的に・操作の前に呼ぶ。どの部屋も） */
  expire(): number[] {
    const all: number[] = [];
    for (const room of ROOM_IDS) {
      const { cabinets, expired } = expireCabinets(this.room(room).cabinets, this.now(), this.cfg.cabinetTtlMs);
      for (const id of expired) this.putCabinet(room, cabinets.find((c) => c.id === id)!);
      all.push(...expired);
    }
    return all;
  }

  /** その鍵の人がいる部屋の筐体（鍵なし・店内にいなければオープン部屋） */
  listCabinets(keyHash: string | null = null): CabinetView[] {
    this.expire();
    return this.room(this.roomOf(keyHash)).cabinets.map((c) => this.cabinetView(c));
  }

  /** 空いている筐体を使う（持ち主になる）。近く（2 マス以内）にいること。1 人 1 台（部屋ごと） */
  claim(keyHash: string | null, rawId: unknown): CabinetView {
    const p = this.requireOnline(keyHash);
    this.expire();
    const id = Number(rawId);
    const spot = Number.isInteger(id) ? cabinetSpot(id) : undefined;
    if (!spot) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    if (cabinetDistance(this.tileOf(p), spot) > 2) throw new ArcadeError(409, '筐体の近くまで行ってから使ってください', 'too-far');
    const err = claimError(this.room(p.room).cabinets, id, p.keyHash, this.now(), this.cfg.cabinetTtlMs);
    if (err === 'taken') throw new ArcadeError(409, 'この筐体はほかの人が使っています', 'taken');
    if (err === 'already-own')
      throw new ArcadeError(409, 'ほかの筐体を使っています（同時に使えるのは 1 台です。先にそちらを空けてください）', 'already-own');
    if (err) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    const c = claimCabinet(this.cabinetRecord(p.room, id), { id: p.keyHash, name: p.name, pid: p.pid }, this.now(), this.cfg.cabinetTtlMs);
    return this.putCabinet(p.room, c);
  }

  /** 設定（配信の URL・宣伝）。持ち主か管理者（いる部屋の筐体） */
  updateCabinet(keyHash: string | null, rawId: unknown, input: unknown): CabinetView {
    const k = this.requireKey(keyHash);
    this.expire();
    const id = Number(rawId);
    const room = this.roomOf(k);
    const c = this.cabinetRecord(room, Number.isInteger(id) ? id : -1);
    const admin = this.isAdmin(k);
    if (!admin && c.ownerId !== k) throw new ArcadeError(403, 'この筐体を設定できるのは持ち主か管理者だけです', 'not-owner');
    if (!admin) this.requireBanFree(k);
    const { value, error } = validateCabinetInput(input);
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    return this.putCabinet(room, applyCabinetInput(c, value, this.now()));
  }

  /** 空ける（持ち主か管理者） */
  releaseCabinet(keyHash: string | null, rawId: unknown): CabinetView {
    const k = this.requireKey(keyHash);
    this.expire();
    const id = Number(rawId);
    const room = this.roomOf(k);
    const c = this.cabinetRecord(room, Number.isInteger(id) ? id : -1);
    this.syncSlot();
    const admin = this.isAdmin(k) || (room === 'reserved' && this.isRoomHost(k));
    if (!admin && c.ownerId !== k) throw new ArcadeError(403, 'この筐体を空けられるのは持ち主か管理者（予約部屋では主催者）だけです', 'not-owner');
    return this.putCabinet(room, releaseCabinet(c));
  }

  // ---------------------------------------------------------------- 管理者

  adminEnabled(): boolean {
    return !!this.cfg.adminPassHash;
  }

  /** 合言葉が合えば管理者にする（その鍵。adminTtlMs の間） */
  adminLogin(keyHash: string | null, password: unknown): Profile {
    const k = this.requireKey(keyHash);
    if (!this.cfg.adminPassHash) throw new ArcadeError(403, 'このサーバでは管理者の合言葉が設定されていません', 'admin-disabled');
    const u = this.store.getUser(k);
    if (!u) throw new ArcadeError(409, '先に入室してください', 'need-enter');
    if (!checkPassphrase(password, this.cfg.adminPassHash))
      throw new ArcadeError(403, '合言葉が違います', 'bad-password');
    const nu = { ...u, admin_until: this.now() + this.cfg.adminTtlMs };
    this.store.upsertUser(nu);
    this.refreshPlayer(k);
    this.hooks.send(k, { type: 'requests', unread: this.store.countUnreadRequests() });
    return this.profileOf(nu);
  }

  adminLogout(keyHash: string | null): Profile {
    const k = this.requireKey(keyHash);
    const u = this.store.getUser(k);
    if (!u) throw new ArcadeError(409, '先に入室してください', 'need-enter');
    const nu = { ...u, admin_until: 0 };
    this.store.upsertUser(nu);
    this.refreshPlayer(k);
    return this.profileOf(nu);
  }

  private refreshPlayer(k: string): void {
    const p = this.online.get(k);
    if (p) this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
    const u = this.store.getUser(k);
    if (u) this.hooks.send(k, { type: 'you', you: this.profileOf(u) });
  }

  private requireAdmin(keyHash: string | null): string {
    const k = this.requireKey(keyHash);
    if (!this.isAdmin(k)) throw new ArcadeError(403, '管理者だけができる操作です', 'not-admin');
    return k;
  }

  /** お知らせ（壁の大画面とチャットに流す）。管理者がいる部屋に出す */
  postNotice(keyHash: string | null, raw: unknown): Notice {
    const { room } = this.requireRoomPower(keyHash);
    const text = typeof raw === 'string' ? tidy(raw) : '';
    if (!text) throw new ArcadeError(400, 'お知らせを入れてください', 'bad-input');
    if (charLength(text) > NOTICE_MAX) throw new ArcadeError(400, `お知らせは ${NOTICE_MAX} 文字までです`, 'too-long');
    const data = this.room(room).data;
    const at = this.now();
    const id = data.addNotice(at, text);
    this.hooks.broadcast({ type: 'notices', notices: data.recentNotices() }, room);
    this.addChat(room, 'notice', null, 'お知らせ', text);
    return { id, at, text };
  }

  deleteNotice(keyHash: string | null, rawId: unknown): void {
    const { room } = this.requireRoomPower(keyHash);
    const data = this.room(room).data;
    const id = Number(rawId);
    const notice = Number.isInteger(id) ? data.getNotice(id) : undefined;
    if (!notice || !data.deleteNotice(id)) throw new ArcadeError(404, 'そのお知らせはありません', 'not-found');
    this.hooks.broadcast({ type: 'notices', notices: data.recentNotices() }, room);
    // チャット欄に流れた同じお知らせも消す（その部屋の全員の画面から）
    for (const chatId of data.noticeChatIds(notice)) {
      if (data.deleteChat(chatId)) this.hooks.broadcast({ type: 'chat-delete', id: chatId }, room);
    }
  }

  notices(room: RoomId = 'open'): Notice[] {
    return this.room(room).data.recentNotices();
  }

  /** チャットの発言を消す（管理者がいる部屋の全員の画面から消える） */
  deleteChat(keyHash: string | null, rawId: unknown): void {
    const { room } = this.requireRoomPower(keyHash);
    const data = this.room(room).data;
    const id = Number(rawId);
    const row = Number.isInteger(id) ? data.getChatKind(id) : undefined;
    if (!row || !data.deleteChat(id)) throw new ArcadeError(404, 'その発言はありません', 'not-found');
    this.hooks.broadcast({ type: 'chat-delete', id }, room);
    this.unpinDeleted(id);
    // お知らせの行を消したら、元のお知らせ（壁の大画面に流れる分）も消す
    if (row.kind === 'notice') {
      let removed = false;
      for (const nid of data.noticeIdsForChat(row)) removed = data.deleteNotice(nid) || removed;
      if (removed) this.hooks.broadcast({ type: 'notices', notices: data.recentNotices() }, room);
    }
  }

  /** 退室させる。minutes > 0 ならその鍵の入室をその分だけ止める */
  kick(keyHash: string | null, rawPid: unknown, rawMinutes: unknown): { until: number | null } {
    const k = this.requireAdmin(keyHash);
    const pid = typeof rawPid === 'string' ? rawPid : '';
    const target = pid ? this.store.getUserByPid(pid) : undefined;
    if (!target) throw new ArcadeError(404, 'その人は見つかりません', 'not-found');
    if (target.key_hash === k) throw new ArcadeError(400, '自分は退室させられません', 'self');
    const minutes = rawMinutes === undefined || rawMinutes === null ? 0 : Number(rawMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_BAN_MINUTES)
      throw new ArcadeError(400, `入室を止める時間は 0〜${MAX_BAN_MINUTES} 分です`, 'bad-input');
    const until = minutes > 0 ? this.now() + minutes * 60 * 1000 : null;
    if (until) this.store.setBan(target.key_hash, until);
    // 管理者だった人なら外す
    if (target.admin_until > 0) this.store.upsertUser({ ...target, admin_until: 0 });
    const reason = until ? `管理者により退室になりました（${new Date(until).toLocaleString('ja-JP')} まで入室できません）` : '管理者により退室になりました';
    const room = this.roomOf(target.key_hash);
    this.hooks.drop(target.key_hash, { type: 'kicked', reason, ...(until ? { until } : {}) });
    this.disconnect(target.key_hash);
    this.badges.delete(target.key_hash);
    this.grants.delete(target.key_hash);
    this.addChat(room, 'system', null, null, `${target.name} さんが退室になりました`);
    return { until };
  }

  /** 古い記録の掃除（入室の停止の期限切れ・長く来ていない人・古い予約の行・残す時間を過ぎた発言） */
  sweep(): void {
    const now = this.now();
    this.store.deleteExpiredBans(now);
    this.store.deleteStaleUsers(now - 180 * 24 * 60 * 60 * 1000);
    this.expire();
    this.expireBadges();
    this.expirePosters();
    this.store.pruneReservations(now, RESERVATION_KEEP_MS, RESERVATION_MAX_ROWS);
    this.expireChat();
    this.expireGameSessions();
    this.syncSlot();
  }

  // ---------------------------------------------------------------- 予約部屋（v0.5.0。DESIGN §14）

  private reservationView(r: ReservationRow): ReservationView {
    const { passHash: _h, ownerKey: _k, ...v } = r;
    return v;
  }

  /** まだ終わっていない予約（誰でも見られる形） */
  reservationViews(): ReservationView[] {
    const now = this.now();
    return this.reservations.filter((r) => r.endAt > now).map((r) => this.reservationView(r));
  }

  private broadcastReservations(): void {
    this.hooks.broadcast({ type: 'reservations', reservations: this.reservationViews() });
  }

  /** いま予約部屋を開いている予約 */
  activeReservation(): ReservationRow | undefined {
    this.syncSlot();
    return this.reservations.find((r) => r.id === this.slot.id);
  }

  /**
   * 予約の時間の移り変わりを当てる（数秒ごとの tick・入室の前に呼ぶ。時計は cfg.now なのでテストで進められる）。
   * - 開いていた予約が終わった（取り消された）：予約部屋の全員をオープン部屋へ戻し、チャット・お知らせ・筐体・クレーンゲームを消す
   * - 新しい予約が始まった：その部屋の案内を流す
   * - 終わる 10 分前・5 分前：予約部屋に案内
   */
  syncSlot(): void {
    const now = this.now();
    const before = this.reservations.length;
    this.reservations = this.reservations.filter((r) => r.endAt > now);
    const active = activeReservation(this.reservations, now);
    const nextId = active?.id ?? null;
    if (this.slot.id !== nextId) {
      if (this.slot.id !== null) this.closeReservedRoom(this.closeReason ?? ROOM_ENDED_TEXT);
      this.closeReason = null;
      this.slot = { id: nextId, warned: new Set() };
      if (active)
        this.addChat('reserved', 'system', null, null, `🔑 予約部屋「${active.title}」が開きました（${formatReservationRange(active)}・予約：${active.host}）`);
    }
    if (active) {
      const left = active.endAt - now;
      const crossed = RESERVATION_WARN_MS.filter((w) => left <= w && !this.slot.warned.has(w));
      if (crossed.length) {
        for (const w of RESERVATION_WARN_MS) if (left <= w) this.slot.warned.add(w);
        const mins = Math.max(1, Math.ceil(left / 60000));
        this.addChat(
          'reserved',
          'system',
          null,
          null,
          `⏰ 予約の時間はあと ${mins} 分です（${jstTime(active.endAt)} に終わります。終わるとオープン部屋に戻ります）`,
        );
      }
    }
    if (this.reservations.length !== before) this.broadcastReservations();
  }

  /** 予約部屋を閉じる：全員をオープン部屋へ戻してから、部屋の中身を消す（次の予約に前のチャットを残さない） */
  private closeReservedRoom(reason: string): void {
    for (const p of this.inRoom('reserved')) this.moveTo(p, 'open', true, reason);
    const r = this.room('reserved');
    r.data.clear();
    r.cabinets = FLOOR.cabinets.map((s) => emptyCabinet(s.id));
    r.machines.clear();
    r.craneNext.clear();
    this.grants.clear();
    this.roomBans.clear();
  }

  /** 予約部屋に入れない理由（入れるなら null）。合言葉は見ない（予約した人・管理者・この予約の合言葉を入れた人だけ） */
  private reservedRefusal(k: string): string | null {
    const active = this.reservations.find((r) => r.id === this.slot.id);
    if (!active) return closedRoomText(this.reservationViews(), this.now());
    if (active.ownerKey === k || this.isAdmin(k)) return null;
    if (this.roomBans.has(k)) return '主催者により、この予約の間は予約部屋に入れません';
    if (this.grants.get(k) === active.id) return null;
    return '予約部屋に入るには合言葉が必要です';
  }

  /** 予約の一覧（誰でも）。鍵があれば、その人があと予約できる時間も */
  listReservations(keyHash: string | null): ReservationsResponse {
    this.syncSlot();
    const now = this.now();
    const u = keyHash ? this.store.getUser(keyHash) : undefined;
    return {
      reservations: this.reservationViews(),
      serverNow: now,
      activeId: this.slot.id,
      myLeftMs: u ? this.leftMs(u.key_hash) : null,
    };
  }

  private leftMs(k: string): number {
    return Math.max(0, RESERVATION_KEY_TOTAL_MS - reservedTotalMs(this.reservations.filter((r) => r.ownerKey === k), this.now()));
  }

  /** 予約する（入室したことのある人なら誰でも。空いている枠だけ・1 人の合計 5 時間まで） */
  createReservation(keyHash: string | null, input: unknown): ReservationView {
    const k = this.requireKey(keyHash);
    const u = this.store.getUser(k);
    if (!u) throw new ArcadeError(409, '先に名前を決めて入店してください', 'need-enter');
    this.requireBanFree(k);
    this.syncSlot();
    const now = this.now();
    const { value, error } = validateReservation(input, now);
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    const span = { startAt: value.startAt, endAt: value.startAt + value.minutes * 60 * 1000 };
    const clash = this.reservations.find((r) => overlaps(r, span));
    if (clash) throw new ArcadeError(409, `その時間はほかの予約（${formatReservationRange(clash)}）と重なっています`, 'overlap');
    const left = this.leftMs(k);
    if (span.endAt - span.startAt > left)
      throw new ArcadeError(
        409,
        `予約できるのは 1 人あわせて ${RESERVATION_KEY_TOTAL_MS / 3600000} 時間までです（あと ${Math.floor(left / 60000)} 分）`,
        'too-much',
      );
    const row = this.store.addReservation({
      createdAt: now,
      startAt: span.startAt,
      endAt: span.endAt,
      title: value.title,
      host: value.host,
      description: value.description,
      passHash: hashPassphrase(value.passphrase),
      ownerKey: k,
      ownerPid: u.pid,
    });
    this.reservations = [...this.reservations, row].sort((a, b) => a.startAt - b.startAt);
    this.broadcastReservations();
    this.addChat('open', 'system', null, null, `📅 ${value.host} さんが予約部屋を予約しました：「${row.title}」（${formatReservationRange(row)}）`);
    this.syncSlot();
    return this.reservationView(row);
  }

  /** 取り消す（予約した人か管理者）。使っている最中なら予約部屋をすぐ閉じる */
  cancelReservation(keyHash: string | null, rawId: unknown): void {
    const k = this.requireKey(keyHash);
    this.syncSlot();
    const id = Number(rawId);
    const row = Number.isInteger(id) ? this.reservations.find((r) => r.id === id) : undefined;
    if (!row) throw new ArcadeError(404, 'その予約はありません（終わったか、取り消されています）', 'not-found');
    if (row.ownerKey !== k && !this.isAdmin(k)) throw new ArcadeError(403, '取り消せるのは予約した人か管理者だけです', 'not-owner');
    this.store.deleteReservation(row.id);
    this.reservations = this.reservations.filter((r) => r.id !== row.id);
    if (row.id === this.slot.id) this.closeReason = ROOM_CANCELLED_TEXT;
    this.syncSlot();
    this.broadcastReservations();
  }

  /**
   * 部屋に入る（扉・予約表・入店の画面から）。予約部屋は予約の時間の間だけで、合言葉が要る（予約した人・管理者は要らない）。
   * 合言葉が合えばその鍵を覚える（再読み込みで入り直せる）。店内にいればその場で部屋を移し、welcome を送る。
   * 合言葉が違うときは code = bad-passphrase（app.ts が回数を数える）
   */
  enterRoom(keyHash: string | null, rawRoom: unknown, passphrase: unknown): RoomEnterResponse {
    const k = this.requireKey(keyHash);
    if (!this.store.getUser(k)) throw new ArcadeError(409, '先に名前を決めて入店してください', 'need-enter');
    this.requireBanFree(k);
    if (!isRoomId(rawRoom)) throw new ArcadeError(404, 'その部屋はありません', 'not-found');
    const p = this.online.get(k);
    if (rawRoom === 'open') {
      if (p) this.moveTo(p, 'open', true);
      return { room: 'open', moved: !!p, reservation: null };
    }
    this.syncSlot();
    const active = this.reservations.find((r) => r.id === this.slot.id);
    if (!active) throw new ArcadeError(409, closedRoomText(this.reservationViews(), this.now()), 'room-closed');
    const admin = this.isAdmin(k);
    if (active.ownerKey !== k && !admin && this.roomBans.has(k))
      throw new ArcadeError(403, '主催者により、この予約の間は予約部屋に入れません', 'room-banned');
    if (active.ownerKey !== k && !admin && this.grants.get(k) !== active.id) {
      if (typeof passphrase !== 'string' || !passphrase.trim()) throw new ArcadeError(403, '合言葉を入れてください', 'need-passphrase');
      if (!checkPassphrase(passphrase.normalize('NFC').trim(), active.passHash)) throw new ArcadeError(403, '合言葉が違います', 'bad-passphrase');
      this.grants.set(k, active.id);
    }
    if (p && p.room !== 'reserved') {
      if (this.inRoom('reserved').length >= this.cfg.maxPlayers && !admin)
        throw new ArcadeError(503, `予約部屋は満員です（${this.cfg.maxPlayers} 人まで）`, 'full');
      this.moveTo(p, 'reserved', true);
    }
    return { room: 'reserved', moved: !!p, reservation: this.reservationView(active) };
  }

  /** 予約部屋の中で、主催者（かサイトの管理者）だけ */
  private requireHostInRoom(keyHash: string | null): { k: string; admin: boolean; active: ReservationRow } {
    const r = this.requireRoomPower(keyHash);
    const active = this.reservations.find((x) => x.id === this.slot.id);
    if (r.room !== 'reserved' || !active) throw new ArcadeError(409, '予約部屋の中でできる操作です', 'not-in-room');
    return { k: r.k, admin: r.admin, active };
  }

  /** 人を予約部屋から出す（オープン部屋へ戻し、この予約の間は入れなくする）。主催者・サイトの管理者 */
  removeFromRoom(keyHash: string | null, rawPid: unknown): void {
    const { k, admin } = this.requireHostInRoom(keyHash);
    const pid = typeof rawPid === 'string' ? rawPid : '';
    const target = [...this.online.values()].find((x) => x.pid === pid && x.room === 'reserved');
    if (!target) throw new ArcadeError(404, 'その人は予約部屋にいません', 'not-found');
    if (target.keyHash === k) throw new ArcadeError(400, '自分は出せません', 'self');
    if (!admin && this.isAdmin(target.keyHash)) throw new ArcadeError(403, 'サイトの管理者は出せません', 'not-admin');
    this.roomBans.add(target.keyHash);
    this.grants.delete(target.keyHash);
    this.moveTo(target, 'open', true, ROOM_REMOVED_TEXT);
    this.addChat('reserved', 'system', null, null, `${target.name} さんがオープン部屋に戻されました`);
  }

  /** 合言葉を変える（いま中にいる人はそのまま。出ていた人は新しい合言葉が要る）。主催者・サイトの管理者 */
  changeRoomPassphrase(keyHash: string | null, raw: unknown): void {
    const { active } = this.requireHostInRoom(keyHash);
    const pass = checkReservationPass(raw);
    if (!pass.value) throw new ArcadeError(400, pass.error!.message, pass.error!.code);
    const passHash = hashPassphrase(pass.value);
    this.store.updateReservation(active.id, { passHash });
    active.passHash = passHash;
    const inside = new Set(this.inRoom('reserved').map((x) => x.keyHash));
    for (const g of [...this.grants.keys()]) if (!inside.has(g)) this.grants.delete(g);
    this.addChat('reserved', 'system', null, null, '🔑 主催者が予約部屋の合言葉を変えました');
  }

  /** 予約を早めに終える（全員オープン部屋へ・予約部屋の中身を消す）。主催者・サイトの管理者 */
  endRoomEarly(keyHash: string | null): void {
    const { active } = this.requireHostInRoom(keyHash);
    const now = this.now();
    this.store.updateReservation(active.id, { endAt: now });
    active.endAt = now;
    this.closeReason = ROOM_CLOSED_BY_HOST_TEXT;
    this.syncSlot();
    this.broadcastReservations();
  }

  // ---------------------------------------------------------------- クレーンゲーム（DESIGN §8。部屋ごと）

  private machine(room: RoomId, id: number): CraneMachine {
    const machines = this.room(room).machines;
    let m = machines.get(id);
    if (!m) {
      m = newMachine(id, this.rng);
      machines.set(id, m);
    }
    return m;
  }

  private requireCrane(rawId: unknown) {
    const id = Number(rawId);
    const spot = Number.isInteger(id) ? craneSpot(id) : undefined;
    if (!spot) throw new ArcadeError(404, 'そのクレーンゲームはありません', 'not-found');
    return spot;
  }

  /** ケースの中（カプセルの位置と色。中身は送らない）と、次に遊べる時刻 */
  craneState(keyHash: string | null, rawId: unknown): CraneStateResponse {
    const k = this.requireKey(keyHash);
    const spot = this.requireCrane(rawId);
    const room = this.roomOf(k);
    return {
      machine: machineView(this.machine(room, spot.id)),
      cooldownUntil: this.room(room).craneNext.get(k) ?? 0,
      serverNow: this.now(),
      badges: this.badgesOf(k),
    };
  }

  /** アームを (x, z) で下ろす。当たり外れはここで決める */
  cranePlay(keyHash: string | null, rawId: unknown, rawX: unknown, rawZ: unknown): CranePlayResponse {
    const p = this.requireOnline(keyHash);
    const spot = this.requireCrane(rawId);
    if (cabinetDistance(this.tileOf(p), spot) > CRANE_NEAR)
      throw new ArcadeError(409, 'クレーンゲームの近くまで行ってから遊んでください', 'too-far');
    const arm = normalizeArm(rawX, rawZ);
    if (!arm) throw new ArcadeError(400, 'アームの位置が不正です', 'bad-input');
    const now = this.now();
    const room = this.room(p.room);
    const next = room.craneNext.get(p.keyHash) ?? 0;
    if (now < next) throw new ArcadeError(429, `次に遊べるまで あと ${Math.ceil((next - now) / 1000)} 秒です`, 'cooldown');
    const cooldownUntil = now + this.cfg.craneCooldownMs;
    room.craneNext.set(p.keyHash, cooldownUntil);

    const r = resolveCrane(this.machine(p.room, spot.id), arm, this.rng, this.cfg.craneOdds);
    room.machines.set(spot.id, r.machine);
    let gained = false;
    let duplicate = false;
    let completed = false;
    let badges = this.badgesOf(p.keyHash);
    if (r.outcome === 'win' && r.suit) {
      const a = addBadge(badges, r.suit, this.cfg.badgeMode, this.cfg.badgeStackMax);
      ({ gained, duplicate, completed } = a);
      badges = a.badges;
      if (gained) {
        this.hold(p.keyHash).badges = badges;
        this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
        const u = this.store.getUser(p.keyHash);
        if (u) this.hooks.send(p.keyHash, { type: 'you', you: this.profileOf(u) });
        // 取れたときだけ案内する（ダブり・外れは流さない）
        this.addChat(p.room, 'system', null, null, `${p.name} さんがクレーンゲームで ${r.suit} を取った！`);
        if (completed) this.addChat(p.room, 'system', null, null, `🎉 ${p.name} さんが 4 種類コンプリート！`);
      }
    }
    return {
      outcome: r.outcome,
      arm,
      capsuleId: r.capsuleId,
      grabAt: r.grabAt,
      dropTo: r.dropTo,
      suit: r.suit,
      gained,
      duplicate,
      completed,
      badges,
      cooldownUntil,
      serverNow: now,
      machine: machineView(r.machine),
    };
  }

  // ---------------------------------------------------------------- ポスター（DESIGN §9。店全体で 1 つ）

  private posterView(r: PosterRow): PosterView {
    const { authorKey: _k, ...v } = r;
    return v;
  }

  listPosters(): PosterView[] {
    const now = this.now();
    return sortPosters(
      this.store
        .listPosters()
        .filter((p) => p.expiresAt > now)
        .map((r) => this.posterView(r)),
    );
  }

  private broadcastPosters(): void {
    this.hooks.broadcast({ type: 'posters', posters: this.listPosters() });
  }

  /** 期限の過ぎたポスターをはがす（定期的に・操作の前に呼ぶ） */
  expirePosters(): number[] {
    const gone = this.store.deleteExpiredPosters(this.now());
    if (gone.length) this.broadcastPosters();
    return gone;
  }

  private requirePosterWriter(keyHash: string | null): Online {
    const p = this.requireOnline(keyHash);
    this.requireBanFree(p.keyHash);
    if (this.cfg.posterWho === 'admin' && !this.isAdmin(p.keyHash))
      throw new ArcadeError(403, 'このお店では、ポスターを貼れるのは管理者だけです', 'not-admin');
    return p;
  }

  private requirePoster(rawId: unknown): PosterRow {
    const id = Number(rawId);
    const r = Number.isInteger(id) ? this.store.getPoster(id) : undefined;
    if (!r || r.expiresAt <= this.now()) throw new ArcadeError(404, 'そのポスターはありません', 'not-found');
    return r;
  }

  createPoster(keyHash: string | null, input: unknown): PosterView {
    const p = this.requirePosterWriter(keyHash);
    this.expirePosters();
    const { value, error } = validatePoster(input, this.now());
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    const all = this.store.listPosters();
    if (all.filter((x) => x.authorKey === p.keyHash).length >= this.cfg.posterMaxPerUser)
      throw new ArcadeError(409, `同時に貼れるのは 1 人 ${this.cfg.posterMaxPerUser} 枚までです（前のものをはがしてから貼ってください）`, 'too-many');
    if (all.length >= this.cfg.posterMaxTotal) throw new ArcadeError(409, '掲示板がいっぱいです。少し待ってから貼ってください', 'board-full');
    const r = this.store.addPoster({ key: p.keyHash, pid: p.pid, name: p.name }, value, this.now());
    this.broadcastPosters();
    this.addChat(p.room, 'system', null, null, `📌 ${p.name} さんがポスターを貼りました：「${r.title}」（${formatPosterRange(r)}）`);
    return this.posterView(r);
  }

  updatePoster(keyHash: string | null, rawId: unknown, input: unknown): PosterView {
    const k = this.requireKey(keyHash);
    this.expirePosters();
    const r = this.requirePoster(rawId);
    const admin = this.isAdmin(k);
    if (!admin && r.authorKey !== k) throw new ArcadeError(403, 'このポスターを直せるのは書いた人か管理者だけです', 'not-owner');
    if (!admin) this.requireBanFree(k);
    const { value, error } = validatePoster(input, this.now());
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    // 書いた人が直したら、書いた人の名前もその時のものに
    const name = r.authorKey === k ? (this.online.get(k)?.name ?? this.store.getUser(k)?.name ?? null) : null;
    const n = this.store.updatePoster(r.id, name, value, this.now())!;
    this.broadcastPosters();
    return this.posterView(n);
  }

  deletePoster(keyHash: string | null, rawId: unknown): void {
    const k = this.requireKey(keyHash);
    const r = this.requirePoster(rawId);
    if (!this.isAdmin(k) && r.authorKey !== k) throw new ArcadeError(403, 'このポスターをはがせるのは書いた人か管理者だけです', 'not-owner');
    this.store.deletePoster(r.id);
    this.broadcastPosters();
  }

  /** 目立つように固定する（管理者） */
  pinPoster(keyHash: string | null, rawId: unknown, pinned: unknown): PosterView {
    this.requireAdmin(keyHash);
    const r = this.requirePoster(rawId);
    this.store.setPosterPinned(r.id, pinned === true);
    this.broadcastPosters();
    return this.posterView(this.store.getPoster(r.id)!);
  }
  // ---------------------------------------------------------------- コミュニケーションノート（v0.4.0。DESIGN §12。店全体で 1 つ）

  /** 一覧（誰でも読める）：新しいものから limit 件、before があればその id より古いもの。古い順 */
  listNotes(rawBefore: unknown, rawLimit: unknown): NotesResponse {
    const b = Number(rawBefore);
    const before = rawBefore !== undefined && rawBefore !== '' && Number.isInteger(b) && b > 0 ? b : null;
    const l = Number(rawLimit);
    const limit = Number.isInteger(l) && l > 0 ? Math.min(200, l) : NOTE_FETCH;
    return { total: this.store.countNotes(), notes: this.store.listNotes(limit, before) };
  }

  /** 書く（店内にいる人）。名前は書き換えてよい */
  writeNote(keyHash: string | null, input: unknown): NoteView {
    const p = this.requireOnline(keyHash);
    this.requireBanFree(p.keyHash);
    const { value, error } = validateNote(input);
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    const { note, removed } = this.store.addNote({ key: p.keyHash, pid: p.pid }, value, this.now(), this.cfg.noteMaxTotal);
    const total = this.store.countNotes();
    for (const id of removed) this.hooks.broadcast({ type: 'note-delete', id, total });
    this.hooks.broadcast({ type: 'note', note, total });
    // チャットへの案内は控えめに（同じ人は NOTE_ANNOUNCE_MS に 1 回。書いた人のいる部屋に）
    const last = this.noteAnnounced.get(p.keyHash) ?? 0;
    if (this.now() - last >= NOTE_ANNOUNCE_MS) {
      this.noteAnnounced.set(p.keyHash, this.now());
      this.addChat(p.room, 'system', null, null, `📖 ${note.name} さんがノートに書きました`);
    }
    return note;
  }

  /** 消す（書いた人か管理者） */
  deleteNote(keyHash: string | null, rawId: unknown): void {
    const k = this.requireKey(keyHash);
    const id = Number(rawId);
    const n = Number.isInteger(id) ? this.store.getNote(id) : undefined;
    if (!n) throw new ArcadeError(404, 'その書き込みはありません', 'not-found');
    if (n.authorKey !== k && !this.isAdmin(k)) throw new ArcadeError(403, '消せるのは書いた人か管理者だけです', 'not-owner');
    this.store.deleteNote(id);
    this.hooks.broadcast({ type: 'note-delete', id, total: this.store.countNotes() });
  }

  // ---------------------------------------------------------------- 機能追加要望箱（v0.4.0。DESIGN §13。読めるのは管理者だけ）

  /** 送る（入室したことのある人）。送った人にも中身は返さない */
  sendRequest(keyHash: string | null, input: unknown): { ok: true } {
    const k = this.requireKey(keyHash);
    if (!this.store.getUser(k)) throw new ArcadeError(409, '先に入室してください', 'need-enter');
    this.requireBanFree(k);
    const { value, error } = validateRequest(input);
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    this.store.addRequest(value, this.now(), this.cfg.requestMaxTotal);
    this.notifyAdmins(true);
    return { ok: true };
  }

  /** 店内にいる管理者にだけ、未読の件数を知らせる（どの部屋にいても） */
  private notifyAdmins(added = false): void {
    const unread = this.store.countUnreadRequests();
    for (const k of this.online.keys()) if (this.isAdmin(k)) this.hooks.send(k, { type: 'requests', unread, ...(added ? { added } : {}) });
  }

  listRequests(keyHash: string | null): RequestsResponse {
    this.requireAdmin(keyHash);
    return { requests: this.store.listRequests(), unread: this.store.countUnreadRequests() };
  }

  markRequest(keyHash: string | null, rawId: unknown, status: unknown): RequestView {
    this.requireAdmin(keyHash);
    const id = Number(rawId);
    if (!isRequestStatus(status)) throw new ArcadeError(400, '印が不正です', 'bad-input');
    if (!Number.isInteger(id) || !this.store.setRequestStatus(id, status)) throw new ArcadeError(404, 'その要望はありません', 'not-found');
    this.notifyAdmins();
    return this.store.listRequests().find((r) => r.id === id)!;
  }

  deleteRequest(keyHash: string | null, rawId: unknown): void {
    this.requireAdmin(keyHash);
    const id = Number(rawId);
    if (!Number.isInteger(id) || !this.store.deleteRequest(id)) throw new ArcadeError(404, 'その要望はありません', 'not-found');
    this.notifyAdmins();
  }

  // ---------------------------------------------------------------- ゲーム筐体とランキング（v0.6.0。DESIGN §16。ランキングは店全体で 1 つ）

  private requireGame(raw: unknown): string {
    if (!isGameId(raw)) throw new ArcadeError(404, 'そのゲームはありません', 'not-found');
    return raw;
  }

  /** ゲームの窓を開いた（game）・閉じた（null）。頭上の 🎮（WebSocket の play） */
  play(keyHash: string | null, raw: unknown): void {
    const p = this.requireOnline(keyHash);
    const game = raw === null ? null : this.requireGame(raw);
    if (p.playing === game && !(game && p.stance)) return;
    p.playing = game;
    // ゲームを始めたらベガ立ちは外す
    if (game) p.stance = null;
    this.hooks.broadcast({ type: 'player', player: this.playerView(p) }, p.room);
  }

  /** 始める：店内にいて、そのゲームの筐体に 2 マス以内。種とセッションを渡す（前のセッションは消える） */
  startGame(keyHash: string | null, rawGame: unknown, input?: unknown): GameStartResponse {
    const p = this.requireOnline(keyHash);
    const game = this.requireGame(rawGame);
    const body = (input && typeof input === 'object' ? input : {}) as { options?: unknown };
    const opt = parseGameOptions(game, body.options);
    if (!opt) throw new ArcadeError(400, 'ゲームの設定が正しくありません', 'bad-input');
    const at = this.tileOf(p);
    if (!gameSpots(FLOOR, game).some((s) => cabinetDistance(at, s) <= GAME_NEAR))
      throw new ArcadeError(409, 'ゲームの筐体の近くまで行ってから遊んでください', 'too-far');
    const sess: GameSession = {
      id: crypto.randomBytes(16).toString('base64url'),
      game,
      // 種は推測できない乱数（テストでは cfg.rng で決める）
      seed: this.cfg.rng ? Math.floor(this.cfg.rng() * 2 ** 32) >>> 0 : crypto.randomBytes(4).readUInt32LE(0),
      startedAt: this.now(),
      options: opt.options,
      practice: opt.practice,
    };
    this.gameSessions.set(p.keyHash, sess);
    return {
      session: sess.id,
      seed: sess.seed,
      best: this.store.bestScoreOf(game, p.keyHash),
      ...(opt.practice ? { practice: true } : {}),
      ...(opt.options ? { options: opt.options } : {}),
    };
  }

  /** 24 時間たったセッションを消す */
  expireGameSessions(): void {
    const before = this.now() - GAME_SESSION_TTL_MS;
    for (const [k, s] of this.gameSessions) if (s.startedAt < before) this.gameSessions.delete(k);
  }

  /**
   * 記録する：サーバが種と手の並びから盤をなぞり直して点数を決める（クライアントの言う点数は使わない）。
   * セッションは 1 回だけ。店内にいなくても（退店・ページを離れたとき）受け付ける。点数が 0 なら記録しない
   */
  finishGame(keyHash: string | null, rawGame: unknown, input: unknown): GameFinishResponse {
    const k = this.requireKey(keyHash);
    const game = this.requireGame(rawGame);
    this.expireGameSessions();
    const body = (input && typeof input === 'object' ? input : {}) as { session?: unknown; moves?: unknown; over?: unknown };
    const sess = this.gameSessions.get(k);
    if (!sess || sess.id !== body.session || sess.game !== game)
      throw new ArcadeError(409, 'このゲームは記録できませんでした（サーバが再起動したか、別の画面で新しいゲームを始めたため）', 'no-session');
    this.gameSessions.delete(k);
    const ms = this.now() - sess.startedAt;
    // 練習の設定（Columns like game の Standard・5 色・Height 0 以外）は記録しない（なぞり直しもしない）
    if (sess.practice)
      return { recorded: false, practice: true, score: 0, maxTile: 0, moves: 0, best: this.store.bestScoreOf(game, k), newBest: false, rank: this.ranksOf(game, k) };
    // ゲームごとのなぞり直し（gameRecord.ts。速すぎる・おかしな記録は断る）
    const r = checkGameRecord(game, sess.seed, sess.options, body as Record<string, unknown>, ms);
    if (!r.ok)
      throw r.code === 'too-fast'
        ? new ArcadeError(400, game === '2048' ? '手が速すぎるので、このゲームは記録しませんでした' : '速すぎるので、このゲームは記録しませんでした', 'too-fast')
        : new ArcadeError(400, '手順が正しくないので、このゲームは記録しませんでした', 'bad-moves');
    const n = r.moves;
    const monthStart = jstMonthStart(this.now());
    const oldBest = this.store.bestScoreOf(game, k);
    const oldMonth = this.store.bestScoreOf(game, k, monthStart);
    const detail = r.detail ? { detail: r.detail } : {};
    if (r.score <= 0)
      return { recorded: false, score: 0, maxTile: r.maxTile, moves: n, best: oldBest, newBest: false, rank: this.ranksOf(game, k), ...detail };
    const u = this.store.getUser(k);
    const p = this.online.get(k);
    const name = p?.name ?? u?.name ?? '？';
    const before = JSON.stringify(this.rankingTop(game));
    this.store.addGameScore({ game, at: this.now(), keyHash: k, pid: p?.pid ?? u?.pid ?? '', name, score: r.score, maxTile: r.maxTile, moves: n, ms, detail: r.detail });
    const rank = this.ranksOf(game, k);
    const newBest = r.score > oldBest;
    // 自己ベストで総合 10 位以内・今月の自己ベストで今月 3 位以内なら、その人のいる部屋のチャットに案内
    const parts: string[] = [];
    if (newBest && rank.all !== null && rank.all <= RANKING_ANNOUNCE.all) parts.push(`総合 ${rank.all} 位`);
    if (r.score > oldMonth && rank.month !== null && rank.month <= RANKING_ANNOUNCE.month) parts.push(`今月 ${rank.month} 位`);
    if (parts.length)
      this.addChat(this.roomOf(k), 'system', null, null, `🏆 ${name} さんが ${gameInfo(game)?.title ?? game} で ${formatScore(r.score)} 点！（${parts.join('・')}）`);
    this.broadcastRanking(game, before);
    return { recorded: true, score: r.score, maxTile: r.maxTile, moves: n, best: Math.max(oldBest, r.score), newBest, rank, ...detail };
  }

  private entry(r: GameScoreRow, rank: number): RankingEntry {
    return { id: r.id, rank, name: r.name, score: r.score, maxTile: r.maxTile, at: r.at, ...(r.detail ? { detail: r.detail } : {}) };
  }

  /** 立て看板に描く上位（総合） */
  rankingTop(game: string): RankingEntry[] {
    return this.store
      .gameBests(game)
      .slice(0, RANKING_POSTER_TOP)
      .map((r, i) => this.entry(r, i + 1));
  }

  /** 上位が変わっていたら全部の部屋へ（before = 変える前の上位の JSON） */
  private broadcastRanking(game: string, before?: string): void {
    const top = this.rankingTop(game);
    if (before !== undefined && JSON.stringify(top) === before) return;
    this.hooks.broadcast({ type: 'ranking', game, top });
  }

  /** その鍵の順位（自己ベストで。総合・今月） */
  private ranksOf(game: string, k: string): { all: number | null; month: number | null } {
    const at = (list: GameScoreRow[]) => {
      const i = list.findIndex((r) => r.keyHash === k);
      return i < 0 ? null : i + 1;
    };
    return { all: at(this.store.gameBests(game)), month: at(this.store.gameBests(game, jstMonthStart(this.now()))) };
  }

  /** ランキング（誰でも）：上位 50 人と、鍵があれば自分 */
  ranking(keyHash: string | null, rawGame: unknown, rawPeriod: unknown): RankingResponse {
    const game = this.requireGame(rawGame);
    const period = isRankingPeriod(rawPeriod) ? rawPeriod : 'all';
    const list = this.store.gameBests(game, period === 'month' ? jstMonthStart(this.now()) : 0);
    const i = keyHash ? list.findIndex((r) => r.keyHash === keyHash) : -1;
    return {
      period,
      entries: list.slice(0, RANKING_LIST_MAX).map((r, j) => this.entry(r, j + 1)),
      me: i >= 0 ? this.entry(list[i], i + 1) : null,
      total: list.length,
    };
  }

  /** 記録を 1 行消す（サイトの管理者。不適切な名前など）。その人の次に良い記録が順位に出る */
  deleteGameScore(keyHash: string | null, rawGame: unknown, rawId: unknown): void {
    this.requireAdmin(keyHash);
    const game = this.requireGame(rawGame);
    const id = Number(rawId);
    const row = Number.isInteger(id) ? this.store.getGameScore(id) : undefined;
    if (!row || row.game !== game) throw new ArcadeError(404, 'その記録はありません', 'not-found');
    const before = JSON.stringify(this.rankingTop(game));
    this.store.deleteGameScore(id);
    this.broadcastRanking(game, before);
  }
}

/** ノートに書いたことをチャットに流すのは、同じ人は 30 分に 1 回まで */
export const NOTE_ANNOUNCE_MS = 30 * 60 * 1000;

/** 発言の検証（形・文字数・NG 語） */
export const checkChat = (raw: unknown): string => {
  const text = typeof raw === 'string' ? tidy(raw) : '';
  if (!text) throw new ArcadeError(400, '発言を入れてください', 'bad-input');
  if (charLength(text) > CHAT_MAX) throw new ArcadeError(400, `発言は ${CHAT_MAX} 文字までです`, 'too-long');
  if (hasNgWord(text)) throw new ArcadeError(400, '使えない言葉が含まれています', 'ng');
  return text;
};
