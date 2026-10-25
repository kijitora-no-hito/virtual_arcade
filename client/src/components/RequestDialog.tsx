import { REQUEST_KINDS, REQUEST_LIMITS, type RequestKind } from '@va/shared';
import { useState } from 'react';
import { api, errorText } from '../api';

const len = (s: string) => [...s].length;

/**
 * 機能追加要望箱の「要望を送る」窓（DESIGN §13）。送った内容は管理者だけが読む（送った人にも後から見えない）。
 */
export const RequestDialog = ({ myName, onClose }: { myName: string; onClose: () => void }) => {
  const [kind, setKind] = useState<RequestKind>('feature');
  const [text, setText] = useState('');
  const [name, setName] = useState(myName);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/requests', { kind, text, name: anonymous ? null : name });
      setSent(true);
      setText('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal request-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📮 機能追加要望箱</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {sent ? (
          <div className="request-thanks">
            <div className="request-thanks-mark">📮</div>
            <p className="request-thanks-text">ありがとうございます。管理者が読みます。</p>
            <p className="muted small">送った内容は管理者だけが読みます（あとからご自分でも見ることはできません）。</p>
            <div className="cab-actions">
              <button onClick={() => setSent(false)}>もう 1 件送る</button>
              <button className="primary" onClick={onClose}>
                閉じる
              </button>
            </div>
          </div>
        ) : (
          <form
            className="request-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <p className="muted small request-lead">
              「こんな機能がほしい」「ここがおかしい」などを店の管理者に届けます。送った内容は管理者だけが読みます（ほかの人には見えません）。
            </p>
            <div className="field">
              <span>種類</span>
              <div className="poster-kinds">
                {REQUEST_KINDS.map((k) => (
                  <button
                    type="button"
                    key={k.id}
                    className={`pick ${kind === k.id ? 'on' : ''}`}
                    style={kind === k.id ? { borderColor: k.color, color: k.color } : undefined}
                    onClick={() => setKind(k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>
                要望（必須・{REQUEST_LIMITS.text} 文字まで）
                <em className={len(text) > REQUEST_LIMITS.text ? 'error' : 'muted'}>
                  　{len(text)} / {REQUEST_LIMITS.text}
                </em>
              </span>
              <textarea
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="例：チャットの文字を大きくできるようにしてほしいです"
              />
            </label>
            <div className="field">
              <span>名前</span>
              <div className="request-name">
                <input
                  value={anonymous ? '' : name}
                  disabled={anonymous}
                  maxLength={REQUEST_LIMITS.name * 2}
                  placeholder={anonymous ? '（名前を出さない）' : '名前'}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <label className="m-switch request-anon">
                  <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                  <span>名前を出さない</span>
                </label>
              </div>
            </div>
            <div className="cab-actions">
              <button type="button" className="ghost" onClick={onClose}>
                やめる
              </button>
              <button className="primary" disabled={busy || !text.trim() || len(text) > REQUEST_LIMITS.text || (!anonymous && len(name.trim()) > REQUEST_LIMITS.name)}>
                送る
              </button>
            </div>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};
