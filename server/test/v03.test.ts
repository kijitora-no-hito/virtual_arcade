// v0.3.0：クレーンゲーム（DESIGN §8）とポスター欄（DESIGN §9）の API・WebSocket。

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { ADMIN_PW, clock, harness, LOOK, newKey, sleep } from './harness';

type H = Awaited<ReturnType<typeof harness>>;

describe('クレーンゲーム（DESIGN §8）', () => {
  // クレーンゲーム 1 は (20, 0)。前のマスは (20, 1)
  const near = { x: 20, y: 1 };
  const capsuleOf = async (h: H, key: string) => {
    const st = await h.call('GET', '/api/crane/1', undefined, key);
    expect(st.status).toBe(200);
    return st.body.machine.capsules[0] as { id: number; x: number; z: number };
  };

  it('近くでないと遊べない・中身は送らない・取れたらバッジが付いて全員に見える・待ち時間・ダブりなし', async () => {
    // 乱数 0 = ぴったりなら必ず取れる・カプセルの中身はどれも ♠
    const h = await harness('crane', { rng: () => 0 });
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const st = await h.call('GET', '/api/crane/1', undefined, a.key);
    expect(st.body.machine.capsules).toHaveLength(8);
    expect(JSON.stringify(st.body)).not.toMatch(/suit|♠/);
    expect((await h.call('GET', '/api/crane/9', undefined, a.key)).status).toBe(404);

    const c = st.body.machine.capsules[0];
    expect((await h.call('POST', '/api/crane/1/play', { x: c.x, z: c.z }, a.key)).body.code).toBe('too-far');
    await h.walk(a, near.x, near.y);
    expect((await h.call('POST', '/api/crane/1/play', { x: 'a', z: c.z }, a.key)).body.code).toBe('bad-input');

    const r = await h.call('POST', '/api/crane/1/play', { x: c.x, z: c.z }, a.key);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: 'win', capsuleId: c.id, suit: '♠', gained: true, duplicate: false, badges: '♠' });
    expect(r.body.cooldownUntil).toBe(clock.t + 20_000);
    expect(r.body.machine.capsules).toHaveLength(8);
    expect(r.body.chance).toBeUndefined();
    // ほかの人：頭上の名前のバッジ・チャットの案内
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.badges === '♠');
    await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text === 'たいよう さんがクレーンゲームで ♠ を取った！');
    await a.c.waitFor('you', (m) => m.you.badges === '♠');

    // 待ち時間（サーバで確かめる）
    const c2 = r.body.machine.capsules[0];
    expect((await h.call('POST', '/api/crane/1/play', { x: c2.x, z: c2.z }, a.key)).body.code).toBe('cooldown');
    clock.t += 19_000;
    expect((await h.call('POST', '/api/crane/1/play', { x: c2.x, z: c2.z }, a.key)).body.code).toBe('cooldown');
    expect((await h.call('GET', '/api/crane/1', undefined, a.key)).body.cooldownUntil).toBe(clock.t + 1000);
    clock.t += 1_000;
    // 2 個目も ♠ → もう持っています（案内は流さない）
    const n = b.c.msgs.length;
    const dup = await h.call('POST', '/api/crane/1/play', { x: c2.x, z: c2.z }, a.key);
    expect(dup.body).toMatchObject({ outcome: 'win', suit: '♠', gained: false, duplicate: true, badges: '♠' });
    await sleep(100);
    expect(b.c.msgs.slice(n).some((m) => m.type === 'chat')).toBe(false);

    // 発言にもバッジ（発言したときのもの）・自分の情報にも
    clock.t += 20_000;
    const said = await h.call('POST', '/api/chat', { text: 'とれた！' }, a.key);
    expect(said.body.message).toMatchObject({ name: 'たいよう', badges: '♠' });
    expect((await h.call('GET', '/api/me', undefined, a.key)).body.profile.badges).toBe('♠');
    const recent = (await h.connect(b.key)).welcome!.chat.find((m) => m.text === 'とれた！');
    expect(recent).toMatchObject({ badges: '♠' });
    await h.stop();
  });

  it('当たり外れ：空振り・途中で落ちる（位置が変わる）・確率の上限は設定で', async () => {
    let next = 0.99;
    const h = await harness('crane-miss', { rng: () => next });
    const a = await h.join('あ');
    await h.walk(a, near.x, near.y);
    const c = await capsuleOf(h, a.key);
    // 遠くで下ろす → 空振り
    const miss = await h.call('POST', '/api/crane/1/play', { x: 0, z: 0 }, a.key);
    expect(miss.body).toMatchObject({ outcome: 'miss', capsuleId: null, suit: null, gained: false });
    // 乱数 0.8：ぴったり 65% を超え、残りの前半 → 途中で落ちた
    clock.t += 20_000;
    next = 0.8;
    const drop = await h.call('POST', '/api/crane/1/play', { x: c.x, z: c.z }, a.key);
    expect(drop.body.outcome).toBe('drop');
    const moved = drop.body.machine.capsules.find((x: { id: number }) => x.id === c.id);
    expect(moved).toMatchObject(drop.body.dropTo);
    expect(drop.body.badges).toBe('');
    // 乱数 0.95：触れたがつかみ損ね
    clock.t += 20_000;
    const c2 = drop.body.machine.capsules.find((x: { id: number }) => x.id !== c.id);
    next = 0.95;
    expect((await h.call('POST', '/api/crane/1/play', { x: c2.x, z: c2.z }, a.key)).body.outcome).toBe('slip');
    await h.stop();

    // 確率の上限 100%（CRANE_MAX_CHANCE=100）なら乱数 0.8 でも取れる
    const h2 = await harness('crane-odds', { rng: () => 0.8, craneOdds: { maxChance: 1, perfect: 0.025, zero: 0.11 } });
    const b = await h2.join('い');
    await h2.walk(b, near.x, near.y);
    const c3 = await capsuleOf(h2, b.key);
    expect((await h2.call('POST', '/api/crane/1/play', { x: c3.x, z: c3.z }, b.key)).body.outcome).toBe('win');
    await h2.stop();
  });

  it('4 種類そろうとコンプリートの案内・重ねて持てる設定', async () => {
    const h = await harness('crane-complete', { rng: () => 0, craneCooldownMs: 1000 });
    const a = await h.join('あ');
    const b = await h.join('い');
    await h.walk(a, near.x, near.y);
    // 中身の分かったケースを入れる（テストだけ）
    const suits = ['♠', '♡', '♦', '♧'] as const;
    (h.srv.arcade as unknown as { rooms: { open: { machines: Map<number, unknown> } } }).rooms.open.machines.set(1, {
      id: 1,
      nextId: 5,
      rev: 1,
      capsules: suits.map((suit, i) => ({ id: i + 1, x: 0.3 + i * 0.18, z: 0.5, color: '#fff', suit })),
    });
    let last: Record<string, unknown> = {};
    for (let i = 0; i < suits.length; i++) {
      clock.t += 1000;
      last = (await h.call('POST', '/api/crane/1/play', { x: 0.3 + i * 0.18, z: 0.5 }, a.key)).body;
    }
    expect(last).toMatchObject({ badges: '♠♡♦♧', completed: true });
    await b.c.waitFor('chat', (m) => m.message.text === '🎉 あ さんが 4 種類コンプリート！');
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.badges === '♠♡♦♧');
    await h.stop();

    const s = await harness('crane-stack', { rng: () => 0, craneCooldownMs: 1000, badgeMode: 'stack', badgeStackMax: 2 });
    const c = await s.join('う');
    await s.walk(c, near.x, near.y);
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      clock.t += 1000;
      const cap = await capsuleOf(s, c.key);
      got.push((await s.call('POST', '/api/crane/1/play', { x: cap.x, z: cap.z }, c.key)).body.badges);
    }
    expect(got).toEqual(['♠', '♠♠', '♠♠']);
    expect((await s.call('GET', '/api/meta')).body.crane).toMatchObject({ badgeMode: 'stack', stackMax: 2, cooldownMs: 1000 });
    await s.stop();
  });

  it('バッジは再読み込み・一時的な切断では残り、退店・切断から 30 分・退室させられたら消える', async () => {
    const h = await harness('badges', { rng: () => 0 });
    const a = await h.join('あ');
    const b = await h.join('い');
    await h.walk(a, near.x, near.y);
    const cap = await capsuleOf(h, a.key);
    await h.call('POST', '/api/crane/1/play', { x: cap.x, z: cap.z }, a.key);

    // 再読み込み（つなぎ直し）
    await a.c.close();
    await b.c.waitFor('leave', (m) => m.pid === a.pid);
    const again = await h.connect(a.key);
    expect(again.welcome!.you.badges).toBe('♠');
    expect(again.welcome!.players.find((p) => p.pid === a.pid)!.badges).toBe('♠');

    // 切断から 29 分は残る・30 分で消える
    await again.close();
    await sleep(100);
    clock.t += 29 * 60 * 1000;
    h.srv.arcade.sweep();
    expect((await h.call('GET', '/api/me', undefined, a.key)).body.profile.badges).toBe('♠');
    clock.t += 60 * 1000;
    h.srv.arcade.sweep();
    expect((await h.call('GET', '/api/me', undefined, a.key)).body.profile.badges).toBe('');

    // 退店：バッジが消え、接続は切れる（bye）。名前と見た目は残る
    const c = await h.join('う');
    await h.walk(c, near.x, near.y);
    const cap2 = await capsuleOf(h, c.key);
    expect((await h.call('POST', '/api/crane/1/play', { x: cap2.x, z: cap2.z }, c.key)).body.badges).toBe('♠');
    expect((await h.call('POST', '/api/leave', undefined, c.key)).status).toBe(200);
    await c.c.waitFor('bye');
    await b.c.waitFor('leave', (m) => m.pid === c.pid);
    expect((await h.call('GET', '/api/me', undefined, c.key)).body.profile).toMatchObject({ name: 'う', badges: '' });
    const back = await h.connect(c.key);
    expect(back.welcome!.you.badges).toBe('');

    // 管理者に退室させられたら消える
    const d = await h.join('え');
    await h.walk(d, near.x, near.y);
    const cap3 = await capsuleOf(h, d.key);
    expect((await h.call('POST', '/api/crane/1/play', { x: cap3.x, z: cap3.z }, d.key)).body.badges).toBe('♠');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, b.key);
    await h.call('POST', '/api/admin/kick', { pid: d.pid }, b.key);
    expect((await h.call('GET', '/api/me', undefined, d.key)).body.profile.badges).toBe('');
    await h.stop();
  });
});

