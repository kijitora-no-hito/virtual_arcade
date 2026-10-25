import {
  NOTICE_MAX,
  requestKindColor,
  requestKindLabel,
  type Notice,
  type Profile,
  type RequestsResponse,
  type RequestStatus,
  type RequestView,
} from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import type { ClientPlayer } from '../game/client';
import { NameBadges } from './Badges';

const BAN_CHOICES = [
  { minutes: 0, label: '退室だけ' },
  { minutes: 30, label: '＋30 分止める' },
  { minutes: 24 * 60, label: '＋1 日止める' },
  { minutes: 7 * 24 * 60, label: '＋7 日止める' },
];

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const STATUS_LABEL: Record<RequestStatus, string> = { new: '● 未読', read: '既読', done: '✓ 対応済み' };

/** 要望の一覧（管理者だけ。DESIGN §13）：新しい順・未読の印・既読 / 対応済み・削除 */
const RequestList = ({ unread }: { unread: number }) => {
  const [list, setList] = useState<RequestView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<RequestsResponse>('GET', '/api/admin/requests')
      .then((r) => setList(r.requests))
      .catch((e) => setError(errorText(e)));
  // 未読の件数が変わったら（新しく届いた・ほかの管理者が印を付けた）読み直す
  useEffect(() => {
    void load();
  }, [unread]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const mark = (r: RequestView, status: RequestStatus) => run(() => api('PATCH', `/api/admin/requests/${r.id}`, { status }));
  const remove = (r: RequestView) => {
    if (!window.confirm('この要望を削除しますか？（元に戻せません）')) return;
    void run(() => api('DELETE', `/api/admin/requests/${r.id}`));
  };
  if (!list) return <p className="muted">{error ?? '読み込み中…'}</p>;
  return (
    <div className="request-admin">
      <p className="muted small">店内の要望箱に届いたもの（新しい順）。読めるのは管理者だけです。{list.length} 件・未読 {unread} 件。</p>
      {list.length === 0 && <p className="muted">まだ要望は届いていません。</p>}
      <ul className="request-list">
        {list.map((r) => (
          <li key={r.id} className={`request-item ${r.status}`}>
            <div className="request-item-head">
              <span className={`request-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              <span className="poster-kind" style={{ background: requestKindColor(r.kind) }}>
                {requestKindLabel(r.kind)}
              </span>
              <span className="request-from">{r.name ?? <span className="muted">名前なし</span>}</span>
              <span className="muted small">{fmt(r.at)}</span>
            </div>
            <div className="request-text">{r.text}</div>
            <div className="request-acts">
              {r.status === 'new' ? (
                <button className="small" disabled={busy} onClick={() => mark(r, 'read')}>
                  既読にする
                </button>
              ) : (
                <button className="small ghost" disabled={busy} onClick={() => mark(r, 'new')}>
                  未読に戻す
                </button>
              )}
              {r.status !== 'done' ? (
                <button className="small" disabled={busy} onClick={() => mark(r, 'done')}>
                  ✓ 対応済み
                </button>
              ) : (
                <button className="small ghost" disabled={busy} onClick={() => mark(r, 'read')}>
                  対応済みを外す
                </button>
              )}
              <button className="small danger" disabled={busy} onClick={() => remove(r)}>
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  );
};

/** 管理者の窓：合言葉の入力 → お知らせ・退室と入室の停止（筐体は筐体の窓から、チャットの削除は欄の × から）・要望（v0.4.0） */
export const AdminDialog = ({
  you,
  enabled,
  players,
  notices,
  onClose,
  unread = 0,
  initialTab = 'main',
}: {
  you: Profile;
  enabled: boolean;
  players: ClientPlayer[];
  notices: Notice[];
  onClose: () => void;
  /** 要望の未読の件数 */
  unread?: number;
  initialTab?: 'main' | 'requests';
}) => {
  const [tab, setTab] = useState<'main' | 'requests'>(initialTab);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
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

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🔧 管理者</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {you.admin && (
          <div className="tabs">
            <button className={`tab ${tab === 'main' ? 'on' : ''}`} onClick={() => setTab('main')}>
              管理
            </button>
            <button className={`tab ${tab === 'requests' ? 'on' : ''}`} onClick={() => setTab('requests')}>
              📮 要望{unread > 0 && <span className="count-badge">{unread}</span>}
            </button>
          </div>
        )}
        {you.admin && tab === 'requests' ? (
          <RequestList unread={unread} />
        ) : !you.admin ? (
          enabled ? (
            <form
              className="admin-login"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api('POST', '/api/admin/login', { password }), '管理者になりました').then(() => setPassword(''));
              }}
            >
              <label className="field">
                <span>管理者の合言葉</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <button className="primary" disabled={busy || !password}>
                管理者になる
              </button>
              <p className="muted small">合言葉はサーバの設定です。何度も間違えると、しばらく入力できなくなります。</p>
            </form>
          ) : (
            <p className="muted">このサーバでは管理者の合言葉が設定されていません。</p>
          )
        ) : (
          <div className="admin-body">
            <section>
              <h3>お知らせ（壁の大画面とチャットに流す）</h3>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => api('POST', '/api/admin/notices', { text: notice }), 'お知らせを流しました').then((ok) => ok && setNotice(''));
                }}
              >
                <input
                  value={notice}
                  maxLength={NOTICE_MAX * 2}
                  placeholder={`お知らせ（${NOTICE_MAX} 文字まで）`}
                  onChange={(e) => setNotice(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
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
              <h3>店内の人（{players.length} 人）</h3>
              <table className="admin-players">
                <tbody>
                  {players.map((p) => (
                    <tr key={p.pid}>
                      <td className="name">
                        {p.admin ? '★ ' : ''}
                        <NameBadges name={p.name} badges={p.badges} />
                        {p.pid === you.pid && <span className="muted">（自分）</span>}
                      </td>
                      <td className="acts">
                        {p.pid !== you.pid &&
                          BAN_CHOICES.map((b) => (
                            <button
                              key={b.minutes}
                              className={`small ${b.minutes ? 'danger' : ''}`}
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(`${p.name} さんを退室させますか？${b.minutes ? `（${b.label.replace('＋', '')}、この人の鍵での入室を止めます）` : ''}`)) return;
                                run(() => api('POST', '/api/admin/kick', { pid: p.pid, minutes: b.minutes }), `${p.name} さんを退室させました`);
                              }}
                            >
                              {b.label}
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="muted small">
              <p>筐体の変更・解除：筐体をクリックすると、どの筐体でも「管理者として設定を変える / 空ける」が出ます。</p>
              <p>チャットの削除：右の欄の各発言の × から。</p>
            </section>
            <button className="ghost" disabled={busy} onClick={() => run(() => api('POST', '/api/admin/logout'), '管理者をやめました')}>
              管理者をやめる
            </button>
          </div>
        )}
        {info && <p className="ok small">{info}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};
