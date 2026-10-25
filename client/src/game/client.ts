// 店の状態をブラウザ側で持つ（WebSocket で受け取る）。描画は毎フレームここを読む。
// React の画面（チャット・窓）は subscribe で変化を知る。

import {
  BUBBLE_MS,
  EMOTE_MS,
  type CabinetView,
  type ChatMessage,
  type ClientMessage,
  type Emote,
  type Notice,
  type PlayerView,
  type PosterView,
  type Point,
  type Profile,
  type ReservationView,
  type RoomId,
  type ServerMessage,
  PROTOCOL,
  estimateOffset,
} from '@va/shared';
import { myKey, wsUrl } from '../api';

declare const __VA_CLIENT_VERSION__: string | undefined;
/** このページ（クライアント）の版。サーバの版と違えば「新しい版があります」を出す（v0.5.0） */
export const CLIENT_VERSION = typeof __VA_CLIENT_VERSION__ !== 'undefined' ? __VA_CLIENT_VERSION__ : '';

export interface ClientPlayer extends PlayerView {
  /** 描画中の位置（なめらかに追う） */
  rx: number;
  ry: number;
  dir: -1 | 1;
  bubble: { text: string; until: number } | null;
  emote: { emoji: Emote; at: number } | null;
}

export type Fatal =
  | { code: 'kicked'; text: string }
  | { code: 'replaced'; text: string }
  | { code: 'banned' | 'full' | 'need-enter' | 'no-key' | 'other'; text: string };

const CHAT_KEEP = 200;

export type NoteEvent = Extract<ServerMessage, { type: 'note' | 'note-delete' }>;

export class ArcadeClient {
  players = new Map<string, ClientPlayer>();
  cabinets = new Map<number, CabinetView>();
  chat: ChatMessage[] = [];
  notices: Notice[] = [];
  posters: PosterView[] = [];
  you: Profile | null = null;
  /** 退店した（つなぎ直さない） */
  left = false;
  maxPlayers = 50;
  connected = false;
  fatal: Fatal | null = null;
  /** 直近のエラー（移動できない など。画面の下に少し出す） */
  toast: { text: string; at: number } | null = null;
  /** 変化の数（React の再描画用） */
  version = 0;
  /** 要望箱の未読の件数（管理者だけに届く。DESIGN §13） */
  requestsUnread = 0;
  /** v0.5.0：いまいる部屋（welcome で決まる）。つなぎ直すときもこの部屋を頼む */
  room: RoomId = 'open';
  /** 部屋が変わった回数（描画・窓を作り直す合図） */
  roomSeq = 0;
  /** 予約の一覧（これからの分） */
  reservations: ReservationView[] = [];
  /** サーバの版がこのページの版と違う（再読み込みを勧める） */
  outdated = false;

  constructor(initialRoom: RoomId = 'open') {
    this.room = initialRoom;
  }
  /** ノートに書かれた・消された（開いているノートの窓が受け取る。DESIGN §12） */
  private noteListeners = new Set<(m: NoteEvent) => void>();

  onNote = (fn: (m: NoteEvent) => void): (() => void) => {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  };

  private offset = 0;
  /** 最後に ping を送った時刻（pong の serverNow と合わせて時計の差を出す） */
  private pingAt = 0;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: number | undefined;
  private ping: number | undefined;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** サーバの時刻（受け取った serverNow との差で合わせる） */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  me(): ClientPlayer | undefined {
    return this.you ? this.players.get(this.you.pid) : undefined;
  }

