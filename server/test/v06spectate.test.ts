// v0.6.0：ほかの人のプレイを見る（観戦。DESIGN §16.10）。サーバは中継だけ（保存しない）。上限・見る人がいなければ受けない・部屋・許可。

import { replay2048, SPECTATE_DEFAULTS } from '@va/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { clock, harness, sleep } from './harness';

type H = Awaited<ReturnType<typeof harness>>;

const MIN = 60 * 1000;
/** 小さな JPEG の data URL（中身はそれらしいバイト。大きさだけ見る） */
const jpeg = (bytes = 2000) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 3).toString('base64')}`;

/** 遊んでいる人（窓を開いた）と見る人 */
const pair = async (h: H, game = 'columns') => {
  const a = await h.join('あそぶ');
  const b = await h.join('みる');
  a.c.send({ type: 'play', game });
  await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.playing === game);
  return { a, b };
};

/** 少し待って、その種類のメッセージの数 */
const countAfter = async (c: { msgs: { type: string }[] }, type: string, ms = 150) => {
  await sleep(ms);
  return c.msgs.filter((m) => m.type === type).length;
};

describe('観戦（DESIGN §16.10）', () => {
  it('Columns like game・Hextris：見る人がいる間だけ画像を中継・1 秒に 5 枚まで・人数の表示・やめる', async () => {
    const h = await harness('sp-frame');
    const { a, b } = await pair(h, 'hextris');
    // 見る人がいないときの画像は受け取らない（中継しない）
    a.c.send({ type: 'spec-frame', image: jpeg(), info: { score: 1 } });
    await sleep(100);
    expect(h.srv.arcade.specStats.framesDropped).toBe(1);
    expect(b.c.msgs.some((m) => m.type === 'spec-frame')).toBe(false);

    b.c.send({ type: 'spectate', pid: a.pid });
    const start = await b.c.waitFor('spec-start');
    expect(start).toMatchObject({ pid: a.pid, name: 'あそぶ', game: 'hextris' });
    expect(await a.c.waitFor('spectators', (m) => m.viewers === 1)).toMatchObject({ allow: true });
    // 頭上の人数（部屋の全員へ）
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.viewers === 1);
    expect(h.srv.arcade.streamCount()).toBe(1);

    // 同じ時刻に 8 枚 → 5 枚だけ（SPECTATE_FPS）
    for (let i = 0; i < 8; i++) a.c.send({ type: 'spec-frame', image: jpeg(), info: { score: 10 + i, state: 'play' } });
    expect(await countAfter(b.c, 'spec-frame')).toBe(SPECTATE_DEFAULTS.fps);
    const f = b.c.msgs.find((m) => m.type === 'spec-frame')!;
    expect(f).toMatchObject({ pid: a.pid, info: { score: 10, state: 'play' } });
    // 1 秒たてばまた送れる
    clock.t += 1001;
    a.c.send({ type: 'spec-frame', image: jpeg() });
    expect(await countAfter(b.c, 'spec-frame')).toBe(SPECTATE_DEFAULTS.fps + 1);
    // おかしな画像（png・32 KB を超える）は中継しない
    clock.t += 1001;
    a.c.send({ type: 'spec-frame', image: 'data:image/png;base64,AAAA' });
    a.c.send({ type: 'spec-frame', image: jpeg(33 * 1024) });
    expect(await countAfter(b.c, 'spec-frame')).toBe(SPECTATE_DEFAULTS.fps + 1);
    // 32 KB ちょうどは 4 KB を超えるメッセージだが届く
    a.c.send({ type: 'spec-frame', image: jpeg(32 * 1024) });
    expect(await countAfter(b.c, 'spec-frame')).toBe(SPECTATE_DEFAULTS.fps + 2);
    // ゲームオーバーの状態
    a.c.send({ type: 'spec-state', info: { score: 999, state: 'over' } });
    expect((await b.c.waitFor('spec-info')).info).toEqual({ score: 999, state: 'over' });

    // 見る人がやめると、遊ぶ人に 0 人と知らせ、中継も止まる
    b.c.send({ type: 'spectate', pid: null });
    await a.c.waitFor('spectators', (m) => m.viewers === 0);
    expect(h.srv.arcade.streamCount()).toBe(0);
    const before = h.srv.arcade.specStats.framesDropped;
    a.c.send({ type: 'spec-frame', image: jpeg() });
    await sleep(100);
    expect(h.srv.arcade.specStats.framesDropped).toBe(before + 1);
    await h.stop();
  });

  it('遊ぶ人が窓を閉じる・歩く・切れると、見る人に「〇〇 さんのゲームが終わりました」（最後の点数）', async () => {
    const h = await harness('sp-end');
    const { a, b } = await pair(h);
    b.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 1);
    a.c.send({ type: 'spec-frame', image: jpeg(), info: { score: 1234 } });
    await b.c.waitFor('spec-frame');
    a.c.send({ type: 'play', game: null });
    const end = await b.c.waitFor('spec-end');
    expect(end).toMatchObject({ pid: a.pid, name: 'あそぶ', score: 1234 });
    expect(end.reason).toMatch(/あそぶ さんのゲームが終わりました/);
    expect(h.srv.arcade.streamCount()).toBe(0);

    // 歩いても終わる
    a.c.send({ type: 'play', game: 'columns' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.playing === 'columns');
    b.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 1 && a.c.msgs.filter((x) => x.type === 'spectators' && x.viewers === 1).length >= 2);
    a.c.send({ type: 'goto', x: 10, y: 12 });
    await b.c.waitFor('spec-end', (m) => b.c.msgs.filter((x) => x.type === 'spec-end').length >= 2 && m.score === null);

    // 切れても終わる
    a.c.send({ type: 'play', game: 'columns' });
    await sleep(50);
    b.c.send({ type: 'spectate', pid: a.pid });
    await sleep(80);
    expect(h.srv.arcade.streamCount()).toBe(1);
    await a.c.close();
    await b.c.waitFor('spec-end', () => b.c.msgs.filter((x) => x.type === 'spec-end').length >= 3);
    expect(h.srv.arcade.streamCount()).toBe(0);
    await h.stop();
  });

  it('上限：1 人を見られるのは 8 人まで・同時に見られている人の合計・遊んでいない人・自分・許可を切った人は見られない', async () => {
    const h = await harness('sp-limits', { spectate: { enabled: true, maxViewers: 2, fps: 5, maxStreams: 1, frameMaxBytes: 32 * 1024 } });
    const a = await h.join('あ');
    const b = await h.join('い');
    const c = await h.join('う');
    const d = await h.join('え');
    const err = async (who: typeof b, pid: string) => {
      const n = who.c.msgs.length;
      who.c.send({ type: 'spectate', pid });
      return (await who.c.waitFor('error', (m) => who.c.msgs.indexOf(m) >= n)).code;
    };
    expect(await err(b, a.pid)).toBe('not-playing');
    a.c.send({ type: 'play', game: 'hextris' });
    await sleep(50);
    expect(await err(a, a.pid)).toBe('self');
    expect(await err(b, 'nobody')).toBe('not-found');
    b.c.send({ type: 'spectate', pid: a.pid });
    c.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 2);
    expect(await err(d, a.pid)).toBe('full');
    // 同時に見られている人の合計（ここでは 1）：ほかの人は見られない
    b.c.send({ type: 'play', game: 'columns' });
    await sleep(50);
    expect(await err(d, b.pid)).toBe('busy');
    // 許可を切ると、今の見る人は終わり、新しく見られない
    a.c.send({ type: 'spectate-allow', allow: false });
    const end = await c.c.waitFor('spec-end');
    expect(end.reason).toMatch(/許可を切りました/);
    await d.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.noSpectate === true);
    expect(await err(d, a.pid)).toBe('denied');
    // 許可していない人の画像は受け取らない
    const before = h.srv.arcade.specStats.framesDropped;
    a.c.send({ type: 'spec-frame', image: jpeg() });
    await sleep(80);
    expect(h.srv.arcade.specStats.framesDropped).toBe(before + 1);
    a.c.send({ type: 'spectate-allow', allow: true });
    await sleep(50);
    d.c.send({ type: 'spectate', pid: a.pid });
    await d.c.waitFor('spec-start');
    await h.stop();
  });

  it('SPECTATE=off で観戦をまるごと止める', async () => {
    const h = await harness('sp-off', { spectate: { enabled: false, maxViewers: 8, fps: 5, maxStreams: 6, frameMaxBytes: 32 * 1024 } });
    const { a, b } = await pair(h);
    b.c.send({ type: 'spectate', pid: a.pid });
    expect((await b.c.waitFor('error')).code).toBe('spectate-off');
    await h.stop();
  });

  it('部屋が違えば見られない・部屋を移ると見るのが終わる', async () => {
    const h = await harness('sp-room');
    const { a, b } = await pair(h);
    // 予約部屋を開いて、遊ぶ人（予約した人）が移る
    const t0 = Math.ceil((clock.t + 1) / (30 * MIN)) * 30 * MIN;
    const r = await h.call(
      'POST',
      '/api/reservations',
      { startAt: t0, minutes: 60, title: '観戦の部屋', host: 'あそぶ', description: '', passphrase: 'ひみつの合言葉' },
      a.key,
    );
    expect(r.status).toBe(201);
    clock.t = t0 + 5 * MIN;
    h.srv.arcade.syncSlot();
    b.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 1);
    expect((await h.call('POST', '/api/rooms/reserved/enter', {}, a.key)).body.room).toBe('reserved');
    expect((await b.c.waitFor('spec-end')).reason).toMatch(/ゲームが終わりました/);
    // 予約部屋で遊んでいる人は、オープン部屋からは見られない
    a.c.send({ type: 'play', game: 'columns' });
    await sleep(50);
    const n = b.c.msgs.length;
    b.c.send({ type: 'spectate', pid: a.pid });
    expect((await b.c.waitFor('error', (m) => b.c.msgs.indexOf(m) >= n)).code).toBe('not-found');
    await h.stop();
  });

  it('2048：手の中継（途中から見る人にはまとめて）・ずれたら送り直してもらう・新しいゲーム', async () => {
    const h = await harness('sp-2048');
    const a = await h.join('にせん');
    const b = await h.join('みる');
    const c = await h.join('あとから');
    await h.walk(a, 14, 5);
    a.c.send({ type: 'play', game: '2048' });
    const st = await h.call('POST', '/api/games/2048/start', {}, a.key);
    const session = st.body.session as string;
    // 盤が動く手を作る
    let moves = '';
    for (const d of '0123012301230123') if (replay2048(st.body.seed, moves + d).ok) moves += d;
    expect(moves.length).toBeGreaterThan(4);
    await sleep(30);
    // 見始めると、遊ぶ人に「手をまとめて送って」
    b.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 1 && m.sync === true);
    a.c.send({ type: 'spec-sync', session, moves: moves.slice(0, 3), score: 4 });
    const reset = await b.c.waitFor('spec-2048');
    expect(reset).toMatchObject({ pid: a.pid, reset: true, seed: st.body.seed, from: 0, moves: moves.slice(0, 3) });
    a.c.send({ type: 'spec-moves', session, from: 3, moves: moves.slice(3), score: 8 });
    expect(await b.c.waitFor('spec-2048', (m) => !m.reset)).toMatchObject({ from: 3, moves: moves.slice(3), score: 8 });
    // 途中から見る人には、サーバが持っているそれまでの手をまとめて（遊ぶ人に頼まない）
    c.c.send({ type: 'spectate', pid: a.pid });
    expect(await c.c.waitFor('spec-2048')).toMatchObject({ reset: true, seed: st.body.seed, moves });
    // 番号がずれた続きは捨てて、送り直しを頼む
    const n = a.c.msgs.length;
    a.c.send({ type: 'spec-moves', session, from: 1, moves: '0' });
    await a.c.waitFor('spectators', (m) => m.sync === true && a.c.msgs.indexOf(m) >= n);
    // おかしな手・別のセッションのまとめは中継しない
    const nb = b.c.msgs.length;
    a.c.send({ type: 'spec-moves', session, from: moves.length, moves: 'X' });
    a.c.send({ type: 'spec-sync', session: 'other', moves: '0' });
    await sleep(100);
    expect(b.c.msgs.slice(nb).some((m) => m.type === 'spec-2048')).toBe(false);
    // 長すぎて送れないとき
    a.c.send({ type: 'spec-sync', session, moves: null });
    expect((await b.c.waitFor('spec-unavailable')).reason).toMatch(/途中からは見られません/);
    // 新しいゲーム：見る人に新しいゲーム、遊ぶ人に送り直しを頼む
    const n2 = a.c.msgs.length;
    await h.call('POST', '/api/games/2048/start', {}, a.key);
    expect((await b.c.waitFor('spec-info')).info).toMatchObject({ score: 0, state: 'play' });
    await a.c.waitFor('spectators', (m) => m.sync === true && a.c.msgs.indexOf(m) >= n2);
    await h.stop();
  });

  it('WebSocket：4 KB を超えるのは観戦の画像・手のまとめだけ（ほかは切る）・見る人がいないのに大きな画像を送り続けると切る', async () => {
    const h = await harness('sp-ws');
    const { a } = await pair(h);
    // 4 KB を超えるチャット・移動などは切る
    const big = await h.join('おおきい');
    const closed = new Promise<number>((r) => big.c.ws.once('close', (code) => r(code)));
    big.c.ws.send(JSON.stringify({ type: 'emote', emoji: 'x'.repeat(5000) }));
    expect(await closed).toBe(1009);
    // 見る人がいないのに 48 KB 近い画像を送り続けると切る（20 回までは捨てるだけ）
    const closedA = new Promise<number>((r) => a.c.ws.once('close', (code) => r(code)));
    for (let i = 0; i < 25; i++) {
      if (a.c.ws.readyState !== WebSocket.OPEN) break;
      a.c.ws.send(JSON.stringify({ type: 'spec-frame', image: jpeg(30 * 1024) }));
      if (i % 10 === 9) await sleep(20);
    }
    expect(await closedA).toBe(1008);
    await h.stop();
  });

  it('WebSocket：入る前の大きなメッセージ・48 KB を超えるメッセージは切る', async () => {
    const h = await harness('sp-ws2');
    const ws = new WebSocket(`${h.origin.replace('http', 'ws')}/ws`);
    await new Promise((r) => ws.once('open', r));
    const code = new Promise<number>((r) => ws.once('close', (c) => r(c)));
    ws.send(JSON.stringify({ type: 'spec-frame', image: jpeg(10 * 1024) }));
    expect(await code).toBe(1009);
    const { a, b } = await pair(h);
    b.c.send({ type: 'spectate', pid: a.pid });
    await a.c.waitFor('spectators', (m) => m.viewers === 1);
    const closed = new Promise<number>((r) => a.c.ws.once('close', (c) => r(c)));
    a.c.ws.send(JSON.stringify({ type: 'spec-frame', image: jpeg(40 * 1024) }));
    expect(await closed).toBe(1009);
    await h.stop();
  });
});
