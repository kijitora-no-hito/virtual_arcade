import { FLOOR, type CabinetView, type Notice } from '@va/shared';
import { thumbSrc } from '../game/thumbs';

/** 壁の大画面をクリックしたときの一覧：配信中の筐体へ歩いて行く / 視聴する */
export const ScreenDialog = ({
  cabinets,
  notices,
  onWalk,
  onWatch,
  onClose,
}: {
  cabinets: CabinetView[];
  notices: Notice[];
  onWalk: (id: number) => void;
  onWatch: (id: number) => void;
  onClose: () => void;
}) => {
  const lives = cabinets.filter((c) => c.videoId).sort((a, b) => a.id - b.id);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal screen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📺 配信中の筐体（{lives.length} 台）</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {notices.length > 0 && (
          <ul className="notice-list">
            {notices.map((n) => (
              <li key={n.id}>📢 {n.text}</li>
            ))}
          </ul>
        )}
        {lives.length === 0 && <p className="muted">いま配信中の筐体はありません。空いている筐体を「使う」と、配信と宣伝を出せます。</p>}
        <div className="live-grid">
          {lives.map((c) => {
            const spot = FLOOR.cabinets.find((x) => x.id === c.id);
            return (
              <div className="live-card" key={c.id} style={{ borderColor: spot?.color }}>
                <div className="live-thumb">
                  <img src={thumbSrc(c.videoId!, c.live)} alt="" referrerPolicy="no-referrer" />
                  <span className="live-badge">LIVE</span>
                  <span className="cab-no small" style={{ background: spot?.color }}>
                    No.{c.id}
                  </span>
                </div>
                <div className="live-text">
                  <div className="live-event">{c.eventName || '（イベント名なし）'}</div>
                  {c.gameName && <div>{c.gameName}</div>}
                  {c.playerName && <div className="muted">プレイヤー：{c.playerName}</div>}
                </div>
                <div className="live-actions">
                  <button onClick={() => onWalk(c.id)}>歩いて行く</button>
                  <button className="primary" onClick={() => onWatch(c.id)}>
                    ▶ 視聴する
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
