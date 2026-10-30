// 筐体の持ち主の決まり（空いている筐体を「使う」と持ち主になる・1 人 4 台まで（v0.7.0。CABINET_MAX_PER_USER）・最後の更新から一定時間で空きに戻る）と、
// 設定の検証（YouTube の URL・宣伝の文字）。サーバが使う純粋関数。

import { charLength, hasNgWord, tidy } from './text';
import { canonicalYouTubeUrl, parseYouTubeUrl } from './youtube';

/** 宣伝の各項目の文字数の上限 */
export const PROMO_LIMITS = {
  eventName: 30,
  gameName: 30,
  playerName: 20,
  note: 120,
} as const;

export type PromoField = keyof typeof PROMO_LIMITS;
export const PROMO_FIELDS: PromoField[] = ['eventName', 'gameName', 'playerName', 'note'];
export const PROMO_LABEL: Record<PromoField, string> = {
  eventName: 'イベント名',
  gameName: 'ゲーム名',
  playerName: 'プレイヤー名',
  note: '備考',
};

/** 既定：1 人が同時に持てる（配信を登録できる）筐体の数（v0.7.0 ユーザー指定「一人が登録できる配信を4つまでに増やします」。部屋ごとに数える） */
export const DEFAULT_CABINET_MAX_PER_USER = 4;

/** 既定：最後の更新から 6 時間で空きに戻る */
export const DEFAULT_CABINET_TTL_MS = 6 * 60 * 60 * 1000;

export interface CabinetRecord {
  id: number;
  /** 持ち主（サーバでは鍵のハッシュ）。null = 持ち主なし */
  ownerId: string | null;
  ownerName: string | null;
  /** 持ち主の公開 ID（画面で「自分の筐体」を見分ける用） */
  ownerPid: string | null;
  videoId: string | null;
  live: boolean;
  url: string | null;
  eventName: string;
  gameName: string;
  playerName: string;
  note: string;
  /** 最後に使う・設定した時刻（0 = 一度も使われていない） */
  updatedAt: number;
}

export const emptyCabinet = (id: number): CabinetRecord => ({
  id,
  ownerId: null,
  ownerName: null,
  ownerPid: null,
  videoId: null,
  live: false,
  url: null,
  eventName: '',
  gameName: '',
  playerName: '',
  note: '',
  updatedAt: 0,
});

/** 空き（何も設定されていない）か */
export const isBlank = (c: CabinetRecord): boolean =>
  !c.ownerId && !c.videoId && !c.eventName && !c.gameName && !c.playerName && !c.note;

/** 時間切れか（何か設定されていて、最後の更新から ttl 以上たった） */
export const isExpired = (c: CabinetRecord, now: number, ttlMs: number): boolean =>
  !isBlank(c) && now - c.updatedAt >= ttlMs;

/** 「使う」ことができる空きか（持ち主がいない、または時間切れ） */
export const isFree = (c: CabinetRecord, now: number, ttlMs: number): boolean => !c.ownerId || isExpired(c, now, ttlMs);

/** ownerId が今持っている筐体（時間切れは除く） */
export const ownedBy = (cabs: CabinetRecord[], ownerId: string, now: number, ttlMs: number): CabinetRecord | undefined =>
  cabs.find((c) => c.ownerId === ownerId && !isExpired(c, now, ttlMs));

/** ownerId が今持っている筐体の全部（時間切れは除く。管理者が持ち主なしで設定した筐体は数えない） */
export const ownedAll = (cabs: CabinetRecord[], ownerId: string, now: number, ttlMs: number): CabinetRecord[] =>
  cabs.filter((c) => c.ownerId === ownerId && !isExpired(c, now, ttlMs));

/** too-many = もう上限（maxPerUser 台）まで持っている（v0.6 までの 1 人 1 台のときは already-own） */
export type ClaimError = 'not-found' | 'taken' | 'too-many';

