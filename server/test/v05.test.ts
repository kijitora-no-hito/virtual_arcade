// v0.5.0：オープン部屋と予約部屋（DESIGN §14）。予約・合言葉・部屋の行き来・時間の終わり・部屋ごとのチャットと筐体。
// 時計は harness の clock.t（cfg.now）で進め、予約の時間の移り変わりは srv.arcade.syncSlot() で当てる（実時間を待たない）。

import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ROOM_CANCELLED_TEXT, ROOM_ENDED_TEXT } from '../src/arcade';
import { ADMIN_PW, clock, harness, newKey, sleep } from './harness';

const MIN = 60 * 1000;
const H = 60 * MIN;
/** 次の 30 分の枠の頭（clock.t から） */
const nextSlot = () => Math.ceil((clock.t + 1) / (30 * MIN)) * 30 * MIN;
const res = (startAt: number, minutes: number, extra: Record<string, unknown> = {}) => ({
  startAt,
  minutes,
  title: '格闘ゲーム交流会',
  host: 'たいよう',
  description: '初心者歓迎',
  passphrase: 'ひみつの合言葉',
  ...extra,
});

describe('予約（DESIGN §14.2）', () => {
  it('作る・誰でも見られる・合言葉のハッシュは送らない・重なりは断る・入店前は不可', async () => {
    const h = await harness('res-create');
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const t0 = nextSlot() + 2 * H;
    // 入店したことのない鍵は予約できない
    expect((await h.call('POST', '/api/reservations', res(t0, 60), newKey())).body.code).toBe('need-enter');
    // 枠の検証（API でも）
    expect((await h.call('POST', '/api/reservations', res(t0 + 10 * MIN, 60), a.key)).body.code).toBe('bad-time');
    expect((await h.call('POST', '/api/reservations', res(t0, 330), a.key)).body.code).toBe('bad-time');
    expect((await h.call('POST', '/api/reservations', res(t0 + 15 * 24 * H, 60), a.key)).body.code).toBe('bad-time');

    const r = await h.call('POST', '/api/reservations', res(t0, 120), a.key);
    expect(r.status).toBe(201);
    expect(r.body.reservation).toMatchObject({ startAt: t0, endAt: t0 + 2 * H, title: '格闘ゲーム交流会', host: 'たいよう', ownerPid: a.pid });
    // 全員に一覧が届く（合言葉もハッシュも鍵も載せない）
    const got = await b.c.waitFor('reservations', (m) => m.reservations.length === 1);
    const pub = await h.call('GET', '/api/reservations');
    for (const text of [JSON.stringify(r.body), JSON.stringify(got), JSON.stringify(pub.body)]) {
      expect(text).not.toMatch(/scrypt|passHash|pass_hash|ownerKey|owner_key|ひみつの合言葉/);
    }
    expect(pub.body.reservations).toHaveLength(1);
    expect(pub.body.myLeftMs).toBeNull();
    // チャットに案内（オープン部屋）
    await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text.includes('予約部屋を予約しました'));

    // 重なりは断る（ほかの人でも）・ちょうど続く時間はよい
    expect((await h.call('POST', '/api/reservations', res(t0 + H, 60), b.key)).body.code).toBe('overlap');
    expect((await h.call('POST', '/api/reservations', res(t0 - 30 * MIN, 60), b.key)).body.code).toBe('overlap');
    expect((await h.call('POST', '/api/reservations', res(t0 + 2 * H, 60), b.key)).status).toBe(201);
    expect((await h.call('POST', '/api/reservations', res(t0 - H, 60), b.key)).status).toBe(201);
    await h.stop();
  });

  it('1 人あわせて 5 時間まで（いくつかに分けてもよい）・取り消すと戻る', async () => {
    const h = await harness('res-total');
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const t0 = nextSlot() + H;
    expect((await h.call('POST', '/api/reservations', res(t0, 180), a.key)).status).toBe(201);
    const second = await h.call('POST', '/api/reservations', res(t0 + 4 * H, 120), a.key);
    expect(second.status).toBe(201);
    expect((await h.call('GET', '/api/reservations', undefined, a.key)).body.myLeftMs).toBe(0);
    const over = await h.call('POST', '/api/reservations', res(t0 + 8 * H, 30), a.key);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('too-much');
    // ほかの人は予約できる
    expect((await h.call('GET', '/api/reservations', undefined, b.key)).body.myLeftMs).toBe(5 * H);
    expect((await h.call('POST', '/api/reservations', res(t0 + 8 * H, 300), b.key)).status).toBe(201);
    // 1 つで 5 時間ちょうども（別の人）・5 時間を超える 1 つは形で断る
    // 取り消すと残りが戻る（ほかの人は取り消せない）
    expect((await h.call('DELETE', `/api/reservations/${second.body.reservation.id}`, undefined, b.key)).body.code).toBe('not-owner');
    expect((await h.call('DELETE', `/api/reservations/${second.body.reservation.id}`, undefined, a.key)).status).toBe(200);
    expect((await h.call('GET', '/api/reservations', undefined, a.key)).body.myLeftMs).toBe(2 * H);
    // 終わった予約は合計に入らない
    clock.t = t0 + 3 * H;
    h.srv.arcade.syncSlot();
    expect((await h.call('GET', '/api/reservations', undefined, a.key)).body.myLeftMs).toBe(5 * H);
    await h.stop();
  });

  it('管理者はどの予約も取り消せる', async () => {
    const h = await harness('res-admin');
    const a = await h.join('たいよう');
    const admin = await h.join('てんちょう');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    const r = await h.call('POST', '/api/reservations', res(nextSlot() + H, 60), a.key);
    expect((await h.call('DELETE', `/api/reservations/${r.body.reservation.id}`, undefined, admin.key)).status).toBe(200);
    expect((await h.call('GET', '/api/reservations')).body.reservations).toHaveLength(0);
    await h.stop();
  });
});

