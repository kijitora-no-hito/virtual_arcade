// 店の状態（店内にいる人・筐体・チャット・お知らせ）と操作。HTTP・WebSocket からは app.ts が呼ぶ。
// 人の位置はサーバが持つ（経路と出発時刻。歩いている途中の位置は positionAt で同じ式を使って求める）。

import {
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
import type { PosterRow, Store, UserRow } from './db';
import { checkPassphrase, newPid } from './secret';


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
}

export interface Hooks {
  /** 店内の全員へ */
  broadcast: (msg: ServerMessage) => void;
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

export class Arcade {
  private online = new Map<string, Online>();
  private cabinets: CabinetRecord[];
  private hooks: Hooks = { broadcast: () => {}, send: () => {}, drop: () => {} };
  private now: () => number;
  private rng: () => number;
  private badges = new Map<string, BadgeHold>();
  /** クレーンゲームの次に遊べる時刻（鍵ごと） */
  private craneNext = new Map<string, number>();
  /** クレーンゲームのケース（台ごと。メモリだけ） */
  private machines = new Map<number, CraneMachine>();
  /** ノートに書いたことをチャットに流した時刻（鍵ごと。控えめにするため） */
  private noteAnnounced = new Map<string, number>();

  constructor(
    private store: Store,
    private cfg: Config,
  ) {
    this.now = cfg.now ?? Date.now;
    this.rng = cfg.rng ?? Math.random;
    const saved = new Map(store.loadCabinets().map((c) => [c.id, c]));
    this.cabinets = FLOOR.cabinets.map((s) => {
      const c = saved.get(s.id);
      return c ? { ...emptyCabinet(s.id), ...c, id: s.id } : emptyCabinet(s.id);
    });
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
    };
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

  onlineCount(): number {
    return this.online.size;
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
    if (!old && !this.online.has(k) && this.online.size >= this.cfg.maxPlayers)
      throw new ArcadeError(503, `満員です（${this.cfg.maxPlayers} 人まで）。少し待ってから入ってください`, 'full');
    const u: UserRow = old
      ? { ...old, name, look, last_seen: now }
      : { key_hash: k, pid: newPid(), name, look, x: null, y: null, created_at: now, last_seen: now, admin_until: 0 };
    this.store.upsertUser(u);
    const p = this.online.get(k);
    if (p) {
      p.name = name;
      p.look = look;
      this.hooks.broadcast({ type: 'player', player: this.playerView(p) });
      this.hooks.send(k, { type: 'you', you: this.profileOf(u) });
    }
    return this.profileOf(u);
  }

  /**
   * WebSocket がつながった。店内に入れて、最初の状態を返す（ほかの人には join）。
   * すでに店内にいる（別のタブ・再接続）なら、位置はそのまま。
   */
  connect(keyHash: string | null): WelcomeMessage {
    const k = this.requireKey(keyHash);
    const u = this.store.getUser(k);
    if (!u) throw new ArcadeError(409, '先に名前と見た目を決めてください', 'need-enter');
    this.requireBanFree(k);
    const now = this.now();
    let p = this.online.get(k);
    if (!p) {
      if (this.online.size >= this.cfg.maxPlayers && !this.isAdmin(k))
        throw new ArcadeError(503, `満員です（${this.cfg.maxPlayers} 人まで）。少し待ってから入ってください`, 'full');
      const start =
        u.x !== null && u.y !== null && isPassable(FLOOR, u.x, u.y)
          ? { x: u.x, y: u.y }
          : FLOOR.spawn[Math.floor(Math.random() * FLOOR.spawn.length)];
      p = { keyHash: k, pid: u.pid, name: u.name, look: u.look, path: [{ ...start }], startedAt: now, watching: null };
      this.online.set(k, p);
      const hold = this.badges.get(k);
      if (hold) hold.offSince = null;
      this.hooks.broadcast({ type: 'join', player: this.playerView(p) });
    }
    this.store.upsertUser({ ...u, last_seen: now });
    this.expire();
    // 管理者には要望の未読の件数（welcome の後に届くよう、次の順番で）
    if (this.isAdmin(k)) queueMicrotask(() => this.hooks.send(k, { type: 'requests', unread: this.store.countUnreadRequests() }));
    return {
      type: 'welcome',
      you: this.profileOf(u),
      serverNow: now,
      players: [...this.online.values()].map((x) => this.playerView(x)),
      cabinets: this.cabinets.map((c) => this.cabinetView(c)),
      chat: this.store.recentChat(),
      notices: this.store.recentNotices(),
      posters: this.listPosters(),
      maxPlayers: this.cfg.maxPlayers,
    };
  }

