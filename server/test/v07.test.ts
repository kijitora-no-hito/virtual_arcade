// v0.7.0：スロットマシンとコイン（マークの両替）の API・WebSocket（DESIGN §17）。

import { describe, expect, it } from 'vitest';
import { BANK_KEEP_MS, normalizeBankCode, REELS, REEL_LEN, MAX_SLIDE, symbolAt } from '@va/shared';
import { clock, harness, newKey, sleep } from './harness';

/** そのリールで sym のあるコマ（その位置で押せばすべらずに止まる） */
const at = (reel: number, sym: string) => REELS[reel].findIndex((s) => s === sym);
/** sym が 4 コマ以内に無い押す位置 */
const away = (reel: number, sym: string) =>
  Array.from({ length: REEL_LEN }, (_, p) => p).find((p) => ![...Array(MAX_SLIDE + 1).keys()].some((s) => symbolAt(reel, p + s) === sym))!;

describe('スロットマシン（DESIGN §17）', () => {
  // クレーンゲーム 1 は (20, 0)・前のマス (20, 1)。スロット 1 は (17, 4)・前のマス (17, 5)
  it('両替・回す・止める・BIG・持ち越し・リプレイ・ごまかしを断る', async () => {
    let next = 0;
    const h = await harness('slot', { rng: () => next, badgeMode: 'stack', badgeStackMax: 9, craneCooldownMs: 1000 });
    const a = await h.join('たいよう');
    const b = await h.join('みどり');

    // マークが無いと両替できない・形が違う
    expect((await h.call('POST', '/api/slot/exchange', { suit: '♠' }, a.key)).body.code).toBe('no-badge');
    expect((await h.call('POST', '/api/slot/exchange', { suit: 'x' }, a.key)).body.code).toBe('bad-input');
    expect((await h.call('POST', '/api/slot/exchange', { suit: '♠' })).status).toBe(401);

    // クレーンゲームで ♠ を 3 つ取る（乱数 0 = 必ず取れる・中身はどれも ♠）
    await h.walk(a, 20, 1);
    for (let i = 0; i < 3; i++) {
      const c = (await h.call('GET', '/api/crane/1', undefined, a.key)).body.machine.capsules[0];
      expect((await h.call('POST', '/api/crane/1/play', { x: c.x, z: c.z }, a.key)).body.gained).toBe(true);
      clock.t += 1000;
    }
    // 両替：♠ 1 つ = コイン 100 枚（v0.7.0 の途中で 10 → 100）。名前の後ろのバッジも減る（全員に）・自分にだけコイン
    const ex = await h.call('POST', '/api/slot/exchange', { suit: '♠' }, a.key);
    expect(ex.status).toBe(200);
    expect(ex.body).toEqual({ coins: 100, badges: '♠♠' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.badges === '♠♠');
    await a.c.waitFor('you', (m) => m.you.coins === 100 && m.you.badges === '♠♠');
    // コインはほかの人には送らない
    expect(JSON.stringify(b.c.msgs.filter((m) => m.type !== 'welcome'))).not.toMatch(/coins/);
    expect(JSON.stringify(b.c.welcome!.players)).not.toMatch(/coins/);
    expect((await h.call('POST', '/api/slot/exchange', { suit: '♠' }, a.key)).body.coins).toBe(200);

    // 遠いと回せない・知らない台
    expect((await h.call('POST', '/api/slot/1/spin', {}, a.key)).body.code).toBe('too-far');
    expect((await h.call('POST', '/api/slot/9/spin', {}, a.key)).status).toBe(404);
    await h.walk(a, 17, 5);

    // はずれ（乱数 0.999）：3 枚掛ける
    next = 0.999;
    const s1 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s1.status).toBe(200);
    expect(s1.body).toMatchObject({ flag: null, internal: null, coins: 197, bet: 3 });
    // 前の回が終わっていない・止めていないのに回す
    expect((await h.call('POST', '/api/slot/2/spin', {}, a.key)).body.code).toBe('spinning');
    // ありえない押す位置・違う回
    for (const presses of [
      [
        [0, 21],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 1],
        [0, 2],
        [1, 0],
      ],
      [[0, 1]],
      'x',
    ])
      expect((await h.call('POST', '/api/slot/1/stop', { spinId: s1.body.spinId, presses }, a.key)).body.code).toBe('bad-input');
    expect((await h.call('POST', '/api/slot/1/stop', { spinId: 'nope', presses: [[0, 0], [1, 0], [2, 0]] }, a.key)).body.code).toBe('no-spin');
    // 窓を開き直すと止めていない回が返る
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body.pending.spinId).toBe(s1.body.spinId);
    const t1 = await h.call('POST', '/api/slot/1/stop', { spinId: s1.body.spinId, presses: [[0, 0], [1, 0], [2, 0]] }, a.key);
    expect(t1.body).toMatchObject({ win: null, payout: 0, coins: 197, bonus: null, replay: false });
    expect(t1.body.reels).toHaveLength(3);
    // 同じ回は 2 度止められない
    expect((await h.call('POST', '/api/slot/1/stop', { spinId: s1.body.spinId, presses: [[0, 0], [1, 0], [2, 0]] }, a.key)).body.code).toBe('no-spin');
    // 早すぎる連打
    expect((await h.call('POST', '/api/slot/1/spin', {}, a.key)).body.code).toBe('too-soon');
    clock.t += 1500;

    // BIG（乱数 0）：外すと持ち越し（ランプ）、次の回で 7 を狙えば揃う
    next = 0;
    const s2 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s2.body).toMatchObject({ flag: 'big', internal: 'big', coins: 194 });
    const miss = await h.call(
      'POST',
      '/api/slot/1/stop',
      { spinId: s2.body.spinId, presses: [[0, away(0, 'seven')], [1, at(1, 'seven')], [2, at(2, 'seven')]] },
      a.key,
    );
    expect(miss.body).toMatchObject({ win: null, bonus: 'big' });
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body.bonus).toBe('big');
    clock.t += 1500;
    // 内部中は小役だけ抽選（乱数 0.999 = はずれ）→ この回に揃えられるのは BIG
    next = 0.999;
    const s3 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s3.body).toMatchObject({ flag: 'big', internal: 'big', coins: 191 });
    const big = await h.call(
      'POST',
      '/api/slot/1/stop',
      { spinId: s3.body.spinId, presses: [[2, at(2, 'seven')], [0, at(0, 'seven')], [1, at(1, 'seven')]] },
      a.key,
    );
    expect(big.body).toMatchObject({ win: 'big', payout: 250, coins: 441, bonus: null });
    await b.c.waitFor('chat', (m) => m.message.kind === 'system' && m.message.text === '🎰 たいよう さんがスロットで BIG BONUS！（+250 枚）');
    await a.c.waitFor('you', (m) => m.you.coins === 441);
    clock.t += 1500;

    // 内部中に小役（乱数 0 = ベル）が当たった回は小役が先（BIG は揃わない）
    next = 0;
    const s4 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s4.body.flag).toBe('big');
    await h.call('POST', '/api/slot/1/stop', { spinId: s4.body.spinId, presses: [[0, away(0, 'seven')], [1, 0], [2, 0]] }, a.key);
    clock.t += 1500;
    const s5 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s5.body).toMatchObject({ flag: 'bell', internal: 'big' });
    const bell = await h.call('POST', '/api/slot/1/stop', { spinId: s5.body.spinId, presses: [[0, at(0, 'seven')], [1, at(1, 'seven')], [2, at(2, 'seven')]] }, a.key);
    expect(bell.body).toMatchObject({ win: 'bell', payout: 8, bonus: 'big' });
    clock.t += 1500;

    // リプレイ（内部中の区間で 0.2 = リプレイ）：次の回は掛けずに回せる
    next = 0.2;
    const s6 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s6.body.flag).toBe('replay');
    const rp = await h.call('POST', '/api/slot/1/stop', { spinId: s6.body.spinId, presses: [[0, 3], [1, 7], [2, 11]] }, a.key);
    expect(rp.body).toMatchObject({ win: 'replay', payout: 0, replay: true });
    clock.t += 1500;
    next = 0.999;
    const s7 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s7.body).toMatchObject({ bet: 0, coins: rp.body.coins });

    // 押さずに 30 秒（＋余裕）たった回は位置 0 で止めたことにして、次を回せる
    clock.t += 41_000;
    const s8 = await h.call('POST', '/api/slot/1/spin', {}, a.key);
    expect(s8.status).toBe(200);
    expect(s8.body.spinId).not.toBe(s7.body.spinId);

    // 頭上の 🎰（playing = 'slot'）・スロットは観戦できない
    a.c.send({ type: 'play', game: 'slot' });
    await b.c.waitFor('player', (m) => m.player.pid === a.pid && m.player.playing === 'slot');
    b.c.send({ type: 'spectate', pid: a.pid });
    await b.c.waitFor('error', (m) => m.code === 'not-playing');

    // 退店でコインは消える
    expect((await h.call('POST', '/api/leave', {}, a.key)).status).toBe(200);
    await sleep(50);
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body).toMatchObject({ coins: 0, bonus: null, pending: null });
    await h.stop();
  });

  it('コインが足りなければ回せない（最初は 0 枚）・店内にいないと回せない', async () => {
    const h = await harness('slot-nocoin', { rng: () => 0.999 });
    const a = await h.join('あおい');
    await h.walk(a, 17, 5);
    expect((await h.call('GET', '/api/slot/1', undefined, a.key)).body).toMatchObject({ coins: 0, bonus: null, replay: false, pending: null });
    expect((await h.call('POST', '/api/slot/1/spin', {}, a.key)).body.code).toBe('no-coins');
    expect((await h.call('POST', '/api/slot/1/spin', {}, newKey())).status).toBeGreaterThanOrEqual(400);
    await h.stop();
  });
});

