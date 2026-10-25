// v0.4.0：コミュニケーションノート（DESIGN §12）と機能追加要望箱（DESIGN §13）の API・WebSocket。

import { describe, expect, it } from 'vitest';
import { NOTE_ANNOUNCE_MS } from '../src/arcade';
import { ADMIN_PW, clock, harness, newKey, sleep } from './harness';

describe('コミュニケーションノート（DESIGN §12）', () => {
  it('書く・誰でも読める・全員に届く・検証・チャットへの案内は控えめ', async () => {
    const h = await harness('notes');
    const a = await h.join('たいよう');
    const b = await h.join('みどり');

    // 店内にいない人は書けない
    const outsider = newKey();
    expect((await h.call('POST', '/api/notes', { name: 'だれか', text: 'こんにちは' }, outsider)).body.code).toBe('not-online');

    const r = await h.call('POST', '/api/notes', { name: 'たいよう', text: 'はじめまして！\nまた来ます' }, a.key);
    expect(r.status).toBe(201);
    expect(r.body.note).toMatchObject({ name: 'たいよう', text: 'はじめまして！\nまた来ます', pid: a.pid });
    expect(r.body.note.authorKey).toBeUndefined();
    const got = await b.c.waitFor('note', (m) => m.note.id === r.body.note.id);
    expect(got.total).toBe(1);
    await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text === '📖 たいよう さんがノートに書きました');

    // 名前は書き換えてよい
    clock.t += 1000;
    const r2 = await h.call('POST', '/api/notes', { name: '  たいよう（2 回目）  ', text: '  ふたつめ  ' }, a.key);
    expect(r2.body.note).toMatchObject({ name: 'たいよう（2 回目）', text: 'ふたつめ' });
    // 30 分たつまで、同じ人の案内は流さない
    await sleep(80);
    expect(b.c.msgs.filter((m) => m.type === 'chat' && m.message.text.includes('ノートに書きました'))).toHaveLength(1);

    // 読むのは鍵なしでも
    const list = await h.call('GET', '/api/notes');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.notes.map((n: { text: string }) => n.text)).toEqual(['はじめまして！\nまた来ます', 'ふたつめ']);
    expect(JSON.stringify(list.body)).not.toMatch(/authorKey|author_key/);

    // 検証：3 行まで・90 文字まで・NG 語・空・名前
    const bad = async (body: unknown) => (await h.call('POST', '/api/notes', body, b.key)).body.code;
    expect(await bad({ name: 'みどり', text: '1\n2\n3\n4' })).toBe('too-long');
    expect(await bad({ name: 'みどり', text: 'あ'.repeat(91) })).toBe('too-long');
    expect(await bad({ name: 'みどり', text: 'もう死ねよ' })).toBe('ng');
    expect(await bad({ name: 'みどり', text: '   \n  ' })).toBe('bad-input');
    expect(await bad({ name: '', text: 'こんにちは' })).toBe('bad-input');
    expect(await bad({ name: 'あ'.repeat(21), text: 'こんにちは' })).toBe('too-long');
    // 空の行は詰めるので 3 行に収まる
    const ok = await h.call('POST', '/api/notes', { name: 'みどり', text: '1\n\n\n2\n3' }, b.key);
    expect(ok.status).toBe(201);
    expect(ok.body.note.text).toBe('1\n2\n3');

    // 30 分たてば、また流す
    clock.t += NOTE_ANNOUNCE_MS;
    await h.call('POST', '/api/notes', { name: 'たいよう', text: 'みっつめ' }, a.key);
    await b.c.waitFor('chat', (m) => m.message.text === '📖 たいよう さんがノートに書きました' && m.message.at === clock.t);
    await h.stop();
  });

  it('回数制限：1 人 10 分に 3 件（形の検証の後に数える。鍵ごと）', async () => {
    const h = await harness('notes-rate');
    const a = await h.join('たいよう');
    for (let i = 0; i < 3; i++) expect((await h.call('POST', '/api/notes', { name: 'たいよう', text: `その${i}` }, a.key)).status).toBe(201);
    // 検証で断られたものは数えない（その前に断る）
    expect((await h.call('POST', '/api/notes', { name: 'たいよう', text: '' }, a.key)).body.code).toBe('bad-input');
    expect((await h.call('POST', '/api/notes', { name: 'たいよう', text: 'よっつめ' }, a.key)).body.code).toBe('rate');
    // ほかの人は書ける（鍵ごと）
    const b = await h.join('みどり');
    expect((await h.call('POST', '/api/notes', { name: 'みどり', text: 'こんばんは' }, b.key)).status).toBe(201);
    await h.stop();
  });

  it('消す：書いた人と管理者だけ（ほかの人は 403）。全員の画面から消える', async () => {
    const h = await harness('notes-del');
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const admin = await h.join('てんちょう');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    const n1 = (await h.call('POST', '/api/notes', { name: 'たいよう', text: 'ひとつめ' }, a.key)).body.note;
    const n2 = (await h.call('POST', '/api/notes', { name: 'たいよう', text: 'ふたつめ' }, a.key)).body.note;

    expect((await h.call('DELETE', `/api/notes/${n1.id}`, undefined, b.key)).status).toBe(403);
    expect((await h.call('DELETE', `/api/notes/${n1.id}`, undefined, a.key)).status).toBe(200);
    const del = await b.c.waitFor('note-delete', (m) => m.id === n1.id);
    expect(del.total).toBe(1);
    expect((await h.call('DELETE', `/api/notes/${n1.id}`, undefined, a.key)).status).toBe(404);
    expect((await h.call('DELETE', `/api/notes/${n2.id}`, undefined, admin.key)).status).toBe(200);
    expect((await h.call('GET', '/api/notes')).body.total).toBe(0);
    await h.stop();
  });

  it('件数の上限を超えたら古いものから消す・古いページを続きから読める', async () => {
    const h = await harness('notes-max', {
      noteMaxTotal: 10,
      rates: { ...(await import('../src/config')).defaultConfig().rates, noteKey: { limit: 100, windowMs: 1000 }, note: { limit: 100, windowMs: 1000 } },
    });
    const a = await h.join('たいよう');
    const b = await h.join('みどり');
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await h.call('POST', '/api/notes', { name: 'たいよう', text: `その${i}` }, a.key)).body.note.id);
    await b.c.waitFor('note-delete', (m) => m.id === ids[1]);
    const all = await h.call('GET', '/api/notes');
    expect(all.body.total).toBe(10);
    expect(all.body.notes[0].text).toBe('その2');
    // 続き：新しいものから 4 件 → それより古い 4 件
    const page1 = await h.call('GET', '/api/notes?limit=4');
    expect(page1.body.notes.map((n: { text: string }) => n.text)).toEqual(['その8', 'その9', 'その10', 'その11']);
    const page2 = await h.call('GET', `/api/notes?limit=4&before=${page1.body.notes[0].id}`);
    expect(page2.body.notes.map((n: { text: string }) => n.text)).toEqual(['その4', 'その5', 'その6', 'その7']);
    await h.stop();
  });
});

