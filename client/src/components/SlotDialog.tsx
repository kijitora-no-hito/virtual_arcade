import {
  cabinetDistance,
  COINS_PER_BADGE,
  REELS,
  SLOT_BET,
  SLOT_AUTO_STOP_MS,
  SLOT_MIN_INTERVAL_MS,
  SLOT_NEAR,
  SLOT_PAYOUT,
  SLOT_PLAYING,
  SLOT_ROLE_NAMES,
  slotSpot,
  stopReel,
  SUITS,
  symbolAt,
  targetSymbol,
  type SlotExchangeResponse,
  type SlotRole,
  type SlotSpinResponse,
  type SlotStateResponse,
  type SlotStopResponse,
  type SlotSymbol,
} from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { bgm } from '../audio/bgm';
import type { ArcadeClient } from '../game/client';
import {
  anySpinning,
  centerOf,
  drawSlotMachine,
  drawSymbol,
  newSlotSim,
  pressPos,
  pressReel,
  SLOT_H,
  SLOT_W,
  snapReel,
  startSpin,
  stepSlot,
} from '../game/slotGame';
import { suitColor } from './Badges';
import { CoinBank } from './CoinBank';

type Phase = 'loading' | 'idle' | 'wait' | 'requesting' | 'spinning' | 'settling' | 'resolving';

const REEL_NAMES = ['左', '中', '右'];
const REEL_KEYS = ['←', '↓', '→'];

/** 配当表の小さな絵柄 */
const SymIcon = ({ sym }: { sym: SlotSymbol }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(34 * dpr);
    c.height = Math.round(24 * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSymbol(ctx, sym, 17, 12, 22);
  }, [sym]);
  return <canvas ref={ref} className="slot-sym" style={{ width: 34, height: 24 }} aria-hidden="true" />;
};

const PAYTABLE: Array<{ syms: SlotSymbol[]; role: SlotRole; text: string }> = [
  { syms: ['seven', 'seven', 'seven'], role: 'big', text: `${SLOT_PAYOUT.big} 枚` },
  { syms: ['seven', 'seven', 'bar'], role: 'reg', text: `${SLOT_PAYOUT.reg} 枚` },
  { syms: ['suika', 'suika', 'suika'], role: 'suika', text: `${SLOT_PAYOUT.suika} 枚` },
  { syms: ['bell', 'bell', 'bell'], role: 'bell', text: `${SLOT_PAYOUT.bell} 枚` },
  { syms: ['cherry'], role: 'cherry', text: `${SLOT_PAYOUT.cherry} 枚（左の中段）` },
  { syms: ['replay', 'replay', 'replay'], role: 'replay', text: 'もう 1 回（掛けずに）' },
];

