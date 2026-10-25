import { embedUrlFull, FLOOR, YOUTUBE_EMBED_ORIGIN, type CabinetView } from '@va/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { listeningMessage, playerStateFromMessage } from '../audio/videoDuck';
import { PromoBlock } from './CabinetDialog';

/**
 * 視聴画面：大きな埋め込みプレイヤー（音あり・操作可）＋宣伝。チャットは右の欄のまま。
 * 埋め込みの再生の状態（再生が始まった など）を postMessage で受け取り、onPlayerState で知らせる（店内の BGM をフェードアウトするため）。
 * そのために URL に enablejsapi=1&origin=… を付け、埋め込みへ {"event":"listening"} を届くまで送る（YouTube の IFrame API の外部の手順）。
 */
export const WatchView = ({
  cabinet,
  onBack,
  onPlayerState,
  chat,
}: {
  cabinet: CabinetView;
  onBack: () => void;
  onPlayerState?: (state: number) => void;
  /** スマホ：動画の下に出すチャット（PC は右の欄のまま） */
  chat?: ReactNode;
}) => {
  const spot = FLOOR.cabinets.find((x) => x.id === cabinet.id);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cb = useRef(onPlayerState);
  cb.current = onPlayerState;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let heard = false;
    const onMessage = (e: MessageEvent) => {
      // 送り元を確かめる：この埋め込みの窓から、YouTube のオリジンで来たものだけ
      if (e.source !== frame.contentWindow) return;
      const st = playerStateFromMessage(e.origin, e.data);
      if (st === null) return;
      heard = true;
      cb.current?.(st);
    };
    window.addEventListener('message', onMessage);
    const hello = () => {
      try {
        frame.contentWindow?.postMessage(listeningMessage('va-watch'), YOUTUBE_EMBED_ORIGIN);
      } catch {
        /* まだ読み込み中 */
      }
    };
    frame.addEventListener('load', hello);
    // 返事が来るまで 1 秒ごとに送る（読み込みの途中で送った分は届かないことがある）。30 秒であきらめる（予備のタイマーに任せる）
    let n = 0;
    const t = window.setInterval(() => {
      if (heard || ++n > 30) window.clearInterval(t);
      else hello();
    }, 1000);
    return () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', hello);
      window.clearInterval(t);
    };
  }, [cabinet.videoId]);

  return (
    <div className={`watch ${chat ? 'm-watch' : ''}`}>
      <div className="watch-head">
        <div className="watch-title">
          <span className="cab-no" style={{ background: spot?.color }}>
            No.{cabinet.id}
          </span>
          <span className="live-badge">LIVE</span>
          <span className="watch-event">{cabinet.eventName || cabinet.gameName || '配信'}</span>
        </div>
        <button className="primary" onClick={onBack}>
          ← 店内に戻る
        </button>
      </div>
      <div className="watch-player">
        {cabinet.videoId && (
          <iframe
            ref={frameRef}
            key={cabinet.videoId}
            src={embedUrlFull(cabinet.videoId, location.origin)}
            title={`筐体 No.${cabinet.id} の配信`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
      <div className="watch-info">
        <PromoBlock c={cabinet} />
        <div className="watch-side">
          <a className="button" href={cabinet.url ?? '#'} target="_blank" rel="noopener noreferrer">
            YouTube で開く ↗
          </a>
          <p className="muted small">
            視聴中は、店内であなたのキャラクターがこの筐体の前に座っています。埋め込みが再生できない配信は「YouTube で開く」から見てください。
            動画が始まると店内の BGM は小さくなって止まり、店内に戻ると流れます。
          </p>
        </div>
      </div>
      {chat && <div className="watch-chat">{chat}</div>}
    </div>
  );
};
