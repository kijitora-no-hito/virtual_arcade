// v0.6.0：Hextris（DESIGN §16.9）の API・ランキング。記録はブラウザの申告（なぞり直さない）で、点の入り方の決まりと速さだけを見る。

import { HEXTRIS_SCORE_PER_SEC } from '@va/shared';
import { describe, expect, it } from 'vitest';
import { ADMIN_PW, clock, harness } from './harness';

// Hextris の筐体は (15, 4)（2048 (14, 4) の右隣）。前のマスは (15, 5)
const NEAR = { x: 15, y: 5 };
const sum = (clears: number[][]) => clears.reduce((a, [k, m]) => a + k * k * m, 0);
/** コンボを続けて n 回消した記録（3 個ずつ） */
const combo = (n: number, k = 3) => Array.from({ length: n }, (_, i) => [k, i + 1]);

describe('Hextris（DESIGN §16.9）', () => {
  it('始める（筐体の近く）→ 記録（点数・detail・ランキング・立て看板・チャットの案内）', async () => {
    const h = await harness('hx-finish');
    const a = await h.join('ろくかく');
    expect((await h.call('POST', '/api/games/hextris/start', {}, a.key)).body.code).toBe('too-far');
    // 2048 の前 (14,5) は Hextris の筐体 (15,4) にも 2 マス以内
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/hextris/start', {}, a.key);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ best: 0 });
    expect(typeof st.body.seed).toBe('number');
    const clears = combo(8);
    clock.t += 120_000;
    const fin = await h.call('POST', '/api/games/hextris/finish', { session: st.body.session, score: sum(clears), clears }, a.key);
    expect(fin.status).toBe(200);
    expect(fin.body).toMatchObject({ recorded: true, score: sum(clears), moves: 8, newBest: true, rank: { all: 1, month: 1 }, detail: { combo: 8, blocks: 24 } });
    const top = await a.c.waitFor('ranking', (m) => m.game === 'hextris');
    expect(top.top[0]).toMatchObject({ name: 'ろくかく', score: sum(clears), detail: { combo: 8 } });
    await a.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text.includes('Hextris'));
    const rk = await h.call('GET', '/api/games/hextris/ranking', undefined, a.key);
    expect(rk.body.entries).toHaveLength(1);
    expect(rk.body.me).toMatchObject({ rank: 1 });
    // 1 回だけ
    expect((await h.call('POST', '/api/games/hextris/finish', { session: st.body.session, score: 9, clears: [[3, 1]] }, a.key)).body.code).toBe('no-session');
    // welcome にも Hextris の上位
    const again = await h.connect(a.key);
    expect(again.welcome!.rankings!.hextris[0].score).toBe(sum(clears));
    await h.stop();
  });

  it('おかしな記録（合計が違う・コンボが飛ぶ）は bad-moves、速すぎる点数は too-fast、0 点は記録しない', async () => {
    const h = await harness('hx-bad');
    const a = await h.join('ずる');
    await h.walk(a, NEAR.x, NEAR.y);
    const play = async (body: Record<string, unknown>, ms: number) => {
      const st = await h.call('POST', '/api/games/hextris/start', {}, a.key);
      clock.t += ms;
      return h.call('POST', '/api/games/hextris/finish', { session: st.body.session, ...body }, a.key);
    };
    expect((await play({ score: 100, clears: combo(3) }, 60_000)).body.code).toBe('bad-moves');
    expect((await play({ score: 9 + 27, clears: [[3, 1], [3, 3]] }, 60_000)).body.code).toBe('bad-moves');
    expect((await play({ score: 9, clears: [[2, 1]] }, 60_000)).body.code).toBe('bad-moves');
    expect((await play({ score: '9', clears: [[3, 1]] }, 60_000)).body.code).toBe('bad-moves');
    expect((await play({ score: 9 }, 60_000)).body.code).toBe('bad-moves');
    // 速すぎる：10 秒で 20 連続コンボの 5 個消し（5,250 点 > 10 × 上限）
    const fast = combo(20, 5);
    expect(sum(fast)).toBeGreaterThan(10 * HEXTRIS_SCORE_PER_SEC);
    const tf = await play({ score: sum(fast), clears: fast }, 10_000);
    expect(tf.status).toBe(400);
    expect(tf.body.code).toBe('too-fast');
    expect(tf.body.error).toMatch(/速すぎる/);
    // 同じ記録でも、それだけの時間をかけていれば受け付ける
    expect((await play({ score: sum(fast), clears: fast }, 60_000)).body.recorded).toBe(true);
    const zero = await play({ score: 0, clears: [] }, 5_000);
    expect(zero.body).toMatchObject({ recorded: false, score: 0 });
    await h.stop();
  });

  it('管理者は記録を消せる', async () => {
    const h = await harness('hx-admin');
    const a = await h.join('けされる');
    const admin = await h.join('かんり');
    expect((await h.call('POST', '/api/admin/login', { password: ADMIN_PW }, admin.key)).status).toBe(200);
    await h.walk(a, NEAR.x, NEAR.y);
    const st = await h.call('POST', '/api/games/hextris/start', {}, a.key);
    clock.t += 60_000;
    await h.call('POST', '/api/games/hextris/finish', { session: st.body.session, score: 9, clears: [[3, 1]] }, a.key);
    const id = (await h.call('GET', '/api/games/hextris/ranking')).body.entries[0].id;
    expect((await h.call('DELETE', `/api/admin/games/hextris/scores/${id}`, undefined, a.key)).status).toBe(403);
    expect((await h.call('DELETE', `/api/admin/games/hextris/scores/${id}`, undefined, admin.key)).status).toBe(200);
    expect((await h.call('GET', '/api/games/hextris/ranking')).body.entries).toHaveLength(0);
    await h.stop();
  });
});