describe('ポスター欄（DESIGN §9）', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const poster = (over: Record<string, unknown> = {}) => ({
    kind: 'tournament',
    title: '格闘ゲーム交流大会',
    game: '格闘ゲーム',
    body: '初心者歓迎！\n観戦だけでもどうぞ',
    url: 'https://example.com/event',
    startsAt: clock.t + 2 * DAY,
    endsAt: null,
    ...over,
  });

  it('貼る（全員に配る・チャットに案内）・検証・1 人 2 枚まで・入室していない人は貼れない', async () => {
    const h = await harness('posters');
    const a = await h.join('あ');
    const b = await h.join('い');
    const r = await h.call('POST', '/api/posters', poster(), a.key);
    expect(r.status).toBe(201);
    expect(r.body.poster).toMatchObject({
      title: '格闘ゲーム交流大会',
      body: '初心者歓迎！\n観戦だけでもどうぞ',
      authorName: 'あ',
      authorPid: a.pid,
      pinned: false,
      expiresAt: clock.t + 3 * DAY,
    });
    expect(JSON.stringify(r.body)).not.toMatch(/authorKey|author_key/);
    await b.c.waitFor('posters', (m) => m.posters.length === 1 && m.posters[0].title === '格闘ゲーム交流大会');
    await b.c.waitFor(
      'chat',
      (m) => m.message.kind === 'system' && m.message.text.startsWith('📌 あ さんがポスターを貼りました：「格闘ゲーム交流大会」'),
    );

    expect((await h.call('POST', '/api/posters', poster({ title: '' }), a.key)).body.code).toBe('bad-input');
    expect((await h.call('POST', '/api/posters', poster({ title: 'あ'.repeat(41) }), a.key)).body.code).toBe('too-long');
    expect((await h.call('POST', '/api/posters', poster({ body: 'あ'.repeat(401) }), a.key)).body.code).toBe('too-long');
    expect((await h.call('POST', '/api/posters', poster({ title: '死ね' }), a.key)).body.code).toBe('ng');
    expect((await h.call('POST', '/api/posters', poster({ url: 'javascript:alert(1)' }), a.key)).body.code).toBe('bad-url');
    expect((await h.call('POST', '/api/posters', poster({ startsAt: null }), a.key)).body.code).toBe('bad-time');

    expect((await h.call('POST', '/api/posters', poster({ title: '2 枚目' }), a.key)).status).toBe(201);
    expect((await h.call('POST', '/api/posters', poster({ title: '3 枚目' }), a.key)).body.code).toBe('too-many');
    // 入室していない人
    const k = newKey();
    await h.call('POST', '/api/enter', { name: 'う', look: LOOK }, k);
    expect((await h.call('POST', '/api/posters', poster(), k)).body.code).toBe('not-online');
    await h.stop();
  });

  it('直す・はがす（書いた人）・管理者はどれでも直せる・はがせる・ピンで先頭・一覧は近い日時の順', async () => {
    const h = await harness('posters-edit');
    const a = await h.join('あ');
    const b = await h.join('い');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    const p1 = (await h.call('POST', '/api/posters', poster({ title: '遠い', startsAt: clock.t + 5 * DAY }), a.key)).body.poster;
    const p2 = (await h.call('POST', '/api/posters', poster({ title: '近い', startsAt: clock.t + DAY }), b.key)).body.poster;
    const p3 = (await h.call('POST', '/api/posters', poster({ title: 'まんなか', startsAt: clock.t + 3 * DAY }), b.key)).body.poster;
    let list = (await h.call('GET', '/api/posters')).body.posters;
    expect(list.map((p: { title: string }) => p.title)).toEqual(['近い', 'まんなか', '遠い']);

    // 直す（書いた人だけ）
    expect((await h.call('PATCH', `/api/posters/${p1.id}`, poster({ title: '直した', startsAt: clock.t + 5 * DAY }), b.key)).status).toBe(403);
    const ed = await h.call('PATCH', `/api/posters/${p1.id}`, poster({ title: '直した', startsAt: clock.t + 5 * DAY }), a.key);
    expect(ed.body.poster).toMatchObject({ id: p1.id, title: '直した', authorName: 'あ' });
    expect((await h.call('PATCH', `/api/posters/${p1.id}`, poster({ title: 'あ'.repeat(41) }), a.key)).body.code).toBe('too-long');
    // 管理者が直しても書いた人の名前は変わらない
    const ae = await h.call('PATCH', `/api/posters/${p1.id}`, poster({ title: '管理者が直した', startsAt: clock.t + 5 * DAY }), adm.key);
    expect(ae.body.poster).toMatchObject({ title: '管理者が直した', authorName: 'あ' });

    // ピン（管理者だけ）
    expect((await h.call('POST', `/api/admin/posters/${p1.id}/pin`, { pinned: true }, a.key)).status).toBe(403);
    expect((await h.call('POST', `/api/admin/posters/${p1.id}/pin`, { pinned: true }, adm.key)).body.poster.pinned).toBe(true);
    await b.c.waitFor('posters', (m) => m.posters[0]?.id === p1.id && m.posters[0].pinned);
    list = (await h.call('GET', '/api/posters')).body.posters;
    expect(list.map((p: { id: number }) => p.id)).toEqual([p1.id, p2.id, p3.id]);

    // はがす：ほかの人はできない・書いた人・管理者はどれでも
    expect((await h.call('DELETE', `/api/posters/${p2.id}`, undefined, a.key)).status).toBe(403);
    expect((await h.call('DELETE', `/api/posters/${p2.id}`, undefined, b.key)).status).toBe(200);
    expect((await h.call('DELETE', `/api/posters/${p1.id}`, undefined, adm.key)).status).toBe(200);
    expect((await h.call('DELETE', `/api/posters/${p1.id}`, undefined, adm.key)).status).toBe(404);
    await a.c.waitFor('posters', (m) => m.posters.length === 1 && m.posters[0].id === p3.id);
    // はがしたので、また貼れる（1 人 2 枚）
    expect((await h.call('POST', '/api/posters', poster({ title: '3 枚目' }), b.key)).status).toBe(201);
    await h.stop();
  });

  it('期限（終了・開始から 1 日）を過ぎたら自動ではがす・再起動しても残る', async () => {
    const h = await harness('posters-keep');
    const a = await h.join('あ');
    await h.call('POST', '/api/posters', poster({ title: '3 時間', startsAt: clock.t + HOUR, endsAt: clock.t + 3 * HOUR }), a.key);
    await h.call('POST', '/api/posters', poster({ title: '終了なし', startsAt: clock.t + 2 * HOUR }), a.key);
    expect(a.c.welcome!.posters).toEqual([]);
    await h.stop();

    // 再起動（同じ DB）
    const h2 = await harness('posters-keep');
    const c = await h2.join('う');
    expect(c.c.welcome!.posters.map((p) => p.title)).toEqual(['3 時間', '終了なし']);
    clock.t += 3 * HOUR;
    h2.srv.arcade.sweep();
    await c.c.waitFor('posters', (m) => m.posters.length === 1 && m.posters[0].title === '終了なし');
    clock.t += 22 * HOUR; // まだ（開始から 23 時間）
    expect((await h2.call('GET', '/api/posters')).body.posters).toHaveLength(1);
    clock.t += HOUR; // 開始から 1 日
    expect((await h2.call('GET', '/api/posters')).body.posters).toEqual([]);
    await h2.stop();
  });

  it('管理者だけが書ける設定・回数制限', async () => {
    const h = await harness('posters-admin', { posterWho: 'admin' });
    const a = await h.join('あ');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    expect((await h.call('POST', '/api/posters', poster(), a.key)).body.code).toBe('not-admin');
    expect((await h.call('POST', '/api/posters', poster(), adm.key)).status).toBe(201);
    expect((await h.call('GET', '/api/meta')).body.posters).toMatchObject({ who: 'admin', maxPerUser: 2, maxTotal: 40 });
    await h.stop();

    const base = defaultConfig({});
    const r = await harness('posters-rate', { rates: { ...base.rates, posterKey: { limit: 2, windowMs: 60_000 } } });
    const b = await r.join('い');
    const p = (await r.call('POST', '/api/posters', poster(), b.key)).body.poster;
    expect((await r.call('PATCH', `/api/posters/${p.id}`, poster({ title: 'x' }), b.key)).status).toBe(200);
    expect((await r.call('PATCH', `/api/posters/${p.id}`, poster({ title: 'y' }), b.key)).body.code).toBe('rate');
    await r.stop();
  });
});

