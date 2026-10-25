// 回数制限と、接続元 IP の求め方。
// IP アドレスはログにもディスクにも書かない。メモリの中でも、起動ごとに変わる塩でハッシュにした値だけを持つ。

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { RateRule } from './config';

const SALT = crypto.randomBytes(16);

/** IP を短いハッシュにする（回数制限の数え用） */
export const ipTag = (ip: string): string => crypto.createHmac('sha256', SALT).update(ip).digest('base64url').slice(0, 16);

const isLoopback = (addr: string | undefined): boolean =>
  !!addr && (addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.'));

/**
 * 接続元。trustProxy = loopback のときは、直前の接続元が 127.0.0.1 / ::1（= 同じ機械の Apache）なら
 * X-Forwarded-For の最後の 1 つ（Apache が付けた値）だけを使う。それ以外は直前の接続元。
 */
export const clientIp = (req: IncomingMessage, trustProxy: 'loopback' | 'none'): string => {
  const remote = req.socket.remoteAddress ?? '';
  if (trustProxy === 'loopback' && isLoopback(remote)) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
    const last = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    if (last) return last;
  }
  return remote;
};

/** 窓の中の回数を数える簡単な制限（スライディングウィンドウ） */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private rule: RateRule) {}

  /** 1 回数える。上限を超えていたら false（数えない） */
  hit(key: string, now = Date.now()): boolean {
    const from = now - this.rule.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.rule.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** 数えずに、もう上限に達しているかだけを見る（間違いだけを数える制限で、照合の前に使う） */
  blocked(key: string, now = Date.now()): boolean {
    const from = now - this.rule.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > from).length >= this.rule.limit;
  }

  /** 古い記録を捨てる（定期的に呼ぶ） */
  sweep(now = Date.now()): void {
    const from = now - this.rule.windowMs;
    for (const [k, list] of this.hits) {
      const keep = list.filter((t) => t > from);
      if (keep.length) this.hits.set(k, keep);
      else this.hits.delete(k);
    }
  }
}
