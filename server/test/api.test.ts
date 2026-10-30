import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { FLOOR, frontTile, type CabinetView } from '@va/shared';
import { describe, expect, it } from 'vitest';
import { ADMIN_PW, clock, harness, LOOK, newKey, sleep, tmp } from './harness';
import { hashPassphrase } from '../src/secret';

const statusOfUpgrade = (origin: string, p: string): Promise<number> =>
  new Promise((resolve) => {
    const u = new URL(origin);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: p,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(-1));
    req.end();
  });

describe('入室と再入室', () => {
  it('名前と見た目を決めて入る・同じ鍵なら同じ人として戻る', async () => {
    const h = await harness('enter');
    const key = newKey();
    expect((await h.call('GET', '/api/me', undefined, key)).body).toEqual({ profile: null });
    const r1 = await h.call('POST', '/api/enter', { name: ' たろう ', look: LOOK }, key);
    expect(r1.status).toBe(200);
    expect(r1.body.profile).toMatchObject({ name: 'たろう', look: LOOK, admin: false });
    const me = await h.call('GET', '/api/me', undefined, key);
    expect(me.body.profile.pid).toBe(r1.body.profile.pid);

    // 再入室（名前を変えても pid は同じ）
    const r2 = await h.call('POST', '/api/enter', { name: 'たろう2', look: { color: 'blue', hat: 'none' } }, key);
    expect(r2.body.profile.pid).toBe(r1.body.profile.pid);

    const c = await h.connect(key);
    expect(c.welcome!.you).toMatchObject({ name: 'たろう2', pid: r1.body.profile.pid });
    expect(c.welcome!.cabinets).toHaveLength(16);
    expect(c.welcome!.players.map((p) => p.pid)).toContain(r1.body.profile.pid);
    // 位置は spawn のどれか
    const p0 = c.welcome!.players[0].path[0];
    expect(FLOOR.spawn.some((s) => s.x === p0.x && s.y === p0.y)).toBe(true);
    await h.stop();
  });

  it('名前・見た目・鍵の検証', async () => {
    const h = await harness('enter-bad');
    const key = newKey();
    expect((await h.call('POST', '/api/enter', { name: '', look: LOOK }, key)).status).toBe(400);
    expect((await h.call('POST', '/api/enter', { name: 'あ'.repeat(21), look: LOOK }, key)).status).toBe(400);
    expect((await h.call('POST', '/api/enter', { name: '死ね', look: LOOK }, key)).body.code).toBe('bad-name');
    expect((await h.call('POST', '/api/enter', { name: 'a', look: { color: 'gold', hat: 'cap' } }, key)).body.code).toBe('bad-look');
    expect((await h.call('POST', '/api/enter', { name: 'a', look: LOOK })).status).toBe(401);
    expect((await h.call('POST', '/api/enter', { name: 'a', look: LOOK }, 'short')).status).toBe(401);
    // 名前を決めずに WebSocket → need-enter
    const c = await h.connect(newKey());
    expect(c.msgs[0]).toMatchObject({ type: 'error', code: 'need-enter' });
    await h.stop();
  });

  it('再接続すると前の位置に戻る・同じ鍵の 2 本目は 1 本目を置き換える（退室にならない）', async () => {
    const h = await harness('reenter');
    const a = await h.join('あ');
    const b = await h.join('い');
    await h.walk(a, 8, 13);
    const second = await h.connect(a.key);
    expect(second.welcome).not.toBeNull();
    await a.c.waitFor('error', (m) => m.code === 'replaced');
    await sleep(100);
    expect(b.c.msgs.some((m) => m.type === 'leave' && m.pid === a.pid)).toBe(false);
    // 2 本目も閉じる → 退室、位置を覚える
    await second.close();
    await b.c.waitFor('leave', (m) => m.pid === a.pid);
    const third = await h.connect(a.key);
    expect(third.welcome!.players.find((p) => p.pid === a.pid)!.path).toEqual([{ x: 8, y: 13 }]);
    await h.stop();
  });

  it('入室の回数制限は初めての人だけを数える（入り直しは数えない）', async () => {
    const base = (await import('../src/config')).defaultConfig({});
    const h = await harness('enter-rate', { rates: { ...base.rates, enter: { limit: 1, windowMs: 60_000 } } });
    const a = newKey();
    expect((await h.call('POST', '/api/enter', { name: 'a', look: LOOK }, a)).status).toBe(200);
    expect((await h.call('POST', '/api/enter', { name: 'b', look: LOOK }, newKey())).status).toBe(429);
    expect((await h.call('POST', '/api/enter', { name: 'a2', look: LOOK }, a)).status).toBe(200);
    await h.stop();
  });

  it('上限の人数：満員なら入れない（管理者は入れる）', async () => {
    const h = await harness('full', { maxPlayers: 2 });
    await h.join('1');
    await h.join('2');
    const k3 = newKey();
    expect((await h.call('POST', '/api/enter', { name: '3', look: LOOK }, k3)).body.code).toBe('full');
    expect((await h.call('GET', '/api/meta')).body).toMatchObject({ maxPlayers: 2, online: 2 });
    await h.stop();

    // 名前を決めたことがある人でも、満員なら WebSocket で断られる。管理者は満員でも入れる
    const h2 = await harness('full2', { maxPlayers: 1 });
    const x = newKey();
    const adm = newKey();
    await h2.call('POST', '/api/enter', { name: 'x', look: LOOK }, x); // 名前だけ（店内にはいない）
    await h2.call('POST', '/api/enter', { name: 'adm', look: LOOK }, adm);
    expect((await h2.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm)).status).toBe(200);
    await h2.join('first');
    const c = await h2.connect(x);
    expect(c.msgs[0]).toMatchObject({ type: 'error', code: 'full' });
    expect((await h2.connect(adm)).welcome).not.toBeNull();
    await h2.stop();
  });
});