  /** 接続が切れた（店を出た）。位置を覚えておく */
  disconnect(keyHash: string): void {
    const p = this.online.get(keyHash);
    if (!p) return;
    this.online.delete(keyHash);
    const now = this.now();
    const at = currentTile(p.path, p.startedAt, now);
    const u = this.store.getUser(keyHash);
    if (u) this.store.upsertUser({ ...u, x: at.x, y: at.y, last_seen: now });
    const hold = this.badges.get(keyHash);
    if (hold) hold.offSince = now;
    this.hooks.broadcast({ type: 'leave', pid: p.pid });
  }

  /** 退店（バッジを消して、接続を切る。名前と見た目・最後の位置は残る） */
  leave(keyHash: string | null): void {
    const k = this.requireKey(keyHash);
    this.badges.delete(k);
    this.craneNext.delete(k);
    this.hooks.drop(k, { type: 'bye' });
    this.disconnect(k);
  }

  /** 切断から badgeKeepMs たったバッジを消す */
  expireBadges(): void {
    const now = this.now();
    for (const [k, h] of this.badges)
      if (h.offSince !== null && now - h.offSince >= this.cfg.badgeKeepMs && !this.online.has(k)) this.badges.delete(k);
    for (const [k, t] of this.craneNext) if (t < now - 60_000) this.craneNext.delete(k);
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
    this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: null });
  }

  emote(keyHash: string | null, emoji: unknown): Emote {
    const p = this.requireOnline(keyHash);
    if (!isEmote(emoji)) throw new ArcadeError(400, 'そのエモーションはありません', 'bad-input');
    this.hooks.broadcast({ type: 'emote', pid: p.pid, emoji, at: this.now() });
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
      const c = this.cabinetRecord(id);
      if (!c.videoId) throw new ArcadeError(409, 'この筐体には配信が設定されていません', 'no-stream');
      p.path = [frontTile(spot)];
      p.startedAt = this.now();
      p.watching = id;
    }
    this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: p.watching });
  }

  // ---------------------------------------------------------------- チャット

  say(keyHash: string | null, raw: unknown): ChatMessage {
    const p = this.requireOnline(keyHash);
    const text = checkChat(raw);
    return this.addChat('user', p.pid, p.name, text, this.badgesOf(p.keyHash));
  }

  /** 自分の発言を 1 つだけピン止めする（頭上の吹き出しが出しっぱなしになる）。pinned = false で外す */
  pinChat(keyHash: string | null, rawId: unknown, pinned: unknown): PinnedChat | null {
    const p = this.requireOnline(keyHash);
    const id = Number(rawId);
    const row = Number.isInteger(id) ? this.store.getChatRow(id) : undefined;
    if (!row) throw new ArcadeError(404, 'その発言はありません', 'not-found');
    if (row.kind !== 'user' || row.pid !== p.pid) throw new ArcadeError(403, 'ピン止めできるのは自分の発言だけです', 'not-owner');
    const h = this.hold(p.keyHash);
    if (pinned === false) {
      if (h.pinned?.id === id) h.pinned = null;
    } else h.pinned = { id, text: row.text };
    const now = h.pinned;
    this.tidyHold(p.keyHash);
    this.hooks.broadcast({ type: 'player', player: this.playerView(p) });
    return now;
  }

  /** 消された発言のピン止めを外す */
  private unpinDeleted(chatId: number): void {
    for (const [k, h] of this.badges)
      if (h.pinned?.id === chatId) {
        h.pinned = null;
        this.tidyHold(k);
        const p = this.online.get(k);
        if (p) this.hooks.broadcast({ type: 'player', player: this.playerView(p) });
      }
  }

  private addChat(kind: ChatKind, pid: string | null, name: string | null, text: string, badges = ''): ChatMessage {
    const at = this.now();
    const id = this.store.addChat({ at, kind, pid, name, text, badges });
    const message: ChatMessage = { id, at, kind, pid, name, text };
    if (badges) message.badges = badges;
    this.hooks.broadcast({ type: 'chat', message });
    return message;
  }

  recentChat(): ChatMessage[] {
    return this.store.recentChat();
  }

  // ---------------------------------------------------------------- 筐体

  private cabinetRecord(id: number): CabinetRecord {
    const c = this.cabinets.find((x) => x.id === id);
    if (!c) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    return c;
  }

  private putCabinet(c: CabinetRecord): CabinetView {
    this.cabinets = this.cabinets.map((x) => (x.id === c.id ? c : x));
    this.store.saveCabinet(c);
    const v = this.cabinetView(c);
    this.hooks.broadcast({ type: 'cabinet', cabinet: v });
    // 配信が外れた筐体を視聴していた人は立たせる
    if (!c.videoId)
      for (const p of this.online.values())
        if (p.watching === c.id) {
          p.watching = null;
          this.hooks.broadcast({ type: 'move', pid: p.pid, path: p.path, startedAt: p.startedAt, watching: null });
        }
    return v;
  }

  /** 時間切れの筐体を空きにする（定期的に・操作の前に呼ぶ） */
  expire(): number[] {
    const { cabinets, expired } = expireCabinets(this.cabinets, this.now(), this.cfg.cabinetTtlMs);
    if (!expired.length) return expired;
    for (const id of expired) this.putCabinet(cabinets.find((c) => c.id === id)!);
    return expired;
  }

  listCabinets(): CabinetView[] {
    this.expire();
    return this.cabinets.map((c) => this.cabinetView(c));
  }

  /** 空いている筐体を使う（持ち主になる）。近く（2 マス以内）にいること。1 人 1 台 */
  claim(keyHash: string | null, rawId: unknown): CabinetView {
    const p = this.requireOnline(keyHash);
    this.expire();
    const id = Number(rawId);
    const spot = Number.isInteger(id) ? cabinetSpot(id) : undefined;
    if (!spot) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    if (cabinetDistance(this.tileOf(p), spot) > 2) throw new ArcadeError(409, '筐体の近くまで行ってから使ってください', 'too-far');
    const err = claimError(this.cabinets, id, p.keyHash, this.now(), this.cfg.cabinetTtlMs);
    if (err === 'taken') throw new ArcadeError(409, 'この筐体はほかの人が使っています', 'taken');
    if (err === 'already-own')
      throw new ArcadeError(409, 'ほかの筐体を使っています（同時に使えるのは 1 台です。先にそちらを空けてください）', 'already-own');
    if (err) throw new ArcadeError(404, 'その筐体はありません', 'not-found');
    const c = claimCabinet(this.cabinetRecord(id), { id: p.keyHash, name: p.name, pid: p.pid }, this.now(), this.cfg.cabinetTtlMs);
    return this.putCabinet(c);
  }

  /** 設定（配信の URL・宣伝）。持ち主か管理者 */
  updateCabinet(keyHash: string | null, rawId: unknown, input: unknown): CabinetView {
    const k = this.requireKey(keyHash);
    this.expire();
    const id = Number(rawId);
    const c = this.cabinetRecord(Number.isInteger(id) ? id : -1);
    const admin = this.isAdmin(k);
    if (!admin && c.ownerId !== k) throw new ArcadeError(403, 'この筐体を設定できるのは持ち主か管理者だけです', 'not-owner');
    if (!admin) this.requireBanFree(k);
    const { value, error } = validateCabinetInput(input);
    if (!value) throw new ArcadeError(400, error!.message, error!.code);
    return this.putCabinet(applyCabinetInput(c, value, this.now()));
  }

  /** 空ける（持ち主か管理者） */
  releaseCabinet(keyHash: string | null, rawId: unknown): CabinetView {
    const k = this.requireKey(keyHash);
    this.expire();
    const id = Number(rawId);
    const c = this.cabinetRecord(Number.isInteger(id) ? id : -1);
    const admin = this.isAdmin(k);
    if (!admin && c.ownerId !== k) throw new ArcadeError(403, 'この筐体を空けられるのは持ち主か管理者だけです', 'not-owner');
    return this.putCabinet(releaseCabinet(c));
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
    if (p) this.hooks.broadcast({ type: 'player', player: this.playerView(p) });
    const u = this.store.getUser(k);
    if (u) this.hooks.send(k, { type: 'you', you: this.profileOf(u) });
  }

  private requireAdmin(keyHash: string | null): string {
    const k = this.requireKey(keyHash);
    if (!this.isAdmin(k)) throw new ArcadeError(403, '管理者だけができる操作です', 'not-admin');
    return k;
  }

  /** お知らせ（壁の大画面とチャットに流す） */
  postNotice(keyHash: string | null, raw: unknown): Notice {
    this.requireAdmin(keyHash);
    const text = typeof raw === 'string' ? tidy(raw) : '';
    if (!text) throw new ArcadeError(400, 'お知らせを入れてください', 'bad-input');
    if (charLength(text) > NOTICE_MAX) throw new ArcadeError(400, `お知らせは ${NOTICE_MAX} 文字までです`, 'too-long');
    const at = this.now();
    const id = this.store.addNotice(at, text);
    this.hooks.broadcast({ type: 'notices', notices: this.store.recentNotices() });
    this.addChat('notice', null, 'お知らせ', text);
    return { id, at, text };
  }

  deleteNotice(keyHash: string | null, rawId: unknown): void {
    this.requireAdmin(keyHash);
    const id = Number(rawId);
    const notice = Number.isInteger(id) ? this.store.getNotice(id) : undefined;
    if (!notice || !this.store.deleteNotice(id)) throw new ArcadeError(404, 'そのお知らせはありません', 'not-found');
    this.hooks.broadcast({ type: 'notices', notices: this.store.recentNotices() });
    // チャット欄に流れた同じお知らせも消す（全員の画面から）
    for (const chatId of this.store.noticeChatIds(notice)) {
      if (this.store.deleteChat(chatId)) this.hooks.broadcast({ type: 'chat-delete', id: chatId });
    }
  }

  notices(): Notice[] {
    return this.store.recentNotices();
  }

  /** チャットの発言を消す（全員の画面から消える） */
  deleteChat(keyHash: string | null, rawId: unknown): void {
    this.requireAdmin(keyHash);
    const id = Number(rawId);
    const row = Number.isInteger(id) ? this.store.getChatKind(id) : undefined;
    if (!row || !this.store.deleteChat(id)) throw new ArcadeError(404, 'その発言はありません', 'not-found');
    this.hooks.broadcast({ type: 'chat-delete', id });
    this.unpinDeleted(id);
    // お知らせの行を消したら、元のお知らせ（壁の大画面に流れる分）も消す
    if (row.kind === 'notice') {
      let removed = false;
      for (const nid of this.store.noticeIdsForChat(row)) removed = this.store.deleteNotice(nid) || removed;
      if (removed) this.hooks.broadcast({ type: 'notices', notices: this.store.recentNotices() });
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
    this.hooks.drop(target.key_hash, { type: 'kicked', reason, ...(until ? { until } : {}) });
    this.disconnect(target.key_hash);
    this.badges.delete(target.key_hash);
    this.addChat('system', null, null, `${target.name} さんが退室になりました`);
    return { until };
  }

  /** 古い記録の掃除（入室の停止の期限切れ・長く来ていない人） */
  sweep(): void {
    const now = this.now();
    this.store.deleteExpiredBans(now);
    this.store.deleteStaleUsers(now - 180 * 24 * 60 * 60 * 1000);
    this.expire();
    this.expireBadges();
    this.expirePosters();
  }

  // ---------------------------------------------------------------- クレーンゲーム（DESIGN §8）

  private machine(id: number): CraneMachine {
    let m = this.machines.get(id);
    if (!m) {
      m = newMachine(id, this.rng);
      this.machines.set(id, m);
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
    return {
      machine: machineView(this.machine(spot.id)),
      cooldownUntil: this.craneNext.get(k) ?? 0,
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
    const next = this.craneNext.get(p.keyHash) ?? 0;
    if (now < next) throw new ArcadeError(429, `次に遊べるまで あと ${Math.ceil((next - now) / 1000)} 秒です`, 'cooldown');
    const cooldownUntil = now + this.cfg.craneCooldownMs;
    this.craneNext.set(p.keyHash, cooldownUntil);

    const r = resolveCrane(this.machine(spot.id), arm, this.rng, this.cfg.craneOdds);
    this.machines.set(spot.id, r.machine);
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
        this.hooks.broadcast({ type: 'player', player: this.playerView(p) });
        const u = this.store.getUser(p.keyHash);
        if (u) this.hooks.send(p.keyHash, { type: 'you', you: this.profileOf(u) });
        // 取れたときだけ案内する（ダブり・外れは流さない）
        this.addChat('system', null, null, `${p.name} さんがクレーンゲームで ${r.suit} を取った！`);
        if (completed) this.addChat('system', null, null, `🎉 ${p.name} さんが 4 種類コンプリート！`);
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

  // ---------------------------------------------------------------- ポスター（DESIGN §9）

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
    this.addChat('system', null, null, `📌 ${p.name} さんがポスターを貼りました：「${r.title}」（${formatPosterRange(r)}）`);
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
  // ---------------------------------------------------------------- コミュニケーションノート（v0.4.0。DESIGN §12）

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
    // チャットへの案内は控えめに（同じ人は NOTE_ANNOUNCE_MS に 1 回）
    const last = this.noteAnnounced.get(p.keyHash) ?? 0;
    if (this.now() - last >= NOTE_ANNOUNCE_MS) {
      this.noteAnnounced.set(p.keyHash, this.now());
      this.addChat('system', null, null, `📖 ${note.name} さんがノートに書きました`);
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

  /** 店内にいる管理者にだけ、未読の件数を知らせる */
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
