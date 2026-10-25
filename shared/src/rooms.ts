// v0.5.0：オープン部屋と予約部屋（DESIGN §14）。予約の検証・重なり・1 人の合計時間・JST の表示の純粋関数。

import { FLOOR, isPassable, type Floor, type Point } from './floor';
import { charLength, hasNgWord, stripControl, tidy } from './text';

/** 部屋。open = いつものお店（オープン部屋）、reserved = 予約部屋（予約の時間だけ開く） */
export type RoomId = 'open' | 'reserved';
export const ROOM_IDS: readonly RoomId[] = ['open', 'reserved'];
export const isRoomId = (v: unknown): v is RoomId => v === 'open' || v === 'reserved';
export const roomLabel = (r: RoomId): string => (r === 'reserved' ? '予約部屋' : 'オープン部屋');

/**
 * WebSocket の取り決めの版（hello の proto）。0.5.0 で部屋が加わって 2 にした。
 * これより古い（proto の無い）クライアントには「再読み込みしてください」と返して切る。
 */
export const PROTOCOL = 2;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 予約の単位（30 分） */
export const SLOT_MS = 30 * MIN;
/** 1 人（鍵）が持てる予約の合計（これから・いま使っている分）。1 つで 5 時間でも、短いものをいくつかでもよい */
export const RESERVATION_KEY_TOTAL_MS = 5 * HOUR;
/** 1 つの予約の長さ：30 分〜5 時間（合計の上限と同じ） */
export const RESERVATION_MIN_MS = SLOT_MS;
export const RESERVATION_MAX_MS = RESERVATION_KEY_TOTAL_MS;
/** 予約できるのは今から 14 日先まで（開始の時刻） */
export const RESERVATION_AHEAD_MS = 14 * DAY;
/** 終わる前の案内（10 分前・5 分前） */
export const RESERVATION_WARN_MS = [10 * MIN, 5 * MIN] as const;
/** 終わった予約の行を残す期間（それより古いものは消す）・表の行数の上限 */
export const RESERVATION_KEEP_MS = 30 * DAY;
export const RESERVATION_MAX_ROWS = 2000;

export const RESERVATION_LIMITS = {
  /** 部屋名（予約の題名） */
  title: 30,
  /** 予約した人の名前（店内の名前と同じ長さ） */
  host: 20,
  description: 120,
  passMin: 4,
  passMax: 32,
} as const;

/** 予約を作るときに送るもの */
export interface ReservationInput {
  startAt: number;
  /** 長さ（分）。30 の倍数 */
  minutes: number;
  title: string;
  host: string;
  description: string;
  passphrase: string;
}

/** 誰にでも見せる予約（合言葉・ハッシュ・鍵は載せない。ownerPid は店内の公開 ID） */
export interface ReservationView {
  id: number;
  startAt: number;
  endAt: number;
  /** 部屋名 */
  title: string;
  /** 予約した人の名前 */
  host: string;
  description: string;
  ownerPid: string;
  createdAt: number;
}