describe('機能追加要望箱（DESIGN §13）', () => {
  it('送る・管理者だけが読める（一般の人は 403）・名前を出さない・NG 語では断らない・管理者に知らせる', async () => {
    const h = await harness('requests');
    const a = await h.join('たいよう');
    const admin = await h.join('てんちょう');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    await admin.c.waitFor('requests', (m) => m.unread === 0);

    // 鍵の無い人・入室したことの無い人は送れない
    expect((await h.call('POST', '/api/requests', { kind: 'feature', text: 'x', name: null })).status).toBe(401);
    expect((await h.call('POST', '/api/requests', { kind: 'feature', text: 'x', name: null }, newKey())).body.code).toBe('need-enter');

    const r = await h.call('POST', '/api/requests', { kind: 'feature', text: 'ミニゲームを\n増やしてほしいです', name: 'たいよう' }, a.key);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true }); // 送った人にも中身は返さない
    const n = await admin.c.waitFor('requests', (m) => m.unread === 1 && m.added === true);
    expect(n.added).toBe(true);
    // 管理者でない人には知らせない
    await sleep(60);
    expect(a.c.msgs.some((m) => m.type === 'requests')).toBe(false);

    // 名前を出さない・NG 語でも断らない
    expect((await h.call('POST', '/api/requests', { kind: 'bug', text: '「死ね」と書いた発言が NG にならないことがある', name: null }, a.key)).status).toBe(201);
    // 種類・長さ
    expect((await h.call('POST', '/api/requests', { kind: 'spam', text: 'x' }, a.key)).body.code).toBe('bad-input');
    expect((await h.call('POST', '/api/requests', { kind: 'other', text: 'あ'.repeat(501) }, a.key)).body.code).toBe('too-long');
    expect((await h.call('POST', '/api/requests', { kind: 'other', text: '  ' }, a.key)).body.code).toBe('bad-input');

    // 一般の人は読めない・印も削除もできない
    expect((await h.call('GET', '/api/admin/requests', undefined, a.key)).status).toBe(403);
    expect((await h.call('GET', '/api/admin/requests')).status).toBe(401);
    expect((await h.call('GET', '/api/requests', undefined, a.key)).status).toBe(404);

    const list = await h.call('GET', '/api/admin/requests', undefined, admin.key);
    expect(list.status).toBe(200);
    expect(list.body.unread).toBe(2);
    expect(list.body.requests.map((x: { kind: string; name: string | null; status: string }) => [x.kind, x.name, x.status])).toEqual([
      ['bug', null, 'new'],
      ['feature', 'たいよう', 'new'],
    ]);
    expect(list.body.requests[1].text).toBe('ミニゲームを\n増やしてほしいです');
    const id = list.body.requests[1].id;
    expect((await h.call('PATCH', `/api/admin/requests/${id}`, { status: 'read' }, a.key)).status).toBe(403);
    expect((await h.call('DELETE', `/api/admin/requests/${id}`, undefined, a.key)).status).toBe(403);

    // 既読・対応済み・戻す・削除
    expect((await h.call('PATCH', `/api/admin/requests/${id}`, { status: 'read' }, admin.key)).body.request.status).toBe('read');
    await admin.c.waitFor('requests', (m) => m.unread === 1 && !m.added);
    expect((await h.call('PATCH', `/api/admin/requests/${id}`, { status: 'done' }, admin.key)).body.request.status).toBe('done');
    expect((await h.call('PATCH', `/api/admin/requests/${id}`, { status: 'x' }, admin.key)).body.code).toBe('bad-input');
    expect((await h.call('PATCH', `/api/admin/requests/9999`, { status: 'read' }, admin.key)).status).toBe(404);
    expect((await h.call('DELETE', `/api/admin/requests/${id}`, undefined, admin.key)).status).toBe(200);
    expect((await h.call('GET', '/api/admin/requests', undefined, admin.key)).body.requests).toHaveLength(1);

    // 管理者が入り直すと、つないだときに未読の件数が届く
    await admin.c.close();
    const again = await h.connect(admin.key);
    await again.waitFor('requests', (m) => m.unread === 1);
    await h.stop();
  });

  it('回数制限：1 人 1 時間に 5 件・件数の上限', async () => {
    const h = await harness('requests-rate', { requestMaxTotal: 3 });
    const a = await h.join('たいよう');
    const admin = await h.join('てんちょう');
    await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key);
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/api/requests', { kind: 'other', text: `要望${i}`, name: null }, a.key)).status).toBe(201);
    expect((await h.call('POST', '/api/requests', { kind: 'other', text: '要望5', name: null }, a.key)).body.code).toBe('rate');
    const list = await h.call('GET', '/api/admin/requests', undefined, admin.key);
    expect(list.body.requests.map((x: { text: string }) => x.text)).toEqual(['要望4', '要望3', '要望2']);
    await h.stop();
  });
});