describe('移動', () => {
  it('目的地へ A* の経路で歩く・全員に配る', async () => {
    const h = await harness('move');
    const a = await h.join('あ');
    const b = await h.join('い');
    const m = await h.walk(a, 4, 3);
    expect(m.path[m.path.length - 1]).toEqual({ x: 4, y: 3 });
    for (let i = 1; i < m.path.length; i++) {
      expect(Math.abs(m.path[i].x - m.path[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.path[i].y - m.path[i - 1].y)).toBeLessThanOrEqual(1);
    }
    await b.c.waitFor('move', (x) => x.pid === a.pid);
    await h.stop();
  });

  it('通れないマス・範囲外・小数は断る', async () => {
    const h = await harness('move-bad');
    const a = await h.join('あ');
    const cab = FLOOR.cabinets[0];
    a.c.send({ type: 'goto', x: cab.x, y: cab.y });
    await a.c.waitFor('error', (m) => m.code === 'blocked');
    const d = FLOOR.decor[0];
    a.c.send({ type: 'goto', x: d.x, y: d.y });
    a.c.send({ type: 'goto', x: -1, y: 0 });
    a.c.send({ type: 'goto', x: 99, y: 3 });
    a.c.send({ type: 'goto', x: 1.5, y: 3 });
    a.c.send({ type: 'goto', x: '2', y: 3 });
    await sleep(200);
    const errs = a.c.msgs.filter((m) => m.type === 'error');
    expect(errs.map((e) => (e as { code?: string }).code)).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'bad-input', 'bad-input']);
    expect(a.c.msgs.some((m) => m.type === 'move')).toBe(false);
    await h.stop();
  });
});