export interface ReservationError {
  code: 'bad-input' | 'too-long' | 'ng' | 'bad-time' | 'bad-pass';
  message: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** その時刻を含む 30 分の枠の始まり（JST は UTC+9 で 30 分の倍数なので UTC のまま切ってよい） */
export const slotFloor = (t: number): number => Math.floor(t / SLOT_MS) * SLOT_MS;

/** 予約の形を確かめる（時刻・長さ・文字数・NG 語・合言葉）。重なり・1 人の合計はサーバが確かめる */
export const validateReservation = (raw: unknown, now: number): { value?: ReservationInput; error?: ReservationError } => {
  if (!raw || typeof raw !== 'object') return { error: { code: 'bad-input', message: '予約の内容が読めません' } };
  const r = raw as Record<string, unknown>;
  const startAt = r.startAt;
  const minutes = r.minutes;
  if (!isInt(startAt) || !isInt(minutes)) return { error: { code: 'bad-time', message: '開始の時刻と長さを選んでください' } };
  if (startAt % SLOT_MS !== 0) return { error: { code: 'bad-time', message: '開始は 30 分単位（00 分か 30 分）で選んでください' } };
  const ms = minutes * MIN;
  if (minutes % 30 !== 0 || ms < RESERVATION_MIN_MS || ms > RESERVATION_MAX_MS)
    return { error: { code: 'bad-time', message: `長さは 30 分単位で 30 分〜${RESERVATION_MAX_MS / HOUR} 時間です` } };
  // 今の枠（始まっている 30 分）からは予約できる。それより前は不可
  if (startAt < slotFloor(now)) return { error: { code: 'bad-time', message: '過ぎた時刻は予約できません' } };
  if (startAt > now + RESERVATION_AHEAD_MS) return { error: { code: 'bad-time', message: '予約できるのは 14 日先までです' } };

  const text = (v: unknown) => (typeof v === 'string' ? tidy(v) : '');
  const title = text(r.title);
  const host = text(r.host);
  const description = text(r.description);
  if (!title) return { error: { code: 'bad-input', message: '部屋名を入れてください' } };
  if (charLength(title) > RESERVATION_LIMITS.title)
    return { error: { code: 'too-long', message: `部屋名は ${RESERVATION_LIMITS.title} 文字までです` } };
  if (!host) return { error: { code: 'bad-input', message: '予約する人の名前を入れてください' } };
  if (charLength(host) > RESERVATION_LIMITS.host)
    return { error: { code: 'too-long', message: `名前は ${RESERVATION_LIMITS.host} 文字までです` } };
  if (charLength(description) > RESERVATION_LIMITS.description)
    return { error: { code: 'too-long', message: `説明は ${RESERVATION_LIMITS.description} 文字までです` } };
  if (hasNgWord(title) || hasNgWord(host) || hasNgWord(description))
    return { error: { code: 'ng', message: '使えない言葉が含まれています' } };

  const pass = checkReservationPass(r.passphrase);
  if (pass.error) return { error: pass.error };
  return { value: { startAt, minutes, title, host, description, passphrase: pass.value! } };
};

/** 合言葉の形（4〜32 文字。前後の空白は落とす。制御文字は不可） */
export const checkReservationPass = (raw: unknown): { value?: string; error?: ReservationError } => {
  if (typeof raw !== 'string') return { error: { code: 'bad-pass', message: '合言葉を入れてください' } };
  const v = raw.normalize('NFC').trim();
  if (stripControl(v) !== v) return { error: { code: 'bad-pass', message: '合言葉に使えない文字が含まれています' } };
  const n = charLength(v);
  if (n < RESERVATION_LIMITS.passMin || n > RESERVATION_LIMITS.passMax)
    return { error: { code: 'bad-pass', message: `合言葉は ${RESERVATION_LIMITS.passMin}〜${RESERVATION_LIMITS.passMax} 文字です` } };
  return { value: v };
};

/** 2 つの時間が重なるか（終わりと始まりが同じ時刻なら重ならない） */
export const overlaps = (a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }): boolean =>
  a.startAt < b.endAt && b.startAt < a.endAt;

/** いま使っている予約（無ければ undefined） */
export const activeReservation = <T extends { startAt: number; endAt: number }>(list: T[], now: number): T | undefined =>
  list.find((r) => r.startAt <= now && now < r.endAt);

/** これから（まだ終わっていない）予約を開始の順に */
export const upcomingReservations = <T extends { startAt: number; endAt: number }>(list: T[], now: number): T[] =>
  list.filter((r) => r.endAt > now).sort((a, b) => a.startAt - b.startAt);

/** 次の予約（いま使っている分は除く） */
export const nextReservation = <T extends { startAt: number; endAt: number }>(list: T[], now: number): T | undefined =>
  upcomingReservations(list, now).find((r) => r.startAt > now);

/** 1 人（鍵）の予約の合計（まだ終わっていない分の長さ） */
export const reservedTotalMs = (list: Array<{ startAt: number; endAt: number }>, now: number): number =>
  list.filter((r) => r.endAt > now).reduce((a, r) => a + (r.endAt - r.startAt), 0);

/** その開始の時刻から、重ならずに取れるいちばん長い時間（ms。合計の残りでも切る） */
export const maxLengthFrom = (startAt: number, list: Array<{ startAt: number; endAt: number }>, leftMs: number, now: number): number => {
  let max = Math.min(RESERVATION_MAX_MS, Math.max(0, leftMs));
  for (const r of list) {
    if (r.endAt <= now) continue;
    if (r.startAt <= startAt && startAt < r.endAt) return 0;
    if (r.startAt > startAt) max = Math.min(max, r.startAt - startAt);
  }
  return Math.floor(max / SLOT_MS) * SLOT_MS;
};

