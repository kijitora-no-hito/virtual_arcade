import { describe, expect, it } from 'vitest';
import {
  canonicalYouTubeUrl,
  claimCabinet,
  claimError,
  currentTile,
  emptyCabinet,
  expireCabinets,
  findPath,
  FLOOR,
  frontTile,
  hasNgWord,
  isExpired,
  isPassable,
  isValidPath,
  loadFloor,
  normalizeForNg,
  ownedBy,
  parseYouTubeUrl,
  pathLength,
  positionAt,
  thumbnailUrls,
  validateCabinetInput,
  checkName,
  type CabinetRecord,
  type FloorJson,
} from '../src';

const TTL = 6 * 60 * 60 * 1000;

describe('店のレイアウト', () => {
  it('筐体 16 台・前のマスが通れる', () => {
    expect(FLOOR.cabinets).toHaveLength(16);
    for (const c of FLOOR.cabinets) {
      expect(isPassable(FLOOR, c.x, c.y)).toBe(false);
      const f = frontTile(c);
      expect(isPassable(FLOOR, f.x, f.y)).toBe(true);
    }
  });

  it('通れないマス：筐体・飾り・範囲外・小数', () => {
    const c = FLOOR.cabinets[0];
    expect(isPassable(FLOOR, c.x, c.y)).toBe(false);
    const d = FLOOR.decor[0];
    expect(isPassable(FLOOR, d.x, d.y)).toBe(false);
    expect(isPassable(FLOOR, -1, 0)).toBe(false);
    expect(isPassable(FLOOR, 0, FLOOR.rows)).toBe(false);
    expect(isPassable(FLOOR, FLOOR.cols, 0)).toBe(false);
    expect(isPassable(FLOOR, 1.5, 2)).toBe(false);
    expect(isPassable(FLOOR, 1, 2)).toBe(true);
  });

  it('すべての通れるマスが入口からつながっている', () => {
    const s = FLOOR.spawn[0];
    for (let y = 0; y < FLOOR.rows; y++)
      for (let x = 0; x < FLOOR.cols; x++) if (isPassable(FLOOR, x, y)) expect(findPath(FLOOR, s, { x, y }), `${x},${y}`).not.toBeNull();
  });

  it('重なり・範囲外・前がふさがった筐体は読み込みでエラー', () => {
    const base: FloorJson = {
      name: 't',
      cols: 6,
      rows: 6,
      entrance: { wall: 'left', from: 4, to: 5 },
      spawn: [{ x: 0, y: 5 }],
      screen: { wall: 'right', from: 1, to: 4 },
      board: { wall: 'left', from: 1, to: 3 },
      cabinets: [{ id: 1, x: 2, y: 2, face: 'S', color: '#fff' }],
      decor: [],
    };
    expect(() => loadFloor(base)).not.toThrow();
    expect(() => loadFloor({ ...base, decor: [{ type: 'plant', x: 2, y: 2 }] })).toThrow();
    expect(() => loadFloor({ ...base, decor: [{ type: 'plant', x: 2, y: 3 }] })).toThrow(/前のマス/);
    expect(() => loadFloor({ ...base, cabinets: [{ id: 1, x: 9, y: 2, face: 'S', color: '#fff' }] })).toThrow(/範囲外/);
    // 掲示板が入口と重なる・壁からはみ出す
    expect(() => loadFloor({ ...base, board: { wall: 'left', from: 3, to: 5 } })).toThrow(/重なって/);
    expect(() => loadFloor({ ...base, board: { wall: 'left', from: 5, to: 7 } })).toThrow(/範囲/);
  });
});

