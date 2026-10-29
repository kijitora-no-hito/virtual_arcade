import { formatScore, GAME_MAX_MOVES, gameInfo, type GameFinishResponse, type GameStartResponse } from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, BASE, errorText, myKey } from '../api';
import type { ArcadeClient } from '../game/client';
import { RankingDialog } from './RankingDialog';

/** いま遊んでいるゲーム（サーバのセッション・種と、盤が動いた手の並び） */
interface Session {
  id: string;
  gen: number;
  /** 0〜3（向き）と K（Keep going） */
  moves: string;
  /** 向きの手の数 */
  count: number;
}

const NO_SESSION_TEXT = 'サーバが再起動したため、このゲームは記録できませんでした';

/** 記録の結果の帯の文 */
const resultText = (r: GameFinishResponse): string => {
  if (!r.recorded) return '点数が 0 のため記録しませんでした';
  const ranks = [r.rank.all !== null ? `総合 ${r.rank.all} 位` : '', r.rank.month !== null ? `今月 ${r.rank.month} 位` : ''].filter(Boolean).join('・');
  return r.newBest
    ? `記録しました：${formatScore(r.score)} 点（自己ベスト更新！${ranks}）`
    : `記録しました：${formatScore(r.score)} 点（自己ベストは ${formatScore(r.best)} 点・${ranks}）`;
};

const finishError = (e: unknown): string => (e instanceof ApiError && e.code === 'no-session' ? NO_SESSION_TEXT : errorText(e));

/**
 * 2048 の窓（v0.6.0。DESIGN §16.3）。元の 2048 を同じオリジンの iframe で動かし、postMessage でやりとりする。
 * 開く → start（種）→ iframe に va2048:start → 盤が動いた手を覚える → ゲームオーバー・New Game・閉じる・退店・ページを離れたときに finish。
 * 点数はサーバが種と手の並びからなぞり直して決める
 */
export const Game2048Dialog = ({
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
  const pendingStart = useRef<{ type: 'va2048:start'; seed: number; gen: number; best: number } | null>(null);
  /** New Game の処理中（スマホは click と touchend の両方で 2 回来る） */
  const restarting = useRef(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const info = gameInfo(game);

  const post = (msg: unknown) => frameRef.current?.contentWindow?.postMessage(msg, location.origin);
  const focusFrame = () => {
    try {
      frameRef.current?.focus();
      frameRef.current?.contentWindow?.focus();
    } catch {
      /* フォーカスできなくても、クリックすれば入る */
    }
  };

  /** サーバに新しいゲームを頼み、種を iframe に渡す */
  const start = async () => {
    try {
      const r = await api<GameStartResponse>('POST', `/api/games/${game}/start`, {});
      gen.current += 1;
      sess.current = { id: r.session, gen: gen.current, moves: '', count: 0 };
      const msg = { type: 'va2048:start' as const, seed: r.seed, gen: gen.current, best: r.best };
      if (ready.current) {
        post(msg);
        focusFrame();
      } else pendingStart.current = msg;
    } catch (e) {
      sess.current = null;
      setResult({ text: errorText(e), error: true });
    }
  };

  /** 送る中身（1 手も動かしていなければ送らない）。取り出したらセッションは手放す */
  const takeFinish = (): { session: string; moves: string } | null => {
    const s = sess.current;
    sess.current = null;
    return s && s.count > 0 ? { session: s.id, moves: s.moves } : null;
  };

  const finish = async () => {
    const body = takeFinish();
    if (!body) return;
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

  /** New Game・Try again：今のゲームを記録してから、新しい種で始め直す */
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

  const startRef = useRef(start);
  startRef.current = start;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const finishOnLeaveRef = useRef(finishOnLeave);
  finishOnLeaveRef.current = finishOnLeave;

  // iframe からの知らせ（送り主がこの iframe で、同じオリジンのものだけ）
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow || e.origin !== location.origin) return;
      const d = e.data as { type?: string; dir?: unknown; gen?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      const s = sess.current;
      const mine = !!s && d.gen === s.gen;
      switch (d.type) {
        case 'va2048:ready':
          if (!ready.current) {
            ready.current = true;
            if (pendingStart.current) {
              post(pendingStart.current);
              pendingStart.current = null;
              focusFrame();
            }
          }
          break;
        case 'va2048:move':
          if (mine && (d.dir === 0 || d.dir === 1 || d.dir === 2 || d.dir === 3) && s.count < GAME_MAX_MOVES) {
            if (s.count === 0) setResult(null);
            s.moves += String(d.dir);
            s.count++;
          }
          break;
        case 'va2048:keep':
          if (mine) s.moves += 'K';
          break;
        case 'va2048:over':
          if (mine) void finishRef.current();
          break;
        case 'va2048:restart':
          void restartRef.current();
          break;
        case 'va2048:close':
          onCloseRef.current();
          break;
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  // 開いたら始める（頭上に 🎮）。閉じる・ページを離れるときに記録する
  useEffect(() => {
    client.send({ type: 'play', game });
    void startRef.current();
    const hide = () => finishOnLeaveRef.current();
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      finishOnLeaveRef.current();
      client.send({ type: 'play', game: null });
    };
  }, [client, game]);

  // 画面の確認用（URL の末尾に #dev のときだけ）：今のゲームの手の数
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaGame = {
      moves: () => sess.current?.moves ?? null,
      count: () => sess.current?.count ?? 0,
      gen: () => gen.current,
    };
    return () => {
      delete w.__vaGame;
    };
  }, []);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal game-modal" onClick={(e) => e.stopPropagation()}>
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
          途中でやめても、そこまでの点数を記録します（順位はいちばん良い記録で決まります）。点数はサーバが手順をなぞり直して決めます。
        </p>
      </div>
      {showRanking && <RankingDialog game={game} admin={!!client.you?.admin} seq={client.rankingSeq} onClose={() => setShowRanking(false)} />}
    </div>
  );
};
