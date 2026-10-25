// v0.5.0：予約部屋の予約の検証・重なり・1 人の合計・JST の表示（DESIGN §14）。
import { describe, expect, it } from 'vitest';
import {
  activeReservation,
  closedRoomText,
  doorFront,
  doorSpots,
  calendarSpots,
  FLOOR,
  formatReservationRange,
  isPassable,
  jstDayStart,
  maxLengthFrom,
  nextReservation,
  overlaps,
  reservedTotalMs,
  RESERVATION_AHEAD_MS,
  slotFloor,
  SLOT_MS,
  validateReservation,
  type ReservationView,
} from '../src';

const H = 60 * 60 * 1000;
// 2027-01-01 00:00 JST（30 分の枠の頭）
const NOW = Date.UTC(2026, 11, 31, 15, 0, 0);
const base = { title: '格闘ゲーム交流会', host: 'たいよう', description: '', passphrase: 'abcd' };

describe('予約の検証（30 分単位・30 分〜5 時間・14 日先まで）', () => {
  it('よい予約', () => {
    const r = validateReservation({ ...base, startAt: NOW + 2 * H, minutes: 90 }, NOW);
    expect(r.value).toMatchObject({ startAt: NOW + 2 * H, minutes: 90, title: '格闘ゲーム交流会', passphrase: 'abcd' });
  });
  it('30 分の枠に乗っていない開始は不可', () => {
    expect(validateReservation({ ...base, startAt: NOW + 15 * 60 * 1000, minutes: 60 }, NOW).error?.code).toBe('bad-time');
    expect(validateReservation({ ...base, startAt: NOW + 1, minutes: 60 }, NOW).error?.code).toBe('bad-time');
  });
  it('長さは 30 分単位で 30 分〜5 時間', () => {
    expect(validateReservation({ ...base, startAt: NOW + H, minutes: 0 }, NOW).error?.code).toBe('bad-time');
    expect(validateReservation({ ...base, startAt: NOW + H, minutes: 45 }, NOW).error?.code).toBe('bad-time');
    expect(validateReservation({ ...base, startAt: NOW + H, minutes: 30 }, NOW).value).toBeTruthy();
    expect(validateReservation({ ...base, startAt: NOW + H, minutes: 300 }, NOW).value).toBeTruthy();
    expect(validateReservation({ ...base, startAt: NOW + H, minutes: 330 }, NOW).error?.code).toBe('bad-time');
  });
  it('今の枠からは予約できる・過ぎた枠と 14 日より先は不可', () => {
    const mid = NOW + 10 * 60 * 1000;
    expect(validateReservation({ ...base, startAt: slotFloor(mid), minutes: 30 }, mid).value).toBeTruthy();
    expect(validateReservation({ ...base, startAt: slotFloor(mid) - SLOT_MS, minutes: 60 }, mid).error?.code).toBe('bad-time');
    expect(validateReservation({ ...base, startAt: NOW + RESERVATION_AHEAD_MS, minutes: 30 }, NOW).value).toBeTruthy();
    expect(validateReservation({ ...base, startAt: NOW + RESERVATION_AHEAD_MS + SLOT_MS, minutes: 30 }, NOW).error?.code).toBe('bad-time');
  });
  it('部屋名・名前・説明・NG 語・合言葉', () => {
    const at = { startAt: NOW + H, minutes: 60 };
    expect(validateReservation({ ...base, ...at, title: '  ' }, NOW).error?.code).toBe('bad-input');
    expect(validateReservation({ ...base, ...at, title: 'あ'.repeat(31) }, NOW).error?.code).toBe('too-long');
    expect(validateReservation({ ...base, ...at, host: '' }, NOW).error?.code).toBe('bad-input');
    expect(validateReservation({ ...base, ...at, description: 'あ'.repeat(121) }, NOW).error?.code).toBe('too-long');
    expect(validateReservation({ ...base, ...at, title: 'もう死ねよ' }, NOW).error?.code).toBe('ng');
    expect(validateReservation({ ...base, ...at, passphrase: 'abc' }, NOW).error?.code).toBe('bad-pass');
    expect(validateReservation({ ...base, ...at, passphrase: 'a'.repeat(33) }, NOW).error?.code).toBe('bad-pass');
    expect(validateReservation({ ...base, ...at, passphrase: 'ab\ncd' }, NOW).error?.code).toBe('bad-pass');
    expect(validateReservation({ ...base, ...at, passphrase: '  あいうえ  ' }, NOW).value?.passphrase).toBe('あいうえ');
  });
});

