// スマホのレイアウトの部品（DESIGN §11）：チャットの最新の数行・チャットのシート・メニュー。
// PC のレイアウトでは使わない。

import type { ChatMessage, Profile } from '@va/shared';
import { useRef, useState, type ReactNode } from 'react';
import { BgmControls } from './BgmControls';
import { Badges, NameBadges } from './Badges';

/** 指を上下に動かした量でスワイプを判断する（下からのシートの取っ手・チャットの最新の行） */
const useSwipe = (onUp?: () => void, onDown?: () => void, onTap?: () => void) => {
  const start = useRef<{ y: number; x: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dy = e.clientY - s.y;
      const dx = e.clientX - s.x;
      if (dy < -30 && Math.abs(dy) > Math.abs(dx)) onUp?.();
      else if (dy > 30 && Math.abs(dy) > Math.abs(dx)) onDown?.();
      else if (Math.hypot(dx, dy) <= 10) onTap?.();
    },
    onPointerCancel: () => (start.current = null),
  };
};

const time = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** たたんだチャット：最新の 3 行（読むだけ）。タップか上へのスワイプでシートを開く */
export const ChatPeek = ({ messages, myPid, onOpen }: { messages: ChatMessage[]; myPid: string | null; onOpen: () => void }) => {
  const swipe = useSwipe(onOpen, undefined, onOpen);
  const last = messages.slice(-3);
  return (
    <div className="m-peek" role="button" tabIndex={0} aria-label="チャットの履歴を開く" {...swipe} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="m-peek-grip" aria-hidden />
      {last.length === 0 && <div className="m-peek-line muted">まだ発言はありません。下の欄から話しかけてみましょう。</div>}
      {last.map((m) => (
        <div key={m.id} className={`m-peek-line ${m.kind}`}>
          <span className="chat-time">{time(m.at)}</span>
          {m.kind === 'notice' && <span className="chat-tag">お知らせ</span>}
          {m.kind === 'user' && (
            <span className={`chat-name ${m.pid === myPid ? 'mine' : ''}`}>
              <NameBadges name={m.name ?? ''} badges={m.badges} />
            </span>
          )}
          <span className="chat-text">{m.text}</span>
        </div>
      ))}
      <span className="m-peek-open">履歴 ▴</span>
    </div>
  );
};

/** 下からのシート（全幅）。取っ手を下へスワイプ・外側のタップで閉じる。full で全画面 */
export const Sheet = ({
  title,
  onClose,
  full = false,
  onToggleFull,
  children,
  className = '',
}: {
  title: ReactNode;
  onClose: () => void;
  full?: boolean;
  onToggleFull?: () => void;
  children: ReactNode;
  className?: string;
}) => {
  const swipe = useSwipe(onToggleFull && !full ? onToggleFull : undefined, full && onToggleFull ? onToggleFull : onClose);
  return (
    <div className="m-sheet-back" onClick={onClose}>
      <div className={`m-sheet ${full ? 'full' : ''} ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="m-sheet-head" {...swipe}>
          <div className="m-sheet-grip" aria-hidden />
          <div className="m-sheet-title">{title}</div>
          {onToggleFull && (
            <button className="ghost m-icon" onClick={onToggleFull} aria-label={full ? '小さくする' : '全画面'}>
              {full ? '▾' : '▴'}
            </button>
          )}
          <button className="ghost m-icon" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
};

/** チャットのシート（履歴・発言・ピン止め・削除。中身は PC の欄と同じ ChatPanel） */
export const ChatSheet = ({ online, maxPlayers, connected, onClose, children }: { online: number; maxPlayers: number; connected: boolean; onClose: () => void; children: ReactNode }) => {
  const [full, setFull] = useState(false);
  return (
    <Sheet
      className="m-chat-sheet"
      full={full}
      onToggleFull={() => setFull(!full)}
      onClose={onClose}
      title={
        <>
          店内チャット <span className={`chat-online ${connected ? '' : 'off'}`}>{connected ? `● ${online} / ${maxPlayers} 人` : '● 接続中…'}</span>
        </>
      }
    >
      {children}
    </Sheet>
  );
};

/** メニュー（☰）：見た目を変える・BGM・近くの配信・管理者・退店・操作の説明 */
export const MobileMenu = ({
  you,
  embedVideo,
  onEmbedVideo,
  onEditProfile,
  onAdmin,
  onLeave,
  onClose,
  version,
  adminBadge,
}: {
  you: Profile | null;
  embedVideo: boolean;
  onEmbedVideo: (on: boolean) => void;
  onEditProfile: () => void;
  onAdmin: () => void;
  onLeave: () => void;
  onClose: () => void;
  version?: string;
  /** 管理者のボタンに出す数（未読の要望など） */
  adminBadge?: number;
}) => (
  <Sheet title="メニュー" onClose={onClose} className="m-menu">
    {you && (
      <div className="m-menu-me">
        <span className="m-menu-name">
          {you.admin && '★ '}
          {you.name}
          <Badges badges={you.badges} />
        </span>
        <button onClick={onEditProfile}>見た目を変える</button>
      </div>
    )}
    <section className="m-menu-sec">
      <h3>店内の BGM</h3>
      <BgmControls touch />
    </section>
    <section className="m-menu-sec">
      <label className="m-switch">
        <input type="checkbox" checked={embedVideo} onChange={(e) => onEmbedVideo(e.target.checked)} />
        <span>
          近くの筐体の配信を動画で出す
          <span className="muted small">（重くなります。切ると、サムネイルだけ）</span>
        </span>
      </label>
    </section>
    <div className="m-menu-actions">
      <button className={you?.admin ? 'admin-on' : ''} onClick={onAdmin}>
        {you?.admin ? '🔧 管理者' : '管理者'}
        {!!adminBadge && <span className="count-badge">{adminBadge}</span>}
      </button>
      {you && (
        <button className="danger" onClick={onLeave}>
          退店する
        </button>
      )}
    </div>
    <section className="m-menu-sec m-help">
      <h3>操作</h3>
      <ul>
        <li>
          <b>歩く</b> 床をタップ（筐体などの陰になった床は長押し）
        </li>
        <li>
          <b>見回す</b> 1 本指でドラッグ（離すと 3 秒で自分の所へ戻ります）
        </li>
        <li>
          <b>拡大・縮小</b> 2 本指でピンチ
        </li>
        <li>
          <b>筐体</b> タップで視聴・使う。近づくと宣伝が下に出ます
        </li>
        <li>
          <b>大画面</b> タップで配信中の一覧
        </li>
        <li>
          <b>クレーンゲーム</b> 右奥・タップで遊ぶ　<b>掲示板</b> 左の壁・大会やイベントの告知
        </li>
        <li>
          <b>ノート</b> 入口の近くの机・ひとこと書ける　<b>要望箱</b> 右の手前・管理者へ要望を送る
        </li>
        <li>
          <b>チャット</b> 下の数行をタップすると履歴（自分の発言は 📌 でピン止め）
        </li>
      </ul>
    </section>
    {version && <p className="entry-version">v{version}</p>}
  </Sheet>
);