describe('予約部屋に入る（DESIGN §14.3）', () => {
  it('時間外は閉まっている・合言葉・間違いの回数制限・予約した人と管理者は合言葉なし', async () => {
    const h = await harness('room-enter');
    const owner = await h.join('たいよう');
    const guest = await h.join('みどり');
    const other = await h.join('あおい');
    const admin = await h.join('てんちょう');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    const t0 = nextSlot() + H;
    await h.call('POST', '/api/reservations', res(t0, 60, { title: '大会の練習' }), owner.key);

    // 時間外：閉まっている（次の予約を知らせる）
    const closed = await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, guest.key);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('room-closed');
    expect(closed.body.error).toMatch(/現在予約はありません。次は .*「大会の練習」/);

    clock.t = t0 + 5 * MIN;
    h.srv.arcade.syncSlot();
    // 合言葉なし・違う
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, guest.key)).body.code).toBe('need-passphrase');
    expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ちがう' }, guest.key)).body.code).toBe('bad-passphrase');
    // 合う：その場で予約部屋へ（新しい welcome）
    const ok = await h.call('POST', '/api/rooms/reserved/enter', { passphrase: ' ひみつの合言葉 ' }, guest.key);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ room: 'reserved', moved: true, reservation: { title: '大会の練習' } });
    expect(JSON.stringify(ok.body)).not.toMatch(/scrypt|passHash|ownerKey/);
    const w = await guest.c.waitFor('welcome', (m) => m.room === 'reserved');
    expect(w.players.map((p) => p.pid)).toEqual([guest.pid]);
    expect(w.chat.some((m) => m.text.includes('予約部屋「大会の練習」が開きました'))).toBe(true);
    // オープン部屋の人には leave
    await other.c.waitFor('leave', (m) => m.pid === guest.pid);

    // 予約した人・管理者は合言葉なしで入れる
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, owner.key)).body.room).toBe('reserved');
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, admin.key)).body.room).toBe('reserved');

    // 間違いは鍵ごとに 10 分 5 回まで（合っていても待たされる）
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: `x${i}xx` }, other.key)).body.code).toBe('bad-passphrase');
    const locked = await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, other.key);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('rate');

    // 戻る（オープン部屋へ）
    const back = await h.call('POST', '/api/rooms/open/enter', {}, guest.key);
    expect(back.body).toMatchObject({ room: 'open', moved: true });
    await guest.c.waitFor('welcome', (m) => m.room === 'open' && guest.c.msgs.filter((x) => x.type === 'welcome').length >= 3);
    await h.stop();
  });

  it('IP ごとの間違いの回数制限（鍵を変えても）', async () => {
    const h = await harness('room-ip', {
      rates: { ...(await import('../src/config')).defaultConfig({}).rates, pass: { limit: 3, windowMs: 600_000 } },
    });
    const owner = await h.join('たいよう');
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 60), owner.key);
    clock.t = t0 + MIN;
    h.srv.arcade.syncSlot();
    for (let i = 0; i < 3; i++) {
      const x = await h.join(`ひと${i}`);
      expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'まちがい' }, x.key)).body.code).toBe('bad-passphrase');
    }
    const y = await h.join('ひと9');
    expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, y.key)).status).toBe(429);
    await h.stop();
  });

  it('入店の画面から：合言葉を入れてから WebSocket で予約部屋に入る・入れない人はオープン部屋（理由つき）', async () => {
    const h = await harness('room-direct');
    const owner = await h.join('たいよう');
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 60), owner.key);
    clock.t = t0 + MIN;
    h.srv.arcade.syncSlot();
    // 店内にいない人（入店の画面）：名前を決めて、合言葉 → moved = false → hello で予約部屋
    const key = newKey();
    expect((await h.call('POST', '/api/enter', { name: 'はじめて', look: { color: 'red', hat: 'cap' } }, key)).status).toBe(200);
    const ent = await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, key);
    expect(ent.body).toMatchObject({ room: 'reserved', moved: false });
    const c = await h.connect(key, '/ws', 'reserved');
    expect(c.welcome!.room).toBe('reserved');
    expect(c.welcome!.reason).toBeUndefined();
    // 再読み込み（つなぎ直し）でも予約部屋のまま
    await c.close();
    const c2 = await h.connect(key, '/ws', 'reserved');
    expect(c2.welcome!.room).toBe('reserved');
    // 合言葉を入れていない人は、オープン部屋に入れて理由を出す
    const k2 = newKey();
    await h.call('POST', '/api/enter', { name: 'ふたりめ', look: { color: 'red', hat: 'cap' } }, k2);
    const c3 = await h.connect(k2, '/ws', 'reserved');
    expect(c3.welcome!.room).toBe('open');
    expect(c3.welcome!.reason).toMatch(/合言葉が必要/);
    await h.stop();
  });

  it('古いクライアント（proto なし）には再読み込みを頼んで切る', async () => {
    const h = await harness('old-client');
    const a = await h.join('たいよう');
    const ws = new WebSocket(`${h.origin.replace('http', 'ws')}/ws`);
    const got = await new Promise<any>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', key: a.key })));
      ws.on('message', (d) => resolve(JSON.parse(String(d))));
      ws.on('error', reject);
    });
    expect(got.type).toBe('kicked');
    expect(got.reason).toMatch(/再読み込み/);
    ws.close();
    await h.stop();
  });
});

