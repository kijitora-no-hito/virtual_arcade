import { execFileSync } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, normalizeBasePath } from '../src/config';
import { clientIp, RateLimiter } from '../src/limits';
import { checkPassphrase, hashKey, hashPassphrase } from '../src/secret';

const req = (remote: string, xff?: string) =>
  ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as unknown as IncomingMessage;

describe('設定', () => {
  it('BASE_PATH の正規化', () => {
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('arcade/')).toBe('/arcade');
    expect(normalizeBasePath('/arcade/')).toBe('/arcade');
    expect(() => normalizeBasePath('/a/../b')).toThrow();
    expect(() => normalizeBasePath('C:/Program Files/Git/arcade')).toThrow();
  });

  it('既定値：8791 番は index.ts、50 人・6 時間・管理者なし', () => {
    const c = defaultConfig({});
    expect(c).toMatchObject({ basePath: '', maxPlayers: 50, cabinetTtlMs: 6 * 3600000, adminPassHash: null, trustProxy: 'loopback' });
    expect(defaultConfig({ MAX_PLAYERS: '10', CABINET_TTL_HOURS: '2' })).toMatchObject({ maxPlayers: 10, cabinetTtlMs: 2 * 3600000 });
  });

  it('管理者の合言葉のハッシュの形を確かめる', () => {
    const h = hashPassphrase('長い合言葉です');
    expect(defaultConfig({ ADMIN_PASS_HASH: h }).adminPassHash).toBe(h);
    expect(() => defaultConfig({ ADMIN_PASS_HASH: 'plain-password' })).toThrow(/ADMIN_PASS_HASH/);
  });
});

describe('合言葉と鍵', () => {
  it('照合', () => {
    const h = hashPassphrase('correct horse battery staple');
    expect(checkPassphrase('correct horse battery staple', h)).toBe(true);
    expect(checkPassphrase('correct horse battery stapl', h)).toBe(false);
    expect(checkPassphrase('', h)).toBe(false);
    expect(checkPassphrase(123, h)).toBe(false);
    expect(checkPassphrase('x', null)).toBe(false);
  });

  it('scripts/hash-admin.mjs の出力でも照合できる', () => {
    const out = execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../../scripts/hash-admin.mjs'), '--stdin'], {
      input: 'スクリプトで作った合言葉です',
    })
      .toString()
      .trim();
    expect(checkPassphrase('スクリプトで作った合言葉です', out)).toBe(true);
  });

  it('鍵の形', () => {
    expect(hashKey('a'.repeat(43))).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey('short')).toBeNull();
    expect(hashKey('a'.repeat(43) + '!')).toBeNull();
    expect(hashKey(undefined)).toBeNull();
  });
});

describe('接続元 IP と回数制限', () => {
  it('X-Forwarded-For は直前が loopback のときだけ、最後の 1 つを信頼', () => {
    expect(clientIp(req('127.0.0.1', '1.1.1.1, 2.2.2.2'), 'loopback')).toBe('2.2.2.2');
    expect(clientIp(req('::ffff:127.0.0.1', '3.3.3.3'), 'loopback')).toBe('3.3.3.3');
    expect(clientIp(req('203.0.113.5', '1.1.1.1'), 'loopback')).toBe('203.0.113.5');
    expect(clientIp(req('127.0.0.1', '1.1.1.1'), 'none')).toBe('127.0.0.1');
    expect(clientIp(req('127.0.0.1'), 'loopback')).toBe('127.0.0.1');
  });

  it('スライディングウィンドウ', () => {
    const l = new RateLimiter({ limit: 2, windowMs: 1000 });
    expect(l.hit('a', 0)).toBe(true);
    expect(l.hit('a', 10)).toBe(true);
    expect(l.hit('a', 20)).toBe(false);
    expect(l.hit('b', 20)).toBe(true);
    expect(l.hit('a', 1001)).toBe(true);
  });
});
