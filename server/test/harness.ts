// テスト用のサーバと WebSocket の道具（api.test.ts・v03.test.ts で共用）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerMessage, WelcomeMessage } from '@va/shared';
import { afterAll, expect } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/app';
import type { Config } from '../src/config';
import { hashPassphrase } from '../src/secret';

export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-test-'));
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows で WAL が残ることがある */
  }
});

export const newKey = () => crypto.randomBytes(32).toString('base64url');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const ADMIN_PW = 'とても長い管理者の合言葉-correct horse battery staple';
export const ADMIN_HASH = hashPassphrase(ADMIN_PW);
export const LOOK = { color: 'red', hat: 'cap' };

/** テスト用の時計（進められる） */
export const clock = { t: 1_800_000_000_000 };

export interface Client {
  ws: WebSocket;
  msgs: ServerMessage[];
  welcome: WelcomeMessage | null;
  waitFor<T extends ServerMessage['type']>(
    type: T,
    pred?: (m: Extract<ServerMessage, { type: T }>) => boolean,
    ms?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  send(m: unknown): void;
  close(): Promise<void>;
}

/** テスト用のサーバ 1 台 */
export const harness = async (name: string, config: Partial<Config> = {}, extra: { clientDist?: string } = {}) => {
  const dbPath = path.join(tmp, `${name}.db`);
  const srv = createServer({
    dbPath,
    serveClient: !!extra.clientDist,
    clientDist: extra.clientDist,
    config: { basePath: '', adminPassHash: ADMIN_HASH, now: () => clock.t, ...config },
  });
  await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  const prefix = config.basePath ?? '';
  const clients: Client[] = [];

  const call = async <T = any>(method: string, p: string, body?: unknown, key?: string) => {
    const headers: Record<string, string> = {};
    if (key) headers['X-VA-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${origin}${prefix}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* 本文なし */
    }
    return { status: res.status, body: json as T };
  };

  const connect = (key: string, wsPath = `${prefix}/ws`): Promise<Client> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${origin.replace('http', 'ws')}${wsPath}`);
      const msgs: ServerMessage[] = [];
      const waiters: Array<() => void> = [];
      const c: Client = {
        ws,
        msgs,
        welcome: null,
        waitFor(type, pred, ms = 2000) {
          return new Promise((res, rej) => {
            const find = () => msgs.find((m) => m.type === type && (!pred || pred(m as any))) as any;
            const hit = find();
            if (hit) return res(hit);
            const timer = setTimeout(() => rej(new Error(`待ち切れ: ${type}`)), ms);
            waiters.push(() => {
              const h = find();
              if (h) {
                clearTimeout(timer);
                res(h);
              }
            });
          });
        },
        send(m) {
          ws.send(JSON.stringify(m));
        },
        close() {
          return new Promise((r) => {
            if (ws.readyState === WebSocket.CLOSED) return r();
            ws.once('close', () => r());
            ws.close();
          });
        },
      };
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as ServerMessage;
        msgs.push(m);
        if (m.type === 'welcome') {
          c.welcome = m;
          resolve(c);
        }
        if (m.type === 'error' && !c.welcome) resolve(c);
        waiters.forEach((w) => w());
      });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', key })));
      ws.on('error', reject);
      ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      clients.push(c);
    });

  /** 名前を決めて入室し、WebSocket でつなぐ */
  const join = async (nm: string, key = newKey()) => {
    const r = await call('POST', '/api/enter', { name: nm, look: LOOK }, key);
    expect(r.status).toBe(200);
    const c = await connect(key);
    expect(c.welcome).not.toBeNull();
    return { key, c, pid: c.welcome!.you.pid };
  };

  /** 歩いて着く（テストの時計を進める） */
  const walk = async (who: { c: Client; pid: string }, x: number, y: number) => {
    const n = who.c.msgs.length;
    who.c.send({ type: 'goto', x, y });
    const m = await who.c.waitFor('move', (mm) => mm.pid === who.pid && who.c.msgs.indexOf(mm) >= n);
    clock.t += 60_000;
    return m;
  };

  const stop = async () => {
    await Promise.all(clients.map((c) => c.close()));
    await srv.close();
  };
  return { srv, origin, call, connect, join, walk, stop };
};