/** スロットマシンの窓（v0.7.0。DESIGN §17）。レバーで回し、止めるボタンで目押し。内部抽選・配当はサーバ、止まる位置は手元とサーバの同じ計算 */
export const SlotDialog = ({ client, id, onClose }: { client: ArcadeClient; id: number; onClose: () => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef({
    sim: newSlotSim([0, 1, 2].map((r) => REELS[r].indexOf('seven'))),
    phase: 'loading' as Phase,
    spin: null as SlotSpinResponse | null,
    stops: [null, null, null] as Array<number | null>,
    presses: [] as Array<[number, number]>,
    spinAt: 0,
    /** 次に回せる時刻（performance.now） */
    nextAt: 0,
    queued: false,
    /** 確認用：狙って止めるリール */
    aim: new Set<number>(),
  });
  const [phase, setPhaseState] = useState<Phase>('loading');
  const [coins, setCoins] = useState(client.you?.coins ?? 0);
  const [lamp, setLamp] = useState(false);
  const [replay, setReplay] = useState(false);
  const [result, setResult] = useState<{ role: SlotRole | null; payout: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false]);
  const [exchanging, setExchanging] = useState(false);

  const spot = slotSpot(id);
  const me = client.me();
  const near = !!spot && !!me && cabinetDistance({ x: Math.round(me.rx), y: Math.round(me.ry) }, spot) <= SLOT_NEAR;
  const nearRef = useRef(near);
  nearRef.current = near;
  const badges = client.you?.badges ?? '';

  const setPhase = (p: Phase) => {
    g.current.phase = p;
    setPhaseState(p);
  };
  /** 上のバーの自分のコインもすぐに（サーバからも you が届く） */
  const applyCoins = (n: number) => {
    setCoins(n);
    if (client.you && client.you.coins !== n) {
      client.you = { ...client.you, coins: n };
      client.notify();
    }
  };

  // 窓を開いた：頭上に 🎰。状態を読む（止めていない回があれば続きから）
  useEffect(() => {
    client.send({ type: 'play', game: SLOT_PLAYING });
    let alive = true;
    api<SlotStateResponse>('GET', `/api/slot/${id}`)
      .then((st) => {
        if (!alive) return;
        applyCoins(st.coins);
        setLamp(!!st.bonus);
        g.current.sim.lamp = !!st.bonus;
        setReplay(st.replay);
        g.current.nextAt = performance.now() + Math.max(0, st.nextAt - st.serverNow);
        if (st.pending) {
          const s = g.current;
          s.spin = st.pending;
          s.stops = [null, null, null];
          s.presses = [];
          s.spinAt = performance.now();
          startSpin(s.sim);
          setPhase('spinning');
        } else setPhase('idle');
      })
      .catch((e) => {
        if (alive) {
          setError(errorText(e));
          setPhase('idle');
        }
      });
    return () => {
      alive = false;
      client.send({ type: 'play', game: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const doSpin = () => {
    const s = g.current;
    if (!nearRef.current) {
      setError('スロットの近く（2 マス以内）まで行くと回せます');
      setPhase('idle');
      return;
    }
    setError(null);
    setResult(null);
    setPhase('requesting');
    startSpin(s.sim);
    s.nextAt = performance.now() + SLOT_MIN_INTERVAL_MS;
    api<SlotSpinResponse>('POST', `/api/slot/${id}/spin`)
      .then((r) => {
        s.spin = r;
        s.stops = [null, null, null];
        s.presses = [];
        s.spinAt = performance.now();
        applyCoins(r.coins);
        setReplay(false);
        setPhase('spinning');
      })
      .catch((e) => {
        // 回せなかった：今の所で止める
        for (const r of s.sim.reels) snapReel(r, centerOf(r));
        s.sim.sounds.push('buzz');
        s.queued = false;
        setError(errorText(e));
        setPhase('idle');
      });
  };

  /** レバー（早すぎるときは回せるようになるまで待たせる） */
  const lever = () => {
    const s = g.current;
    if (s.phase !== 'idle' && s.phase !== 'wait') {
      // リールが止まって結果を待っている間に押したら、次に回す
      if (s.phase === 'settling' || s.phase === 'resolving') s.queued = true;
      return;
    }
    if (performance.now() < s.nextAt) {
      setPhase('wait');
      return;
    }
    doSpin();
  };

  /** 止めるボタン */
  const press = (reel: number) => {
    const s = g.current;
    if (s.phase !== 'spinning' || !s.spin) return;
    const p = pressReel(s.sim, reel, s.stops, s.spin.flag);
    if (p === null) return;
    s.stops[reel] = ((s.sim.reels[reel].target % 21) + 21) % 21;
    s.presses.push([reel, p]);
    setSpinning(s.sim.reels.map((r) => r.mode === 'spin'));
    if (s.presses.length === 3) setPhase('settling');
  };

  /** 3 本止まった：サーバに押した順と位置を送って配当を決めてもらう */
  const resolve = () => {
    const s = g.current;
    const spin = s.spin;
    if (!spin) return;
    setPhase('resolving');
    api<SlotStopResponse>('POST', `/api/slot/${id}/stop`, { spinId: spin.spinId, presses: s.presses })
      .then((r) => {
        r.reels.forEach((p, i) => snapReel(s.sim.reels[i], p));
        applyCoins(r.coins);
        setReplay(r.replay);
        const lit = !!r.bonus;
        if (lit && !s.sim.lamp) s.sim.sounds.push('lamp');
        s.sim.lamp = lit;
        setLamp(lit);
        if (r.win) {
          s.sim.win = { role: r.win, at: performance.now() };
          s.sim.sounds.push(r.win === 'big' || r.win === 'reg' ? 'bonus' : r.win === 'replay' ? 'replay' : 'small');
        }
        setResult({ role: r.win, payout: r.payout });
      })
      .catch((e) => {
        setError(errorText(e));
      })
      .finally(() => {
        s.spin = null;
        setPhase('idle');
        if (s.queued) {
          s.queued = false;
          lever();
        }
      });
  };

  const fn = useRef({ lever, press, resolve, doSpin });
  fn.current = { lever, press, resolve, doSpin };

  // 描画と進行のループ
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(SLOT_W * dpr);
    canvas.height = Math.round(SLOT_H * dpr);
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const s = g.current;
      // 確認用の「狙って止める」：押せば当たりの図柄を引き込める瞬間に押す
      if (s.phase === 'spinning' && s.spin && s.aim.size) {
        for (const reel of [...s.aim]) {
          const r = s.sim.reels[reel];
          if (r.mode !== 'spin') {
            s.aim.delete(reel);
            continue;
          }
          const want = targetSymbol(s.spin.flag, reel);
          const press = ((pressPos(r) % 21) + 21) % 21;
          if (!want || symbolAt(reel, stopReel(reel, press, s.stops, s.spin.flag)) === want) {
            s.aim.delete(reel);
            fn.current.press(reel);
          }
        }
      }
      stepSlot(s.sim, dt);
      for (const n of s.sim.sounds.splice(0)) bgm.playSfx(n);
      if (s.phase === 'wait' && t >= s.nextAt) fn.current.doSpin();
      // 押さずに 30 秒：今の位置で自動で止める
      if (s.phase === 'spinning' && t - s.spinAt > SLOT_AUTO_STOP_MS) for (let i = 0; i < 3; i++) fn.current.press(i);
      if (s.phase === 'settling' && !anySpinning(s.sim)) fn.current.resolve();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSlotMachine(ctx, s.sim, t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 回り始めたら止めるボタンを出す
  useEffect(() => {
    if (phase === 'spinning') setSpinning(g.current.sim.reels.map((r) => r.mode === 'spin'));
    else if (phase === 'idle' || phase === 'loading') setSpinning([false, false, false]);
  }, [phase]);

  // キーボード：スペース / Enter / ↑ = レバー、← ↓ →（Z X C）= 止める
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 預かりのキーを打っている間は使わない
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.code;
      let used = true;
      if (k === 'Space' || k === 'Enter' || k === 'ArrowUp' || k === 'NumpadEnter') {
        if (!e.repeat) fn.current.lever();
      } else if (k === 'ArrowLeft' || k === 'KeyZ') fn.current.press(0);
      else if (k === 'ArrowDown' || k === 'KeyX') fn.current.press(1);
      else if (k === 'ArrowRight' || k === 'KeyC') fn.current.press(2);
      else used = false;
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  // 画面の確認用（URL の末尾に #dev のときだけ）
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaSlot = {
      state: () => {
        const s = g.current;
        return {
          phase: s.phase,
          flag: s.spin?.flag ?? null,
          internal: s.spin?.internal ?? null,
          lamp: s.sim.lamp,
          reels: s.sim.reels.map((r) => centerOf(r)),
          modes: s.sim.reels.map((r) => r.mode),
          win: s.sim.win?.role ?? null,
          presses: s.presses.slice(),
        };
      },
      lever: () => fn.current.lever(),
      press: (reel: number) => fn.current.press(reel),
      // 当たっている役の図柄を引き込める瞬間に押す（目押しが完璧な人）
      aim: (reels: number[] = [0, 1, 2]) => reels.forEach((r) => g.current.aim.add(r)),
    };
    return () => {
      delete w.__vaSlot;
    };
  }, []);

  const exchange = async (suit: string) => {
    setExchanging(true);
    try {
      const r = await api<SlotExchangeResponse>('POST', '/api/slot/exchange', { suit });
      applyCoins(r.coins);
      if (client.you) {
        client.you = { ...client.you, badges: r.badges, coins: r.coins };
        client.notify();
      }
      bgm.playSfx('coin');
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExchanging(false);
    }
  };

  // 止めるボタン・レバーはポインタを押した瞬間に（目押しのため。フォーカスも移さない）
  const down = (f: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      f();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    tabIndex: -1,
  });

  const canLever = phase === 'idle' || phase === 'wait';
  const status =
    error ??
    (phase === 'loading'
      ? '読み込み中…'
      : !near && (phase === 'idle' || phase === 'wait')
        ? 'スロットの近く（2 マス以内）まで行くと回せます'
        : phase === 'wait'
          ? 'ウェイト中…'
          : phase === 'requesting'
            ? ''
            : phase === 'spinning'
              ? `止める：${REEL_KEYS.join(' ')}（Z X C）か下のボタン${lamp ? '　LUCKY！ 7 を狙え！' : ''}`
              : phase === 'settling' || phase === 'resolving'
                ? ''
                : result?.role
                  ? `${SLOT_ROLE_NAMES[result.role]}！${result.payout ? ` +${result.payout} 枚` : ''}${result.role === 'replay' ? '　次の 1 回は掛けずに回せます' : ''}`
                  : lamp
                    ? 'LUCKY ランプが光っています！ 7 を狙って揃えよう'
                    : !replay && coins < SLOT_BET
                      ? 'コインが足りません。下の「マークを両替」でコインにできます'
                      : 'レバー（スペース / Enter）で回す');

  const counts = SUITS.map((s) => ({ s, n: [...badges].filter((c) => c === s).length }));
  return (
    <div className="modal-back side" onClick={onClose}>
      <div className="modal slot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🎰 スロット No.{id}</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="slot-screen">
          <canvas ref={canvasRef} style={{ width: SLOT_W, height: SLOT_H }} />
        </div>
        <div className="slot-meters">
          <div className="slot-meter">
            <span>CREDIT</span>
            <b className="slot-coins">{coins.toLocaleString('en-US')}</b>
          </div>
          <div className="slot-meter">
            <span>BET</span>
            <b>{replay ? 'REPLAY' : SLOT_BET}</b>
          </div>
          <div className={`slot-meter ${result?.payout ? 'win' : ''}`}>
            <span>PAYOUT</span>
            <b>{result?.payout ?? 0}</b>
          </div>
        </div>
        <div className={`slot-status ${error ? 'error' : ''} ${lamp ? 'lucky' : ''}`}>{status}</div>
        <div className="slot-controls">
          <button
            className={`slot-lever ${canLever && near ? 'active' : ''}`}
            disabled={!canLever || !near}
            {...down(() => lever())}
            title="レバー（スペース / Enter）。1 回 3 枚（MAX BET）"
          >
            レバー
          </button>
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              className={`slot-stop ${spinning[i] && phase === 'spinning' ? 'active' : ''}`}
              disabled={!(spinning[i] && phase === 'spinning')}
              {...down(() => press(i))}
              title={`${REEL_NAMES[i]}のリールを止める（${REEL_KEYS[i]} / ${'ZXC'[i]}）`}
              aria-label={`${REEL_NAMES[i]}を止める`}
            >
              {REEL_NAMES[i]}
            </button>
          ))}
        </div>
        <div className="slot-lower">
          <section className="slot-paytable" aria-label="配当表">
            <h3>配当表（中段 1 ライン・1 回 3 枚）</h3>
            <ul>
              {PAYTABLE.map((p) => (
                <li key={p.role}>
                  <span className="slot-syms">
                    {p.syms.map((s, i) => (
                      <SymIcon key={i} sym={s} />
                    ))}
                  </span>
                  <span className="slot-pay">
                    <b className={p.role === 'big' || p.role === 'reg' ? 'bonus' : ''}>{SLOT_ROLE_NAMES[p.role]}</b> {p.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="slot-exchange" aria-label="マークを両替">
            <h3>マークを両替</h3>
            <p className="muted small">クレーンゲームで取ったマーク 1 つ = コイン {COINS_PER_BADGE} 枚（マークはなくなります）</p>
            <div className="slot-ex-list">
              {counts.map(({ s, n }) => (
                <button
                  key={s}
                  className="small slot-ex"
                  disabled={!n || exchanging}
                  onClick={() => void exchange(s)}
                  title={n ? `${s} を 1 つコイン ${COINS_PER_BADGE} 枚に` : `${s} を持っていません`}
                >
                  <span style={{ color: n ? suitColor(s) : undefined }}>{s}</span>
                  {n > 1 && <sub>×{n}</sub>} → 🪙{COINS_PER_BADGE}
                </button>
              ))}
            </div>
          </section>
          <CoinBank client={client} coins={coins} busy={phase !== 'idle' && phase !== 'wait'} onCoins={applyCoins} />
        </div>
        <p className="muted small slot-note">
          リールは押した所から最大 4 コマすべって止まります。ベル・リプレイはどこで押しても揃いますが、7・BAR・スイカ・チェリーは狙わないと取りこぼします。
          LUCKY ランプが光ったらボーナス（揃えるまで続きます）。コインは退店するまで（バッジと同じ）。
        </p>
      </div>
    </div>
  );
};
