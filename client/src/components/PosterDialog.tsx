import {
  formatPosterRange,
  formatPosterTime,
  POSTER_KINDS,
  POSTER_LIMITS,
  posterKindColor,
  posterKindLabel,
  urlDomain,
  type MetaResponse,
  type PosterKind,
  type PosterView,
} from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import type { ArcadeClient } from '../game/client';
import { NameBadges } from './Badges';

/** ms → datetime-local の値（この端末の時刻） */
const toLocalInput = (t: number | null): string => {
  if (t === null || !Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
/** 書くときの開始の初めの値：今日の 21:00（過ぎていたら明日） */
const defaultStart = () => {
  const d = new Date();
  d.setHours(21, 0, 0, 0);
  if (d.getTime() < Date.now() + 30 * 60 * 1000) d.setDate(d.getDate() + 1);
  return d.getTime();
};

interface Form {
  kind: PosterKind;
  title: string;
  game: string;
  body: string;
  url: string;
  start: string;
  end: string;
}

const emptyForm = (): Form => ({ kind: 'tournament', title: '', game: '', body: '', url: '', start: toLocalInput(defaultStart()), end: '' });
const formOf = (p: PosterView): Form => ({
  kind: p.kind,
  title: p.title,
  game: p.game,
  body: p.body,
  url: p.url ?? '',
  start: toLocalInput(p.startsAt),
  end: toLocalInput(p.endsAt),
});

const len = (s: string) => [...s].length;

/** ポスター欄の窓（DESIGN §9）：一覧と詳細・書く・直す・はがす・管理者のピン */
export const PosterDialog = ({
  client,
  meta,
  initialId,
  onClose,
}: {
  client: ArcadeClient;
  meta: MetaResponse | null;
  initialId: number | null;
  onClose: () => void;
}) => {
  const posters = client.posters;
  const you = client.you;
  const admin = !!you?.admin;
  const who = meta?.posters.who ?? 'all';
  const maxPerUser = meta?.posters.maxPerUser ?? 2;
  const mine = posters.filter((p) => p.authorPid === you?.pid);
  const canWrite = who === 'all' || admin;

  const [selected, setSelected] = useState<number | null>(initialId ?? posters[0]?.id ?? null);
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view');
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sel = posters.find((p) => p.id === selected) ?? null;
  // 選んでいたものがはがされたら先頭へ
  useEffect(() => {
    if (mode === 'view' && selected !== null && !sel) setSelected(posters[0]?.id ?? null);
    if (mode === 'view' && selected === null && posters[0]) setSelected(posters[0].id);
  }, [mode, selected, sel, posters]);

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

  const startNew = () => {
    setForm(emptyForm());
    setMode('new');
    setError(null);
    setInfo(null);
  };
  const startEdit = (p: PosterView) => {
    setForm(formOf(p));
    setMode('edit');
    setError(null);
    setInfo(null);
  };
  const save = async () => {
    const startsAt = fromLocalInput(form.start);
    const endsAt = fromLocalInput(form.end);
    if (startsAt === null) {
      setError('開始の日時を入れてください');
      return;
    }
    const body = { kind: form.kind, title: form.title, game: form.game, body: form.body, url: form.url, startsAt, endsAt };
    if (mode === 'new') {
      let id: number | null = null;
      const ok = await run(async () => {
        const r = await api<{ poster: PosterView }>('POST', '/api/posters', body);
        id = r.poster.id;
      }, 'ポスターを貼りました');
      if (ok) {
        setMode('view');
        setSelected(id);
      }
    } else if (sel) {
      const ok = await run(() => api('PATCH', `/api/posters/${sel.id}`, body), '直しました');
      if (ok) setMode('view');
    }
  };
  const remove = (p: PosterView) => {
    if (!window.confirm(`ポスター「${p.title}」をはがしますか？`)) return;
    void run(() => api('DELETE', `/api/posters/${p.id}`), 'はがしました');
  };
  const pin = (p: PosterView) => void run(() => api('POST', `/api/admin/posters/${p.id}/pin`, { pinned: !p.pinned }), p.pinned ? '固定をやめました' : '先頭に固定しました');

  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const L = POSTER_LIMITS;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal poster-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📌 ポスター欄（大会・イベントの告知）</h2>
          <div className="row-gap">
            {mode === 'view' && canWrite && (
              <button className="primary" onClick={startNew} disabled={!admin && mine.length >= maxPerUser} title={!admin && mine.length >= maxPerUser ? `同時に貼れるのは ${maxPerUser} 枚までです` : ''}>
                ＋ ポスターを書く
              </button>
            )}
            <button className="ghost" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </div>
        <div className={`poster-body ${mode !== 'view' ? 'editing' : ''}`}>
          <ul className="poster-list">
            {posters.length === 0 && <li className="muted small poster-empty">まだポスターはありません。大会や参加型対戦の予定を書いて貼りましょう。</li>}
            {posters.map((p) => (
              <li key={p.id}>
                <button
                  className={`poster-item ${p.id === selected && mode !== 'new' ? 'on' : ''}`}
                  onClick={() => {
                    setSelected(p.id);
                    setMode('view');
                  }}
                >
                  <span className="poster-kind" style={{ background: posterKindColor(p.kind) }}>
                    {posterKindLabel(p.kind)}
                  </span>
                  {p.pinned && <span className="poster-pin">📍固定</span>}
                  <span className="poster-item-title">{p.title}</span>
                  <span className="poster-item-time">{formatPosterRange(p)}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="poster-detail">
            {mode === 'view' && sel && (
              <article>
                <div className="poster-tags">
                  <span className="poster-kind" style={{ background: posterKindColor(sel.kind) }}>
                    {posterKindLabel(sel.kind)}
                  </span>
                  {sel.pinned && <span className="poster-pin">📍 固定</span>}
                </div>
                <h3 className="poster-title">{sel.title}</h3>
                <div className="poster-when">🗓 {formatPosterRange(sel)}</div>
                {sel.game && (
                  <div className="promo-row">
                    <span>ゲーム</span>
                    {sel.game}
                  </div>
                )}
                {sel.body && <div className="poster-text">{sel.body}</div>}
                {sel.url && (
                  <div className="poster-url">
                    <a href={sel.url} target="_blank" rel="noopener noreferrer nofollow">
                      くわしく・連絡先 ↗
                    </a>
                    <span className="muted small">（{urlDomain(sel.url)} を新しいタブで開きます）</span>
                  </div>
                )}
                <div className="poster-meta muted small">
                  <span>
                    書いた人：
                    <NameBadges name={sel.authorName} badges={client.badgesOf(sel.authorPid)} />
                  </span>
                  <span>自動ではがれる：{formatPosterTime(sel.expiresAt)}</span>
                </div>
                <div className="cab-actions">
                  {(sel.authorPid === you?.pid || admin) && (
                    <button disabled={busy} onClick={() => startEdit(sel)}>
                      {sel.authorPid !== you?.pid ? '管理者として直す' : '直す'}
                    </button>
                  )}
                  {(sel.authorPid === you?.pid || admin) && (
                    <button className="danger" disabled={busy} onClick={() => remove(sel)}>
                      {sel.authorPid !== you?.pid ? '管理者としてはがす' : 'はがす'}
                    </button>
                  )}
                  {admin && (
                    <button disabled={busy} onClick={() => pin(sel)}>
                      {sel.pinned ? '固定をやめる' : '📍 先頭に固定'}
                    </button>
                  )}
                </div>
              </article>
            )}
            {mode === 'view' && !sel && posters.length > 0 && <p className="muted">左の一覧から選んでください。</p>}
            {mode === 'view' && posters.length === 0 && (
              <div className="muted poster-help">
                <p>店の左の壁の掲示板に、大会・参加型対戦・イベントのお知らせを貼れます。</p>
                <p>
                  {canWrite
                    ? `1 人 ${maxPerUser} 枚まで。開始の日時（終了があれば終了）から 1 日で自動ではがれます。`
                    : 'このお店では、ポスターを貼れるのは管理者だけです。'}
                </p>
              </div>
            )}

            {(mode === 'new' || mode === 'edit') && (
              <form
                className="poster-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <h3>{mode === 'new' ? 'ポスターを書く' : 'ポスターを直す'}</h3>
                <label className="field">
                  <span>
                    題名（必須・{L.title} 文字まで）<em className={len(form.title) > L.title ? 'error' : 'muted'}>　{len(form.title)} / {L.title}</em>
                  </span>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={stop} placeholder="例：格闘ゲーム 交流大会 予選" />
                </label>
                <div className="field">
                  <span>種類</span>
                  <div className="poster-kinds">
                    {POSTER_KINDS.map((k) => (
                      <button
                        type="button"
                        key={k.id}
                        className={`pick ${form.kind === k.id ? 'on' : ''}`}
                        style={form.kind === k.id ? { borderColor: k.color, color: k.color } : undefined}
                        onClick={() => setForm({ ...form, kind: k.id })}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="poster-times">
                  <label className="field">
                    <span>開始の日時（必須）</span>
                    <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} onKeyDown={stop} />
                  </label>
                  <label className="field">
                    <span>終了の日時（任意・開始から 7 日まで）</span>
                    <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} onKeyDown={stop} />
                  </label>
                </div>
                <label className="field">
                  <span>
                    ゲーム名（{L.game} 文字まで）<em className={len(form.game) > L.game ? 'error' : 'muted'}>　{len(form.game)} / {L.game}</em>
                  </span>
                  <input value={form.game} onChange={(e) => setForm({ ...form, game: e.target.value })} onKeyDown={stop} />
                </label>
                <label className="field">
                  <span>
                    内容（{L.body} 文字まで）<em className={len(form.body) > L.body ? 'error' : 'muted'}>　{len(form.body)} / {L.body}</em>
                  </span>
                  <textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} onKeyDown={stop} placeholder="参加の方法・ルール・配信する筐体など" />
                </label>
                <label className="field">
                  <span>くわしい情報・連絡先の URL（任意・http:// か https:// で始まるもの）</span>
                  <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} onKeyDown={stop} placeholder="https://" />
                </label>
                <p className="muted small">
                  書いた人の名前（{you?.name}）が付きます。開始の日時（終了があれば終了）から 1 日で自動ではがれます。日時はこのパソコンの時刻で入れてください。
                </p>
                <div className="cab-actions">
                  <button type="button" className="ghost" onClick={() => setMode('view')}>
                    やめる
                  </button>
                  <button className="primary" disabled={busy || !form.title.trim() || !form.start}>
                    {mode === 'new' ? '貼る' : '保存する'}
                  </button>
                </div>
              </form>
            )}
            {info && <p className="ok small">{info}</p>}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
