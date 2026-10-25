import { CHAT_MAX, type ChatMessage } from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { NameBadges } from './Badges';

const time = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 1 件の表示（お知らせ・システムの案内・発言） */
export const ChatLine = ({
  m,
  mine,
  admin,
  pinned,
  onDelete,
  onPin,
}: {
  m: ChatMessage;
  mine: boolean;
  admin: boolean;
  /** この発言がピン止めされている（誰かの頭上に出しっぱなし） */
  pinned: boolean;
  onDelete: (id: number) => void;
  onPin: (id: number, pin: boolean) => void;
}) => {
  const del = admin && (
    <button className="chat-del" title="この発言を消す（管理者）" onClick={() => onDelete(m.id)}>
      ×
    </button>
  );
  if (m.kind === 'notice')
    return (
      <li className="chat-line chat-notice">
        <span className="chat-time">{time(m.at)}</span>
        <span className="chat-tag">お知らせ</span>
        <span className="chat-text">{m.text}</span>
        {del}
      </li>
    );
  if (m.kind === 'system')
    return (
      <li className="chat-line chat-system">
        <span className="chat-time">{time(m.at)}</span>
        <span className="chat-text">{m.text}</span>
        {del}
      </li>
    );
  return (
    <li className={`chat-line chat-user ${mine ? 'mine' : ''} ${pinned ? 'pinned' : ''}`}>
      {mine && (
        <button
          className={`chat-pin ${pinned ? 'on' : ''}`}
          title={pinned ? 'ピン止めを外す' : 'ピン止めする（頭上の吹き出しが出しっぱなしになります。1 つまで）'}
          onClick={() => onPin(m.id, !pinned)}
        >
          📌
        </button>
      )}
      {!mine && pinned && (
        <span className="chat-pin-mark" title="ピン止め中">
          📌
        </span>
      )}
      <span className="chat-time">{time(m.at)}</span>
      <span className="chat-name">
        {m.host && <span className="host-tag">主催</span>}
        <NameBadges name={m.name ?? ''} badges={m.badges} />
      </span>
      <span className="chat-text">{m.text}</span>
      {del}
    </li>
  );
};

/** 発言・ピン止め・削除（欄・スマホのシートで共用） */
export const pinChat = (id: number, on: boolean) => api('POST', `/api/chat/${id}/pin`, { pinned: on });
export const removeChat = (id: number) => api('DELETE', `/api/admin/chat/${id}`);

/**
 * 発言の欄。compact（スマホ）は文字数の行を、打っているとき・エラーのときだけ出す。
 * onSent は送れたとき（一覧を下までスクロールするため）。
 */
export const ChatForm = ({
  compact = false,
  onSent,
  outerError = null,
}: {
  compact?: boolean;
  onSent?: () => void;
  /** 一覧の操作（ピン止め・削除）のエラー。文字数の行に出す */
  outerError?: string | null;
}) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ownError, setError] = useState<string | null>(null);
  const error = ownError ?? outerError;

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/chat', { text: t });
      setText('');
      onSent?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const len = [...text].length;
  return (
    <>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          maxLength={CHAT_MAX * 2}
          placeholder={compact ? `発言（${CHAT_MAX} 文字まで）` : `発言（${CHAT_MAX} 文字まで・Enter で送信）`}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button className="primary" disabled={busy || !text.trim() || len > CHAT_MAX}>
          送信
        </button>
      </form>
      {(!compact || len > 0 || error) && (
        <div className="chat-foot">
          <span className={len > CHAT_MAX ? 'error' : 'muted'}>
            {len} / {CHAT_MAX}
          </span>
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </>
  );
};

/**
 * 店内チャット（右の欄）。発言は店内全体に届き、発言した人の頭上に吹き出しが出る。compact（スマホ）は見出しを出さない。
 * form={false} は発言の欄を出さない（スマホの下の欄は、縦横で同じ ChatForm を外に置いて、回転やキーボードで作り直さないため。v0.4.1）
 */
export const ChatPanel = ({
  messages,
  myPid,
  admin,
  online,
  maxPlayers,
  connected,
  pinnedIds,
  compact = false,
  form = true,
}: {
  /** ピン止めされている発言の id（店内の全員の分） */
  pinnedIds: Set<number>;
  messages: ChatMessage[];
  myPid: string | null;
  admin: boolean;
  online: number;
  maxPlayers: number;
  connected: boolean;
  compact?: boolean;
  form?: boolean;
}) => {
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  // 一番下を見ているときだけ、新しい発言で下までスクロールする
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const pin = async (id: number, on: boolean) => {
    try {
      await pinChat(id, on);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async (id: number) => {
    try {
      await removeChat(id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="chat">
      {!compact && (
        <div className="chat-head">
          <span>店内チャット</span>
          <span className={`chat-online ${connected ? '' : 'off'}`}>
            {connected ? `● ${online} / ${maxPlayers} 人` : '● 接続中…'}
          </span>
        </div>
      )}
      <ol
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {messages.length === 0 && <li className="muted small">まだ発言はありません。下の欄から話しかけてみましょう。</li>}
        {messages.map((m) => (
          <ChatLine
            key={m.id}
            m={m}
            mine={!!myPid && m.pid === myPid && m.kind === 'user'}
            admin={admin}
            pinned={pinnedIds.has(m.id)}
            onDelete={remove}
            onPin={pin}
          />
        ))}
      </ol>
      {form ? (
        <ChatForm compact={compact} outerError={error} onSent={() => (stick.current = true)} />
      ) : (
        error && (
          <div className="chat-foot">
            <span className="error">{error}</span>
          </div>
        )
      )}
    </div>
  );
};