describe('経路探索', () => {
  it('同じマスなら 1 マス、隣なら 2 マス', () => {
    expect(findPath(FLOOR, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
    expect(findPath(FLOOR, { x: 1, y: 1 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('筐体の列を回り込む（通れないマスを通らない・最短）', () => {
    // 筐体 1〜4 は (3..6, 4)。その奥 (4,3) から手前 (4,5) へ
    const p = findPath(FLOOR, { x: 4, y: 3 }, { x: 4, y: 5 })!;
    expect(p).not.toBeNull();
    expect(isValidPath(FLOOR, p)).toBe(true);
    for (const q of p) expect(isPassable(FLOOR, q.x, q.y)).toBe(true);
    // 角を斜めに抜けられないので左端 (2,4) を回る：(4,3)→(3,3)→(2,3)→(2,4)→(2,5)→(3,5)→(4,5) = 6
    expect(pathLength(p)).toBeCloseTo(6, 5);
  });

  it('角をすり抜けない（斜めは両隣が通れるときだけ）', () => {
    // 筐体 (3,4) と (4,4) の間に隙間はない。(2,3)→(3,5) は (3,4) の角を斜めに抜けられない
    const p = findPath(FLOOR, { x: 2, y: 3 }, { x: 3, y: 5 })!;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      if (a.x !== b.x && a.y !== b.y) {
        expect(isPassable(FLOOR, b.x, a.y)).toBe(true);
        expect(isPassable(FLOOR, a.x, b.y)).toBe(true);
      }
    }
  });

  it('通れないマスへは null', () => {
    const c = FLOOR.cabinets[0];
    expect(findPath(FLOOR, { x: 1, y: 1 }, { x: c.x, y: c.y })).toBeNull();
    expect(findPath(FLOOR, { x: 1, y: 1 }, { x: -1, y: 0 })).toBeNull();
  });

  it('経路の検証：飛び・通れないマスを含む経路は不正', () => {
    expect(isValidPath(FLOOR, [{ x: 1, y: 1 }, { x: 3, y: 1 }])).toBe(false);
    expect(isValidPath(FLOOR, [{ x: 3, y: 3 }, { x: 3, y: 4 }])).toBe(false);
    expect(isValidPath(FLOOR, [{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(true);
  });

  it('位置の補間と、今いるマス', () => {
    const path = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ];
    // 4 タイル/秒：0.125 秒で 0.5 タイル
    const p = positionAt(path, 1000, 1125);
    expect(p.x).toBeCloseTo(1.5);
    expect(p.done).toBe(false);
    expect(p.dir).toBe(1);
    expect(currentTile(path, 1000, 1100)).toEqual({ x: 1, y: 1 });
    expect(currentTile(path, 1000, 1200)).toEqual({ x: 2, y: 1 });
    expect(positionAt(path, 1000, 99999)).toMatchObject({ x: 3, y: 1, done: true });
  });
});

describe('YouTube の URL', () => {
  const ID = 'dQw4w9WgXcQ';
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, false],
    [`https://youtube.com/watch?v=${ID}&t=30s`, false],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`, false],
    [`http://www.youtube.com/watch?v=${ID}`, false],
    [`https://youtu.be/${ID}`, false],
    [`https://youtu.be/${ID}?si=abc`, false],
    [`youtu.be/${ID}`, false],
    [`https://www.youtube.com/live/${ID}`, true],
    [`https://www.youtube.com/live/${ID}?feature=share`, true],
    [`  https://www.youtube.com/watch?v=${ID}  `, false],
  ])('受け付ける: %s', (url, live) => {
    expect(parseYouTubeUrl(url)).toEqual({ id: ID, live });
  });

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evilyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.twitch.tv/somebody',
    'https://www.youtube.com/channel/UC1234567890',
    'https://www.youtube.com/@someone/live',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://youtu.be/dQw4w9Wg<cQ',
    'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'https://user:pass@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be:8443/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ/x',
    'https://youtu.be/dQw4w9WgXcQ https://evil.example',
    '',
    'not a url',
    `https://youtu.be/${'a'.repeat(400)}`,
  ])('断る: %s', (url) => {
    expect(parseYouTubeUrl(url)).toBeNull();
  });

  it('文字列以外は null', () => {
    expect(parseYouTubeUrl(null)).toBeNull();
    expect(parseYouTubeUrl(123)).toBeNull();
  });

  it('保存する URL とサムネイル', () => {
    expect(canonicalYouTubeUrl({ id: ID, live: false })).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(canonicalYouTubeUrl({ id: ID, live: true })).toBe(`https://www.youtube.com/live/${ID}`);
    expect(thumbnailUrls({ id: ID, live: true })[0]).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault_live.jpg`);
    expect(thumbnailUrls({ id: ID, live: false })).toEqual([`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`]);
  });
});

describe('NG 語', () => {
  it('ならし：全角・半角カナ・カタカナ・大文字・空白と記号', () => {
    expect(normalizeForNg('ＦＵＣＫ')).toBe('fuck');
    expect(normalizeForNg('ｷﾁｶﾞｲ')).toBe('きちがい');
    expect(normalizeForNg('キ・チ ガ イ')).toBe('きちがい');
  });

  it.each(['死ね', 'お前 死 ね', 'ＦＵＣＫ you', 'f.u.c.k', 'キチガイ', 'ｷﾁｶﾞｲ', 'ｓｈｉｔ'])('引っかかる: %s', (t) => {
    expect(hasNgWord(t)).toBe(true);
  });

  it.each(['こんにちは', 'シネマに行こう', 'ところすごい', '格闘ゲーム大会', 'Hello world', '参加型対戦やってます'])(
    '引っかからない: %s',
    (t) => {
      expect(hasNgWord(t)).toBe(false);
    },
  );

  it('一覧を渡して照合できる', () => {
    expect(hasNgWord('テストワード', ['てすと'])).toBe(true);
    expect(hasNgWord('テストワード', ['ほげ'])).toBe(false);
  });

  it('名前の検証', () => {
    expect(checkName('  たろう  ')).toEqual({ name: 'たろう' });
    expect(checkName('').error).toBeTruthy();
    expect(checkName('あ'.repeat(21)).error).toMatch(/20/);
    expect(checkName('あ'.repeat(20)).name).toBeTruthy();
    expect(checkName('死ね太郎').error).toMatch(/使えない/);
    expect(checkName(5).error).toBeTruthy();
  });
});

describe('筐体の持ち主の決まり', () => {
  const now = 10_000_000;
  const cabs = (): CabinetRecord[] => [1, 2, 3].map(emptyCabinet);
  const alice = { id: 'A', name: 'アリス', pid: 'pa' };
  const bob = { id: 'B', name: 'ボブ', pid: 'pb' };

  it('空いている筐体は使える・持ち主になる', () => {
    const list = cabs();
    expect(claimError(list, 1, 'A', now, TTL)).toBeNull();
    list[0] = claimCabinet(list[0], alice, now, TTL);
    expect(list[0]).toMatchObject({ ownerId: 'A', ownerName: 'アリス', updatedAt: now });
    expect(ownedBy(list, 'A', now, TTL)?.id).toBe(1);
  });

  it('同時に持てるのは 1 台・ほかの人の筐体は使えない', () => {
    const list = cabs();
    list[0] = claimCabinet(list[0], alice, now, TTL);
    expect(claimError(list, 2, 'A', now, TTL)).toBe('already-own');
    expect(claimError(list, 1, 'B', now, TTL)).toBe('taken');
    expect(claimError(list, 1, 'A', now, TTL)).toBeNull(); // 自分の筐体はもう一度使える（更新）
    expect(claimError(list, 9, 'A', now, TTL)).toBe('not-found');
  });

  it('最後の更新から 6 時間で時間切れ：空きに戻り、ほかの人が使える', () => {
    const list = cabs();
    list[0] = claimCabinet(list[0], alice, now, TTL);
    expect(isExpired(list[0], now + TTL - 1, TTL)).toBe(false);
    expect(isExpired(list[0], now + TTL, TTL)).toBe(true);
    // 時間切れの筐体は自分の持ち物に数えない → 別の筐体を使える
    expect(claimError(list, 2, 'A', now + TTL, TTL)).toBeNull();
    expect(claimError(list, 1, 'B', now + TTL, TTL)).toBeNull();
    const taken = claimCabinet(list[0], bob, now + TTL, TTL);
    expect(taken).toMatchObject({ ownerId: 'B', eventName: '' });
    const { cabinets, expired } = expireCabinets(list, now + TTL, TTL);
    expect(expired).toEqual([1]);
    expect(cabinets[0].ownerId).toBeNull();
  });

  it('空きの筐体は時間切れにならない', () => {
    expect(isExpired(emptyCabinet(1), now + TTL * 10, TTL)).toBe(false);
  });

  it('設定の検証：URL・文字数・NG 語', () => {
    const ok = validateCabinetInput({ url: 'https://youtu.be/dQw4w9WgXcQ', eventName: '参加型', gameName: 'テトリス', playerName: 'P', note: '' });
    expect(ok.value).toMatchObject({ videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', live: false });
    expect(validateCabinetInput({ url: '' }).value).toMatchObject({ videoId: null, url: null });
    expect(validateCabinetInput({ url: 'https://example.com/' }).error?.code).toBe('bad-url');
    expect(validateCabinetInput({ eventName: 'あ'.repeat(31) }).error?.code).toBe('too-long');
    expect(validateCabinetInput({ note: 'お前ら死ね' }).error?.code).toBe('ng');
    expect(validateCabinetInput({ gameName: 5 }).error?.code).toBe('bad-input');
    expect(validateCabinetInput(null).error?.code).toBe('bad-input');
  });
});