describe('チャット', () => {
  it('発言は全員に届き、直近が残る', async () => {
    const h = await harness('chat');
    const a = await h.join('あ');
    const b = await h.join('い');
    const r = await h.call('POST', '/api/chat', { text: ' こんにちは ' }, a.key);
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ kind: 'user', pid: a.pid, name: 'あ', text: 'こんにちは' });
    await b.c.waitFor('chat', (m) => m.message.text === 'こんにちは');
    const again = await h.connect(b.key);
    expect(again.welcome!.chat.at(-1)?.text).toBe('こんにちは');
    await h.stop();
  });

  it('200 文字・NG 語・入室していない・連投の制限', async () => {
    const h = await harness('chat-limit', { chatMinIntervalMs: 0 });
    const a = await h.join('あ');
    expect((await h.call('POST', '/api/chat', { text: 'あ'.repeat(201) }, a.key)).body.code).toBe('too-long');
    expect((await h.call('POST', '/api/chat', { text: 'あ'.repeat(200) }, a.key)).status).toBe(201);
    expect((await h.call('POST', '/api/chat', { text: 'おまえ死ね' }, a.key)).body.code).toBe('ng');
    expect((await h.call('POST', '/api/chat', { text: 'ＦＵＣＫ' }, a.key)).body.code).toBe('ng');
    expect((await h.call('POST', '/api/chat', { text: '   ' }, a.key)).status).toBe(400);
    expect((await h.call('POST', '/api/chat', { text: 'x' }, newKey())).body.code).toBe('not-online');
    // 鍵ごと 15 秒に 6 回まで（1 回目は上で済んでいる）
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await h.call('POST', '/api/chat', { text: `連投${i}` }, a.key)).status);
    expect(codes.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(codes[5]).toBe(429);
    await h.stop();
  });

  it('同じ人の発言は 1 秒に 1 回', async () => {
    const h = await harness('chat-interval');
    const a = await h.join('あ');
    expect((await h.call('POST', '/api/chat', { text: '1' }, a.key)).status).toBe(201);
    expect((await h.call('POST', '/api/chat', { text: '2' }, a.key)).status).toBe(429);
    clock.t += 1500;
    expect((await h.call('POST', '/api/chat', { text: '3' }, a.key)).status).toBe(201);
    await h.stop();
  });
});

describe('エモーションと視聴', () => {
  it('エモーションは一覧のものだけ・回数制限', async () => {
    const h = await harness('emote', { emoteMinIntervalMs: 0 });
    const a = await h.join('あ');
    const b = await h.join('い');
    a.c.send({ type: 'emote', emoji: '👍' });
    await b.c.waitFor('emote', (m) => m.pid === a.pid && m.emoji === '👍');
    a.c.send({ type: 'emote', emoji: '💩' });
    await a.c.waitFor('error', (m) => m.code === 'bad-input');
    for (let i = 0; i < 9; i++) a.c.send({ type: 'emote', emoji: '👏' });
    await a.c.waitFor('error', (m) => m.code === 'rate');
    await h.stop();
  });
});