/** 「使う」ができるか。できなければ理由 */
export const claimError = (
  cabs: CabinetRecord[],
  id: number,
  ownerId: string,
  now: number,
  ttlMs: number,
  maxPerUser = DEFAULT_CABINET_MAX_PER_USER,
): ClaimError | null => {
  const c = cabs.find((x) => x.id === id);
  if (!c) return 'not-found';
  const mine = ownedAll(cabs, ownerId, now, ttlMs);
  if (mine.some((m) => m.id === id)) return null; // 自分の筐体をもう一度「使う」= 更新
  if (!isFree(c, now, ttlMs)) return 'taken';
  if (mine.length >= Math.max(1, maxPerUser)) return 'too-many';
  return null;
};

/** 使う（持ち主になる）。時間切れだった筐体は中身を消してから。新しい記録を返す */
export const claimCabinet = (
  c: CabinetRecord,
  owner: { id: string; name: string; pid: string },
  now: number,
  ttlMs: number,
): CabinetRecord => {
  const base = c.ownerId === owner.id && !isExpired(c, now, ttlMs) ? c : emptyCabinet(c.id);
  return { ...base, ownerId: owner.id, ownerName: owner.name, ownerPid: owner.pid, updatedAt: now };
};

/** 空ける（全部消す） */
export const releaseCabinet = (c: CabinetRecord): CabinetRecord => emptyCabinet(c.id);

/** 時間切れの筐体を空きにする。空きにした id の一覧と新しい配列 */
export const expireCabinets = (
  cabs: CabinetRecord[],
  now: number,
  ttlMs: number,
): { cabinets: CabinetRecord[]; expired: number[] } => {
  const expired: number[] = [];
  const cabinets = cabs.map((c) => {
    if (!isExpired(c, now, ttlMs)) return c;
    expired.push(c.id);
    return emptyCabinet(c.id);
  });
  return { cabinets, expired };
};

export interface CabinetInput {
  url: string | null;
  videoId: string | null;
  live: boolean;
  eventName: string;
  gameName: string;
  playerName: string;
  note: string;
}

export interface InputError {
  code: 'bad-url' | 'too-long' | 'ng' | 'bad-input';
  message: string;
}

/**
 * 筐体の設定の検証。url は空なら配信なし。宣伝はそれぞれ文字数の上限と NG 語。
 * 返り値の error があれば断る。
 */
export const validateCabinetInput = (input: unknown): { value?: CabinetInput; error?: InputError } => {
  if (!input || typeof input !== 'object') return { error: { code: 'bad-input', message: '内容が読めません' } };
  const o = input as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : null);
  const rawUrl = str(o.url);
  if (rawUrl === null) return { error: { code: 'bad-input', message: 'URL が読めません' } };
  let url: string | null = null;
  let videoId: string | null = null;
  let live = false;
  if (rawUrl.trim()) {
    const ref = parseYouTubeUrl(rawUrl);
    if (!ref)
      return {
        error: {
          code: 'bad-url',
          message: 'YouTube の URL（youtube.com/watch?v=… ・ youtu.be/… ・ youtube.com/live/…）だけ設定できます',
        },
      };
    url = canonicalYouTubeUrl(ref);
    videoId = ref.id;
    live = ref.live;
  }
  const out: CabinetInput = { url, videoId, live, eventName: '', gameName: '', playerName: '', note: '' };
  for (const f of PROMO_FIELDS) {
    const v = str(o[f]);
    if (v === null) return { error: { code: 'bad-input', message: `${PROMO_LABEL[f]}が読めません` } };
    const t = tidy(v);
    if (charLength(t) > PROMO_LIMITS[f])
      return { error: { code: 'too-long', message: `${PROMO_LABEL[f]}は ${PROMO_LIMITS[f]} 文字までです` } };
    if (hasNgWord(t)) return { error: { code: 'ng', message: `${PROMO_LABEL[f]}に使えない言葉が含まれています` } };
    out[f] = t;
  }
  return { value: out };
};

/** 設定を当てる（持ち主はそのまま。更新の時刻を now に） */
export const applyCabinetInput = (c: CabinetRecord, v: CabinetInput, now: number): CabinetRecord => ({
  ...c,
  ...v,
  updatedAt: now,
});
