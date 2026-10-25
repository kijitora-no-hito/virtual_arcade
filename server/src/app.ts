// HTTP（REST）＋ WebSocket のサーバ本体。index.ts から起動する。テストからも使える。
//
// すべて BASE_PATH（例 /arcade）の下で動く：ページ・API（{base}/api/...）・WebSocket（{base}/ws）・静的ファイル。
// クライアントは相対パスでビルドしてあり、index.html にサーバが <base href> を差し込むので、ビルドし直さずに BASE_PATH を変えられる。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  BGM_MIME,
  CHAT_MAX,
  NAME_MAX,
  NOTICE_MAX,
  POSTER_LIMITS,
  PROMO_LIMITS,
  validateNote,
  validatePoster,
  validateRequest,
  validateReservation,
  isRoomId,
  PROTOCOL,
  RESERVATION_AHEAD_MS,
  RESERVATION_KEY_TOTAL_MS,
  RESERVATION_LIMITS,
  SLOT_MS,
  type ClientMessage,
  type MeResponse,
  type MetaResponse,
  type ServerMessage,
} from '@va/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { Arcade, ArcadeError, checkChat } from './arcade';
import { listBgm, servableBgm } from './bgm';
import { defaultConfig, type Config } from './config';
import { Store } from './db';
import { clientIp, ipTag, RateLimiter } from './limits';
import { CLIENT_DIST } from './paths';
import { hashKey } from './secret';

declare const __VA_VERSION__: string | undefined;
export const VERSION = typeof __VA_VERSION__ !== 'undefined' ? __VA_VERSION__ : '0.5.0';

export interface AppOptions {
  dbPath: string;
  serveClient?: boolean;
  /** ビルド済みクライアントの場所（テスト用） */
  clientDist?: string;
  /** 設定の上書き（テスト用）。無ければ環境変数 */
  config?: Partial<Config>;
}

const HEARTBEAT_MS = 30_000;
const HELLO_TIMEOUT_MS = 10_000;
const SWEEP_MS = 60 * 1000;
/** 予約の時間の移り変わり（始まり・終わる前の案内・終わり）を見る間隔 */
const SLOT_TICK_MS = 5 * 1000;
/** 1 本の接続から 10 秒に送れるメッセージの数（超えたら切る） */
const WS_MSGS_PER_10S = 80;
/** 移動の指示は 1 秒に 10 回まで（超えた分は捨てる） */
const GOTO_PER_SEC = 10;

interface Conn {
  ip: string;
  keyHash: string | null;
  alive: boolean;
  msgs: number[];
  gotos: number[];
}

