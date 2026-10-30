// v0.7.0：配信を登録できる筐体を 1 人 4 台まで（ユーザー指定「一人が登録できる配信を4つまでに増やします」。DESIGN §18）。

import { describe, expect, it } from 'vitest';
import { FLOOR, frontTile } from '@va/shared';
import { defaultConfig } from '../src/config';
import { clock, harness } from './harness';

const URL1 = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

describe('配信を登録できる筐体は 1 人 4 台まで', () => {
  it('既定 4 台・環境変数 CABINET_MAX_PER_USER（1〜16）', () => {
    expect(defaultConfig({}).cabinetMaxPerUser).toBe(4);
    expect(defaultConfig({ CABINET_MAX_PER_USER: '2' }).cabinetMaxPerUser).toBe(2);
    expect(defaultConfig({ CABINET_MAX_PER_USER: '0' }).cabinetMaxPerUser).toBe(1);
    expect(defaultConfig({ CABINET_MAX_PER_USER: '99' }).cabinetMaxPerUser).toBe(16);
    expect(defaultConfig({ CABINET_MAX_PER_USER: 'x' }).cabinetMaxPerUser).toBe(4);
  });

  it('4 台まで持てて設定・空けられる・5 台目は断る・時間切れは数えない・meta に上限', async () => {
    const h = await harness('cab4');
    const a = await h.join('よんだい');
    expect((await h.call('GET', '/api/meta')).body.cabinetMaxPerUser).toBe(4);
    // 1〜4 番は (3..6, 4)、前のマスは (3..6, 5)。5 番目に 1 番〜4 番の近くの 9〜12 番 (3..6, 9) を試す
    for (const id of [1, 2, 3, 4]) {
      const f = frontTile(FLOOR.cabinets.find((c) => c.id === id)!);
      await h.walk(a, f.x, f.y);
      const r = await h.call('POST', `/api/cabinets/${id}/claim`, undefined, a.key);
      expect(r.status, `claim ${id}`).toBe(200);
      expect((await h.call('PATCH', `/api/cabinets/${id}`, { url: URL1, eventName: `配信${id}` }, a.key)).status).toBe(200);
    }
    const f9 = frontTile(FLOOR.cabinets.find((c) => c.id === 9)!);
    await h.walk(a, f9.x, f9.y);
    const fifth = await h.call('POST', '/api/cabinets/9/claim', undefined, a.key);
    expect(fifth.status).toBe(409);
    expect(fifth.body).toMatchObject({ code: 'too-many', error: '配信を登録できるのは 1 人 4 台までです（先にどれかを空けてください）' });
    // 持っている台の更新はできる・一覧には 4 台とも自分の名前
    const list = (await h.call('GET', '/api/cabinets', undefined, a.key)).body.cabinets as Array<{ id: number; ownerPid: string | null; videoId: string | null }>;
    expect(list.filter((c) => c.ownerPid === a.pid).map((c) => c.id)).toEqual([1, 2, 3, 4]);
    expect(list.filter((c) => c.videoId).length).toBe(4);
    // 1 台空けると 5 台目を使える
    expect((await h.call('POST', '/api/cabinets/2/release', undefined, a.key)).status).toBe(200);
    expect((await h.call('POST', '/api/cabinets/9/claim', undefined, a.key)).status).toBe(200);
    // また 4 台。時間切れ（6 時間）になった台は数えない
    const f10 = frontTile(FLOOR.cabinets.find((c) => c.id === 10)!);
    await h.walk(a, f10.x, f10.y);
    expect((await h.call('POST', '/api/cabinets/10/claim', undefined, a.key)).body.code).toBe('too-many');
    clock.t += 6 * 60 * 60 * 1000;
    expect((await h.call('POST', '/api/cabinets/10/claim', undefined, a.key)).status).toBe(200);
    await h.stop();
  });

  it('部屋ごとに数える（オープン部屋で上限まで持っていても予約部屋でまた持てる）・上限 2 の設定', async () => {
    const h = await harness('cab2', { cabinetMaxPerUser: 2 });
    const a = await h.join('にだい');
    const claimAll = async (ids: number[]) => {
      const out: number[] = [];
      for (const id of ids) {
        const f = frontTile(FLOOR.cabinets.find((c) => c.id === id)!);
        await h.walk(a, f.x, f.y);
        out.push((await h.call('POST', `/api/cabinets/${id}/claim`, undefined, a.key)).status);
      }
      return out;
    };
    expect(await claimAll([1, 2])).toEqual([200, 200]);
    const f3 = frontTile(FLOOR.cabinets.find((c) => c.id === 3)!);
    await h.walk(a, f3.x, f3.y);
    expect((await h.call('POST', '/api/cabinets/3/claim', undefined, a.key)).body).toMatchObject({
      code: 'too-many',
      error: '配信を登録できるのは 1 人 2 台までです（先にどれかを空けてください）',
    });
    // 予約部屋へ移る（今の枠から 2 時間の予約）
    const t0 = Math.ceil((clock.t + 1) / (30 * 60 * 1000)) * 30 * 60 * 1000;
    const r = await h.call(
      'POST',
      '/api/reservations',
      { startAt: t0, minutes: 120, title: '配信の会', host: 'にだい', description: '', passphrase: 'ひみつの合言葉' },
      a.key,
    );
    expect(r.status).toBe(201);
    clock.t = t0;
    h.srv.arcade.syncSlot();
    await h.call('POST', '/api/rooms/reserved/enter', {}, a.key);
    await a.c.waitFor('welcome', (m) => m.room === 'reserved');
    expect(await claimAll([1, 2, 3])).toEqual([200, 200, 409]);
    await h.stop();
  });
});
