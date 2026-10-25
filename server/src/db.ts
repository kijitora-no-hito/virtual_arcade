// SQLite（node:sqlite の DatabaseSync）。来た人・入室の停止・筐体・チャット（直近）・お知らせ。
// 秘密鍵はハッシュだけを保存する。IP アドレスは保存しない。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CHAT_KEEP,
  NOTE_MAX_TOTAL,
  REQUEST_MAX_TOTAL,
  type NoteInput,
  type NoteView,
  type RequestInput,
  type RequestKind,
  type RequestStatus,
  type RequestView,
  posterExpiresAt,
  type CabinetRecord,
  type ChatKind,
  type ChatMessage,
  type Look,
  type Notice,
  type PosterInput,
  type PosterKind,
  type PosterView,
  type ReservationView,
} from '@va/shared';

/** ポスターの行（書いた人の鍵のハッシュつき） */
export interface PosterRow extends PosterView {
  authorKey: string;
}

/** 予約の行（v0.5.0。合言葉のハッシュ・予約した人の鍵のハッシュつき。どちらもクライアントには送らない） */
export interface ReservationRow extends ReservationView {
  passHash: string;
  ownerKey: string;
}

export interface UserRow {
  key_hash: string;
  pid: string;
  name: string;
  look: Look;
  x: number | null;
  y: number | null;
  created_at: number;
  last_seen: number;
  admin_until: number;
}

