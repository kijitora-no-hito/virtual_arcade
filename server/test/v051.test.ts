// v0.5.1：チャットの発言は 24 時間（CHAT_TTL_HOURS）で消える。
// 時計は harness の clock.t（cfg.now）で進め、掃除は srv.arcade.expireChat()（本番は起動時と 1 分ごとの sweep）で当てる。

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { MemRoomData } from '../src/roomData';
import { ADMIN_PW, clock, harness } from './harness';

const H = 60 * 60 * 1000;

describe('チャットの残す時間（v0.5.1）', () => {
  it('既定は 24 時間・CHAT_TTL_HOURS で変えられる・おかしな値は既定', () => {
    expect(defaultConfig({}).chatTtlMs).toBe(24 * H);
    expect(defaultConfig({ CHAT_TTL_HOURS: '2' }).chatTtlMs).toBe(2 * H);
    expect(defaultConfig({ CHAT_TTL_HOURS: '72' }).chatTtlMs).toBe(72 * H);
    expect(defaultConfig({ CHAT_TTL_HOURS: 'abc' }).chatTtlMs).toBe(24 * H);
    expect(defaultConfig({ CHAT_TTL_HOURS: '0' }).chatTtlMs).toBe(1 * H);
  });

  it('24 時間を過ぎた発言は welcome に入らず、掃除で DB からも開いている画面からも消える（新しい発言は残る）', async () => {
    const h = await harness('ttl-basic');
    const a = await h.join('あ');
    const old = (await h.call('POST', '/api/chat', { text: '昨日の発言' }, a.key)).body.message;
    clock.t += 23 * H;
    const fresh = (await h.call('POST', '/api/chat', { text: '今日の発言' }, a.key)).body.message;
    // まだ 24 時間たっていない
    let b = await h.join('い');
    expect(b.c.welcome!.chat.map((m) => m.id)).toEqual(expect.arrayContaining([old.id, fresh.id]));
    await b.c.close();

    clock.t += 1 * H + 1000;
    // 掃除の前でも、新しく入った人の welcome には過ぎた発言を入れない
    b = await h.join('う');
    const ids = b.c.welcome!.chat.map((m) => m.id);
    expect(ids).not.toContain(old.id);
    expect(ids).toContain(fresh.id);
    expect(h.srv.arcade.recentChat('open').map((m) => m.id)).not.toContain(old.id);
    // 掃除：DB から消え、開いている画面にも chat-delete が届く
    expect(h.srv.store.recentChat().map((m) => m.id)).toContain(old.id);
    h.srv.arcade.expireChat();
    await a.c.waitFor('chat-delete', (m) => m.id === old.id);
    await b.c.waitFor('chat-delete', (m) => m.id === old.id);
    expect(h.srv.store.recentChat().map((m) => m.id)).not.toContain(old.id);
    expect(h.srv.store.recentChat().map((m) => m.id)).toContain(fresh.id);
    // sweep（起動時と 1 分ごと）からも呼ばれる
    clock.t += 23 * H;
    h.srv.arcade.sweep();
    await a.c.waitFor('chat-delete', (m) => m.id === fresh.id);
    expect(h.srv.store.recentChat().map((m) => m.id)).not.toContain(fresh.id);
    await h.stop();
  });

  it('消えた発言のピン止めは外れる・過ぎた発言はピン止めできない', async () => {
    const h = await harness('ttl-pin');
    const a = await h.join('あ');
    const b = await h.join('い');
    const m1 = (await h.call('POST', '/api/chat', { text: '21 時から大会やります！' }, a.key)).body.message;
    clock.t += 2000;
    const m2 = (await h.call('POST', '/api/chat', { text: 'まだ間に合います' }, a.key)).body.message;
    await h.call('POST', `/api/chat/${m1.id}/pin`, {}, a.key);
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned?.id === m1.id);

    clock.t += 24 * H - 1000; // m1 だけ過ぎた
    h.srv.arcade.expireChat();
    await b.c.waitFor('chat-delete', (m) => m.id === m1.id);
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.pinned === null);
    const c = await h.join('う');
    expect(c.c.welcome!.players.find((p) => p.pid === a.pid)?.pinned ?? null).toBeNull();
    // 掃除の前（1 分の間）でも、過ぎた発言はピン止めできない
    clock.t += 2000;
    expect((await h.call('POST', `/api/chat/${m2.id}/pin`, {}, a.key)).status).toBe(404);
    await h.stop();
  });

  it('お知らせの行が消えても、お知らせそのもの（大画面の帯・一覧）は消えない', async () => {
    const h = await harness('ttl-notice');
    const a = await h.join('あ');
    const adm = await h.join('管理');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, adm.key);
    const n = await h.call('POST', '/api/admin/notices', { text: '21 時から大会です' }, adm.key);
    expect(n.status).toBe(201);
    const row = await a.c.waitFor('chat', (m) => m.message.kind === 'notice' && m.message.text === '21 時から大会です');

    clock.t += 25 * H;
    h.srv.arcade.expireChat();
    await a.c.waitFor('chat-delete', (m) => m.id === row.message.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.c.msgs.filter((m) => m.type === 'notices' && m.notices.length === 0)).toHaveLength(0);
    expect(h.srv.arcade.notices('open').map((x) => x.id)).toEqual([n.body.notice.id]);
    const b = await h.join('い');
    expect(b.c.welcome!.notices.map((x) => x.id)).toEqual([n.body.notice.id]);
    expect(b.c.welcome!.chat.some((m) => m.kind === 'notice')).toBe(false);
    await h.stop();
  });

  it('CHAT_TTL_HOURS を短くすると、その時間で消える', async () => {
    const h = await harness('ttl-short', { chatTtlMs: 2 * H });
    const a = await h.join('あ');
    const m = (await h.call('POST', '/api/chat', { text: 'すぐ消える' }, a.key)).body.message;
    clock.t += 2 * H - 1000;
    h.srv.arcade.expireChat();
    expect(h.srv.store.recentChat().map((x) => x.id)).toContain(m.id);
    clock.t += 2000;
    h.srv.arcade.expireChat();
    await a.c.waitFor('chat-delete', (x) => x.id === m.id);
    expect(h.srv.store.recentChat().map((x) => x.id)).not.toContain(m.id);
    await h.stop();
  });

  it('予約部屋（メモリ）の発言も同じ決まり・お知らせは残る', () => {
    const d = new MemRoomData();
    const t = 1_000_000;
    const a = d.addChat({ at: t, kind: 'user', pid: 'p', name: 'あ', text: '古い' });
    const nid = d.addNotice(t, 'お知らせ');
    const nc = d.addChat({ at: t, kind: 'notice', pid: null, name: 'お知らせ', text: 'お知らせ' });
    const b = d.addChat({ at: t + 2 * H, kind: 'user', pid: 'p', name: 'あ', text: '新しい' });
    expect(d.expireChat(t + H)).toEqual([a, nc]);
    expect(d.recentChat().map((m) => m.id)).toEqual([b]);
    expect(d.recentNotices().map((x) => x.id)).toEqual([nid]);
    expect(d.expireChat(t + H)).toEqual([]);
  });
});
