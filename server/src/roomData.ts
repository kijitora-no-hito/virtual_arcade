// v0.5.0：部屋ごとのチャット・お知らせ・筐体の置き場所（DESIGN §14）。
// オープン部屋は今までどおり SQLite（chat / notices / cabinets の表。形は変えない）。
// 予約部屋はメモリだけ（DB に書かない。予約の時間が終わったら clear で消す。サーバの再起動でも消える）。

import { CHAT_KEEP, type CabinetRecord, type ChatKind, type ChatMessage, type Notice } from '@va/shared';
import type { Store } from './db';

export interface ChatRowInput {
  at: number;
  kind: ChatKind;
  pid: string | null;
  name: string | null;
  text: string;
  badges?: string;
  /** 予約部屋の主催者の発言（メモリの部屋だけ持つ） */
  host?: boolean;
}

export interface RoomData {
  /** DB に残す（オープン部屋）か、メモリだけ（予約部屋） */
  readonly persistent: boolean;
  loadCabinets(): CabinetRecord[];
  saveCabinet(c: CabinetRecord): void;
  addChat(m: ChatRowInput): number;
  recentChat(): ChatMessage[];
  deleteChat(id: number): boolean;
  /** v0.5.1：古い発言（at < before）を消して id を返す（お知らせは消さない） */
  expireChat(before: number): number[];
  getChatRow(id: number): { id: number; kind: string; pid: string | null; text: string } | undefined;
  getChatKind(id: number): { kind: string; at: number; text: string } | undefined;
  noticeIdsForChat(c: { at: number; text: string }): number[];
  noticeChatIds(n: Notice): number[];
  addNotice(at: number, text: string): number;
  recentNotices(): Notice[];
  deleteNotice(id: number): boolean;
  getNotice(id: number): Notice | undefined;
  /** 全部消す（予約部屋の時間が終わったとき。DB の部屋では何もしない） */
  clear(): void;
}

/** オープン部屋：今までの表をそのまま使う */
export const dbRoomData = (store: Store): RoomData => ({
  persistent: true,
  loadCabinets: () => store.loadCabinets(),
  saveCabinet: (c) => store.saveCabinet(c),
  addChat: (m) => store.addChat(m),
  recentChat: () => store.recentChat(),
  deleteChat: (id) => store.deleteChat(id),
  expireChat: (before) => store.expireChat(before),
  getChatRow: (id) => store.getChatRow(id),
  getChatKind: (id) => store.getChatKind(id),
  noticeIdsForChat: (c) => store.noticeIdsForChat(c),
  noticeChatIds: (n) => store.noticeChatIds(n),
  addNotice: (at, text) => store.addNotice(at, text),
  recentNotices: () => store.recentNotices(),
  deleteNotice: (id) => store.deleteNotice(id),
  getNotice: (id) => store.getNotice(id),
  clear: () => {},
});

/** お知らせを残す件数（DB の部屋と同じ） */
const NOTICE_KEEP = 20;
/** 予約部屋の id は DB の行と見分けやすいよう大きな数から（クライアントは部屋を移ると一覧ごと差し替える） */
const MEM_ID_BASE = 1_000_000_000;

interface MemChat extends ChatMessage {
  badges?: string;
}

/** 予約部屋：メモリだけ */
export class MemRoomData implements RoomData {
  readonly persistent = false;
  private cabinets = new Map<number, CabinetRecord>();
  private chat: MemChat[] = [];
  private notices: Notice[] = [];
  private nextId = MEM_ID_BASE;

  loadCabinets(): CabinetRecord[] {
    return [...this.cabinets.values()].map((c) => ({ ...c }));
  }

  saveCabinet(c: CabinetRecord): void {
    this.cabinets.set(c.id, { ...c });
  }

  addChat(m: ChatRowInput): number {
    const id = ++this.nextId;
    const row: MemChat = { id, at: m.at, kind: m.kind, pid: m.pid, name: m.name, text: m.text };
    if (m.badges) row.badges = m.badges;
    if (m.host) row.host = true;
    this.chat.push(row);
    if (this.chat.length > CHAT_KEEP) this.chat = this.chat.slice(-CHAT_KEEP);
    return id;
  }

  recentChat(): ChatMessage[] {
    return this.chat.map((m) => ({ ...m }));
  }

  deleteChat(id: number): boolean {
    const n = this.chat.length;
    this.chat = this.chat.filter((m) => m.id !== id);
    return this.chat.length < n;
  }

  expireChat(before: number): number[] {
    const gone = this.chat.filter((m) => m.at < before).map((m) => m.id);
    if (gone.length) this.chat = this.chat.filter((m) => m.at >= before);
    return gone;
  }

  getChatRow(id: number) {
    const m = this.chat.find((x) => x.id === id);
    return m ? { id: m.id, kind: m.kind, pid: m.pid, text: m.text } : undefined;
  }

  getChatKind(id: number) {
    const m = this.chat.find((x) => x.id === id);
    return m ? { kind: m.kind, at: m.at, text: m.text } : undefined;
  }

  noticeIdsForChat(c: { at: number; text: string }, windowMs = 5000): number[] {
    return this.notices.filter((n) => n.text === c.text && Math.abs(n.at - c.at) <= windowMs).map((n) => n.id);
  }

  noticeChatIds(n: Notice, windowMs = 5000): number[] {
    return this.chat.filter((m) => m.kind === 'notice' && m.text === n.text && Math.abs(m.at - n.at) <= windowMs).map((m) => m.id);
  }

  addNotice(at: number, text: string): number {
    const id = ++this.nextId;
    this.notices.push({ id, at, text });
    if (this.notices.length > NOTICE_KEEP) this.notices = this.notices.slice(-NOTICE_KEEP);
    return id;
  }

  recentNotices(limit = 5): Notice[] {
    return this.notices
      .slice(-limit)
      .reverse()
      .map((n) => ({ ...n }));
  }

  deleteNotice(id: number): boolean {
    const n = this.notices.length;
    this.notices = this.notices.filter((x) => x.id !== id);
    return this.notices.length < n;
  }

  getNotice(id: number): Notice | undefined {
    const n = this.notices.find((x) => x.id === id);
    return n ? { ...n } : undefined;
  }

  clear(): void {
    this.cabinets.clear();
    this.chat = [];
    this.notices = [];
  }
}