describe('筐体', () => {
  const cab1 = FLOOR.cabinets.find((c) => c.id === 1)!;
  const front1 = frontTile(cab1);
  const URL1 = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

  it('近づいて使う・設定・空ける（持ち主の決まり）', async () => {
    const h = await harness('cabinet');
    const a = await h.join('あ');
    const b = await h.join('い');
    // 遠いと使えない
    expect((await h.call('POST', '/api/cabinets/1/claim', undefined, a.key)).body.code).toBe('too-far');
    await h.walk(a, front1.x, front1.y);
    const r = await h.call('POST', '/api/cabinets/1/claim', undefined, a.key);
    expect(r.status).toBe(200);
    expect(r.body.cabinet).toMatchObject({ id: 1, owned: true, ownerName: 'あ', ownerPid: a.pid, videoId: null });
    await b.c.waitFor('cabinet', (m) => m.cabinet.id === 1 && m.cabinet.owned);

    // 1 人 1 台
    await h.walk(a, 4, 5);
    expect((await h.call('POST', '/api/cabinets/2/claim', undefined, a.key)).body.code).toBe('already-own');
    // ほかの人の筐体は使えない・設定できない
    await h.walk(b, 3, 5);
    expect((await h.call('POST', '/api/cabinets/1/claim', undefined, b.key)).body.code).toBe('taken');
    expect((await h.call('PATCH', '/api/cabinets/1', { url: URL1 }, b.key)).status).toBe(403);

    // 設定
    expect((await h.call('PATCH', '/api/cabinets/1', { url: 'https://example.com/v' }, a.key)).body.code).toBe('bad-url');
    expect((await h.call('PATCH', '/api/cabinets/1', { url: URL1, eventName: 'あ'.repeat(31) }, a.key)).body.code).toBe('too-long');
    expect((await h.call('PATCH', '/api/cabinets/1', { url: URL1, note: '死ね' }, a.key)).body.code).toBe('ng');
    const set = await h.call<{ cabinet: CabinetView }>(
      'PATCH',
      '/api/cabinets/1',
      { url: 'youtu.be/aqz-KE-bpKQ', eventName: '参加型対戦', gameName: 'テスト', playerName: 'あ', note: 'どなたでも' },
      a.key,
    );
    expect(set.status).toBe(200);
    expect(set.body.cabinet).toMatchObject({ videoId: 'aqz-KE-bpKQ', url: URL1, live: false, eventName: '参加型対戦' });
    await b.c.waitFor('cabinet', (m) => m.cabinet.id === 1 && m.cabinet.videoId === 'aqz-KE-bpKQ');

    // 視聴：筐体の前に座る（ほかの人にも見える）。配信のない筐体は断る
    b.c.send({ type: 'watch', cabinet: 1 });
    const sit = await a.c.waitFor('move', (m) => m.pid === b.pid && m.watching === 1);
    expect(sit.path).toEqual([front1]);
    b.c.send({ type: 'watch', cabinet: 5 });
    await b.c.waitFor('error', (m) => m.code === 'no-stream');
    b.c.send({ type: 'watch', cabinet: null });
    await a.c.waitFor('move', (m) => m.pid === b.pid && m.watching === null);

    // 空ける（ほかの人はできない）
    expect((await h.call('POST', '/api/cabinets/1/release', undefined, b.key)).status).toBe(403);
    const rel = await h.call('POST', '/api/cabinets/1/release', undefined, a.key);
    expect(rel.body.cabinet).toMatchObject({ owned: false, videoId: null, eventName: '' });
    // 空けたらほかの人が使える
    expect((await h.call('POST', '/api/cabinets/1/claim', undefined, b.key)).status).toBe(200);
    await h.stop();
  });

  it('最後の更新から 6 時間で空きに戻る', async () => {
    const h = await harness('cabinet-ttl');
    const a = await h.join('あ');
    await h.walk(a, front1.x, front1.y);
    await h.call('POST', '/api/cabinets/1/claim', undefined, a.key);
    await h.call('PATCH', '/api/cabinets/1', { url: URL1 }, a.key);
    clock.t += 5 * 60 * 60 * 1000;
    let list = (await h.call('GET', '/api/cabinets')).body.cabinets as CabinetView[];
    expect(list[0].owned).toBe(true);
    clock.t += 60 * 60 * 1000;
    list = (await h.call('GET', '/api/cabinets')).body.cabinets as CabinetView[];
    expect(list[0]).toMatchObject({ owned: false, videoId: null });
    // 持ち主だった人もまた使える
    expect((await h.call('POST', '/api/cabinets/2/claim', undefined, a.key)).status).toBe(200);
    await h.stop();
  });

  it('管理者：合言葉で管理者になり、どの筐体も変更・解除できる', async () => {
    const h = await harness('cabinet-admin');
    const a = await h.join('あ');
    const adm = await h.join('管理');
    await h.walk(a, front1.x, front1.y);
    await h.call('POST', '/api/cabinets/1/claim', undefined, a.key);
    expect((await h.call('PATCH', '/api/cabinets/1', { url: URL1 }, adm.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/login', { password: 'ちがう' }, adm.key)).body.code).toBe('bad-password');
    const ok = await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    expect(ok.body.profile.admin).toBe(true);
    await adm.c.waitFor('you', (m) => m.you.admin);
    const set = await h.call('PATCH', '/api/cabinets/1', { url: URL1, eventName: '管理者が修正' }, adm.key);
    expect(set.body.cabinet).toMatchObject({ ownerName: 'あ', eventName: '管理者が修正' });
    // 持ち主のいない筐体も設定できる
    expect((await h.call('PATCH', '/api/cabinets/9', { url: URL1, eventName: '店の配信' }, adm.key)).status).toBe(200);
    const rel = await h.call('POST', '/api/cabinets/1/release', undefined, adm.key);
    expect(rel.body.cabinet.owned).toBe(false);
    // 再読み込み（/me）でも管理者のまま。ログアウトで外れる
    expect((await h.call('GET', '/api/me', undefined, adm.key)).body.profile.admin).toBe(true);
    await h.call('POST', '/api/admin/logout', undefined, adm.key);
    expect((await h.call('PATCH', '/api/cabinets/9', { url: '' }, adm.key)).status).toBe(403);
    await h.stop();
  });

  it('管理者の合言葉の回数制限・合言葉なしのサーバ', async () => {
    const h = await harness('admin-rate');
    const a = await h.join('あ');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await h.call('POST', '/api/admin/login', { password: `x${i}` }, a.key)).status);
    expect(codes.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(codes[5]).toBe(429);
    // 正しい合言葉でも、制限中は通らない
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, a.key)).status).toBe(429);
    await h.stop();

    const h2 = await harness('admin-none', { adminPassHash: null });
    const b = await h2.join('い');
    expect((await h2.call('POST', '/api/admin/login', { password: ADMIN_PW }, b.key)).body.code).toBe('admin-disabled');
    expect((await h2.call('GET', '/api/meta')).body.adminEnabled).toBe(false);
    await h2.stop();
  });
});