describe('予約の時間の終わり（DESIGN §14.4）', () => {
  it('10 分前・5 分前の案内・終わったら全員オープン部屋へ・チャットと筐体を消す・続けての予約に前のチャットを残さない', async () => {
    const h = await harness('room-end');
    const owner = await h.join('たいよう');
    const guest = await h.join('みどり');
    const owner2 = await h.join('あおい');
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 60, { title: 'まえの部屋' }), owner.key);
    await h.call('POST', '/api/reservations', res(t0 + H, 30, { title: 'つぎの部屋', host: 'あおい', passphrase: 'べつの合言葉' }), owner2.key);
    clock.t = t0;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, owner.key);
    await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, guest.key);
    await guest.c.waitFor('welcome', (m) => m.room === 'reserved');
    // 予約部屋で発言・筐体を使う
    expect((await h.call('POST', '/api/chat', { text: '予約部屋の発言です' }, guest.key)).status).toBe(201);
    await h.walk(owner, 3, 5);
    expect((await h.call('POST', '/api/cabinets/1/claim', {}, owner.key)).status).toBe(200);
    expect((await h.call('PATCH', '/api/cabinets/1', { url: 'https://youtu.be/aqz-KE-bpKQ', eventName: '練習会' }, owner.key)).status).toBe(200);

    // 10 分前・5 分前
    clock.t = t0 + 50 * MIN;
    h.srv.arcade.syncSlot();
    await guest.c.waitFor('chat', (m) => m.message.text.includes('あと 10 分'));
    clock.t = t0 + 55 * MIN;
    h.srv.arcade.syncSlot();
    await guest.c.waitFor('chat', (m) => m.message.text.includes('あと 5 分'));
    h.srv.arcade.syncSlot(); // 2 度は流さない
    await sleep(50);
    expect(guest.c.msgs.filter((m) => m.type === 'chat' && m.message.text.includes('あと 5 分'))).toHaveLength(1);

    // 終わり：オープン部屋へ（理由つき）
    clock.t = t0 + H;
    h.srv.arcade.syncSlot();
    const back = await guest.c.waitFor('welcome', (m) => m.room === 'open' && m.reason === ROOM_ENDED_TEXT);
    expect(back.chat.some((m) => m.text === '予約部屋の発言です')).toBe(false);
    expect(back.cabinets.find((c) => c.id === 1)!.videoId).toBeNull();
    await owner.c.waitFor('welcome', (m) => m.room === 'open' && m.reason === ROOM_ENDED_TEXT);
    // 前の予約の合言葉では次の予約に入れない。次の予約の部屋には前のチャット・筐体が無い
    expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, guest.key)).body.code).toBe('bad-passphrase');
    const next = await h.call('POST', '/api/rooms/reserved/enter', {}, owner2.key);
    expect(next.body.reservation.title).toBe('つぎの部屋');
    const w = await owner2.c.waitFor('welcome', (m) => m.room === 'reserved');
    expect(w.chat.map((m) => m.text).join('\n')).not.toMatch(/予約部屋の発言です|まえの部屋|あと 5 分/);
    expect(w.chat.some((m) => m.text.includes('つぎの部屋'))).toBe(true);
    expect(w.cabinets.every((c) => !c.videoId && !c.owned)).toBe(true);
    // 予約部屋のチャットは DB に書かない（オープン部屋の履歴にも入らない）
    expect(h.srv.arcade.recentChat('open').some((m) => m.text === '予約部屋の発言です')).toBe(false);
    await h.stop();
  });

  it('使っている最中の取り消し：すぐ閉じてオープン部屋へ', async () => {
    const h = await harness('room-cancel');
    const owner = await h.join('たいよう');
    const t0 = nextSlot();
    const r = await h.call('POST', '/api/reservations', res(t0, 60), owner.key);
    clock.t = t0 + MIN;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, owner.key);
    await owner.c.waitFor('welcome', (m) => m.room === 'reserved');
    await h.call('DELETE', `/api/reservations/${r.body.reservation.id}`, undefined, owner.key);
    await owner.c.waitFor('welcome', (m) => m.room === 'open' && m.reason === ROOM_CANCELLED_TEXT);
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, owner.key)).body.code).toBe('room-closed');
    await h.stop();
  });
});

