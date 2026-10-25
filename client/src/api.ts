// ベースパス・識別用の鍵・REST の呼び出し。

/**
 * ベースパス（例 /arcade）。サーバが index.html に <meta name="va-base"> を差し込む。
 * 開発（Vite）では無いので ''。
 */
export const BASE: string = (() => {
  try {
    const v = document.querySelector('meta[name="va-base"]')?.getAttribute('content') ?? '';
    return v.replace(/\/+$/, '');
  } catch {
    return '';
  }
})();

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** localStorage は使えないこともあるので必ず try/catch */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくても動く */
    }
  },
};

const KEY_STORE = 'va:key';
const KEY_RE = /^[A-Za-z0-9_-]{22,128}$/;
let memKey: string | null = null;

/** このブラウザの秘密鍵。無ければ作って保存する（保存できない環境ではこのタブの間だけ）。URL には載せない */
export const myKey = (): string => {
  if (memKey) return memKey;
  const saved = storage.get<string | null>(KEY_STORE, null);
  if (typeof saved === 'string' && KEY_RE.test(saved)) {
    memKey = saved;
    return saved;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  storage.set(KEY_STORE, key);
  memKey = key;
  return key;
};

export const api = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
  const headers: Record<string, string> = { 'X-VA-Key': myKey() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('サーバにつながりません');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 本文なし */
  }
  if (!res.ok) throw new ApiError(json?.error ?? `通信エラー（${res.status}）`, json?.code, res.status);
  return json as T;
};

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const wsUrl = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE}/ws`;