describe('管理者の操作', () => {
  it('お知らせ・チャットの削除', async () => {
    const h = await harness('admin-ops');
    const a = await h.join('あ');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    expect((await h.call('POST', '/api/admin/notices', { text: 'お知らせ' }, a.key)).status).toBe(403);
    const n = await h.call('POST', '/api/admin/notices', { text: '21 時から大会です' }, adm.key);
    expect(n.status).toBe(201);
    await a.c.waitFor('notices', (m) => m.notices[0]?.text === '21 時から大会です');
    const noticeChat = await a.c.waitFor('chat', (m) => m.message.kind === 'notice' && m.message.text === '21 時から大会です');
    const said = await h.call('POST', '/api/chat', { text: '消される発言' }, a.key);
    expect((await h.call('DELETE', `/api/admin/chat/${said.body.message.id}`, undefined, a.key)).status).toBe(403);
    expect((await h.call('DELETE', `/api/admin/chat/${said.body.message.id}`, undefined, adm.key)).status).toBe(200);
    await a.c.waitFor('chat-delete', (m) => m.id === said.body.message.id);
    expect((await h.call('DELETE', `/api/admin/chat/${said.body.message.id}`, undefined, adm.key)).status).toBe(404);
    expect((await h.call('DELETE', `/api/admin/notices/${n.body.notice.id}`, undefined, adm.key)).status).toBe(200);
    // 逆向き：チャット欄のお知らせの行を × で消すと、元のお知らせ（壁の大画面に流れる分）も消える
    const n2 = await h.call('POST', '/api/admin/notices', { text: 'チャットから消すお知らせ' }, adm.key);
    const n2Chat = await a.c.waitFor('chat', (m) => m.message.kind === 'notice' && m.message.text === 'チャットから消すお知らせ');
    expect((await h.call('DELETE', `/api/admin/chat/${n2Chat.message.id}`, undefined, adm.key)).status).toBe(200);
    await a.c.waitFor('notices', (m) => !m.notices.some((x: { text: string }) => x.text === 'チャットから消すお知らせ'));
    expect((await h.call('DELETE', `/api/admin/notices/${n2.body.notice.id}`, undefined, adm.key)).status).toBe(404);
    // お知らせを消すと、チャット欄に流れた同じお知らせも消える（全員の画面・入り直した人の履歴から）
    await a.c.waitFor('notices', (m) => !m.notices.some((x: { text: string }) => x.text === '21 時から大会です'));
    await a.c.waitFor('chat-delete', (m) => m.id === noticeChat.message.id);
    const meta = await h.call('GET', '/api/chat', undefined, a.key);
    if (meta.status === 200 && Array.isArray(meta.body?.messages))
      expect(meta.body.messages.some((x: { kind: string; text: string }) => x.kind === 'notice' && x.text === '21 時から大会です')).toBe(false);
    await h.stop();
  });

  it('退室させる・入室を止める（時間がたてば戻れる）', async () => {
    const h = await harness('kick');
    const a = await h.join('あ');
    const b = await h.join('い');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    expect((await h.call('POST', '/api/admin/kick', { pid: b.pid }, a.key)).status).toBe(403);
    expect((await h.call('POST', '/api/admin/kick', { pid: adm.pid }, adm.key)).body.code).toBe('self');
    expect((await h.call('POST', '/api/admin/kick', { pid: b.pid, minutes: -1 }, adm.key)).status).toBe(400);

    // 退室だけ（すぐ戻れる）
    await h.call('POST', '/api/admin/kick', { pid: b.pid }, adm.key);
    await b.c.waitFor('kicked');
    await a.c.waitFor('leave', (m) => m.pid === b.pid);
    const back = await h.connect(b.key);
    expect(back.welcome).not.toBeNull();

    // 退室＋30 分止める
    const r = await h.call('POST', '/api/admin/kick', { pid: b.pid, minutes: 30 }, adm.key);
    expect(r.body.until).toBe(clock.t + 30 * 60 * 1000);
    await back.waitFor('kicked', (m) => !!m.until);
    expect((await h.call('POST', '/api/enter', { name: 'い', look: LOOK }, b.key)).body.code).toBe('banned');
    expect((await h.call('GET', '/api/me', undefined, b.key)).body.bannedUntil).toBe(r.body.until);
    const denied = await h.connect(b.key);
    expect(denied.msgs[0]).toMatchObject({ type: 'error', code: 'banned' });
    clock.t += 31 * 60 * 1000;
    expect((await h.call('POST', '/api/enter', { name: 'い', look: LOOK }, b.key)).status).toBe(200);
    expect((await h.connect(b.key)).welcome).not.toBeNull();
    await h.stop();
  });
});