  connect(): void {
    this.closed = false;
    this.fatal = null;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', key: myKey(), proto: PROTOCOL, v: CLIENT_VERSION, room: this.room }));
      const ping = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        this.pingAt = Date.now();
        ws.send('ping');
      };
      this.ping = window.setInterval(ping, 25000);
      // 予約部屋の残り時間のため、つないだ直後にも 1 回合わせる（welcome の serverNow は片道の遅れを含む）
      window.setTimeout(ping, 1500);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      window.clearInterval(this.ping);
      if (this.ws !== ws) return;
      this.connected = false;
      this.changed();
      if (this.closed) return;
      this.retry = Math.min(this.retry + 1, 5);
      this.timer = window.setTimeout(() => this.connect(), 500 * 2 ** this.retry);
    };
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private toPlayer(v: PlayerView, prev?: ClientPlayer): ClientPlayer {
    const p0 = v.path[0];
    return {
      ...v,
      rx: prev?.rx ?? p0.x,
      ry: prev?.ry ?? p0.y,
      dir: prev?.dir ?? 1,
      bubble: prev?.bubble ?? null,
      emote: prev?.emote ?? null,
    };
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.offset = msg.serverNow - Date.now();
        this.you = msg.you;
        this.maxPlayers = msg.maxPlayers;
        const room = msg.room ?? 'open';
        if (room !== this.room || this.roomSeq === 0) this.roomSeq++;
        // 部屋が変わったら前の部屋の人の吹き出し・位置は持ち越さない
        const old = room === this.room ? this.players : new Map<string, ClientPlayer>();
        this.room = room;
        this.reservations = msg.reservations ?? [];
        this.outdated = !!CLIENT_VERSION && !!msg.version && msg.version !== CLIENT_VERSION;
        if (msg.reason) this.toast = { text: msg.reason, at: performance.now() };
        this.players = new Map(msg.players.map((p) => [p.pid, this.toPlayer(p, old.get(p.pid))]));
        this.cabinets = new Map(msg.cabinets.map((c) => [c.id, c]));
        this.chat = msg.chat;
        this.notices = msg.notices;
        this.posters = msg.posters ?? [];
        this.connected = true;
        this.fatal = null;
        break;
      }
      case 'join':
      case 'player':
        this.players.set(msg.player.pid, this.toPlayer(msg.player, this.players.get(msg.player.pid)));
        break;
      case 'leave':
        this.players.delete(msg.pid);
        break;
      case 'move': {
        const p = this.players.get(msg.pid);
        if (p) {
          p.path = msg.path;
          p.startedAt = msg.startedAt;
          p.watching = msg.watching;
        }
        // 位置だけの変化は描画が毎フレーム読むので、React には知らせない（視聴の変化だけ知らせる）
        if (!p || p.watching !== null || msg.watching !== null) break;
        return;
      }
      case 'emote': {
        const p = this.players.get(msg.pid);
        if (p) p.emote = { emoji: msg.emoji, at: performance.now() };
        return;
      }
      case 'chat': {
        if (!this.chat.some((m) => m.id === msg.message.id)) this.chat = [...this.chat, msg.message].slice(-CHAT_KEEP);
        if (msg.message.kind === 'user' && msg.message.pid) {
          const p = this.players.get(msg.message.pid);
          // 続けて発言したら差し替え
          if (p) p.bubble = { text: msg.message.text, until: performance.now() + BUBBLE_MS };
        }
        break;
      }
      case 'chat-delete': {
        const gone = this.chat.find((m) => m.id === msg.id);
        this.chat = this.chat.filter((m) => m.id !== msg.id);
        if (gone?.pid) {
          const p = this.players.get(gone.pid);
          if (p?.bubble?.text === gone.text) p.bubble = null;
        }
        break;
      }
      case 'cabinet':
        this.cabinets.set(msg.cabinet.id, msg.cabinet);
        break;
      case 'notices':
        this.notices = msg.notices;
        break;
      case 'posters':
        this.posters = msg.posters;
        break;
      case 'reservations':
        this.reservations = msg.reservations;
        break;
      case 'note':
      case 'note-delete':
        for (const l of this.noteListeners) l(msg);
        return;
      case 'requests':
        this.requestsUnread = msg.unread;
        if (msg.added && this.you?.admin) this.toast = { text: `📮 要望が届きました（未読 ${msg.unread} 件）`, at: performance.now() };
        break;
      case 'bye':
        this.closed = true;
        this.left = true;
        break;
      case 'you':
        this.you = msg.you;
        break;
      case 'kicked':
        this.closed = true;
        this.fatal = { code: 'kicked', text: msg.reason };
        break;
      case 'error': {
        const code = msg.code ?? '';
        if (code === 'replaced') {
          this.closed = true;
          this.fatal = { code: 'replaced', text: msg.error };
        } else if (['banned', 'full', 'need-enter', 'no-key'].includes(code) && !this.connected) {
          this.closed = true;
          this.fatal = { code: code as 'banned', text: msg.error };
        } else {
          this.toast = { text: msg.error, at: performance.now() };
        }
        break;
      }
      case 'pong':
        if (msg.serverNow && this.pingAt) this.offset = estimateOffset(msg.serverNow, this.pingAt, Date.now());
        return;
    }
    this.changed();
  }

  /** 名前の後ろに付けるバッジ（その人が店内にいれば今のバッジ） */
  badgesOf(pid: string | null | undefined): string {
    return (pid && this.players.get(pid)?.badges) || '';
  }

  /** 視聴中の筐体の配信が外れたかなどを画面に伝えるため、外から変化を知らせる */
  notify(): void {
    this.changed();
  }

  showToast(text: string): void {
    this.toast = { text, at: performance.now() };
    this.changed();
  }

  /** 生きているエモーション・吹き出しだけ残す（描画の前に呼ぶ） */
  prune(t: number): void {
    for (const p of this.players.values()) {
      if (p.emote && t - p.emote.at > EMOTE_MS) p.emote = null;
      if (p.bubble && t > p.bubble.until) p.bubble = null;
    }
  }

  /** 自分の行き先（歩いている経路の終わり） */
  myTarget(): Point | null {
    const m = this.me();
    return m ? m.path[m.path.length - 1] : null;
  }
}