// ---------------------------------------------------------------- JST の表示

const JST_OFFSET = 9 * HOUR;
const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** JST の年月日・時分（Intl を使わない。どの端末でも同じ表示） */
export const jstParts = (t: number) => {
  const d = new Date(t + JST_OFFSET);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    wd: WD[d.getUTCDay()],
    dow: d.getUTCDay(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
};
const p2 = (n: number) => String(n).padStart(2, '0');
/** 21:00 */
export const jstTime = (t: number): string => {
  const p = jstParts(t);
  return `${p2(p.h)}:${p2(p.mi)}`;
};
/** 10/26(月) */
export const jstDate = (t: number): string => {
  const p = jstParts(t);
  return `${p.mo}/${p.d}(${p.wd})`;
};
/** その日の JST の 0:00（ms） */
export const jstDayStart = (t: number): number => {
  const shifted = t + JST_OFFSET;
  return shifted - (((shifted % DAY) + DAY) % DAY) - JST_OFFSET;
};
/** 10/26(月) 19:00〜21:00（日をまたげば終わりにも日付） */
export const formatReservationRange = (r: { startAt: number; endAt: number }): string => {
  const sameDay = jstDayStart(r.startAt) === jstDayStart(r.endAt - 1);
  const end = !sameDay ? `${jstDate(r.endAt)} ${jstTime(r.endAt)}` : r.endAt === jstDayStart(r.endAt) ? '24:00' : jstTime(r.endAt);
  return `${jstDate(r.startAt)} ${jstTime(r.startAt)}〜${end}`;
};
/** 1 時間 30 分 */
export const formatDuration = (ms: number): string => {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h && mm ? `${h} 時間 ${mm} 分` : h ? `${h} 時間` : `${mm} 分`;
};

/** 予約部屋が閉まっているときの文（「現在予約はありません / 次は ○○」） */
export const closedRoomText = (list: ReservationView[], now: number): string => {
  const n = nextReservation(list, now);
  return n ? `現在予約はありません。次は ${formatReservationRange(n)}「${n.title}」` : '現在予約はありません';
};

// ---------------------------------------------------------------- 店の中の置き場所（floor.json の decor の door / calendar）

/** 予約部屋の扉・予約カレンダーに近いとみなす距離（チェビシェフ距離） */
export const ROOM_OBJECT_NEAR = 2;

export const doorSpots = (f: Floor = FLOOR): Point[] => f.decor.filter((d) => d.type === 'door').map((d) => ({ x: d.x, y: d.y }));
export const calendarSpots = (f: Floor = FLOOR): Point[] => f.decor.filter((d) => d.type === 'calendar').map((d) => ({ x: d.x, y: d.y }));

/** 扉の前のマス（部屋を移ったときに立つ所）。無ければ入口の出現位置の先頭 */
export const doorFront = (f: Floor = FLOOR): Point => {
  const d = doorSpots(f)[0];
  if (d) {
    for (const p of [
      { x: d.x, y: d.y + 1 },
      { x: d.x + 1, y: d.y },
      { x: d.x - 1, y: d.y + 1 },
      { x: d.x + 1, y: d.y + 1 },
    ])
      if (isPassable(f, p.x, p.y)) return p;
  }
  return f.spawn[0];
};

// ---------------------------------------------------------------- 予約部屋の時計と残り時間（v0.5.0）

/** 残り時間の段階：10 分以下で warn、5 分以下で urgent（終わる前の案内と同じしきい値） */
export type RemainLevel = 'normal' | 'warn' | 'urgent';
export const remainLevel = (ms: number): RemainLevel =>
  ms <= RESERVATION_WARN_MS[1] ? 'urgent' : ms <= RESERVATION_WARN_MS[0] ? 'warn' : 'normal';

/** 残り時間の表示：1 時間以上は 1:23:45、それより短ければ 12:34（0 未満は 0:00） */
export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/**
 * サーバとこの端末の時計の差（サーバ − 端末、ms）。ping を送った時刻と pong を受け取った時刻の真ん中にサーバの時刻が来たとみなす。
 * 端末の時計がずれていても、残り時間はサーバの予約の終わりから正しく出せる
 */
export const estimateOffset = (serverNow: number, sentAt: number, receivedAt: number): number =>
  Math.round(serverNow - (sentAt + receivedAt) / 2);
