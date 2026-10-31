import {
  formatScore,
  GAME_COIN_MAX,
  GAME_COIN_MIN,
  GAME_MAX_MOVES,
  COLUMNS_MAX_PIECES,
  HEXTRIS_MAX_CLEARS,
  gameInfo,
  isFrameGame,
  SPECTATE_2048_MOVES_MAX,
  SPECTATE_2048_SYNC_MAX,
  SPECTATE_DEFAULTS,
  type GameFinishResponse,
  type GameStartResponse,
} from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, BASE, errorText, myKey } from '../api';
import type { ArcadeClient } from '../game/client';
import { captureGameFrame, score2048 } from '../game/spectateCapture';
import { RankingDialog } from './RankingDialog';

/**
 * いま遊んでいるゲーム（サーバのセッション・種と、記録）。
 * 2048：盤が動いた手の並び（0〜3 と K）。Columns like game：置いたピース [x, rot, bonus, t] とゲームオーバーの最後のピース。
 * Hextris：消した記録 [k, m]（消した数・コンボの倍率）とブラウザの言う点数
 */
interface Session {
  id: string;
  gen: number;
  /** 練習（ランキングに載らない設定。記録を送らない） */
  practice: boolean;
  /** 2048：0〜3（向き）と K（Keep going） */
  moves: string;
  /** 2048：向きの手の数 */
  count: number;
  /** Columns like game：置いたピース */
  pieces: number[][];
  over: [number, number] | null;
  /** Hextris：消した記録と点数 */
  clears: number[][];
  score: number;
}

const NO_SESSION_TEXT = 'サーバが再起動したため、このゲームは記録できませんでした';

/** iframe とのやりとりのメッセージの頭 */
const PREFIX: Record<string, string> = { '2048': 'va2048:', columns: 'va-columns:', hextris: 'va-hextris:' };

/** 記録の結果の帯の文 */
const resultText = (r: GameFinishResponse): string => {
  if (r.practice) return '練習の設定なので記録しませんでした';
  if (!r.recorded) return '点数が 0 のため記録しませんでした';
  const ranks = [r.rank.all !== null ? `総合 ${r.rank.all} 位` : '', r.rank.month !== null ? `今月 ${r.rank.month} 位` : ''].filter(Boolean).join('・');
  return r.newBest
    ? `記録しました：${formatScore(r.score)} 点（自己ベスト更新！${ranks}）`
    : `記録しました：${formatScore(r.score)} 点（自己ベストは ${formatScore(r.best)} 点・${ranks}）`;
};

/** v0.7.0：もらえたスロットのコインの文（DESIGN §17.9）。無ければ null */
const coinText = (r: GameFinishResponse): string | null => {
  const c = r.coins;
  if (!c) return null;
  if (c.gained > 0) return `🪙 +${c.gained} コイン（スロット用）${c.capped ? '・1 時間の上限で減りました' : c.reason === 'full' ? '・手元のコインが上限です' : ''}`;
  switch (c.reason) {
    case 'low':
      return `🪙 コインなし：もう少しで ${GAME_COIN_MIN} 枚（${formatScore(c.min ?? 0)} 点から）`;
    case 'practice':
      return '🪙 練習はコインなし';
    case 'hour':
      return '🪙 コインなし：今は 1 時間の上限です（しばらくするとまたもらえます）';
    case 'full':
      return '🪙 コインなし：手元のコインが上限です';
    default:
      return null;
  }
};
/** 記録の結果とコインを 1 行に（閉じたときの toast） */
const resultLine = (r: GameFinishResponse): string => [resultText(r), coinText(r)].filter(Boolean).join('　');

const finishError = (e: unknown): string => (e instanceof ApiError && e.code === 'no-session' ? NO_SESSION_TEXT : errorText(e));

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Columns like game の設定の説明（練習の帯） */
const columnsOptionText = (o: { mode: number; colors: number; height: number }) =>
  `${['Standard', 'Flash', 'Time Attack'][o.mode] ?? '?'}・Colors ${o.colors}・Height ${o.height}`;