/** お知らせを残す件数 */
const NOTICE_KEEP = 20;

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        key_hash TEXT PRIMARY KEY,
        pid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        look TEXT NOT NULL,
        x INTEGER,
        y INTEGER,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        admin_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS users_seen ON users(last_seen);
      CREATE TABLE IF NOT EXISTS bans (
        key_hash TEXT PRIMARY KEY,
        until INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cabinets (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        pid TEXT,
        name TEXT,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS posters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_key TEXT NOT NULL,
        author_pid TEXT NOT NULL,
        author_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        game TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        author_key TEXT NOT NULL,
        author_pid TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        host TEXT NOT NULL,
        description TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        owner_pid TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reservations_end ON reservations(end_at);
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new'
      );
    `);
    // v0.3.0：発言したときのバッジ（前の版の DB には列が無い）
    const cols = (this.db.prepare(`PRAGMA table_info(chat)`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('badges')) this.db.exec(`ALTER TABLE chat ADD COLUMN badges TEXT NOT NULL DEFAULT ''`);
  }

  // ---------------------------------------------------------------- 来た人

  getUser(keyHash: string): UserRow | undefined {
    const r = this.db.prepare(`SELECT * FROM users WHERE key_hash = ?`).get(keyHash) as Record<string, unknown> | undefined;
    return r ? this.toUser(r) : undefined;
  }

  getUserByPid(pid: string): UserRow | undefined {
    const r = this.db.prepare(`SELECT * FROM users WHERE pid = ?`).get(pid) as Record<string, unknown> | undefined;
    return r ? this.toUser(r) : undefined;
  }

  private toUser(r: Record<string, unknown>): UserRow {
    let look: Look;
    try {
      look = JSON.parse(String(r.look));
    } catch {
      look = { color: 'cyan', hat: 'none' };
    }
    return {
      key_hash: String(r.key_hash),
      pid: String(r.pid),
      name: String(r.name),
      look,
      x: r.x === null ? null : Number(r.x),
      y: r.y === null ? null : Number(r.y),
      created_at: Number(r.created_at),
      last_seen: Number(r.last_seen),
      admin_until: Number(r.admin_until),
    };
  }

  upsertUser(u: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO users (key_hash, pid, name, look, x, y, created_at, last_seen, admin_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET name = excluded.name, look = excluded.look, x = excluded.x, y = excluded.y,
           last_seen = excluded.last_seen, admin_until = excluded.admin_until`,
      )
      .run(u.key_hash, u.pid, u.name, JSON.stringify(u.look), u.x, u.y, u.created_at, u.last_seen, u.admin_until);
  }

  /** 最後に来たのが before より前の人を消す（入室の停止中の人は残す） */
  deleteStaleUsers(before: number): number {
    const r = this.db
      .prepare(`DELETE FROM users WHERE last_seen < ? AND key_hash NOT IN (SELECT key_hash FROM bans)`)
      .run(before);
    return Number(r.changes);
  }

  // ---------------------------------------------------------------- 入室の停止

  banUntil(keyHash: string): number {
    const r = this.db.prepare(`SELECT until FROM bans WHERE key_hash = ?`).get(keyHash) as { until: number } | undefined;
    return r ? Number(r.until) : 0;
  }

  setBan(keyHash: string, until: number): void {
    this.db
      .prepare(`INSERT INTO bans (key_hash, until) VALUES (?, ?) ON CONFLICT(key_hash) DO UPDATE SET until = excluded.until`)
      .run(keyHash, until);
  }

  deleteExpiredBans(now: number): void {
    this.db.prepare(`DELETE FROM bans WHERE until <= ?`).run(now);
  }

  // ---------------------------------------------------------------- 筐体

  loadCabinets(): CabinetRecord[] {
    const rows = this.db.prepare(`SELECT id, data FROM cabinets`).all() as Array<{ id: number; data: string }>;
    const out: CabinetRecord[] = [];
    for (const r of rows) {
      try {
        out.push({ ...(JSON.parse(r.data) as CabinetRecord), id: Number(r.id) });
      } catch {
        /* 読めない行は空きとして扱う */
      }
    }
    return out;
  }

  saveCabinet(c: CabinetRecord): void {
    this.db
      .prepare(`INSERT INTO cabinets (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(c.id, JSON.stringify(c));
  }

  // ---------------------------------------------------------------- チャット

  addChat(m: { at: number; kind: ChatKind; pid: string | null; name: string | null; text: string; badges?: string }): number {
    const r = this.db
      .prepare(`INSERT INTO chat (at, kind, pid, name, text, badges) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(m.at, m.kind, m.pid, m.name, m.text, m.badges ?? '');
    const id = Number(r.lastInsertRowid);
    this.db.prepare(`DELETE FROM chat WHERE id <= ?`).run(id - CHAT_KEEP);
    return id;
  }

  recentChat(limit = CHAT_KEEP): ChatMessage[] {
    const rows = this.db
      .prepare(`SELECT id, at, kind, pid, name, text, badges FROM chat ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as ChatMessage[];
    return rows.reverse().map((r) => {
      const m: ChatMessage = { id: Number(r.id), at: Number(r.at), kind: r.kind, pid: r.pid, name: r.name, text: r.text };
      if (r.badges) m.badges = String(r.badges);
      return m;
    });
  }

  deleteChat(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM chat WHERE id = ?`).run(id).changes) > 0;
  }

  /**
   * v0.5.1：古い発言（at < before）を消して、その id を返す。お知らせの表（notices）には触れない
   * （お知らせはお知らせの決まりで残す。deleteChat 経由の「お知らせの行を消すと元のお知らせも消す」は通さない）
   */
  expireChat(before: number): number[] {
    const rows = this.db.prepare(`SELECT id FROM chat WHERE at < ? ORDER BY id`).all(before) as unknown as Array<{ id: number }>;
    if (!rows.length) return [];
    this.db.prepare(`DELETE FROM chat WHERE at < ?`).run(before);
    return rows.map((r) => Number(r.id));
  }

  /** 1 件（ピン止めで本人の発言かを確かめる） */
  getChatRow(id: number): { id: number; kind: string; pid: string | null; text: string } | undefined {
    const r = this.db.prepare(`SELECT id, kind, pid, text FROM chat WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r ? { id: Number(r.id), kind: String(r.kind), pid: r.pid === null ? null : String(r.pid), text: String(r.text) } : undefined;
  }

  getChatKind(id: number): { kind: string; at: number; text: string } | undefined {
    const r = this.db.prepare(`SELECT kind, at, text FROM chat WHERE id = ?`).get(id) as unknown as { kind: string; at: number; text: string } | undefined;
    return r ? { kind: String(r.kind), at: Number(r.at), text: String(r.text) } : undefined;
  }

  /** チャットに流したお知らせの行から、元のお知らせ（同じ文・時刻の前後 [windowMs]）の id */
  noticeIdsForChat(c: { at: number; text: string }, windowMs = 5000): number[] {
    const rows = this.db
      .prepare(`SELECT id FROM notices WHERE text = ? AND at BETWEEN ? AND ?`)
      .all(c.text, c.at - windowMs, c.at + windowMs) as unknown as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  }

  // ---------------------------------------------------------------- お知らせ

  addNotice(at: number, text: string): number {
    const r = this.db.prepare(`INSERT INTO notices (at, text) VALUES (?, ?)`).run(at, text);
    const id = Number(r.lastInsertRowid);
    this.db.prepare(`DELETE FROM notices WHERE id <= ?`).run(id - NOTICE_KEEP);
    return id;
  }

  recentNotices(limit = 5): Notice[] {
    const rows = this.db.prepare(`SELECT id, at, text FROM notices ORDER BY id DESC LIMIT ?`).all(limit) as unknown as Notice[];
    return rows.map((r) => ({ id: Number(r.id), at: Number(r.at), text: String(r.text) }));
  }

  deleteNotice(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM notices WHERE id = ?`).run(id).changes) > 0;
  }

  getNotice(id: number): Notice | undefined {
    const r = this.db.prepare(`SELECT id, at, text FROM notices WHERE id = ?`).get(id) as unknown as Notice | undefined;
    return r ? { id: Number(r.id), at: Number(r.at), text: String(r.text) } : undefined;
  }

  /**
   * お知らせを出したときにチャットへ流した行（kind = notice・同じ文・出した時刻の前後 [windowMs]）の id。
   * お知らせを消すときに、チャット欄に流れた分も一緒に消すため（チャットの行はお知らせの id を持っていない）。
   */
  noticeChatIds(n: Notice, windowMs = 5000): number[] {
    const rows = this.db
      .prepare(`SELECT id FROM chat WHERE kind = 'notice' AND text = ? AND at BETWEEN ? AND ?`)
      .all(n.text, n.at - windowMs, n.at + windowMs) as unknown as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  }

  // ---------------------------------------------------------------- ポスター

  private toPoster(r: Record<string, unknown>): PosterRow {
    const startsAt = Number(r.starts_at);
    const endsAt = r.ends_at === null ? null : Number(r.ends_at);
    return {
      id: Number(r.id),
      authorKey: String(r.author_key),
      authorPid: String(r.author_pid),
      authorName: String(r.author_name),
      kind: String(r.kind) as PosterKind,
      title: String(r.title),
      game: String(r.game),
      body: String(r.body),
      url: r.url === null ? null : String(r.url),
      startsAt,
      endsAt,
      pinned: Number(r.pinned) === 1,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      expiresAt: posterExpiresAt({ startsAt, endsAt }),
    };
  }

  listPosters(): PosterRow[] {
    return (this.db.prepare(`SELECT * FROM posters`).all() as Array<Record<string, unknown>>).map((r) => this.toPoster(r));
  }

  getPoster(id: number): PosterRow | undefined {
    const r = this.db.prepare(`SELECT * FROM posters WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r ? this.toPoster(r) : undefined;
  }

  addPoster(author: { key: string; pid: string; name: string }, v: PosterInput, now: number): PosterRow {
    const r = this.db
      .prepare(
        `INSERT INTO posters (author_key, author_pid, author_name, kind, title, game, body, url, starts_at, ends_at, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(author.key, author.pid, author.name, v.kind, v.title, v.game, v.body, v.url, v.startsAt, v.endsAt, now, now);
    return this.getPoster(Number(r.lastInsertRowid))!;
  }

  updatePoster(id: number, authorName: string | null, v: PosterInput, now: number): PosterRow | undefined {
    this.db
      .prepare(
        `UPDATE posters SET kind = ?, title = ?, game = ?, body = ?, url = ?, starts_at = ?, ends_at = ?, updated_at = ?,
           author_name = COALESCE(?, author_name) WHERE id = ?`,
      )
      .run(v.kind, v.title, v.game, v.body, v.url, v.startsAt, v.endsAt, now, authorName, id);
    return this.getPoster(id);
  }

  setPosterPinned(id: number, pinned: boolean): boolean {
    return Number(this.db.prepare(`UPDATE posters SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id).changes) > 0;
  }

  deletePoster(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM posters WHERE id = ?`).run(id).changes) > 0;
  }

  /** 自動ではがす時刻を過ぎたものを消す。消した id */
  deleteExpiredPosters(now: number): number[] {
    const gone = this.listPosters()
      .filter((p) => p.expiresAt <= now)
      .map((p) => p.id);
    for (const id of gone) this.deletePoster(id);
    return gone;
  }

  // ---------------------------------------------------------------- ノート（v0.4.0。DESIGN §12）

  private toNote(r: Record<string, unknown>): NoteView & { authorKey: string } {
    return {
      id: Number(r.id),
      at: Number(r.at),
      pid: String(r.author_pid),
      name: String(r.name),
      text: String(r.text),
      authorKey: String(r.author_key),
    };
  }

  countNotes(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM notes`).get() as { n: number }).n);
  }

  /** 新しいものから limit 件（before があればその id より古いもの）を、古い順で */
  listNotes(limit: number, before: number | null): NoteView[] {
    const rows = (
      before === null
        ? this.db.prepare(`SELECT * FROM notes ORDER BY id DESC LIMIT ?`).all(limit)
        : this.db.prepare(`SELECT * FROM notes WHERE id < ? ORDER BY id DESC LIMIT ?`).all(before, limit)
    ) as Array<Record<string, unknown>>;
    return rows.reverse().map((r) => {
      const { authorKey: _k, ...v } = this.toNote(r);
      return v;
    });
  }

  getNote(id: number): (NoteView & { authorKey: string }) | undefined {
    const r = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r ? this.toNote(r) : undefined;
  }

  /** 書く。上限を超えたら古いものから消す（消した id も返す） */
  addNote(author: { key: string; pid: string }, v: NoteInput, at: number, max = NOTE_MAX_TOTAL): { note: NoteView; removed: number[] } {
    const r = this.db
      .prepare(`INSERT INTO notes (at, author_key, author_pid, name, text) VALUES (?, ?, ?, ?, ?)`)
      .run(at, author.key, author.pid, v.name, v.text);
    const id = Number(r.lastInsertRowid);
    const over = this.countNotes() - max;
    const removed =
      over > 0 ? (this.db.prepare(`SELECT id FROM notes ORDER BY id ASC LIMIT ?`).all(over) as Array<{ id: number }>).map((x) => Number(x.id)) : [];
    for (const rid of removed) this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(rid);
    return { note: { id, at, pid: author.pid, name: v.name, text: v.text }, removed };
  }

  deleteNote(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id).changes) > 0;
  }

  // ---------------------------------------------------------------- 要望（v0.4.0。DESIGN §13。管理者だけが読む）

  private toRequest(r: Record<string, unknown>): RequestView {
    return {
      id: Number(r.id),
      at: Number(r.at),
      kind: String(r.kind) as RequestKind,
      name: r.name === null ? null : String(r.name),
      text: String(r.text),
      status: String(r.status) as RequestStatus,
    };
  }

  addRequest(v: RequestInput, at: number, max = REQUEST_MAX_TOTAL): RequestView {
    const r = this.db.prepare(`INSERT INTO requests (at, kind, name, text, status) VALUES (?, ?, ?, ?, 'new')`).run(at, v.kind, v.name, v.text);
    const id = Number(r.lastInsertRowid);
    const n = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM requests`).get() as { n: number }).n);
    if (n > max) this.db.prepare(`DELETE FROM requests WHERE id IN (SELECT id FROM requests ORDER BY id ASC LIMIT ?)`).run(n - max);
    return { id, at, ...v, status: 'new' };
  }

  /** 新しい順 */
  listRequests(): RequestView[] {
    return (this.db.prepare(`SELECT * FROM requests ORDER BY id DESC`).all() as Array<Record<string, unknown>>).map((r) => this.toRequest(r));
  }

  countUnreadRequests(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = 'new'`).get() as { n: number }).n);
  }

  setRequestStatus(id: number, status: RequestStatus): boolean {
    return Number(this.db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id).changes) > 0;
  }

  deleteRequest(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM requests WHERE id = ?`).run(id).changes) > 0;
  }

  // ---------------------------------------------------------------- 予約（v0.5.0。DESIGN §14。新しい表だけ。前の版はこの表を読まない）

  private toReservation(r: Record<string, unknown>): ReservationRow {
    return {
      id: Number(r.id),
      createdAt: Number(r.created_at),
      startAt: Number(r.start_at),
      endAt: Number(r.end_at),
      title: String(r.title),
      host: String(r.host),
      description: String(r.description),
      passHash: String(r.pass_hash),
      ownerKey: String(r.owner_key),
      ownerPid: String(r.owner_pid),
    };
  }

  /** まだ終わっていない予約（終わりが after より後）を開始の順に */
  listReservations(after: number): ReservationRow[] {
    return (this.db.prepare(`SELECT * FROM reservations WHERE end_at > ? ORDER BY start_at ASC`).all(after) as Array<Record<string, unknown>>).map((r) =>
      this.toReservation(r),
    );
  }

  addReservation(r: Omit<ReservationRow, 'id'>): ReservationRow {
    const res = this.db
      .prepare(
        `INSERT INTO reservations (created_at, start_at, end_at, title, host, description, pass_hash, owner_key, owner_pid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.createdAt, r.startAt, r.endAt, r.title, r.host, r.description, r.passHash, r.ownerKey, r.ownerPid);
    return { ...r, id: Number(res.lastInsertRowid) };
  }

  /** 合言葉の付け替え・早めに終える（v0.5.0。主催者の操作） */
  updateReservation(id: number, v: { passHash?: string; endAt?: number }): void {
    if (v.passHash !== undefined) this.db.prepare(`UPDATE reservations SET pass_hash = ? WHERE id = ?`).run(v.passHash, id);
    if (v.endAt !== undefined) this.db.prepare(`UPDATE reservations SET end_at = ? WHERE id = ?`).run(v.endAt, id);
  }

  deleteReservation(id: number): boolean {
    return Number(this.db.prepare(`DELETE FROM reservations WHERE id = ?`).run(id).changes) > 0;
  }

  /** 古い行を消す（終わってから keepMs より前のもの・maxRows を超えた古いもの） */
  pruneReservations(now: number, keepMs: number, maxRows: number): void {
    this.db.prepare(`DELETE FROM reservations WHERE end_at < ?`).run(now - keepMs);
    const n = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM reservations`).get() as { n: number }).n);
    if (n > maxRows) this.db.prepare(`DELETE FROM reservations WHERE id IN (SELECT id FROM reservations ORDER BY end_at ASC LIMIT ?)`).run(n - maxRows);
  }

  countReservations(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM reservations`).get() as { n: number }).n);
  }

  close(): void {
    this.db.close();
  }
}
