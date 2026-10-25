import { cabinetDistance, FLOOR, PROMO_FIELDS, PROMO_LABEL, PROMO_LIMITS, type CabinetView, type PromoField } from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import type { ArcadeClient } from '../game/client';
import { cabinetFront } from '../game/render';
import { thumbSrc } from '../game/thumbs';

const fmtTime = (t: number) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 宣伝の表示（窓・視聴画面で共用） */
export const PromoBlock = ({ c }: { c: CabinetView }) => (
  <div className="promo">
    {c.eventName && <div className="promo-event">{c.eventName}</div>}
    {c.gameName && (
      <div className="promo-row">
        <span>ゲーム</span>
        {c.gameName}
      </div>
    )}
    {c.playerName && (
      <div className="promo-row">
        <span>プレイヤー</span>
        {c.playerName}
      </div>
    )}
    {c.note && <div className="promo-note">{c.note}</div>}
    {!c.eventName && !c.gameName && !c.playerName && !c.note && <div className="muted small">（宣伝の文はまだありません）</div>}
  </div>
);

/** 筐体をクリックしたときの窓：配信中なら「視聴する / YouTube で開く」、空きなら「使う」、自分の筐体（と管理者）なら設定 */
export const CabinetDialog = ({
  client,
  id,
  onClose,
  onWatch,
  ttlHours,
}: {
  client: ArcadeClient;
  id: number;
  ttlHours: number;
  onClose: () => void;
  onWatch: (id: number) => void;
}) => {
  const c = client.cabinets.get(id);
  const me = client.me();
  const you = client.you;
  const mine = !!c?.ownerPid && c.ownerPid === you?.pid;
  const admin = !!you?.admin;
  /** v0.5.0：予約部屋の主催者（その予約の間だけ）。設定は変えられないが、空けられる */
  const host = !admin && client.room === 'reserved' && !!you && client.reservations.some((r) => r.ownerPid === you.pid && r.startAt <= client.serverNow() && client.serverNow() < r.endAt);
  const spot = FLOOR.cabinets.find((x) => x.id === id)!;
  const myTile = me ? { x: Math.round(me.rx), y: Math.round(me.ry) } : null;
  const near = !!myTile && cabinetDistance(myTile, spot) <= 2;
  const myOther = [...client.cabinets.values()].find((x) => x.ownerPid && x.ownerPid === you?.pid && x.id !== id);

  const [form, setForm] = useState<Record<'url' | PromoField, string>>({ url: '', eventName: '', gameName: '', playerName: '', note: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 持ち主（管理者）になったら、今の設定を入れたフォームを開く
  const canEdit = mine || admin;
  useEffect(() => {
    if (!c) return;
    setForm({ url: c.url ?? '', eventName: c.eventName, gameName: c.gameName, playerName: c.playerName, note: c.note });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, c?.updatedAt]);
  useEffect(() => {
    if (mine && !c?.videoId && !c?.eventName) setEditing(true);
  }, [mine, c?.videoId, c?.eventName]);

  if (!c) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const claim = () => run(() => api('POST', `/api/cabinets/${id}/claim`)).then((ok) => ok && setEditing(true));
  const save = () =>
    run(() => api('PATCH', `/api/cabinets/${id}`, form)).then((ok) => {
      if (ok) {
        setSaved(true);
        setEditing(false);
      }
    });
  const release = () => {
    if (!window.confirm(`筐体 No.${id} を空けますか？（配信の URL と宣伝が消えます）`)) return;
    run(() => api('POST', `/api/cabinets/${id}/release`)).then((ok) => ok && onClose());
  };
  const walkHere = () => {
    const f = cabinetFront(id);
    if (f) client.send({ type: 'goto', x: f.x, y: f.y });
    onClose();
  };

  const ownerBadges = c.ownerPid ? (client.players.get(c.ownerPid)?.badges ?? '') : '';
  const status = c.owned ? (mine ? 'あなたが使っています' : `${c.ownerName ?? '誰か'}${ownerBadges} さんが使っています`) : c.videoId ? '管理者が設定した配信' : '空いています';

  return (
    <div className="modal-back side" onClick={onClose}>
      <div className="modal cabinet-modal" onClick={(e) => e.stopPropagation()} style={{ borderColor: spot.color }}>
        <div className="modal-head">
          <h2>
            <span className="cab-no" style={{ background: spot.color }}>
              No.{id}
            </span>
            筐体
            {c.videoId && <span className="live-badge">LIVE</span>}
          </h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="cab-status">
          {status}
          {c.expiresAt && <span className="muted small">　自動で空きに戻る: {fmtTime(c.expiresAt)}</span>}
        </div>

        {c.videoId && !editing && (
          <div className="cab-live">
            <img className="cab-thumb" src={thumbSrc(c.videoId, c.live)} alt="配信のサムネイル" referrerPolicy="no-referrer" />
            <PromoBlock c={c} />
          </div>
        )}
        {!c.videoId && !editing && (c.eventName || c.gameName || c.note) && <PromoBlock c={c} />}

        {c.videoId && !editing && (
          <div className="cab-actions big-actions">
            <button className="primary big" onClick={() => onWatch(id)}>
              ▶ この中で視聴する
            </button>
            <a className="button big" href={c.url ?? '#'} target="_blank" rel="noopener noreferrer">
              YouTube で開く（新しいタブ）↗
            </a>
          </div>
        )}

        {!c.owned && !c.videoId && !editing && (
          <div className="cab-claim">
            <p>
              空いている筐体を「使う」と持ち主になり、YouTube の配信 URL と宣伝（イベント名・ゲーム名・プレイヤー名・備考）を出せます。
              同時に使えるのは 1 台。最後の更新から {ttlHours} 時間で自動で空きに戻ります。
            </p>
            {myOther && <p className="warn small">いまは No.{myOther.id} を使っています。先にそちらを空けてください。</p>}
            {!near && <p className="warn small">筐体の近く（2 マス以内）まで歩いてから使えます。</p>}
            <div className="cab-actions">
              {!near && (
                <button className="ghost" onClick={walkHere}>
                  前まで歩く
                </button>
              )}
              <button className="primary big" disabled={busy || !near || !!myOther} onClick={claim}>
                この筐体を使う
              </button>
            </div>
          </div>
        )}

        {(canEdit || host) && !editing && (
          <div className="cab-actions">
            {canEdit && <button onClick={() => setEditing(true)}>{admin && !mine ? '管理者として設定を変える' : '設定を変える'}</button>}
            {(c.owned || c.videoId || c.eventName) && (
              <button className="danger" disabled={busy} onClick={release}>
                {admin && !mine ? '管理者として空ける' : host && !mine ? '主催者として空ける' : '空ける'}
              </button>
            )}
          </div>
        )}

        {canEdit && editing && (
          <form
            className="cab-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {admin && !mine && <p className="warn small">管理者として編集しています（持ち主は変わりません）。</p>}
            <label className="field">
              <span>YouTube の URL（youtube.com/watch?v=… ・ youtu.be/… ・ youtube.com/live/…。空なら配信なし）</span>
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://www.youtube.com/live/xxxxxxxxxxx"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            {PROMO_FIELDS.map((f) => (
              <label className="field" key={f}>
                <span>
                  {PROMO_LABEL[f]}（{PROMO_LIMITS[f]} 文字まで）
                  {f === 'eventName' && <em className="muted">　例：参加型対戦・大会</em>}
                </span>
                {f === 'note' ? (
                  <textarea
                    rows={3}
                    value={form[f]}
                    onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
                )}
              </label>
            ))}
            <div className="cab-actions">
              <button type="button" className="ghost" onClick={() => setEditing(false)}>
                やめる
              </button>
              <button className="primary" disabled={busy}>
                保存する
              </button>
            </div>
          </form>
        )}
        {saved && <p className="ok small">保存しました。店内の筐体に反映されます。</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};
