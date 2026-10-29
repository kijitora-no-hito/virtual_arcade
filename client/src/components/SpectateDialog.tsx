import { formatScore, gameInfo, isFrameGame, type SpectateInfo } from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import type { ArcadeClient, ClientPlayer } from '../game/client';

/**
 * ほかの人のプレイを見る窓（観戦。v0.6.0。DESIGN §16.10）。同じ部屋の人だけ。
 * - 2048：同じ 2048 を「見るだけ」（?view=1）の iframe で出し、遊ぶ人の種と手をなぞる
 * - Columns like game・Hextris：遊ぶ人の画面を縮めた画像（1 秒に数枚）と、点数などの文字
 * 遊ぶ人が閉じる・部屋を移る・切れる・許可を切ると「〇〇 さんのゲームが終わりました（点数）」
 */
export const SpectateDialog = ({
  client,
  pid,
  onClose,
}: {
  client: ArcadeClient;
  pid: string;
  onClose: () => void;
}) => {
  const target = client.players.get(pid);
  const [name, setName] = useState(target?.name ?? '？');
  const [game, setGame] = useState<string | null>(target?.playing ?? null);
  const [started, setStarted] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [info, setInfo] = useState<SpectateInfo | null>(null);
  /** 終わった（遊ぶ人が閉じた など）・断られた */
  const [ended, setEnded] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const queue = useRef<unknown[]>([]);
  /** 受け取った画像の数・大きさ（確認用） */
  const got = useRef({ frames: 0, bytes: 0, since: 0, moves: 0 });

  const post2048 = (msg: unknown) => {
    if (ready.current) frameRef.current?.contentWindow?.postMessage(msg, location.origin);
    else queue.current.push(msg);
  };

  useEffect(() => {
    const off = client.onSpec((m) => {
      if (m.type === 'spec-error') {
        setEnded(m.error);
        return;
      }
      if (m.type === 'spectators' || m.pid !== pid) return;
      switch (m.type) {
        case 'spec-start':
          setName(m.name);
          setGame(m.game);
          setStarted(true);
          setEnded(null);
          break;
        case 'spec-2048':
          got.current.moves += m.moves.length;
          if (m.reset) setNote(null);
          post2048({ type: 'va2048:view', reset: m.reset, seed: m.seed, moves: m.moves });
          setInfo({ score: m.score ?? 0, state: 'play' });
          break;
        case 'spec-unavailable':
          setNote(m.reason);
          break;
        case 'spec-frame': {
          if (!got.current.since) got.current.since = performance.now();
          got.current.frames++;
          got.current.bytes += Math.floor(((m.image.length - m.image.indexOf(',') - 1) * 3) / 4);
          setImage(m.image);
          if (m.info) setInfo(m.info);
          break;
        }
        case 'spec-info':
          setInfo(m.info);
          break;
        case 'spec-end':
          setEnded(`${m.reason}${m.score !== null ? `（${formatScore(m.score)} 点）` : ''}`);
          break;
      }
    });
    client.send({ type: 'spectate', pid });
    return () => {
      off();
      client.send({ type: 'spectate', pid: null });
    };
  }, [client, pid]);

  // iframe（2048 の見るだけ）の準備
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow || e.origin !== location.origin) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'va2048:ready') {
        ready.current = true;
        for (const m of queue.current) f.contentWindow?.postMessage(m, location.origin);
        queue.current = [];
      } else if (d.type === 'va2048:close') onClose();
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onClose]);

  // 画面の確認用（#dev）
  useEffect(() => {
    if (!location.hash.includes('dev')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__vaSpec = {
      pid: () => pid,
      game: () => game,
      started: () => started,
      ended: () => ended,
      info: () => info,
      image: () => !!image,
      got: () => ({ ...got.current, ms: got.current.since ? performance.now() - got.current.since : 0 }),
      board: () => {
        try {
          return [...(frameRef.current?.contentDocument?.querySelectorAll('.tile') ?? [])].map((t) => t.className).sort();
        } catch {
          return null;
        }
      },
    };
    return () => {
      delete w.__vaSpec;
    };
  });

  const title = game ? (gameInfo(game)?.title ?? game) : '';
  const over = info?.state === 'over';
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal spectate-modal ${game ? `spectate-${game}` : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            👀 {name} さんのプレイ{title ? `（${title}）` : ''}
          </h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <p className="spectate-info">
          {info ? (
            <>
              <strong>{formatScore(info.score)}</strong> 点{info.level !== undefined ? `　Lv ${info.level}` : ''}
              {info.state === 'paused' ? '　（一時停止中）' : ''}
            </>
          ) : started ? (
            'つないでいます…'
          ) : (
            '観戦を始めています…'
          )}
        </p>
        {(ended || over) && (
          <div className={`game-result ${ended && !started ? 'error' : ''}`}>
            {ended ?? `${name} さんのゲームが終わりました（${formatScore(info?.score ?? 0)} 点）`}
          </div>
        )}
        {note && <div className="game-practice">{note}</div>}
        <div className="spectate-view">
          {game === '2048' ? (
            <div className="game-frame spectate-2048-frame">
              <iframe ref={frameRef} src="games/2048/index.html?view=1" title={`${name} さんの 2048`} tabIndex={-1} />
            </div>
          ) : game && isFrameGame(game) ? (
            image ? (
              <img className="spectate-img" src={image} alt={`${name} さんの ${title} の画面`} />
            ) : (
              <div className="spectate-wait muted">画面を待っています…</div>
            )
          ) : null}
        </div>
        <p className="muted small">同じ部屋の人のプレイを見ています（見るだけ。画面は 1 秒に数枚・保存しません）。閉じるといつでもやめられます。</p>
      </div>
    </div>
  );
};

/**
 * ゲーム筐体をクリックしたとき、だれかが遊んでいれば出す窓：［▶ 遊ぶ］と［👀 〇〇 さんのプレイを見る］の一覧（DESIGN §16.10）
 */
export const GameChooser = ({
  client,
  game,
  players,
  onPlay,
  onWatch,
  onClose,
}: {
  client: ArcadeClient;
  game: string;
  players: ClientPlayer[];
  onPlay: () => void;
  onWatch: (pid: string) => void;
  onClose: () => void;
}) => {
  const title = gameInfo(game)?.title ?? game;
  void client;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal chooser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🎮 {title}</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <button className="primary chooser-play" onClick={onPlay}>
          ▶ 遊ぶ
        </button>
        <p className="muted small">いま遊んでいる人</p>
        <ul className="chooser-list">
          {players.map((p) => (
            <li key={p.pid}>
              <button className="chooser-watch" disabled={!!p.noSpectate} onClick={() => onWatch(p.pid)} title={p.noSpectate ? 'この人は観戦を許可していません' : undefined}>
                👀 {p.name} さんのプレイを見る
              </button>
              <span className="muted small">{p.noSpectate ? '観戦を許可していません' : p.viewers ? `${p.viewers} 人が見ています` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