export const createServer = (opts: AppOptions) => {
  const cfg: Config = { ...defaultConfig(), version: VERSION, ...opts.config };
  const now = cfg.now ?? Date.now;
  const base = cfg.basePath;
  const store = new Store(opts.dbPath);
  const arcade = new Arcade(store, cfg);
  const limits = {
    enter: new RateLimiter(cfg.rates.enter),
    hello: new RateLimiter(cfg.rates.hello),
    chat: new RateLimiter(cfg.rates.chat),
    chatKey: new RateLimiter(cfg.rates.chatKey),
    api: new RateLimiter(cfg.rates.api),
    admin: new RateLimiter(cfg.rates.admin),
    adminKey: new RateLimiter(cfg.rates.adminKey),
    cabinetKey: new RateLimiter(cfg.rates.cabinetKey),
    emoteKey: new RateLimiter(cfg.rates.emoteKey),
    craneKey: new RateLimiter(cfg.rates.craneKey),
    posterKey: new RateLimiter(cfg.rates.posterKey),
    poster: new RateLimiter(cfg.rates.poster),
    pinKey: new RateLimiter(cfg.rates.pinKey),
    noteKey: new RateLimiter(cfg.rates.noteKey),
    note: new RateLimiter(cfg.rates.note),
    requestKey: new RateLimiter(cfg.rates.requestKey),
    request: new RateLimiter(cfg.rates.request),
    reserveKey: new RateLimiter(cfg.rates.reserveKey),
    reserve: new RateLimiter(cfg.rates.reserve),
    passKey: new RateLimiter(cfg.rates.passKey),
    pass: new RateLimiter(cfg.rates.pass),
  };
  const lastChat = new Map<string, number>();
  const lastEmote = new Map<string, number>();

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const ipOf = (req: http.IncomingMessage) => ipTag(clientIp(req, cfg.trustProxy));
  const limit = (lim: RateLimiter, key: string, what: string) => {
    if (!lim.hit(key)) throw new ArcadeError(429, `${what}が多すぎます。少し待ってからやり直してください`, 'rate');
  };
  const keyOf = (req: Request) => hashKey(req.get('x-va-key'));

  type H = (req: Request, res: Response) => void;
  const route =
    (fn: H) =>
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        fn(req, res);
      } catch (e) {
        next(e);
      }
    };

  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      limit(limits.api, ipOf(req), '操作');
      next();
    } catch (e) {
      next(e);
    }
  });

  api.get(
    '/meta',
    route((_req, res) => {
      const body: MetaResponse = {
        version: VERSION,
        maxPlayers: cfg.maxPlayers,
        online: arcade.onlineCount(),
        onlineByRoom: arcade.onlineByRoom(),
        reservations: {
          slotMs: SLOT_MS,
          maxTotalMs: RESERVATION_KEY_TOTAL_MS,
          aheadMs: RESERVATION_AHEAD_MS,
          limits: { ...RESERVATION_LIMITS },
        },
        cabinetTtlMs: cfg.cabinetTtlMs,
        adminEnabled: arcade.adminEnabled(),
        limits: { name: NAME_MAX, chat: CHAT_MAX, notice: NOTICE_MAX, promo: { ...PROMO_LIMITS } },
        bgm: listBgm(cfg.bgmDir),
        crane: {
          cooldownMs: cfg.craneCooldownMs,
          badgeMode: cfg.badgeMode,
          stackMax: cfg.badgeStackMax,
          badgeKeepMs: cfg.badgeKeepMs,
        },
        posters: {
          who: cfg.posterWho,
          maxPerUser: cfg.posterMaxPerUser,
          maxTotal: cfg.posterMaxTotal,
          limits: { ...POSTER_LIMITS },
        },
      };
      res.json(body);
    }),
  );

  /** この鍵の人（前に入ったことがあれば名前と見た目） */
  api.get(
    '/me',
    route((req, res) => {
      const k = keyOf(req);
      const body: MeResponse = { profile: arcade.profile(k) };
      const until = arcade.bannedUntil(k);
      if (until) body.bannedUntil = until;
      res.json(body);
    }),
  );

  /** 名前と見た目を決める（初めて・変更） */
  api.post(
    '/enter',
    route((req, res) => {
      const k = keyOf(req);
      // 数えるのは初めての人だけ（前に来たことのある人の入り直し・名前の変更は数えない）
      if (!arcade.profile(k)) limit(limits.enter, ipOf(req), '入室');
      res.json({ profile: arcade.enter(k, req.body?.name, req.body?.look) });
    }),
  );

  api.get(
    '/cabinets',
    route((req, res) => {
      res.json({ cabinets: arcade.listCabinets(keyOf(req)) });
    }),
  );

  // ---- 予約部屋（v0.5.0。DESIGN §14）。一覧は誰でも（合言葉・ハッシュ・鍵は載せない）
  api.get(
    '/reservations',
    route((req, res) => {
      res.json(arcade.listReservations(keyOf(req)));
    }),
  );
  api.post(
    '/reservations',
    route((req, res) => {
      const k = keyOf(req);
      if (!k) throw new ArcadeError(401, '識別用の鍵がありません。ページを開き直してください', 'no-key');
      const { error } = validateReservation(req.body, now()); // 回数を数える前に形を確かめる
      if (error) throw new ArcadeError(400, error.message, error.code);
      limit(limits.reserveKey, k, '予約');
      limit(limits.reserve, ipOf(req), '予約');
      res.status(201).json({ reservation: arcade.createReservation(k, req.body) });
    }),
  );
  api.delete(
    '/reservations/:id',
    route((req, res) => {
      arcade.cancelReservation(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );
  // ---- 予約部屋の主催者（予約した人）の操作。その予約の時間に予約部屋の中にいるときだけ（サイトの管理者はいつでも）
  api.post(
    '/room/remove',
    route((req, res) => {
      arcade.removeFromRoom(keyOf(req), req.body?.pid);
      res.json({ ok: true });
    }),
  );
  api.post(
    '/room/passphrase',
    route((req, res) => {
      arcade.changeRoomPassphrase(keyOf(req), req.body?.passphrase);
      res.json({ ok: true });
    }),
  );
  api.post(
    '/room/end',
    route((req, res) => {
      arcade.endRoomEarly(keyOf(req));
      res.json({ ok: true });
    }),
  );
  /** 部屋に入る（予約部屋は合言葉。間違いだけを鍵ごと・IP ごとに数える）。店内にいればその場で移る */
  api.post(
    '/rooms/:room/enter',
    route((req, res) => {
      const k = keyOf(req);
      const ip = ipOf(req);
      if (req.params.room === 'reserved' && ((k && limits.passKey.blocked(k)) || limits.pass.blocked(ip)))
        throw new ArcadeError(429, '合言葉の間違いが多すぎます。少し待ってからやり直してください', 'rate');
      try {
        res.json(arcade.enterRoom(k, req.params.room, req.body?.passphrase));
      } catch (e) {
        if (e instanceof ArcadeError && e.code === 'bad-passphrase') {
          if (k) limits.passKey.hit(k);
          limits.pass.hit(ip);
        }
        throw e;
      }
    }),
  );

  api.post(
    '/chat',
    route((req, res) => {
      const k = keyOf(req);
      if (!arcade.isOnline(k)) throw new ArcadeError(409, '先に入室してください', 'not-online');
      checkChat(req.body?.text); // 回数を数える前に形を確かめる
      const t = now();
      if (t - (lastChat.get(k!) ?? 0) < cfg.chatMinIntervalMs) throw new ArcadeError(429, '発言の間隔が短すぎます', 'rate');
      limit(limits.chatKey, k!, '発言');
      limit(limits.chat, ipOf(req), '発言');
      lastChat.set(k!, t);
      res.status(201).json({ message: arcade.say(k, req.body?.text) });
    }),
  );

  /** 自分の発言を 1 つだけピン止め（{pinned: false} で外す） */
  api.post(
    '/chat/:id/pin',
    route((req, res) => {
      const k = keyOf(req);
      if (k) limit(limits.pinKey, k, 'ピン止め');
      res.json({ pinned: arcade.pinChat(k, req.params.id, req.body?.pinned) });
    }),
  );

  const cabinetLimit = (req: Request) => {
    const k = keyOf(req);
    if (k) limit(limits.cabinetKey, k, '筐体の操作');
    return k;
  };
  api.post(
    '/cabinets/:id/claim',
    route((req, res) => {
      const k = cabinetLimit(req);
      res.json({ cabinet: arcade.claim(k, req.params.id) });
    }),
  );
  api.patch(
    '/cabinets/:id',
    route((req, res) => {
      const k = cabinetLimit(req);
      res.json({ cabinet: arcade.updateCabinet(k, req.params.id, req.body) });
    }),
  );
  api.post(
    '/cabinets/:id/release',
    route((req, res) => {
      const k = cabinetLimit(req);
      res.json({ cabinet: arcade.releaseCabinet(k, req.params.id) });
    }),
  );

  // ---- 退店（クレーンゲームのバッジが消える。接続も切る）
  api.post(
    '/leave',
    route((req, res) => {
      arcade.leave(keyOf(req));
      res.json({ ok: true });
    }),
  );

  // ---- クレーンゲーム（DESIGN §8。当たり外れはサーバが決める）
  const craneLimit = (req: Request) => {
    const k = keyOf(req);
    if (k) limit(limits.craneKey, k, 'クレーンゲームの操作');
    return k;
  };
  api.get(
    '/crane/:id',
    route((req, res) => {
      res.json(arcade.craneState(craneLimit(req), req.params.id));
    }),
  );
  api.post(
    '/crane/:id/play',
    route((req, res) => {
      const k = craneLimit(req);
      res.json(arcade.cranePlay(k, req.params.id, req.body?.x, req.body?.z));
    }),
  );

  // ---- ポスター（DESIGN §9）
  const posterCheck = (body: unknown) => {
    const { error } = validatePoster(body, now());
    if (error) throw new ArcadeError(400, error.message, error.code);
  };
  api.get(
    '/posters',
    route((_req, res) => {
      arcade.expirePosters();
      res.json({ posters: arcade.listPosters() });
    }),
  );
  api.post(
    '/posters',
    route((req, res) => {
      const k = keyOf(req);
      posterCheck(req.body); // 回数を数える前に形を確かめる
      if (k) limit(limits.posterKey, k, 'ポスターの操作');
      limit(limits.poster, ipOf(req), 'ポスターの操作');
      res.status(201).json({ poster: arcade.createPoster(k, req.body) });
    }),
  );
  api.patch(
    '/posters/:id',
    route((req, res) => {
      const k = keyOf(req);
      posterCheck(req.body);
      if (k) limit(limits.posterKey, k, 'ポスターの操作');
      res.json({ poster: arcade.updatePoster(k, req.params.id, req.body) });
    }),
  );
  api.delete(
    '/posters/:id',
    route((req, res) => {
      arcade.deletePoster(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );
  api.post(
    '/admin/posters/:id/pin',
    route((req, res) => {
      res.json({ poster: arcade.pinPoster(keyOf(req), req.params.id, req.body?.pinned) });
    }),
  );

  // ---- コミュニケーションノート（v0.4.0。DESIGN §12。読むのは誰でも）
  api.get(
    '/notes',
    route((req, res) => {
      res.json(arcade.listNotes(req.query.before, req.query.limit));
    }),
  );
  api.post(
    '/notes',
    route((req, res) => {
      const k = keyOf(req);
      if (!arcade.isOnline(k)) throw new ArcadeError(409, '先に入室してください', 'not-online');
      const { error } = validateNote(req.body); // 回数を数える前に形を確かめる
      if (error) throw new ArcadeError(400, error.message, error.code);
      limit(limits.noteKey, k!, 'ノートへの書き込み');
      limit(limits.note, ipOf(req), 'ノートへの書き込み');
      res.status(201).json({ note: arcade.writeNote(k, req.body) });
    }),
  );
  api.delete(
    '/notes/:id',
    route((req, res) => {
      arcade.deleteNote(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- 機能追加要望箱（v0.4.0。DESIGN §13。送るのは誰でも、読む・印・削除は管理者だけ。一般の人に一覧を返す口は作らない）
  api.post(
    '/requests',
    route((req, res) => {
      const k = keyOf(req);
      if (!k) throw new ArcadeError(401, '識別用の鍵がありません。ページを開き直してください', 'no-key');
      const { error } = validateRequest(req.body);
      if (error) throw new ArcadeError(400, error.message, error.code);
      limit(limits.requestKey, k, '要望の送信');
      limit(limits.request, ipOf(req), '要望の送信');
      res.status(201).json(arcade.sendRequest(k, req.body));
    }),
  );
  api.get(
    '/admin/requests',
    route((req, res) => {
      res.json(arcade.listRequests(keyOf(req)));
    }),
  );
  api.patch(
    '/admin/requests/:id',
    route((req, res) => {
      res.json({ request: arcade.markRequest(keyOf(req), req.params.id, req.body?.status) });
    }),
  );
  api.delete(
    '/admin/requests/:id',
    route((req, res) => {
      arcade.deleteRequest(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- 管理者
  api.post(
    '/admin/login',
    route((req, res) => {
      const k = keyOf(req);
      limit(limits.admin, ipOf(req), '合言葉の入力');
      if (k) limit(limits.adminKey, k, '合言葉の入力');
      res.json({ profile: arcade.adminLogin(k, req.body?.password) });
    }),
  );
  api.post(
    '/admin/logout',
    route((req, res) => {
      res.json({ profile: arcade.adminLogout(keyOf(req)) });
    }),
  );
  api.post(
    '/admin/notices',
    route((req, res) => {
      res.status(201).json({ notice: arcade.postNotice(keyOf(req), req.body?.text) });
    }),
  );
  api.delete(
    '/admin/notices/:id',
    route((req, res) => {
      arcade.deleteNotice(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );
  api.delete(
    '/admin/chat/:id',
    route((req, res) => {
      arcade.deleteChat(keyOf(req), req.params.id);
      res.json({ ok: true });
    }),
  );
  api.post(
    '/admin/kick',
    route((req, res) => {
      res.json(arcade.kick(keyOf(req), req.body?.pid, req.body?.minutes));
    }),
  );

  api.use((_req, res) => {
    res.status(404).json({ error: 'API が見つかりません' });
  });

  const router = express.Router();
  router.use('/api', api);

  // 店内の BGM（BGM_DIR の音声ファイル）。一覧（listBgm）の intro / body と完全に同じファイル名だけを出す
  // （../ などの抜け道・ほかの拡張子・. で始まる名前・シンボリックリンクは一覧に入らないので 404）
  router.get('/bgm/:file', (req, res, next) => {
    const name = req.params.file;
    // 曲単体を落とせる一覧のページは作らない（魔王魂などの規約で曲単体の再配布は禁止。ここは BGM として流すための配信だけ）
    if (!servableBgm(cfg.bgmDir).has(name)) {
      res.status(404).type('text/plain; charset=utf-8').send('見つかりません');
      return;
    }
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    res.type(BGM_MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(name, { root: cfg.bgmDir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(Object.assign(new Error('not found'), { status: 404 }));
    });
  });

  // ビルド済みのクライアントを配信
  const dist = opts.clientDist ?? CLIENT_DIST;
  if (opts.serveClient !== false) {
    const indexFile = path.join(dist, 'index.html');
    let indexCache: { mtime: number; html: string } | null = null;
    const indexHtml = (): string | null => {
      try {
        const st = fs.statSync(indexFile);
        if (!indexCache || indexCache.mtime !== st.mtimeMs) {
          const raw = fs.readFileSync(indexFile, 'utf8');
          const inject = `<base href="${base}/" />\n    <meta name="va-base" content="${base}" />`;
          indexCache = { mtime: st.mtimeMs, html: raw.replace(/<head>/i, `<head>\n    ${inject}`) };
        }
        return indexCache.html;
      } catch {
        return null;
      }
    };
    const sendIndex = (_req: Request, res: Response) => {
      const html = indexHtml();
      if (html) res.type('html').setHeader('Cache-Control', 'no-cache').send(html);
      else
        res
          .status(503)
          .type('text/plain; charset=utf-8')
          .send('クライアントがまだビルドされていません。先に npm run build を実行してください。');
    };
    router.get('/', sendIndex);
    router.get('/index.html', sendIndex);
    router.use(
      '/assets',
      express.static(path.join(dist, 'assets'), { index: false, immutable: true, maxAge: '365d', fallthrough: false }),
    );
    router.use(express.static(dist, { index: false }));
  }

  if (base) {
    // /arcade → /arcade/（相対パスの解決のため）。ルートは BASE_PATH へ案内（Apache 経由ではここには来ない）
    app.get(base, (req, res, next) => (req.path === base ? res.redirect(301, `${base}/`) : next()));
    app.use(base, router);
    app.get('/', (_req, res) => res.redirect(302, `${base}/`));
  } else {
    app.use(router);
  }

  app.use((_req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('見つかりません');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ArcadeError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    const type = err && typeof err === 'object' && 'type' in err ? (err as { type?: string }).type : undefined;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'JSON が読めません' });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: '送る内容が大きすぎます' });
      return;
    }
    const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status?: number }).status) : 0;
    if (status === 404) {
      res.status(404).type('text/plain; charset=utf-8').send('見つかりません');
      return;
    }
    // ログには種類と内容だけ（リクエストの IP・ヘッダ・鍵・チャットは出さない）
    console.error('サーバ内部のエラー:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(500).json({ error: 'サーバ内部のエラー' });
  });

  const server = http.createServer(app);
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  // ---- WebSocket：{base}/ws に接続し、最初のメッセージ {type:'hello', key} で店に入る。
  // 秘密鍵は URL（アクセスログに残る）に載せない。
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const conns = new Map<WebSocket, Conn>();
  /** 鍵ごとの接続（1 人 1 本。新しくつないだら古い方を切る） */
  const byKey = new Map<string, WebSocket>();
  const ipConns = new Map<string, number>();

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== `${base}/ws`) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = ipOf(req);
    if (conns.size >= cfg.maxConnections || (ipConns.get(ip) ?? 0) >= cfg.maxConnectionsPerIp) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  arcade.setHooks({
    broadcast: (msg, room) => {
      const text = JSON.stringify(msg);
      for (const [ws, c] of conns)
        if (c.keyHash && byKey.get(c.keyHash) === ws && ws.readyState === WebSocket.OPEN && (!room || arcade.roomOf(c.keyHash) === room)) ws.send(text);
    },
    send: (k, msg) => {
      const ws = byKey.get(k);
      if (ws) send(ws, msg);
    },
    drop: (k, msg) => {
      const ws = byKey.get(k);
      if (!ws) return;
      byKey.delete(k);
      send(ws, msg);
      ws.close(1000);
    },
  });

  const wsError = (ws: WebSocket, e: unknown) => {
    if (e instanceof ArcadeError) send(ws, { type: 'error', error: e.message, code: e.code });
    else {
      console.error('サーバ内部のエラー:', e instanceof Error ? (e.stack ?? e.message) : String(e));
      send(ws, { type: 'error', error: 'サーバ内部のエラー' });
    }
  };

  const hello = (ws: WebSocket, c: Conn, m: Record<string, unknown>) => {
    if (!limits.hello.hit(c.ip)) {
      send(ws, { type: 'error', error: '接続が多すぎます。少し待ってから開き直してください', code: 'rate' });
      ws.close(1008);
      return;
    }
    // v0.5.0：部屋が加わってメッセージの形が変わった。前の版のページ（ブラウザに残った古いタブ）には再読み込みを頼む
    // （0.4.x のクライアントは kicked の文を出して、つなぎ直さない）
    if (typeof m.proto !== 'number' || m.proto < PROTOCOL) {
      send(ws, { type: 'kicked', reason: '新しい版になりました。ページを再読み込みしてください（F5 / 引っぱって更新）' });
      ws.close(1000);
      return;
    }
    const k = hashKey(m.key);
    try {
      const welcome = arcade.connect(k, isRoomId(m.room) ? m.room : 'open');
      const old = byKey.get(k!);
      c.keyHash = k;
      byKey.set(k!, ws);
      if (old && old !== ws) {
        send(old, { type: 'error', error: '別のタブ・ウィンドウで入室したため、こちらは切れました', code: 'replaced' });
        old.close(1000);
      }
      send(ws, welcome);
    } catch (e) {
      wsError(ws, e);
      ws.close(1008);
    }
  };

  const onMessage = (ws: WebSocket, c: Conn, m: Partial<ClientMessage> & Record<string, unknown>) => {
    const k = c.keyHash!;
    try {
      switch (m.type) {
        case 'goto': {
          const t = now();
          c.gotos = c.gotos.filter((x) => x > t - 1000);
          if (c.gotos.length >= GOTO_PER_SEC) return;
          c.gotos.push(t);
          arcade.goto(k, m.x, m.y);
          return;
        }
        case 'emote': {
          const t = now();
          if (t - (lastEmote.get(k) ?? 0) < cfg.emoteMinIntervalMs || !limits.emoteKey.hit(k)) {
            send(ws, { type: 'error', error: 'エモーションが多すぎます。少し待ってください', code: 'rate' });
            return;
          }
          lastEmote.set(k, t);
          arcade.emote(k, m.emoji);
          return;
        }
        case 'watch':
          arcade.watch(k, m.cabinet === undefined ? null : m.cabinet);
          return;
        default:
          return;
      }
    } catch (e) {
      wsError(ws, e);
    }
  };

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, ip: string) => {
    const c: Conn = { ip, keyHash: null, alive: true, msgs: [], gotos: [] };
    conns.set(ws, c);
    ipConns.set(ip, (ipConns.get(ip) ?? 0) + 1);
    const helloTimer = setTimeout(() => {
      if (!c.keyHash) ws.close(1008);
    }, HELLO_TIMEOUT_MS);
    ws.on('pong', () => {
      c.alive = true;
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      conns.delete(ws);
      const n = (ipConns.get(ip) ?? 1) - 1;
      if (n > 0) ipConns.set(ip, n);
      else ipConns.delete(ip);
      // 同じ鍵で新しくつないだ接続があれば、店からは出さない
      if (c.keyHash && byKey.get(c.keyHash) === ws) {
        byKey.delete(c.keyHash);
        if (!closing) arcade.disconnect(c.keyHash);
      }
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (data) => {
      c.alive = true;
      const t = Date.now();
      c.msgs = c.msgs.filter((x) => x > t - 10_000);
      c.msgs.push(t);
      if (c.msgs.length > WS_MSGS_PER_10S) {
        ws.close(1008);
        return;
      }
      const text = String(data);
      if (text === 'ping') {
        send(ws, { type: 'pong', serverNow: now() });
        return;
      }
      let m: (Partial<ClientMessage> & Record<string, unknown>) | null = null;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (!c.keyHash) {
        if (m.type === 'hello') {
          clearTimeout(helloTimer);
          hello(ws, c, m);
        }
        return;
      }
      if (byKey.get(c.keyHash) !== ws) return; // 置き換えられた古い接続
      onMessage(ws, c, m);
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, c] of conns) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const sweep = () => {
    try {
      arcade.sweep();
      for (const l of Object.values(limits)) l.sweep();
      const old = now() - 60_000;
      for (const [k, t] of lastChat) if (t < old) lastChat.delete(k);
      for (const [k, t] of lastEmote) if (t < old) lastEmote.delete(k);
    } catch (e) {
      console.error('掃除に失敗:', e instanceof Error ? e.message : String(e));
    }
  };
  sweep();
  const sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref();
  const slotTicker = setInterval(() => {
    try {
      arcade.syncSlot();
    } catch (e) {
      console.error('予約の時間の確認に失敗:', e instanceof Error ? e.message : String(e));
    }
  }, SLOT_TICK_MS);
  slotTicker.unref();

  let closing = false;
  const close = async () => {
    // 止める前に、店内の人の位置を覚えておく（次に入ったときにその場所に戻る）
    for (const k of [...byKey.keys()]) arcade.disconnect(k);
    closing = true;
    clearInterval(heartbeat);
    clearInterval(sweeper);
    clearInterval(slotTicker);
    for (const ws of conns.keys()) ws.terminate();
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  };

  return { app, server, arcade, store, config: cfg, close };
};