describe('設定（v0.3.0）', () => {
  it('既定値と環境変数', () => {
    const c = defaultConfig({});
    expect(c).toMatchObject({ craneCooldownMs: 20_000, badgeMode: 'unique', badgeStackMax: 3, badgeKeepMs: 30 * 60 * 1000, posterWho: 'all', posterMaxPerUser: 2 });
    expect(c.craneOdds.maxChance).toBe(0.65);
    const e = defaultConfig({
      CRANE_COOLDOWN_SEC: '5',
      CRANE_MAX_CHANCE: '80',
      BADGE_MODE: 'stack',
      BADGE_STACK_MAX: '4',
      BADGE_KEEP_MIN: '10',
      POSTER_WHO: 'admin',
      POSTER_MAX_PER_USER: '3',
    });
    expect(e).toMatchObject({ craneCooldownMs: 5000, badgeMode: 'stack', badgeStackMax: 4, badgeKeepMs: 600_000, posterWho: 'admin', posterMaxPerUser: 3 });
    expect(e.craneOdds.maxChance).toBe(0.8);
  });
});

describe('チャットのピン止め（v0.3.0）', () => {
  it('自分の発言だけ・1 人 1 つ（差し替え）・外す・全員に配る', async () => {
    const h = await harness('pin');
    const a = await h.join('あ');
    const b = await h.join('い');
    const m1 = (await h.call('POST', '/api/chat', { text: '21 時から大会やります！' }, a.key)).body.message;
    clock.t += 2000;
    const m2 = (await h.call('POST', '/api/chat', { text: '参加者募集中' }, a.key)).body.message;
    const mb = (await h.call('POST', '/api/chat', { text: 'いの発言' }, b.key)).body.message;

    // ほかの人の発言・ない発言は断る
    expect((await h.call('POST', `/api/chat/${mb.id}/pin`, {}, a.key)).body.code).toBe('not-owner');
    expect((await h.call('POST', '/api/chat/99999/pin', {}, a.key)).status).toBe(404);

    const r = await h.call('POST', `/api/chat/${m1.id}/pin`, {}, a.key);
    expect(r.body.pinned).toEqual({ id: m1.id, text: '21 時から大会やります！' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned?.id === m1.id);

    // 別の発言を押したら差し替え（1 つまで）
    await h.call('POST', `/api/chat/${m2.id}/pin`, {}, a.key);
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned?.id === m2.id);
    // 違う発言を外しても変わらない・同じ発言で外れる
    expect((await h.call('POST', `/api/chat/${m1.id}/pin`, { pinned: false }, a.key)).body.pinned).toEqual({ id: m2.id, text: '参加者募集中' });
    expect((await h.call('POST', `/api/chat/${m2.id}/pin`, { pinned: false }, a.key)).body.pinned).toBeNull();
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned === null);

    // 入室時の状態にも入る・再読み込みでは残る
    await h.call('POST', `/api/chat/${m1.id}/pin`, {}, a.key);
    await a.c.close();
    const again = await h.connect(a.key);
    expect(again.welcome!.players.find((p) => p.pid === a.pid)!.pinned).toEqual({ id: m1.id, text: '21 時から大会やります！' });
    const c = await h.join('う');
    expect(c.c.welcome!.players.find((p) => p.pid === a.pid)!.pinned?.id).toBe(m1.id);
    await h.stop();
  });

  it('管理者が発言を消したら外れる・退店・切断から 30 分で消える・回数制限', async () => {
    const base = defaultConfig({});
    const h = await harness('pin-clear', { rates: { ...base.rates, pinKey: { limit: 3, windowMs: 60_000 } } });
    const a = await h.join('あ');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    const m1 = (await h.call('POST', '/api/chat', { text: 'ピン止めする発言' }, a.key)).body.message;
    await h.call('POST', `/api/chat/${m1.id}/pin`, {}, a.key);
    await h.call('DELETE', `/api/admin/chat/${m1.id}`, undefined, adm.key);
    await adm.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned === null);

    // 切断から 30 分
    clock.t += 2000;
    const m2 = (await h.call('POST', '/api/chat', { text: 'もう一度' }, a.key)).body.message;
    await h.call('POST', `/api/chat/${m2.id}/pin`, {}, a.key);
    await a.c.close();
    await adm.c.waitFor('leave', (m) => m.pid === a.pid);
    clock.t += 29 * 60 * 1000;
    h.srv.arcade.sweep();
    const back = await h.connect(a.key);
    expect(back.welcome!.you.pid).toBe(a.pid);
    expect(back.welcome!.players.find((p) => p.pid === a.pid)!.pinned?.id).toBe(m2.id);
    await back.close();
    await sleep(50);
    clock.t += 31 * 60 * 1000;
    h.srv.arcade.sweep();
    const back2 = await h.connect(a.key);
    expect(back2.welcome!.players.find((p) => p.pid === a.pid)!.pinned).toBeNull();

    // 退店で消える
    clock.t += 2000;
    const m3 = (await h.call('POST', '/api/chat', { text: '退店の前' }, a.key)).body.message;
    expect((await h.call('POST', `/api/chat/${m3.id}/pin`, {}, a.key)).status).toBe(200);
    await h.call('POST', '/api/leave', undefined, a.key);
    const back3 = await h.connect(a.key);
    expect(back3.welcome!.players.find((p) => p.pid === a.pid)!.pinned).toBeNull();
    // 回数制限（ここでは鍵ごと 3 回 / 分。既定は 10 回）
    expect((await h.call('POST', `/api/chat/${m3.id}/pin`, {}, a.key)).body.code).toBe('rate');
    await h.stop();
  });
});