describe('BASE_PATH と公開の作り', () => {
  it('ページ・API・WebSocket が /arcade の下で動く', async () => {
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>t</title></head><body></body></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'console.log(1)');
    const h = await harness('base', { basePath: '/arcade' }, { clientDist: dist });

    const page = await fetch(`${h.origin}/arcade/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<base href="/arcade/" />');
    expect(html).toContain('<meta name="va-base" content="/arcade" />');
    const redirect = await fetch(`${h.origin}/arcade`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/arcade/');
    expect((await fetch(`${h.origin}/arcade/assets/a.js`)).status).toBe(200);
    expect((await fetch(`${h.origin}/arcade/api/meta`)).status).toBe(200);
    expect((await fetch(`${h.origin}/api/meta`)).status).toBe(404);
    expect((await fetch(`${h.origin}/arcadex/`)).status).toBe(404);

    expect(await statusOfUpgrade(h.origin, '/arcade/ws')).toBe(101);
    expect(await statusOfUpgrade(h.origin, '/arcade/ws/arcade/ws')).toBe(404);
    expect(await statusOfUpgrade(h.origin, '/ws')).toBe(404);

    const a = await h.join('あ');
    expect(a.c.welcome!.you.name).toBe('あ');
    await h.stop();
  });

  it('大きすぎる JSON・壊れた JSON・知らない API', async () => {
    const h = await harness('limits');
    const key = newKey();
    const big = await fetch(`${h.origin}/api/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VA-Key': key },
      body: JSON.stringify({ name: 'a', look: LOOK, pad: 'x'.repeat(20000) }),
    });
    expect(big.status).toBe(413);
    const broken = await fetch(`${h.origin}/api/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VA-Key': key },
      body: '{',
    });
    expect(broken.status).toBe(400);
    expect((await h.call('GET', '/api/nothing')).status).toBe(404);
    // WebSocket の大きすぎる 1 通は切られる
    const a = await h.join('あ');
    const closed = new Promise<number>((r) => a.c.ws.once('close', (code) => r(code)));
    a.c.ws.send('x'.repeat(10000));
    expect(await closed).toBe(1009);
    await h.stop();
  });
});

/** パスをそのまま送る GET（fetch は ../ を先に解決してしまうので、抜け道の確認はこちらで） */
const rawGet = (origin: string, p: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: Buffer }> =>
  new Promise((resolve) => {
    const u = new URL(origin);
    const req = http.request({ host: u.hostname, port: u.port, path: p, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
    });
    req.on('error', () => resolve({ status: -1, type: '', body: Buffer.alloc(0) }));
    req.end();
  });

describe('店内の BGM の曲（data/bgm/）', () => {
  it('何も置いていなければ合成の曲だけ', async () => {
    const empty = fs.mkdtempSync(path.join(tmp, 'bgm-empty-'));
    const h = await harness('bgm-empty', { bgmDir: empty });
    expect((await h.call('GET', '/api/meta')).body.bgm).toEqual({ files: [], synth: true });
    expect((await rawGet(h.origin, '/bgm/a.mp3')).status).toBe(404);
    await h.stop();
    // フォルダが無くても動く
    const h2 = await harness('bgm-none', { bgmDir: path.join(tmp, 'no-such-dir') });
    expect((await h2.call('GET', '/api/meta')).body.bgm).toEqual({ files: [], synth: true });
    await h2.stop();
  });

  it('一覧（曲名・作者は bgm.json）と配信（BASE_PATH 付き・拡張子の限定・パスの抜け道の拒否）', async () => {
    const root = fs.mkdtempSync(path.join(tmp, 'bgm-'));
    const dir = path.join(root, 'bgm');
    fs.mkdirSync(dir);
    const mp3 = Buffer.from('ID3-fake-mp3-data-0123456789');
    fs.writeFileSync(path.join(dir, 'a.mp3'), mp3);
    fs.writeFileSync(path.join(dir, '店内 2.ogg'), Buffer.from('OggS-fake'));
    fs.writeFileSync(path.join(dir, 'c.M4A'), Buffer.from('m4a-fake'));
    fs.writeFileSync(path.join(dir, 'x.wav'), Buffer.from('RIFF'));
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
    fs.writeFileSync(path.join(dir, '.hidden.mp3'), 'hidden');
    fs.mkdirSync(path.join(dir, 'sub.mp3'));
    fs.writeFileSync(path.join(root, 'outside.mp3'), 'outside');
    fs.writeFileSync(path.join(dir, 'song.intro.ogg'), Buffer.from('OggS-intro'));
    fs.writeFileSync(path.join(dir, 'song.loop.ogg'), Buffer.from('OggS-loop'));
    fs.writeFileSync(
      path.join(dir, 'bgm.json'),
      '\uFEFF' +
        JSON.stringify({
          synth: false,
          tracks: [
            { title: 'ループの曲', author: '魔王魂', credit: '音楽：魔王魂（ループ・音量の調整のため編集）', intro: 'song.intro.ogg', introSec: 1.5, body: 'song.loop.ogg', bodySec: 30.25, gain: 0.35, source: 'song.mp3' },
            { title: '  わたしの曲\n ', author: 'じぶん', body: 'a.mp3', bodySec: -1, gain: 9, rotate: false },
            { title: 'x', body: 'x.wav' },
            { title: '外', body: '../outside.mp3' },
            { title: 'イントロが無い', intro: 'none.ogg', body: 'c.M4A' },
          ],
        }),
    );

    const h = await harness('bgm', { basePath: '/arcade', bgmDir: dir });
    const meta = await h.call('GET', '/api/meta');
    expect(meta.body.version).toBe('0.7.0');
    expect(meta.body.bgm).toEqual({
      synth: false,
      files: [
        {
          id: 'song.loop.ogg',
          title: 'ループの曲',
          author: '魔王魂',
          credit: '音楽：魔王魂（ループ・音量の調整のため編集）',
          intro: 'song.intro.ogg',
          body: 'song.loop.ogg',
          introSec: 1.5,
          bodySec: 30.25,
          gain: 0.35,
          rotate: true,
        },
        { id: 'a.mp3', title: 'わたしの曲', author: 'じぶん', credit: null, intro: null, body: 'a.mp3', introSec: null, bodySec: null, gain: 1.5, rotate: false },
        // bgm.json に書いていないファイルは本体だけの曲として後ろに（イントロのファイルが無い c.M4A もここ）
        { id: 'c.M4A', title: 'c', author: null, credit: null, intro: null, body: 'c.M4A', introSec: null, bodySec: null, gain: 1, rotate: true },
        { id: '店内 2.ogg', title: '店内 2', author: null, credit: null, intro: null, body: '店内 2.ogg', introSec: null, bodySec: null, gain: 1, rotate: true },
      ],
    });
    expect((await rawGet(h.origin, '/arcade/bgm/song.intro.ogg')).body.toString()).toBe('OggS-intro');
    expect((await rawGet(h.origin, '/arcade/bgm/song.loop.ogg')).type).toBe('audio/ogg');

    const a = await rawGet(h.origin, '/arcade/bgm/a.mp3');
    expect(a.status).toBe(200);
    expect(a.type).toBe('audio/mpeg');
    expect(a.body.equals(mp3)).toBe(true);
    const ogg = await rawGet(h.origin, `/arcade/bgm/${encodeURIComponent('店内 2.ogg')}`);
    expect(ogg.status).toBe(200);
    expect(ogg.type).toBe('audio/ogg');
    expect((await rawGet(h.origin, '/arcade/bgm/c.M4A')).type).toBe('audio/mp4');
    // 途中から（シーク）
    const part = await rawGet(h.origin, '/arcade/bgm/a.mp3', { Range: 'bytes=3-7' });
    expect(part.status).toBe(206);
    expect(part.body.toString()).toBe('-fake');

    // BASE_PATH の外では出さない
    expect((await rawGet(h.origin, '/bgm/a.mp3')).status).toBe(404);
    // 許さない拡張子・. で始まる・フォルダ・一覧の json
    for (const p of ['x.wav', 'secret.txt', '.hidden.mp3', 'sub.mp3', 'bgm.json', 'A.MP3', 'song.mp3', 'none.ogg'])
      expect((await rawGet(h.origin, `/arcade/bgm/${encodeURIComponent(p)}`)).status, p).toBe(404);
    // パスの抜け道
    for (const p of [
      '/arcade/bgm/../bgm/outside.mp3',
      '/arcade/bgm/..%2Foutside.mp3',
      '/arcade/bgm/%2e%2e%2foutside.mp3',
      '/arcade/bgm/..%5Coutside.mp3',
      '/arcade/bgm/%2e%2e/outside.mp3',
      '/arcade/bgm/sub.mp3/..%2F..%2Foutside.mp3',
      '/arcade/bgm/a.mp3%00.txt',
    ]) {
      const r = await rawGet(h.origin, p);
      expect(r.status, p).not.toBe(200);
      expect(r.body.toString()).not.toContain('outside');
    }
    await h.stop();
  });
});