describe('重なり・合計・取れる長さ', () => {
  const a = { startAt: NOW + 2 * H, endAt: NOW + 4 * H };
  it('重なり（終わりと始まりが同じなら重ならない）', () => {
    expect(overlaps(a, { startAt: NOW + 3 * H, endAt: NOW + 5 * H })).toBe(true);
    expect(overlaps(a, { startAt: NOW, endAt: NOW + 2 * H })).toBe(false);
    expect(overlaps(a, { startAt: NOW + 4 * H, endAt: NOW + 5 * H })).toBe(false);
    expect(overlaps(a, { startAt: NOW + 2.5 * H, endAt: NOW + 3 * H })).toBe(true);
  });
  it('1 人の合計は終わっていない分だけ', () => {
    expect(reservedTotalMs([a, { startAt: NOW - 3 * H, endAt: NOW - H }], NOW)).toBe(2 * H);
  });
  it('その開始から取れるいちばん長い時間', () => {
    expect(maxLengthFrom(NOW, [a], 5 * H, NOW)).toBe(2 * H);
    expect(maxLengthFrom(NOW + 2.5 * H, [a], 5 * H, NOW)).toBe(0);
    expect(maxLengthFrom(NOW + 4 * H, [a], 1.5 * H, NOW)).toBe(1.5 * H);
  });
  it('いまの予約・次の予約', () => {
    expect(activeReservation([a], NOW + 3 * H)).toBe(a);
    expect(activeReservation([a], NOW + 4 * H)).toBeUndefined();
    expect(nextReservation([a], NOW)).toBe(a);
  });
});

describe('JST の表示', () => {
  it('日付・時刻・日をまたぐ・24:00', () => {
    expect(formatReservationRange({ startAt: NOW + 19 * H, endAt: NOW + 21 * H })).toBe('1/1(金) 19:00〜21:00');
    expect(formatReservationRange({ startAt: NOW + 23 * H, endAt: NOW + 25 * H })).toBe('1/1(金) 23:00〜1/2(土) 01:00');
    expect(formatReservationRange({ startAt: NOW + 22 * H, endAt: NOW + 24 * H })).toBe('1/1(金) 22:00〜24:00');
    expect(jstDayStart(NOW + 5 * H)).toBe(NOW);
  });
  it('閉まっているときの文', () => {
    const r: ReservationView = { id: 1, startAt: NOW + 19 * H, endAt: NOW + 21 * H, title: '交流会', host: 'たいよう', description: '', ownerPid: 'x', createdAt: NOW };
    expect(closedRoomText([], NOW)).toBe('現在予約はありません');
    expect(closedRoomText([r], NOW)).toBe('現在予約はありません。次は 1/1(金) 19:00〜21:00「交流会」');
  });
});

describe('店の中の扉・予約カレンダー（floor.json）', () => {
  it('扉とカレンダーがあり、扉の前のマスは通れる', () => {
    expect(doorSpots()).toHaveLength(1);
    expect(calendarSpots()).toHaveLength(1);
    const f = doorFront();
    expect(isPassable(FLOOR, f.x, f.y)).toBe(true);
  });
});

describe('予約部屋の時計と残り時間', () => {
  it('残り時間の表示', async () => {
    const { formatRemaining } = await import('../src');
    expect(formatRemaining(5025 * 1000)).toBe('1:23:45');
    expect(formatRemaining(3600 * 1000)).toBe('1:00:00');
    expect(formatRemaining(12 * 60 * 1000)).toBe('12:00');
    expect(formatRemaining(61 * 1000 - 1)).toBe('1:01');
    expect(formatRemaining(500)).toBe('0:01');
    expect(formatRemaining(-3000)).toBe('0:00');
  });
  it('残り時間の段階（10 分・5 分）', async () => {
    const { remainLevel } = await import('../src');
    expect(remainLevel(11 * 60 * 1000)).toBe('normal');
    expect(remainLevel(10 * 60 * 1000)).toBe('warn');
    expect(remainLevel(5 * 60 * 1000 + 1)).toBe('warn');
    expect(remainLevel(5 * 60 * 1000)).toBe('urgent');
  });
  it('サーバとの時計の差（往復の真ん中）', async () => {
    const { estimateOffset } = await import('../src');
    // 端末の時計が 1 時間遅れていて、往復 200 ms
    const server = 1_800_000_000_000;
    const sent = server - 3600_000 - 100;
    const recv = server - 3600_000 + 100;
    expect(estimateOffset(server, sent, recv)).toBe(3600_000);
    // 残り時間 = 予約の終わり − (端末の時刻 + 差)
    const end = server + 10 * 60 * 1000;
    expect(end - (recv + estimateOffset(server, sent, recv))).toBe(10 * 60 * 1000 - 100);
  });
});