describe('部屋ごとと店全体（DESIGN §14.1）', () => {
  it('チャット・エモーション・筐体・人数は部屋ごと、ノート・ポスター・バッジは店全体', async () => {
    const h = await harness('room-sep');
    const inR = await h.join('たいよう');
    const inO = await h.join('みどり');
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 120), inR.key);
    clock.t = t0;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, inR.key);
    await inR.c.waitFor('welcome', (m) => m.room === 'reserved');
    const mark = inO.c.msgs.length;
    const markR = inR.c.msgs.length;

    // チャット
    await h.call('POST', '/api/chat', { text: 'こちら予約部屋' }, inR.key);
    clock.t += 2000;
    await h.call('POST', '/api/chat', { text: 'こちらオープン部屋' }, inO.key);
    await inR.c.waitFor('chat', (m) => m.message.text === 'こちら予約部屋');
    await inO.c.waitFor('chat', (m) => m.message.text === 'こちらオープン部屋');
    // エモーション
    inR.c.send({ type: 'emote', emoji: '👍' });
    await inR.c.waitFor('emote', (m) => m.pid === inR.pid);
    // 筐体：同じ番号の筐体を、それぞれの部屋で別の人が使える
    await h.walk(inR, 3, 5);
    await h.walk(inO, 3, 5);
    expect((await h.call('POST', '/api/cabinets/1/claim', {}, inR.key)).status).toBe(200);
    expect((await h.call('POST', '/api/cabinets/1/claim', {}, inO.key)).status).toBe(200);
    expect((await h.call('GET', '/api/cabinets', undefined, inR.key)).body.cabinets[0].ownerPid).toBe(inR.pid);
    expect((await h.call('GET', '/api/cabinets', undefined, inO.key)).body.cabinets[0].ownerPid).toBe(inO.pid);
    expect((await h.call('GET', '/api/meta')).body.onlineByRoom).toEqual({ open: 1, reserved: 1 });
    await sleep(80);
    const openSaw = inO.c.msgs.slice(mark);
    const resSaw = inR.c.msgs.slice(markR);
    expect(openSaw.some((m) => m.type === 'chat' && m.message.text === 'こちら予約部屋')).toBe(false);
    expect(openSaw.some((m) => m.type === 'emote' && m.pid === inR.pid)).toBe(false);
    expect(openSaw.some((m) => m.type === 'move' && m.pid === inR.pid)).toBe(false);
    expect(openSaw.some((m) => m.type === 'cabinet' && m.cabinet.ownerPid === inR.pid)).toBe(false);
    expect(resSaw.some((m) => m.type === 'chat' && m.message.text === 'こちらオープン部屋')).toBe(false);

    // ノート・ポスターは店全体（どちらの部屋にも届く）
    const note = await h.call('POST', '/api/notes', { name: 'たいよう', text: '予約部屋から書きました' }, inR.key);
    expect(note.status).toBe(201);
    await inO.c.waitFor('note', (m) => m.note.id === note.body.note.id);
    const poster = await h.call(
      'POST',
      '/api/posters',
      { kind: 'event', title: '週末の大会', game: '', body: '', url: null, startsAt: clock.t + 24 * H, endsAt: null },
      inO.key,
    );
    expect(poster.status).toBe(201);
    await inR.c.waitFor('posters', (m) => m.posters.some((p) => p.id === poster.body.poster.id));
    expect((await h.call('GET', '/api/notes')).body.total).toBe(1);
    await h.stop();
  });

  it('部屋を移っても名前・見た目・バッジはそのまま、ピン止めは外れる', async () => {
    const h = await harness('room-carry');
    const a = await h.join('たいよう');
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 60), a.key);
    clock.t = t0;
    h.srv.arcade.syncSlot();
    // バッジ（テストではメモリに直接入れる）とピン止め
    (h.srv.arcade as unknown as { badges: Map<string, { badges: string }> }).badges.set(
      [...(h.srv.arcade as unknown as { online: Map<string, { pid: string }> }).online.entries()].find(([, p]) => p.pid === a.pid)![0],
      { badges: '♠♦', pinned: null, offSince: null } as never,
    );
    const said = await h.call('POST', '/api/chat', { text: 'ピン止めする発言' }, a.key);
    expect((await h.call('POST', `/api/chat/${said.body.message.id}/pin`, { pinned: true }, a.key)).body.pinned).toBeTruthy();
    await h.call('POST', '/api/rooms/reserved/enter', {}, a.key);
    const w = await a.c.waitFor('welcome', (m) => m.room === 'reserved');
    const me = w.players.find((p) => p.pid === a.pid)!;
    expect(me).toMatchObject({ name: 'たいよう', look: { color: 'red', hat: 'cap' }, badges: '♠♦', pinned: null });
    await h.stop();
  });
});