describe('コインの預かり（v0.7.0 の途中のユーザー指定。DESIGN §17.7）', () => {
  /** クレーンゲームで ♠ を n 個取って両替する（BADGE_MODE=stack） */
  const coinsFor = async (h: Awaited<ReturnType<typeof harness>>, who: { key: string; c: any; pid: string }, n: number) => {
    await h.walk(who, 20, 1);
    for (let i = 0; i < n; i++) {
      const c = (await h.call('GET', '/api/crane/1', undefined, who.key)).body.machine.capsules[0];
      expect((await h.call('POST', '/api/crane/1/play', { x: c.x, z: c.z }, who.key)).body.gained).toBe(true);
      clock.t += 1000;
      expect((await h.call('POST', '/api/slot/exchange', { suit: '♠' }, who.key)).status).toBe(200);
    }
  };

  it('預ける（全部・4 文字のキー）→ 退店 → 入り直して引き出す（大小文字・1 回だけ）・手元が 0 なら預けられない', async () => {
    // 乱数 0：クレーンゲームは必ず取れる
    const h = await harness('bank', { rng: () => 0, badgeMode: 'stack', badgeStackMax: 9, craneCooldownMs: 1000 });
    const a = await h.join('あずける');
    expect((await h.call('POST', '/api/slot/deposit', {}, a.key)).body.code).toBe('no-coins');
    await coinsFor(h, a, 3);
    const d = await h.call('POST', '/api/slot/deposit', {}, a.key);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ deposited: 300, coins: 0 });
    expect(d.body.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(d.body.expiresAt).toBe(clock.t + BANK_KEEP_MS);
    await a.c.waitFor('you', (m) => m.you.coins === 0);
    // 手元が 0 になったのでもう預けられない
    expect((await h.call('POST', '/api/slot/deposit', {}, a.key)).body.code).toBe('no-coins');
    // 退店（手元のコインは消えるが、預けた分は残る）→ 別の鍵（ブラウザ）で入って引き出す
    await h.call('POST', '/api/leave', {}, a.key);
    const b = await h.join('ひきだす');
    // 店内にいないと引き出せない
    expect((await h.call('POST', '/api/slot/withdraw', { code: d.body.code }, a.key)).status).toBe(409);
    // 形が違う（数えない）
    expect((await h.call('POST', '/api/slot/withdraw', { code: 'AB1' }, b.key)).body.code).toBe('bad-input');
    // 小文字・全角・空白でもよい
    const lower = ` ${d.body.code.toLowerCase().slice(0, 2)} ${d.body.code.slice(2)}`;
    const w = await h.call('POST', '/api/slot/withdraw', { code: lower }, b.key);
    expect(w.status).toBe(200);
    expect(w.body).toEqual({ withdrawn: 300, coins: 300 });
    await b.c.waitFor('you', (m) => m.you.coins === 300);
    // 1 回だけ
    expect((await h.call('POST', '/api/slot/withdraw', { code: d.body.code }, b.key)).body.code).toBe('bad-code');
    expect(normalizeBankCode('ａｂｃｄ')).toBe('ABCD');
    await h.stop();
  });

  it('預けている最中のキーと重ならない・180 日で消える', async () => {
    // 乱数：ふだんは 0、seq に入れた分を先に使う
    const seq: number[] = [];
    const h = await harness('bank-unique', { rng: () => seq.shift() ?? 0, badgeMode: 'stack', badgeStackMax: 9, craneCooldownMs: 1000 });
    const a = await h.join('いちばん');
    await coinsFor(h, a, 1);
    // 乱数が 0 のうちは AAAA
    const d1 = await h.call('POST', '/api/slot/deposit', {}, a.key);
    expect(d1.body.code).toBe('AAAA');
    await coinsFor(h, a, 1);
    seq.push(0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5);
    // また AAAA を引くが、預けている最中なので作り直す
    const d2 = await h.call('POST', '/api/slot/deposit', {}, a.key);
    expect(d2.status).toBe(200);
    expect(d2.body.code).not.toBe('AAAA');
    // 180 日を過ぎると引き出せない
    clock.t += BANK_KEEP_MS + 1000;
    const b = await h.join('おそい');
    expect((await h.call('POST', '/api/slot/withdraw', { code: 'AAAA' }, b.key)).body.code).toBe('bad-code');
    await h.stop();
  });

  it('キーの間違いは鍵ごと 10 分 5 回まで（IP ごと 10 回）', async () => {
    const h = await harness('bank-wrong', { rng: () => 0.5 });
    const a = await h.join('あてずっぽう');
    for (let k = 0; k < 5; k++) expect((await h.call('POST', '/api/slot/withdraw', { code: 'ZZZZ' }, a.key)).body.code).toBe('bad-code');
    expect((await h.call('POST', '/api/slot/withdraw', { code: 'ZZZZ' }, a.key)).body.code).toBe('rate');
    // 別の鍵でも同じ IP なら 10 回まで
    const b = await h.join('べつのかぎ');
    for (let k = 0; k < 5; k++) expect((await h.call('POST', '/api/slot/withdraw', { code: 'ZZZZ' }, b.key)).body.code).toBe('bad-code');
    expect((await h.call('POST', '/api/slot/withdraw', { code: 'ZZZZ' }, b.key)).body.code).toBe('rate');
    await h.stop();
  });
});
