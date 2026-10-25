import {
  formatRemaining,
  jstTime,
  NOTICE_MAX,
  RESERVATION_LIMITS,
  remainLevel,
  type Notice,
  type Profile,
  type ReservationView,
} from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import type { ClientPlayer } from '../game/client';
import { NameBadges } from './Badges';

/**
 * 予約部屋の時計（v0.5.0）：いまの時刻（日本時間）と予約の残り時間。10 分で注意・5 分で急ぎの色。
 * 時刻はサーバの時計に合わせた serverNow から出す（端末の時計がずれていても正しい）
 */
export const RoomClock = ({ end, serverNow, compact = false }: { end: number; serverNow: () => number; compact?: boolean }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const now = serverNow();
  const left = end - now;
  return (
    <span className={`room-clock lvl-${remainLevel(left)} ${compact ? 'compact' : ''}`} role="timer" aria-label={`いま ${jstTime(now)}・予約の残り ${formatRemaining(left)}`}>
      <span className="rc-now">🕒 {jstTime(now)}</span>
      <span className="rc-left">
        {compact ? '' : '残り '}
        {formatRemaining(left)}
      </span>
    </span>
  );
};

/**
 * 部屋の管理（v0.5.0。DESIGN §14.6）：予約部屋の主催者（予約した人）と、サイトの管理者。
 * お知らせ・人を出す・合言葉を変える・早めに終える。発言の削除はチャットの ×、筐体を空けるのは筐体の窓から
 */
export const RoomAdminDialog = ({
  you,
  reservation,
  players,
  notices,
  onClose,
}: {
  you: Profile;
  reservation: ReservationView | undefined;
  players: ClientPlayer[];
  notices: Notice[];
  onClose: () => void;
}) => {
  const [notice, setNotice] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (done) setInfo(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const others = players.filter((p) => p.pid !== you.pid);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal admin-modal room-admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🛠 部屋の管理</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <p className="muted small">
          {reservation ? `「${reservation.title}」（〜${jstTime(reservation.endAt)}）。` : ''}
          {you.admin ? 'サイトの管理者として操作しています。' : '予約した人（主催）は、予約の時間の間だけ、この予約部屋の中で次のことができます。'}
          発言の削除はチャットの ×、筐体を空けるのは筐体の窓から。
        </p>
        <div className="admin-body">
          <section>
            <h3>お知らせ（この部屋の大画面とチャットに流す）</h3>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api('POST', '/api/admin/notices', { text: notice }), 'お知らせを流しました').then((ok) => ok && setNotice(''));
              }}
            >
              <input value={notice} maxLength={NOTICE_MAX * 2} placeholder={`お知らせ（${NOTICE_MAX} 文字まで）`} onChange={(e) => setNotice(e.target.value)} onKeyDown={stop} />
              <button className="primary" disabled={busy || !notice.trim()}>
                流す
              </button>
            </form>
            {notices.length > 0 && (
              <ul className="admin-notices">
                {notices.map((n) => (
                  <li key={n.id}>
                    <span>{n.text}</span>
                    <button className="small danger" disabled={busy} onClick={() => run(() => api('DELETE', `/api/admin/notices/${n.id}`))}>
                      消す
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>この部屋の人（{players.length} 人）</h3>
            {others.length === 0 && <p className="muted small">ほかの人はいません。</p>}
            <table className="admin-players">
              <tbody>
                {others.map((p) => (
                  <tr key={p.pid}>
                    <td className="name">
                      {p.admin ? '★ ' : ''}
                      <NameBadges name={p.name} badges={p.badges} />
                    </td>
                    <td className="acts">
                      {!p.admin && (
                        <button
                          className="small danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`${p.name} さんをオープン部屋に戻しますか？（この予約の間は、合言葉でも予約部屋に入れなくなります）`)) return;
                            run(() => api('POST', '/api/room/remove', { pid: p.pid }), `${p.name} さんをオープン部屋に戻しました`);
                          }}
                        >
                          オープン部屋へ戻す
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3>合言葉を変える</h3>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api('POST', '/api/room/passphrase', { passphrase: pass }), '合言葉を変えました（いま中にいる人はそのまま）').then((ok) => ok && setPass(''));
              }}
            >
              <input
                value={pass}
                autoComplete="off"
                maxLength={RESERVATION_LIMITS.passMax * 2}
                placeholder={`新しい合言葉（${RESERVATION_LIMITS.passMin}〜${RESERVATION_LIMITS.passMax} 文字）`}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={stop}
              />
              <button className="primary" disabled={busy || [...pass.trim()].length < RESERVATION_LIMITS.passMin}>
                変える
              </button>
            </form>
          </section>
          <section>
            <h3>予約を早めに終える</h3>
            <p className="muted small">全員オープン部屋に戻り、この部屋のチャット・筐体は消えます。元に戻せません。</p>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('予約を早めに終えて、予約部屋を閉じますか？')) return;
                void run(() => api('POST', '/api/room/end'));
              }}
            >
              いま終える
            </button>
          </section>
        </div>
        {info && <p className="ok small">{info}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};