/**
 * ゲーム筐体の窓（v0.6.0。DESIGN §16.3・§16.8・§16.9）。元のゲームを同じオリジンの iframe で動かし、postMessage でやりとりする。
 * - 2048：開く → start（種）→ iframe に va2048:start → 盤が動いた手を覚える → ゲームオーバー・New Game・閉じる・退店・ページを離れたときに finish
 * - Columns like game：iframe の Play → va-columns:play {options} → start（種・練習か）→ va-columns:start → 置いたピースを覚える →
 *   ゲームオーバー・Reset・閉じる・退店・ページを離れたときに finish（練習の設定は送らない）
 * - Hextris：iframe の Play・やり直し → va-hextris:play → start → va-hextris:start → 消した記録を覚える → ゲームオーバー・やり直し・閉じる…で finish
 * 点数はサーバが種と記録からなぞり直して決める（Hextris は点の入り方の決まりと速さだけを見る。ブラウザの申告）。
 * v0.6.0：観戦（DESIGN §16.10）。見る人がいる間だけ、2048 は手を、Columns like game・Hextris は画面を縮めた画像を WebSocket で送る
 */
export const GameDialog = ({
  client,
  game,
  onClose,
}: {
  client: ArcadeClient;
  game: string;
  onClose: () => void;
}) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sess = useRef<Session | null>(null);
  const gen = useRef(0);
  /** iframe の読み込みが終わった（それまでの start は覚えておく） */
  const ready = useRef(false);
  const pendingStart = useRef<Record<string, unknown> | null>(null);
  /** New Game の処理中（スマホは click と touchend の両方で 2 回来る） */
  const restarting = useRef(false);
  const [result, setResult] = useState<{ text: string; error: boolean; coins?: string | null } | null>(null);
  const [practice, setPractice] = useState<string | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  /** 観戦：見ている人数・許可しているか */
  const [spec, setSpec] = useState({ viewers: 0, allow: client.spectators.allow });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const info = gameInfo(game);
  const columns = game === 'columns';
  const hextris = game === 'hextris';
  /** 開いてもすぐには始めない（iframe の Play を待つ）ゲーム */
  const deferStart = game !== '2048';
  /** iframe とのやりとりのメッセージの頭 */
  const P = PREFIX[game] ?? 'va2048:';

  const post = (msg: unknown) => frameRef.current?.contentWindow?.postMessage(msg, location.origin);
  const focusFrame = () => {
    try {
      frameRef.current?.focus();
      frameRef.current?.contentWindow?.focus();
    } catch {
      /* フォーカスできなくても、クリックすれば入る */
    }
  };

  /** サーバに新しいゲームを頼み、種を iframe に渡す（options = Columns like game の設定） */
  const start = async (options?: unknown) => {
    try {
      const r = await api<GameStartResponse>('POST', `/api/games/${game}/start`, columns ? { options } : {});
      gen.current += 1;
      sess.current = { id: r.session, gen: gen.current, practice: !!r.practice, moves: '', count: 0, pieces: [], over: null, clears: [], score: 0 };
      setPractice(r.practice && r.options ? columnsOptionText(r.options) : null);
      const msg = columns
        ? { type: 'va-columns:start', seed: r.seed, gen: gen.current, options: r.options }
        : { type: `${P}start`, seed: r.seed, gen: gen.current, best: r.best };
      if (ready.current) {
        post(msg);
        focusFrame();
      } else pendingStart.current = msg;
    } catch (e) {
      sess.current = null;
      setResult({ text: errorText(e), error: true });
      if (deferStart) post({ type: `${P}failed` });
    }
  };

  /** 送る中身（何もしていない・練習なら送らない）。取り出したらセッションは手放す */
  const takeFinish = (): Record<string, unknown> | null => {
    const s = sess.current;
    sess.current = null;
    if (!s || s.practice) return null;
    if (columns) return s.pieces.length > 0 || s.over ? { session: s.id, moves: s.pieces, ...(s.over ? { over: s.over } : {}) } : null;
    if (hextris) return s.clears.length > 0 ? { session: s.id, score: s.score, clears: s.clears } : null;
    return s.count > 0 ? { session: s.id, moves: s.moves } : null;
  };

  const finish = async () => {
    const wasPractice = !!sess.current?.practice;
    const body = takeFinish();
    if (!body) {
      if (wasPractice) setResult({ text: '練習の設定なので記録しませんでした', error: false, coins: '🪙 練習はコインなし' });
      return;
    }
    try {
      const r = await api<GameFinishResponse>('POST', `/api/games/${game}/finish`, body);
      setResult({ text: resultText(r), error: false, coins: coinText(r) });
    } catch (e) {
      setResult({ text: finishError(e), error: true });
    }
  };

  /** 窓を閉じる・ページを離れるとき（keepalive。結果は店内の下の帯に出す） */
  const finishOnLeave = () => {
    const body = takeFinish();
    if (!body) return;
    const json = JSON.stringify(body);
    try {
      void fetch(`${BASE}/api/games/${game}/finish`, {
        method: 'POST',
        headers: { 'X-VA-Key': myKey(), 'Content-Type': 'application/json' },
        body: json,
        // keepalive は 64 KB まで（とても長いゲームはふつうに送る）
        keepalive: json.length < 60_000,
      })
        .then(async (res) => {
          const j = await res.json().catch(() => null);
          if (res.ok) client.showToast(`🎮 ${resultLine(j as GameFinishResponse)}`);
          else client.showToast(j?.code === 'no-session' ? NO_SESSION_TEXT : (j?.error ?? `記録できませんでした（${res.status}）`));
        })
        .catch(() => {
          /* ページを離れた */
        });
    } catch {
      /* 送れなかった */
    }
  };

  /** 2048 の New Game・Try again：今のゲームを記録してから、新しい種で始め直す */
  const restart = async () => {
    if (restarting.current) return;
    restarting.current = true;
    try {
      await finish();
      await start();
    } finally {
      restarting.current = false;
    }
  };

  /** Columns like game・Hextris の Play：前のゲームが残っていれば記録してから、その設定で始める */
  const play = async (options: unknown) => {
    if (restarting.current) return;
    restarting.current = true;
    try {
      if (sess.current) await finish();
      setResult(null);
      await start(options);
    } finally {
      restarting.current = false;
    }
  };

  /** 観戦：見る人がいれば今の状態（ゲームオーバーなど）を知らせる */
  const specState = (score: number, state: 'play' | 'paused' | 'over' | 'idle') => {
    if (client.spectators.viewers > 0 && client.spectators.allow) client.send({ type: 'spec-state', info: { score, state } });
  };

  const startRef = useRef(start);
  startRef.current = start;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const playRef = useRef(play);
  playRef.current = play;
  const finishOnLeaveRef = useRef(finishOnLeave);
  finishOnLeaveRef.current = finishOnLeave;
  const specStateRef = useRef(specState);
  specStateRef.current = specState;

  // iframe からの知らせ（送り主がこの iframe で、同じオリジンのものだけ）
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow || e.origin !== location.origin) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith(P)) return;
      const s = sess.current;
      const mine = !!s && d.gen === s.gen;
      switch (d.type.slice(P.length)) {
        case 'ready':
          if (!ready.current) {
            ready.current = true;
            if (pendingStart.current) {
              post(pendingStart.current);
              pendingStart.current = null;
              focusFrame();
            }
          }
          break;
        // ---- 2048
        case 'move':
          if (mine && (d.dir === 0 || d.dir === 1 || d.dir === 2 || d.dir === 3) && s.count < GAME_MAX_MOVES) {
            if (s.count === 0) setResult(null);
            s.moves += String(d.dir);
            s.count++;
          }
          break;
        case 'keep':
          if (mine) s.moves += 'K';
          break;
        case 'restart':
          void restartRef.current();
          break;
        // ---- Columns like game・Hextris
        case 'play':
          void playRef.current(d.options);
          break;
        case 'place':
          if (mine && isInt(d.x) && isInt(d.rot) && isInt(d.bonus) && isInt(d.t) && s.pieces.length < COLUMNS_MAX_PIECES) {
            if (!s.pieces.length) setResult(null);
            s.pieces.push([d.x, d.rot, d.bonus, d.t]);
          }
          break;
        case 'reset':
          if (s) void finishRef.current();
          break;
        // ---- Hextris：ブロックを消した
        case 'clear':
          if (mine && isInt(d.k) && isInt(d.m) && s.clears.length < HEXTRIS_MAX_CLEARS) {
            if (!s.clears.length) setResult(null);
            s.clears.push([d.k, d.m]);
            s.score = isInt(d.score) ? d.score : s.score + d.k * d.k * d.m;
          }
          break;
        // ---- 共通
        case 'over':
          if (mine) {
            if (columns && isInt(d.x) && isInt(d.bonus)) s.over = [d.x, d.bonus];
            specStateRef.current(isInt(d.score) ? d.score : 0, 'over');
            void finishRef.current();
          }
          break;
        case 'close':
          onCloseRef.current();
          break;
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [P]);

  // 開いたら（2048 はすぐ始める。Columns like game・Hextris は iframe の Play を待つ）。頭上に 🎮。閉じる・ページを離れるときに記録する
  useEffect(() => {
    client.send({ type: 'play', game });
    if (!deferStart) void startRef.current();
    const hide = () => finishOnLeaveRef.current();
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      finishOnLeaveRef.current();
      client.send({ type: 'play', game: null });
    };
  }, [client, game]);

  // ---- 観戦（DESIGN §16.10）：見ている人数と、見る人がいる間だけの中継
  /** 2048：見る人に送った手（どのセッションの何手目まで）・まとめて送り直す */
  const sent2048 = useRef<{ session: string | null; n: number; sync: boolean }>({ session: null, n: 0, sync: true });
  /** 送った画像の数・大きさ（確認用） */
  const specSent = useRef({ frames: 0, bytes: 0, since: 0, last: '' });
  useEffect(() => {
    client.spectators = { viewers: 0, allow: client.spectators.allow };
    return client.onSpec((m) => {
      if (m.type !== 'spectators') return;
      setSpec({ viewers: m.viewers, allow: m.allow });
      if (m.sync || m.viewers === 0) sent2048.current = { session: null, n: 0, sync: true };
    });
  }, [client]);
  const streaming = spec.viewers > 0 && spec.allow;
  useEffect(() => {
    if (!streaming) return;
    const every = Math.ceil(1000 / SPECTATE_DEFAULTS.fps);
    const tick = () => {
      if (isFrameGame(game)) {
        const f = captureGameFrame(frameRef.current, game);
        // 同じ画面（一時停止中など）は送り直さない
        if (!f || f.image === specSent.current.last) return;
        specSent.current.last = f.image;
        if (!specSent.current.since) specSent.current.since = performance.now();
        specSent.current.frames++;
        specSent.current.bytes += f.bytes;
        client.send({ type: 'spec-frame', image: f.image, info: f.info });
        return;
      }
      // 2048：始め直した・頼まれたときは今のゲームの手をまとめて、それ以外は増えた分だけ
      const s = sess.current;
      if (!s) return;
      const st = sent2048.current;
      const score = score2048(frameRef.current);
      if (st.sync || st.session !== s.id) {
        const tooLong = s.moves.length > SPECTATE_2048_SYNC_MAX;
        client.send({ type: 'spec-sync', session: s.id, moves: tooLong ? null : s.moves, score });
        sent2048.current = { session: s.id, n: s.moves.length, sync: false };
      } else if (s.moves.length > st.n) {
        const part = s.moves.slice(st.n, st.n + SPECTATE_2048_MOVES_MAX);
        client.send({ type: 'spec-moves', session: s.id, from: st.n, moves: part, score });
        st.n += part.length;
      }
    };
    const id = window.setInterval(tick, every);
    tick();
    return () => window.clearInterval(id);
  }, [client, game, streaming]);

  // 画面の確認用（URL の末尾に #dev のときだけ）：今のゲームの手の数・置いたピース・消した記録・観戦で送った画像
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaGame = {
      game: () => game,
      moves: () => (columns ? (sess.current?.pieces ?? null) : hextris ? (sess.current?.clears ?? null) : (sess.current?.moves ?? null)),
      count: () => (columns ? (sess.current?.pieces.length ?? 0) : hextris ? (sess.current?.clears.length ?? 0) : (sess.current?.count ?? 0)),
      score: () => sess.current?.score ?? 0,
      practice: () => sess.current?.practice ?? null,
      session: () => !!sess.current,
      gen: () => gen.current,
      viewers: () => client.spectators.viewers,
      specSent: () => ({ ...specSent.current, last: undefined, ms: specSent.current.since ? performance.now() - specSent.current.since : 0 }),
    };
    return () => {
      delete w.__vaGame;
    };
  }, [game, columns, hextris, client]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal game-modal game-${game}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🎮 {info?.title ?? game}</h2>
          <div className="row-gap">
            <span className={`spec-count ${spec.viewers ? 'on' : ''}`} title="あなたのプレイを見ている人数">
              👀 {spec.viewers}
              <span className="spec-long"> 人が見ています</span>
            </span>
            <label className="spec-allow" title="切ると、ほかの人はあなたのプレイを見られません（今見ている人も終わります）">
              <input
                type="checkbox"
                checked={spec.allow}
                onChange={(e) => {
                  const allow = e.target.checked;
                  setSpec((x) => ({ ...x, allow }));
                  client.send({ type: 'spectate-allow', allow });
                }}
              />
              <span className="spec-long">観戦を許可</span>
              <span className="spec-short">観戦</span>
            </label>
            <button className="small" onClick={() => setShowRanking(true)} title="ランキングを見る">
              🏆 ランキング
            </button>
            <button className="ghost" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </div>
        {result && (
          <div className={`game-result ${result.error ? 'error' : ''}`}>
            {result.text}
            {result.coins && <span className={`game-coins ${result.coins.startsWith('🪙 +') ? 'got' : ''}`}>{result.coins}</span>}
          </div>
        )}
        {practice && <div className="game-practice">この設定（{practice}）は練習です。記録されません（ランキングは Standard・Colors 5・Height 0）</div>}
        <div className="game-frame">
          <iframe
            ref={frameRef}
            src={info?.page ?? 'games/2048/index.html'}
            title={info?.title ?? game}
            onLoad={() => {
              // 読み込みが終わった時点で送ってよい（iframe 側は準備ができるまで覚えておく）
              ready.current = true;
              if (pendingStart.current) {
                post(pendingStart.current);
                pendingStart.current = null;
              }
              focusFrame();
            }}
          />
        </div>
        <p className="muted small game-note">
          {`点数に応じてスロットのコイン（${GAME_COIN_MIN}〜${GAME_COIN_MAX} 枚）がもらえます${columns ? '（練習の設定はなし）' : ''}。`}
          {columns
            ? 'Play で始まります（Options の Standard・Colors 5・Height 0 がランキングの対象。Level は自由）。途中でやめても、そこまでの点数を記録します。点数はサーバが置いたピースをなぞり直して決めます。'
            : hextris
              ? 'Play（クリック・Enter）で始まります。← → で回す・↓ で速く・P で一時停止。途中でやめても、そこまでの点数を記録します。Hextris の記録はブラウザの申告です（サーバは点の入り方と速さだけを確かめます）。'
              : '途中でやめても、そこまでの点数を記録します（順位はいちばん良い記録で決まります）。点数はサーバが手順をなぞり直して決めます。'}
        </p>
      </div>
      {showRanking && <RankingDialog game={game} admin={!!client.you?.admin} seq={client.rankingSeq} onClose={() => setShowRanking(false)} />}
    </div>
  );
};
