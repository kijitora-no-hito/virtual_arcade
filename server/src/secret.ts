// 秘密鍵・管理者の合言葉のハッシュ。

import crypto from 'node:crypto';

/** 秘密鍵の形（クライアントが作る 32 バイトの base64url など） */
const KEY_RE = /^[A-Za-z0-9_-]{22,128}$/;

/** 秘密鍵 → 保存・照合に使うハッシュ（鍵そのものは保存しない） */
export const hashKey = (key: unknown): string | null =>
  typeof key === 'string' && KEY_RE.test(key) ? crypto.createHash('sha256').update(key).digest('hex') : null;

/** 管理者の合言葉をハッシュにする（scrypt:<塩>:<ハッシュ>。scripts/hash-admin.mjs と同じ形） */
export const hashPassphrase = (pw: string): string => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw.normalize('NFC'), salt, 32);
  return `scrypt:${salt.toString('base64url')}:${h.toString('base64url')}`;
};

/** 合言葉の照合（時間が一定の比較） */
export const checkPassphrase = (pw: unknown, stored: string | null): boolean => {
  if (!stored || typeof pw !== 'string' || !pw || pw.length > 256) return false;
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(pw.normalize('NFC'), Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(hash, 'base64url');
  return want.length === h.length && crypto.timingSafeEqual(want, h);
};

/** 公開 ID（画面・管理の操作で人を指す。鍵とは関係のない乱数） */
export const newPid = (): string => crypto.randomBytes(9).toString('base64url');
