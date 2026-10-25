import {
  cabinetDistance,
  CRANE_NEAR,
  craneSpot,
  SUITS,
  type CranePlayResponse,
  type CraneStateResponse,
  type MetaResponse,
} from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '../api';
import { bgm } from '../audio/bgm';
import type { SfxName } from '../audio/sfx';
import type { ArcadeClient } from '../game/client';
import { abortDrop, CRANE_H, CRANE_W, drawCrane, newSim, setResult, startDrop, stepSim, type CranePhase } from '../game/craneGame';
import { Badges, suitColor } from './Badges';

const HELP: Partial<Record<CranePhase, string>> = {
  loading: '読み込み中…',
  ready: '［→］を押している間、アームが右へ動きます',
  x: '離すと止まります',
  wz: '［↑］を押している間、アームが奥へ動きます',
  z: '離すと止まります',
  wdrop: '［下ろす］でアームが下ります',
  anim: '',
  done: '',
};

/** クレーンゲームの窓（DESIGN §8）。アームを 2 段階で動かして下ろす。当たり外れはサーバが決める */
export const CraneDialog = ({
  client,
  id,
  meta,
  onClose,
}: {
  client: ArcadeClient;
  id: number;
  meta: MetaResponse | null;
  onClose: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef(newSim());
  const input = useRef({ right: false, up: false });
  const offset = useRef(0);
  const [phase, setPhase] = useState<CranePhase>('loading');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);

  const spot = craneSpot(id);
  const me = client.me();
  const near = !!spot && !!me && cabinetDistance({ x: Math.round(me.rx), y: Math.round(me.ry) }, spot) <= CRANE_NEAR;
  const badges = client.you?.badges ?? '';
  const mode = meta?.crane.badgeMode ?? 'unique';
  const serverNow = now + offset.current;
  const waitSec = Math.max(0, Math.ceil((cooldownUntil - serverNow) / 1000));

  // ケースの中を読む
  const load = async () => {
    try {
      const st = await api<CraneStateResponse>('GET', `/api/crane/${id}`);
      offset.current = st.serverNow - Date.now();
      sim.current.capsules = st.machine.capsules;
      setCooldownUntil(st.cooldownUntil);
      if (sim.current.phase === 'loading') sim.current.phase = 'ready';
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 待ち時間の表示
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  // ［下ろす］：アームを下ろし始め、同時にサーバに結果を聞く
  const drop = () => {
    const s = sim.current;
    if (!startDrop(s)) return;
    setError(null);
    const at = { x: s.arm.x, z: s.arm.z };
    api<CranePlayResponse>('POST', `/api/crane/${id}/play`, { x: at.x, z: at.z })
      .then((r) => {
        offset.current = r.serverNow - Date.now();
        setCooldownUntil(r.cooldownUntil);
        setResult(s, r);
      })
      .catch((e) => {
        abortDrop(s);
        setError(errorText(e));
        if (e instanceof ApiError && e.code === 'cooldown') void load();
      });
  };
  const dropRef = useRef(drop);
  dropRef.current = drop;

  // 描画と進行のループ
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(CRANE_W * dpr);
    canvas.height = Math.round(CRANE_H * dpr);
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let shownPhase: CranePhase | null = null;
    let shownIdle: number | null = null;
    let lastTick = 0;
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const s = sim.current;
      stepSim(s, dt, input.current);
      // 効果音（tick は鳴らしすぎない）
      for (const n of s.sounds.splice(0)) {
        if (n === 'tick') {
          if (t - lastTick < 90) continue;
          lastTick = t;
        }
        bgm.playSfx(n as SfxName);
      }
      if (s.phase === 'anim' && s.finished) {
        s.phase = 'done';
        s.finished = false;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCrane(ctx, s, t);
      if (s.phase !== shownPhase) {
        shownPhase = s.phase;
        setPhase(s.phase);
      }
      const idle = s.phase === 'wz' || s.phase === 'wdrop' ? Math.ceil((10_000 - s.idle) / 1000) : null;
      if (idle !== shownIdle) {
        shownIdle = idle;
        setIdleLeft(idle);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 結果を見せたあと：アームを初めの位置に戻して、次の回へ
  const again = () => {
    const s = sim.current;
    const keep = { capsules: s.capsules, confetti: s.confetti };
    sim.current = { ...newSim(), ...keep, phase: 'ready' };
    setError(null);
  };

  // キーボード（→ / ↑ を押している間・スペースで下ろす）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat && (e.code === 'ArrowRight' || e.code === 'ArrowUp')) return;
      if (e.code === 'ArrowRight') {
        if (canPlayRef.current) input.current.right = true;
      } else if (e.code === 'ArrowUp') input.current.up = true;
      else if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') {
        e.preventDefault();
        const s = sim.current;
        if (s.phase === 'wdrop' || s.phase === 'wz') dropRef.current();
        else if (s.phase === 'done' && canPlayRef.current) again();
      } else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') input.current.right = false;
      if (e.code === 'ArrowUp') input.current.up = false;
    };
    const blur = () => {
      input.current.right = false;
      input.current.up = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const canPlay = near && waitSec === 0 && phase === 'ready';
  const canPlayRef = useRef(canPlay);
  canPlayRef.current = canPlay;

  // 画面の確認用（URL の末尾に #dev のときだけ）
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaCrane = {
      phase: () => sim.current.phase,
      press: (b: 'right' | 'up') => (input.current[b] = true),
      release: (b: 'right' | 'up') => (input.current[b] = false),
      drop: () => dropRef.current(),
      // いちばん手前のカプセルの真上へアームを置いて下ろす
      aimDrop: () => {
        const s = sim.current;
        const c = [...s.capsules].sort((a, b) => a.z - b.z)[0];
        if (!c) return false;
        s.arm.x = c.x;
        s.arm.z = c.z;
        s.phase = 'wdrop';
        dropRef.current();
        return true;
      },
    };
    return () => {
      delete w.__vaCrane;
    };
  }, []);

  // 押している間だけ動くボタン
  const hold = (b: 'right' | 'up', enabled: boolean) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      input.current[b] = true;
    },
    onPointerUp: () => (input.current[b] = false),
    onPointerCancel: () => (input.current[b] = false),
    onLostPointerCapture: () => (input.current[b] = false),
    // スマホの長押しのメニュー（文字の選択・画像の保存など）を出さない
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const status =
    error ??
    (!near
      ? 'クレーンゲームの近く（2 マス以内）まで行くと遊べます'
      : phase === 'ready' && waitSec > 0
        ? `次に遊べるまで あと ${waitSec} 秒`
        : phase === 'done'
          ? waitSec > 0
            ? `次に遊べるまで あと ${waitSec} 秒`
            : 'もう一度遊べます'
          : (HELP[phase] ?? '') + (idleLeft !== null && idleLeft <= 5 ? `（あと ${idleLeft} 秒で自動で進みます）` : ''));

  const cooldownSec = Math.round((meta?.crane.cooldownMs ?? 20000) / 1000);
  return (
    <div className="modal-back side" onClick={onClose}>
      <div className="modal crane-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🕹 クレーンゲーム No.{id}</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="crane-screen">
          <canvas ref={canvasRef} style={{ width: CRANE_W, height: CRANE_H }} />
        </div>
        <div className={`crane-status ${error ? 'error' : ''}`}>{status}</div>
        <div className="crane-controls">
          <button
            className={`crane-btn ${phase === 'ready' || phase === 'x' ? 'active' : ''}`}
            disabled={!(canPlay || phase === 'x')}
            {...hold('right', canPlay)}
            title="押している間、右へ（→ キー）"
          >
            →
          </button>
          <button
            className={`crane-btn ${phase === 'wz' || phase === 'z' ? 'active' : ''}`}
            disabled={!(phase === 'wz' || phase === 'z')}
            {...hold('up', phase === 'wz')}
            title="押している間、奥へ（↑ キー）"
          >
            ↑
          </button>
          <button
            className={`crane-btn drop ${phase === 'wdrop' ? 'active' : ''}`}
            disabled={!(phase === 'wdrop' || phase === 'wz')}
            onClick={drop}
            title="アームを下ろす（スペース）"
          >
            下ろす
          </button>
          {phase === 'done' && (
            <button className="primary" disabled={!near || waitSec > 0} onClick={again}>
              {waitSec > 0 ? `あと ${waitSec} 秒` : 'もう一度'}
            </button>
          )}
        </div>
        <div className="crane-badges">
          <span className="muted small">あなたのバッジ</span>
          <span className="crane-slots">
            {SUITS.map((s) => {
              const n = [...badges].filter((c) => c === s).length;
              return (
                <span key={s} className={`crane-slot ${n ? 'got' : ''}`} style={n ? { color: suitColor(s), borderColor: suitColor(s) } : undefined}>
                  {s}
                  {n > 1 && <sub>×{n}</sub>}
                </span>
              );
            })}
          </span>
          <span className="small">
            {client.you?.name}
            <Badges badges={badges} />
          </span>
        </div>
        <p className="muted small crane-note">
          カプセルの中身は ♠ ♡ ♦ ♧ のバッジ。取ったバッジは退店するまで名前の後ろに付きます
          {mode === 'unique' ? '（4 種類を 1 つずつ。持っているものが出たらそのまま）' : `（同じものは ${meta?.crane.stackMax ?? 3} 個まで）`}。
          1 回ごとに {cooldownSec} 秒の待ち時間があります。
        </p>
      </div>
    </div>
  );
};
