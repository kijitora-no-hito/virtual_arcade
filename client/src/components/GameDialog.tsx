import {
  formatScore,
  GAME_MAX_MOVES,
  COLUMNS_MAX_PIECES,
  gameInfo,
  type GameFinishResponse,
  type GameStartResponse,
} from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, BASE, errorText, myKey } from '../api';
import type { ArcadeClient } from '../game/client';
import { RankingDialog } from './RankingDialog';

/**
 * いま遊んでいるゲーム（サーバのセッション・種と、記録）。
 * 2048：盤が動いた手の並び（0〜3 と K）。Columns like game：置いたピース [x, rot, bonus, t] とゲームオーバーの最後のピース
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
}

const NO_SESSION_TEXT = 'サーバが再起動したため、このゲームは記録できませんでした';

/** 記録の結果の帯の文 */
const resultText = (r: GameFinishResponse): string => {
  if (r.practice) return '練習の設定なので記録しませんでした';
  if (!r.recorded) return '点数が 0 のため記録しませんでした';
  const ranks = [r.rank.all !== null ? `総合 ${r.rank.all} 位` : '', r.rank.month !== null ? `今月 ${r.rank.month} 位` : ''].filter(Boolean).join('・');
  return r.newBest
    ? `記録しました：${formatScore(r.score)} 点（自己ベスト更新！${ranks}）`
    : `記録しました：${formatScore(r.score)} 点（自己ベストは ${formatScore(r.best)} 点・${ranks}）`;
};

const finishError = (e: unknown): string => (e instanceof ApiError && e.code === 'no-session' ? NO_SESSION_TEXT : errorText(e));

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Columns like game の設定の説明（練習の帯） */
const columnsOptionText = (o: { mode: number; colors: number; height: number }) =>
  `${['Standard', 'Flash', 'Time Attack'][o.mode] ?? '?'}・Colors ${o.colors}・Height ${o.height}`;

/**
 * ゲーム筐体の窓（v0.6.0。DESIGN §16.3・§16.8）。元のゲームを同じオリジンの iframe で動かし、postMessage でやりとりする。
 * - 2048：開く → start（種）→ iframe に va2048:start → 盤が動いた手を覚える → ゲームオーバー・New Game・閉じる・退店・ページを離れたときに finish
 * - Columns like game：iframe の Play → va-columns:play {options} → start（種・練習か）→ va-columns:start → 置いたピースを覚える →
 *   ゲームオーバー・Reset・閉じる・退店・ページを離れたときに finish（練習の設定は送らない）
 * 点数はサーバが種と記録からなぞり直して決める
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
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const [practice, setPractice] = useState<string | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const info = gameInfo(game);
  const columns = game === 'columns';
  /** iframe とのやりとりのメッセージの頭 */
  const P = columns ? 'va-columns:' : 'va2048:';

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
      sess.current = { id: r.session, gen: gen.current, practice: !!r.practice, moves: '', count: 0, pieces: [], over: null };
      setPractice(r.practice && r.options ? columnsOptionText(r.options) : null);
      const msg = columns
        ? { type: 'va-columns:start', seed: r.seed, gen: gen.current, options: r.options }
        : { type: 'va2048:start', seed: r.seed, gen: gen.current, best: r.best };
      if (ready.current) {
        post(msg);
        focusFrame();
      } else pendingStart.current = msg;
    } catch (e) {
      sess.current = null;
      setResult({ text: errorText(e), error: true });
      if (columns) post({ type: 'va-columns:failed' });
    }
  };

  /** 送る中身（何もしていない・練習なら送らない）。取り出したらセッションは手放す */
  const takeFinish = (): Record<string, unknown> | null => {
    const s = sess.current;
    sess.current = null;
    if (!s || s.practice) return null;
    if (columns) return s.pieces.length > 0 || s.over ? { session: s.id, moves: s.pieces, ...(s.over ? { over: s.over } : {}) } : null;
    return s.count > 0 ? { session: s.id, moves: s.moves } : null;
  };

  const finish = async () => {
    const wasPractice = !!sess.current?.practice;
    const body = takeFinish();
    if (!body) {
      if (wasPractice) setResult({ text: '練習の設定なので記録しませんでした', error: false });
      return;
    }
    try {
      const r = await api<GameFinishResponse>('POST', `/api/games/${game}/finish`, body);
      setResult({ text: resultText(r), error: false });
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
          if (res.ok) client.showToast(`🎮 ${resultText(j as GameFinishResponse)}`);
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

  /** Columns like game の Play：前のゲームが残っていれば記録してから、その設定で始める */
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
        // ---- Columns like game
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
        // ---- 共通
        case 'over':
          if (mine) {
            if (columns && isInt(d.x) && isInt(d.bonus)) s.over = [d.x, d.bonus];
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

  // 開いたら（2048 はすぐ始める。Columns like game は iframe の Play を待つ）。頭上に 🎮。閉じる・ページを離れるときに記録する
  useEffect(() => {
    client.send({ type: 'play', game });
    if (game !== 'columns') void startRef.current();
    const hide = () => finishOnLeaveRef.current();
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      finishOnLeaveRef.current();
      client.send({ type: 'play', game: null });
    };
  }, [client, game]);

  // 画面の確認用（URL の末尾に #dev のときだけ）：今のゲームの手の数・置いたピース
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaGame = {
      game: () => game,
      moves: () => (columns ? (sess.current?.pieces ?? null) : (sess.current?.moves ?? null)),
      count: () => (columns ? (sess.current?.pieces.length ?? 0) : (sess.current?.count ?? 0)),
      practice: () => sess.current?.practice ?? null,
      session: () => !!sess.current,
      gen: () => gen.current,
    };
    return () => {
      delete w.__vaGame;
    };
  }, [game, columns]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal game-modal game-${game}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🎮 {info?.title ?? game}</h2>
          <div className="row-gap">
            <button className="small" onClick={() => setShowRanking(true)} title="ランキングを見る">
              🏆 ランキング
            </button>
            <button className="ghost" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </div>
        {result && <div className={`game-result ${result.error ? 'error' : ''}`}>{result.text}</div>}
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
          {columns
            ? 'Play で始まります（Options の Standard・Colors 5・Height 0 がランキングの対象。Level は自由）。途中でやめても、そこまでの点数を記録します。点数はサーバが置いたピースをなぞり直して決めます。'
            : '途中でやめても、そこまでの点数を記録します（順位はいちばん良い記録で決まります）。点数はサーバが手順をなぞり直して決めます。'}
        </p>
      </div>
      {showRanking && <RankingDialog game={game} admin={!!client.you?.admin} seq={client.rankingSeq} onClose={() => setShowRanking(false)} />}
    </div>
  );
};
