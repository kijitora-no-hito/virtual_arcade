import {
  convertView,
  formatNoteTime,
  NOTE_FETCH,
  NOTE_LIMITS,
  noteViewCount,
  pageRange,
  viewPages,
  type NotesResponse,
  type NoteView,
} from '@va/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import type { ArcadeClient, NoteEvent } from '../game/client';

const len = (s: string) => [...s.replace(/\n/g, '')].length;
/** 3 行を超える改行は入れさせない */
const clampLines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').slice(0, NOTE_LIMITS.lines).join('\n');

/**
 * コミュニケーションノートの窓（DESIGN §12）。PC・スマホの横向きは見開き（2 ページ）、スマホの縦向きは 1 ページずつ。
 * 開いたときはいちばん新しいページ。［‹］［›］・← →・左右のスワイプでめくる。
 * 一覧は新しいものから NOTE_FETCH 件ずつ読み、古いページへめくったら続きを読む（読んだ分はいつも「新しい方から続いた」範囲）。
 */
export const NoteDialog = ({
  client,
  perView,
  mobile = false,
  onClose,
}: {
  client: ArcadeClient;
  /** 2 = 見開き、1 = 1 ページずつ */
  perView: 1 | 2;
  mobile?: boolean;
  onClose: () => void;
}) => {
  const you = client.you;
  const [total, setTotal] = useState(0);
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState(0);
  const [turn, setTurn] = useState<{ dir: 'next' | 'prev'; n: number } | null>(null);
  const [writing, setWriting] = useState(false);
  const [name, setName] = useState(you?.name ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const loadingOlder = useRef(false);
  const jumpToEnd = useRef(false);
  const pending = useRef<NoteEvent[]>([]);
  const loadedRef = useRef(false);

  const apply = useCallback((m: NoteEvent) => {
    if (m.type === 'note') setNotes((ns) => (ns.some((n) => n.id === m.note.id) ? ns : [...ns, m.note]));
    else setNotes((ns) => ns.filter((n) => n.id !== m.id));
    setTotal(m.total);
  }, []);

  // 最初の読み込み（いちばん新しいページを出す）と、その場の反映（今のページは動かさない）
  useEffect(() => {
    const off = client.onNote((m) => {
      if (loadedRef.current) apply(m);
      else pending.current.push(m);
    });
    api<NotesResponse>('GET', '/api/notes')
      .then((r) => {
        setNotes(r.notes);
        setTotal(r.total);
        setView(noteViewCount(r.total, perView) - 1);
        loadedRef.current = true;
        setLoaded(true);
        for (const m of pending.current.splice(0)) apply(m);
      })
      .catch((e) => setError(errorText(e)));
    return off;
    // perView の変化は下で合わせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, apply]);

  // 見開き ⇄ 1 ページずつ（スマホを回したとき）：見ていたページが入る所へ
  const prevPerView = useRef(perView);
  useEffect(() => {
    if (prevPerView.current !== perView) {
      setView((v) => convertView(v, prevPerView.current, perView));
      prevPerView.current = perView;
    }
  }, [perView]);

  const views = noteViewCount(total, perView);
  const cur = Math.max(0, Math.min(view, views - 1));
  // 自分で書いたら、いちばん新しいページへ
  useEffect(() => {
    if (jumpToEnd.current) {
      jumpToEnd.current = false;
      setView(views - 1);
    }
  }, [total, views]);

  const first = total - notes.length; // notes[0] の通し番号
  const pages = viewPages(cur, perView, total);
  const need = pages.length ? pageRange(pages[0], total).start : 0;

  // 古いページ：まだ読んでいなければ続きを読む
  useEffect(() => {
    if (!loaded || need >= first || loadingOlder.current || !notes.length) return;
    loadingOlder.current = true;
    api<NotesResponse>('GET', `/api/notes?before=${notes[0].id}&limit=${NOTE_FETCH}`)
      .then((r) => {
        setNotes((ns) => [...r.notes.filter((n) => !ns.some((x) => x.id === n.id)), ...ns]);
        setTotal(r.total);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [loaded, need, first, notes]);

  const go = useCallback(
    (d: number) => {
      const next = Math.max(0, Math.min(views - 1, cur + d));
      if (next === cur) return;
      setTurn((t) => ({ dir: d > 0 ? 'next' : 'prev', n: (t?.n ?? 0) + 1 }));
      setView(next);
    },
    [cur, views],
  );

  // キーボード（← →）。入力欄に打っているときは使わない
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'ArrowLeft') go(-1);
      else if (e.code === 'ArrowRight') go(1);
      else if (e.code === 'Escape') onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [go, onClose]);

  // 左右のスワイプ（スマホ）
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => (swipe.current = null),
  };

  const remove = async (n: NoteView) => {
    if (!window.confirm(`「${n.text.split('\n')[0]}」を消しますか？`)) return;
    setError(null);
    try {
      await api('DELETE', `/api/notes/${n.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      jumpToEnd.current = true;
      // 書いた分は WebSocket の note で加わる（その時にいちばん新しいページへ）
      await api<{ note: NoteView }>('POST', '/api/notes', { name, text });
      setText('');
      setWriting(false);
      setInfo('書きました');
    } catch (e) {
      jumpToEnd.current = false;
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const pageNotes = (p: number) => {
    const { start, end } = pageRange(p, total);
    const out: Array<NoteView | null> = [];
    for (let i = start; i < end; i++) out.push(notes[i - first] ?? null);
    return out;
  };

  const renderPage = (p: number | undefined, side: 'left' | 'right' | 'single') => (
    <div className={`note-page ${side}`}>
      {p !== undefined &&
        pageNotes(p).map((n, i) =>
          n ? (
            <div className="note-entry" key={n.id}>
              <div className="note-entry-head">
                <span className="note-name">{n.name}</span>
                <span className="note-time">{formatNoteTime(n.at)}</span>
                {(n.pid === you?.pid || you?.admin) && (
                  <button className="note-del" title={n.pid === you?.pid ? '自分の書き込みを消す' : '管理者として消す'} onClick={() => remove(n)}>
                    ×
                  </button>
                )}
              </div>
              <div className="note-text">{n.text}</div>
            </div>
          ) : (
            <div className="note-entry loading" key={`l${i}`}>
              <div className="note-entry-head">
                <span className="note-name muted">読み込み中…</span>
              </div>
              <div className="note-text" />
            </div>
          ),
        )}
      {p !== undefined && total === 0 && (
        <div className="note-empty">
          まだ何も書かれていません。
          <br />
          ［✎ 書く］から、ひとこと残していきませんか？
        </div>
      )}
      {p !== undefined && <div className="note-pno">{p + 1}</div>}
    </div>
  );

  const allPages = Math.max(1, Math.ceil(total / 4));
  const label = pages.length === 2 ? `${pages[0] + 1}–${pages[1] + 1} / ${allPages}` : `${(pages[0] ?? 0) + 1} / ${allPages}`;
  const lines = text.split('\n').length;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal note-modal ${writing ? 'writing' : ''} ${perView === 1 ? 'single' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📖 コミュニケーションノート</h2>
          <div className="row-gap">
            {!writing && (
              <button className="primary" onClick={() => setWriting(true)} disabled={!client.connected}>
                ✎ 書く
              </button>
            )}
            <button className="ghost" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </div>

        <div className="note-book" {...swipeHandlers}>
          {perView === 2 ? (
            <>
              {renderPage(pages[0], 'left')}
              <div className="note-spine" aria-hidden />
              {renderPage(pages[1], 'right')}
            </>
          ) : (
            renderPage(pages[0], 'single')
          )}
          {turn && <div key={turn.n} className={`note-turn ${turn.dir} ${perView === 1 ? 'single' : ''}`} aria-hidden onAnimationEnd={() => setTurn(null)} />}
        </div>
        <div className="note-nav">
          <button onClick={() => go(-1)} disabled={cur <= 0} aria-label="前のページ">
            ‹
          </button>
          <span className="note-pages">{loaded ? label : '…'}</span>
          <button onClick={() => go(1)} disabled={cur >= views - 1} aria-label="次のページ">
            ›
          </button>
        </div>
        {!writing && (
          <p className="muted small note-hint">
            {mobile ? '左右のスワイプでもめくれます。' : '← → キーでもめくれます。'}新しい書き込みはいちばん後ろのページに加わります。
          </p>
        )}

        {writing && (
          <form
            className="note-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="field">
              <span>名前（{NOTE_LIMITS.name} 文字まで。書き換えてもかまいません）</span>
              <input value={name} maxLength={NOTE_LIMITS.name * 2} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <label className="field">
              <span>
                ひとこと（{NOTE_LIMITS.lines} 行・{NOTE_LIMITS.text} 文字まで）
                <em className={len(text) > NOTE_LIMITS.text ? 'error' : 'muted'}>
                  　{len(text)} / {NOTE_LIMITS.text}・{lines} / {NOTE_LIMITS.lines} 行
                </em>
              </span>
              <textarea
                className="note-input"
                rows={3}
                value={text}
                autoFocus={!mobile}
                placeholder="例：はじめて来ました。また遊びに来ます！"
                onChange={(e) => setText(clampLines(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            <div className="cab-actions">
              <button type="button" className="ghost" onClick={() => setWriting(false)}>
                やめる
              </button>
              <button className="primary" disabled={busy || !text.trim() || !name.trim() || len(text) > NOTE_LIMITS.text}>
                書く
              </button>
            </div>
          </form>
        )}
        {info && !writing && <p className="ok small">{info}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};