describe('予約部屋の主催者（予約した人）は、その予約の間だけ予約部屋の管理者（DESIGN §14.6）', () => {
  /** 主催者・合言葉で入った人・オープン部屋の人がいる、開いている予約部屋 */
  const setup = async (name: string) => {
    const h = await harness(name);
    const host = await h.join('たいよう');
    const guest = await h.join('みどり');
    const other = await h.join('あおい');
    const t0 = nextSlot();
    const r = await h.call('POST', '/api/reservations', res(t0, 60), host.key);
    clock.t = t0 + MIN;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, host.key);
    await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, guest.key);
    await host.c.waitFor('welcome', (m) => m.room === 'reserved');
    await guest.c.waitFor('welcome', (m) => m.room === 'reserved');
    return { h, host, guest, other, t0, id: r.body.reservation.id as number };
  };

  it('主催の印・発言とお知らせの削除・お知らせ・筐体を空ける。合言葉で入った人にはできない', async () => {
    const { h, host, guest } = await setup('host-powers');
    // 主催の印（人と発言）
    const w = guest.c.msgs.filter((m) => m.type === 'welcome').pop() as any; // あとから入った人の welcome に 2 人とも
    expect(w.players.find((p: any) => p.pid === host.pid).host).toBe(true);
    expect(w.players.find((p: any) => p.pid === guest.pid).host).toBeUndefined();
    const hs = await h.call('POST', '/api/chat', { text: '主催です' }, host.key);
    expect(hs.body.message.host).toBe(true);
    clock.t += 2000;
    const gs = await h.call('POST', '/api/chat', { text: 'ゲストです' }, guest.key);
    expect(gs.body.message.host).toBeUndefined();

    // 合言葉で入った人には管理の操作はできない
    expect((await h.call('DELETE', `/api/admin/chat/${hs.body.message.id}`, undefined, guest.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/notices', { text: 'ゲストのお知らせ' }, guest.key)).status).toBe(403);
    expect((await h.call('POST', '/api/room/remove', { pid: host.pid }, guest.key)).status).toBe(403);
    expect((await h.call('POST', '/api/room/passphrase', { passphrase: 'あたらしい' }, guest.key)).status).toBe(403);
    expect((await h.call('POST', '/api/room/end', {}, guest.key)).status).toBe(403);

    // 主催者：発言の削除
    expect((await h.call('DELETE', `/api/admin/chat/${gs.body.message.id}`, undefined, host.key)).status).toBe(200);
    await guest.c.waitFor('chat-delete', (m) => m.id === gs.body.message.id);
    // お知らせ（予約部屋だけに流れる）と削除
    const n = await h.call('POST', '/api/admin/notices', { text: '21 時から決勝です' }, host.key);
    expect(n.status).toBe(201);
    await guest.c.waitFor('notices', (m) => m.notices.some((x) => x.text === '21 時から決勝です'));
    expect(h.srv.arcade.notices('open').some((x) => x.text === '21 時から決勝です')).toBe(false);
    expect((await h.call('DELETE', `/api/admin/notices/${n.body.notice.id}`, undefined, host.key)).status).toBe(200);
    expect(h.srv.arcade.notices('reserved').some((x) => x.text === '21 時から決勝です')).toBe(false);
    // 筐体を空ける（ほかの人の筐体でも）
    await h.walk(guest, 3, 5);
    expect((await h.call('POST', '/api/cabinets/1/claim', {}, guest.key)).status).toBe(200);
    expect((await h.call('POST', '/api/cabinets/1/release', {}, host.key)).body.cabinet.owned).toBe(false);
    await h.stop();
  });

  it('人を出す（オープン部屋へ戻し、この予約の間は合言葉でも入れない）・合言葉を変える', async () => {
    const { h, host, guest, other } = await setup('host-remove');
    expect((await h.call('POST', '/api/room/remove', { pid: host.pid }, host.key)).body.code).toBe('self');
    expect((await h.call('POST', '/api/room/remove', { pid: other.pid }, host.key)).body.code).toBe('not-found'); // オープン部屋の人
    expect((await h.call('POST', '/api/room/remove', { pid: guest.pid }, host.key)).status).toBe(200);
    const back = await guest.c.waitFor('welcome', (m) => m.room === 'open' && !!m.reason);
    expect(back.reason).toMatch(/主催者により/);
    const again = await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, guest.key);
    expect(again.body.code).toBe('room-banned');
    const c2 = await h.connect(guest.key, '/ws', 'reserved');
    expect(c2.welcome!.room).toBe('open');

    // 合言葉を変える：古い合言葉では入れない・新しい合言葉で入れる
    expect((await h.call('POST', '/api/room/passphrase', { passphrase: 'ab' }, host.key)).body.code).toBe('bad-pass');
    expect((await h.call('POST', '/api/room/passphrase', { passphrase: 'あたらしい合言葉' }, host.key)).status).toBe(200);
    expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'ひみつの合言葉' }, other.key)).body.code).toBe('bad-passphrase');
    expect((await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'あたらしい合言葉' }, other.key)).body.room).toBe('reserved');
    expect(JSON.stringify((await h.call('GET', '/api/reservations')).body)).not.toMatch(/あたらしい合言葉|scrypt/);
    await h.stop();
  });

  it('早めに終える：全員オープン部屋へ・中身を消す。終わったあとは主催者の力は無い', async () => {
    const { h, host, guest } = await setup('host-end');
    await h.call('POST', '/api/chat', { text: '終わる前の発言' }, guest.key);
    expect((await h.call('POST', '/api/room/end', {}, host.key)).status).toBe(200);
    await guest.c.waitFor('welcome', (m) => m.room === 'open' && /主催者が予約部屋を閉じた/.test(m.reason ?? ''));
    await host.c.waitFor('welcome', (m) => m.room === 'open' && !!m.reason);
    expect((await h.call('GET', '/api/reservations')).body.reservations).toHaveLength(0);
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, host.key)).body.code).toBe('room-closed');
    expect(h.srv.arcade.recentChat('reserved')).toHaveLength(0);
    // 主催者の力はもう無い（オープン部屋では何もできない）
    clock.t += 2000;
    const said = await h.call('POST', '/api/chat', { text: 'オープン部屋の発言' }, guest.key);
    expect((await h.call('DELETE', `/api/admin/chat/${said.body.message.id}`, undefined, host.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/notices', { text: 'x' }, host.key)).status).toBe(403);
    expect((await h.call('POST', '/api/room/end', {}, host.key)).status).toBe(403);
    await h.stop();
  });

  it('予約の時間が終われば力も無くなる・オープン部屋やサイトの管理の操作はできない・つなぎ直しても主催者のまま', async () => {
    const { h, host, guest, t0 } = await setup('host-scope');
    // オープン部屋に戻ると、予約の間でも力は使えない
    const n0 = host.c.msgs.filter((x) => x.type === 'welcome').length;
    await h.call('POST', '/api/rooms/open/enter', {}, host.key);
    await host.c.waitFor('welcome', (m) => m.room === 'open' && host.c.msgs.filter((x) => x.type === 'welcome').length > n0);
    expect((await h.call('POST', '/api/admin/notices', { text: 'オープン部屋へのお知らせ' }, host.key)).status).toBe(403);
    // サイトの管理の操作（要望箱・ほかの人のノートとポスター・退室）はできない
    expect((await h.call('GET', '/api/admin/requests', undefined, host.key)).status).toBe(403);
    const note = await h.call('POST', '/api/notes', { name: 'みどり', text: 'こんにちは' }, guest.key);
    expect((await h.call('DELETE', `/api/notes/${note.body.note.id}`, undefined, host.key)).status).toBe(403);
    const poster = await h.call(
      'POST',
      '/api/posters',
      { kind: 'event', title: '大会', game: '', body: '', url: null, startsAt: clock.t + 24 * H, endsAt: null },
      guest.key,
    );
    expect((await h.call('DELETE', `/api/posters/${poster.body.poster.id}`, undefined, host.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/kick', { pid: guest.pid, minutes: 0 }, host.key)).status).toBe(403);
    // つなぎ直し（再読み込み）でも主催者
    await h.call('POST', '/api/rooms/reserved/enter', {}, host.key);
    await host.c.close();
    const c2 = await h.connect(host.key, '/ws', 'reserved');
    expect(c2.welcome!.players.find((p) => p.pid === host.pid)!.host).toBe(true);
    expect((await h.call('POST', '/api/admin/notices', { text: 'つなぎ直しても' }, host.key)).status).toBe(201);
    // 予約の時間が終わったら力は無い（予約部屋も閉じる）
    clock.t = t0 + H;
    h.srv.arcade.syncSlot();
    await c2.waitFor('welcome', (m) => m.room === 'open');
    expect((await h.call('POST', '/api/room/end', {}, host.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/notices', { text: 'もう主催者ではない' }, host.key)).status).toBe(403);
    await h.stop();
  });

  it('ほかの人の予約の時間には、前の予約の主催者は何もできない・サイトの管理者はどの部屋でもできる', async () => {
    const h = await harness('host-other');
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const admin = await h.join('てんちょう');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    const t0 = nextSlot();
    await h.call('POST', '/api/reservations', res(t0, 30), a.key);
    await h.call('POST', '/api/reservations', res(t0 + 30 * MIN, 30, { passphrase: 'びーの合言葉' }), b.key);
    clock.t = t0 + 30 * MIN;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, b.key);
    await h.call('POST', '/api/rooms/reserved/enter', { passphrase: 'びーの合言葉' }, a.key);
    await a.c.waitFor('welcome', (m) => m.room === 'reserved');
    expect((await h.call('POST', '/api/admin/notices', { text: 'a のお知らせ' }, a.key)).status).toBe(403);
    expect((await h.call('POST', '/api/room/end', {}, a.key)).status).toBe(403);
    // サイトの管理者は予約部屋でも
    await h.call('POST', '/api/rooms/reserved/enter', {}, admin.key);
    await admin.c.waitFor('welcome', (m) => m.room === 'reserved');
    expect((await h.call('POST', '/api/room/remove', { pid: a.pid }, admin.key)).status).toBe(200);
    expect((await h.call('POST', '/api/admin/notices', { text: '管理者のお知らせ' }, admin.key)).status).toBe(201);
    // 主催者はサイトの管理者を出せない
    expect((await h.call('POST', '/api/room/remove', { pid: admin.pid }, b.key)).status).toBe(403);
    await h.stop();
  });
});
