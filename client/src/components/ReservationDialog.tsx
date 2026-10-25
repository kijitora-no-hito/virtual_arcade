import {
  activeReservation,
  closedRoomText,
  formatDuration,
  formatReservationRange,
  jstDate,
  jstDayStart,
  jstParts,
  jstTime,
  maxLengthFrom,
  RESERVATION_AHEAD_MS,
  RESERVATION_KEY_TOTAL_MS,
  RESERVATION_LIMITS,
  SLOT_MS,
  slotFloor,
  upcomingReservations,
  type Profile,
  type ReservationsResponse,
  type ReservationView,
} from '@va/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from '../api';

const DAY = 24 * 60 * 60 * 1000;
const ROW_H = 22;
const len = (s: string) => [...s].length;

/** 予約表を読む（開いている間は 30 秒ごと・一覧が変わったと届いたときも読み直す） */
export const useReservations = (liveKey: unknown) => {
  const [data, setData] = useState<ReservationsResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const r = await api<ReservationsResponse>('GET', '/api/reservations');
      setOffset(r.serverNow - Date.now());
      setData(r);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [liveKey]);
  return { data, now: () => Date.now() + offset, reload: load, error };
};

/** 予約の 1 行（一覧・状態の帯） */
const ResLine = ({ r, active, mine }: { r: ReservationView; active: boolean; mine: boolean }) => (
  <div className="res-line">
    <div className="res-line-time">
      {active && <span className="res-tag live">開室中</span>}
      {mine && <span className="res-tag mine">あなたの予約</span>}
      {formatReservationRange(r)}
    </div>
    <div className="res-line-title">「{r.title}」</div>
    <div className="muted small">予約：{r.host}</div>
    {r.description && <div className="res-line-desc">{r.description}</div>}
  </div>
);

type View = { kind: 'calendar' } | { kind: 'list' } | { kind: 'form'; startAt: number };

/**
 * 予約表（v0.5.0。DESIGN §14.2）：カレンダー（日 × 30 分の枠。空いている枠を押すと予約）・一覧・予約の形。
 * PC は 7 日ずつの表、スマホ（mobile）は日を選んでその日の枠の一覧。
 * ensureProfile：入店の画面から開いたとき、予約する前に名前を決める（入店したことのない人のため）
 */
export const ReservationDialog = ({
  you,
  mobile,
  liveKey,
  onClose,
  onEnterRoom,
  ensureProfile,
  initial = 'calendar',
}: {
  you: Profile | null;
  mobile: boolean;
  /** 店内の予約の一覧が変わった合図（変わったら読み直す） */
  liveKey?: unknown;
  onClose: () => void;
  /** ［予約部屋に入る］（合言葉の窓へ） */
  onEnterRoom: () => void;
  ensureProfile?: () => Promise<Profile>;
  initial?: 'calendar' | 'list';
}) => {
  const { data, now, reload, error: loadError } = useReservations(liveKey);
  const [view, setView] = useState<View>({ kind: initial });
  const [page, setPage] = useState(0);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const t = now();
  const list = data?.reservations ?? [];
  const active = activeReservation(list, t);
  const today = jstDayStart(t);
  const myPid = you?.pid ?? null;

  const cancel = async (r: ReservationView) => {
    if (!window.confirm(`「${r.title}」（${formatReservationRange(r)}）の予約を取り消しますか？${active?.id === r.id ? '\n使っている最中なので、予約部屋はすぐ閉まります。' : ''}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/api/reservations/${r.id}`);
      setInfo('予約を取り消しました');
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const status = (
    <div className={`res-status ${active ? 'open' : ''}`}>
      {active ? (
        <>
          <div>
            <b>いま開いています</b>　「{active.title}」（予約：{active.host}）〜{jstTime(active.endAt)}
          </div>
          <button className="primary" onClick={onEnterRoom}>
            🔑 予約部屋に入る
          </button>
        </>
      ) : (
        <div>{data ? closedRoomText(list, t) : (loadError ?? '読み込み中…')}</div>
      )}
    </div>
  );

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal res-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📅 予約部屋の予約表</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {status}
        {view.kind !== 'form' && (
          <div className="tabs">
            <button className={`tab ${view.kind === 'calendar' ? 'on' : ''}`} onClick={() => setView({ kind: 'calendar' })}>
              カレンダー
            </button>
            <button className={`tab ${view.kind === 'list' ? 'on' : ''}`} onClick={() => setView({ kind: 'list' })}>
              一覧（{list.length}）
            </button>
          </div>
        )}
        {view.kind === 'calendar' && (
          <SlotCalendar
            list={list}
            now={t}
            today={today}
            mobile={mobile}
            page={page}
            setPage={setPage}
            day={day}
            setDay={setDay}
            myPid={myPid}
            onPick={(startAt) => {
              setInfo(null);
              setError(null);
              setView({ kind: 'form', startAt });
            }}
          />
        )}
        {view.kind === 'list' && (
          <div className="res-list">
            {list.length === 0 && <p className="muted">これからの予約はありません。カレンダーの空いている枠から予約できます。</p>}
            {upcomingReservations(list, t).map((r) => (
              <div key={r.id} className={`res-item ${active?.id === r.id ? 'live' : ''}`}>
                <ResLine r={r} active={active?.id === r.id} mine={!!myPid && r.ownerPid === myPid} />
                {(r.ownerPid === myPid || you?.admin) && (
                  <button className="small danger" disabled={busy} onClick={() => cancel(r)}>
                    取り消す{r.ownerPid !== myPid ? '（管理者）' : ''}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {view.kind === 'form' && (
          <ReservationForm
            startAt={view.startAt}
            list={list}
            now={t}
            you={you}
            leftMs={data?.myLeftMs ?? null}
            ensureProfile={ensureProfile}
            onDone={async (r) => {
              setInfo(`予約しました：「${r.title}」（${formatReservationRange(r)}）。合言葉を参加する人に伝えてください`);
              await reload();
              setView({ kind: 'list' });
            }}
            onCancel={() => setView({ kind: 'calendar' })}
          />
        )}
        {view.kind !== 'form' && (
          <p className="muted small">
            空いている枠を押すと予約できます（30 分単位・1 人あわせて {RESERVATION_KEY_TOTAL_MS / 3600000} 時間まで・14 日先まで。時刻は日本時間）。
            予約部屋には合言葉で入ります。予約の時間が終わると、中の人はオープン部屋に戻り、予約部屋のチャットは消えます。
          </p>
        )}
        {info && <p className="ok small">{info}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};

/** カレンダー：PC は 7 日 × 30 分の表、スマホは日を選んでその日の枠 */
const SlotCalendar = ({
  list,
  now,
  today,
  mobile,
  page,
  setPage,
  day,
  setDay,
  myPid,
  onPick,
}: {
  list: ReservationView[];
  now: number;
  today: number;
  mobile: boolean;
  page: number;
  setPage: (n: number) => void;
  day: number;
  setDay: (n: number) => void;
  myPid: string | null;
  onPick: (startAt: number) => void;
}) => {
  const lastDay = Math.floor((now + RESERVATION_AHEAD_MS - today) / DAY);
  const days = mobile ? [today + day * DAY] : Array.from({ length: 7 }, (_, i) => today + (page * 7 + i) * DAY).filter((d) => d <= today + lastDay * DAY);
  const scrollRef = useRef<HTMLDivElement>(null);
  // はじめは今の時刻（今日でなければ 9:00）のあたりを見せる
  const firstRow = useMemo(() => {
    const showsToday = days[0] === today;
    return Math.max(0, (showsToday ? jstParts(now).h : 9) * 2 - 1);
  }, [days[0], today]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = firstRow * ROW_H;
  }, [firstRow]);
  const minStart = slotFloor(now);
  const maxStart = now + RESERVATION_AHEAD_MS;

  return (
    <div className={`res-cal ${mobile ? 'day' : 'week'}`}>
      {mobile ? (
        <div className="res-days">
          {Array.from({ length: lastDay + 1 }, (_, i) => {
            const d = today + i * DAY;
            const n = list.filter((r) => r.endAt > d && r.startAt < d + DAY).length;
            return (
              <button key={i} className={`res-day ${i === day ? 'on' : ''}`} onClick={() => setDay(i)}>
                <span>{i === 0 ? '今日' : i === 1 ? '明日' : jstDate(d)}</span>
                {n > 0 && <span className="res-day-n">{n}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="res-pager">
          <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ 前の 7 日
          </button>
          <span>
            {jstDate(days[0])} 〜 {jstDate(days[days.length - 1])}
          </span>
          <button className="small" disabled={(page + 1) * 7 > lastDay} onClick={() => setPage(page + 1)}>
            次の 7 日 ›
          </button>
        </div>
      )}
      <div className="res-grid-head" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((d) => {
          const p = jstParts(d);
          return (
            <span key={d} className={`res-col-head ${p.dow === 0 ? 'sun' : p.dow === 6 ? 'sat' : ''} ${d === today ? 'today' : ''}`}>
              {jstDate(d)}
            </span>
          );
        })}
      </div>
      <div className="res-grid-scroll" ref={scrollRef}>
        <div className="res-grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, height: 48 * ROW_H }}>
          <div className="res-hours">
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} style={{ height: ROW_H }}>
                {i % 2 === 0 ? `${String(i / 2).padStart(2, '0')}:00` : ''}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="res-col">
              {Array.from({ length: 48 }, (_, i) => {
                const st = d + i * SLOT_MS;
                const taken = list.some((r) => r.startAt < st + SLOT_MS && st < r.endAt);
                const past = st < minStart || st > maxStart;
                if (taken) return <span key={i} className="res-cell taken" style={{ height: ROW_H }} />;
                return (
                  <button
                    key={i}
                    className={`res-cell ${past ? 'past' : 'free'} ${i % 2 ? '' : 'hour'}`}
                    style={{ height: ROW_H }}
                    disabled={past}
                    title={past ? '' : `${jstDate(st)} ${jstTime(st)} から予約する`}
                    aria-label={`${jstDate(st)} ${jstTime(st)}${past ? '（予約できません）' : ' 空き'}`}
                    onClick={() => onPick(st)}
                  >
                    {!past && <span className="res-plus">＋ {jstTime(st)}</span>}
                  </button>
                );
              })}
              {list
                .filter((r) => r.endAt > d && r.startAt < d + DAY)
                .map((r) => {
                  const top = (Math.max(r.startAt, d) - d) / SLOT_MS;
                  const h = (Math.min(r.endAt, d + DAY) - Math.max(r.startAt, d)) / SLOT_MS;
                  const live = r.startAt <= now && now < r.endAt;
                  return (
                    <div
                      key={r.id}
                      className={`res-block ${live ? 'live' : ''} ${myPid && r.ownerPid === myPid ? 'mine' : ''}`}
                      style={{ top: top * ROW_H, height: h * ROW_H - 2 }}
                      title={`${formatReservationRange(r)}「${r.title}」予約：${r.host}`}
                    >
                      <b>{r.title}</b>
                      <span>
                        {jstTime(r.startAt)}〜{jstTime(r.endAt)}　{r.host}
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** 予約の形（部屋名・名前・説明・合言葉・長さ） */
const ReservationForm = ({
  startAt: initialStart,
  list,
  now,
  you,
  leftMs,
  ensureProfile,
  onDone,
  onCancel,
}: {
  startAt: number;
  list: ReservationView[];
  now: number;
  you: Profile | null;
  leftMs: number | null;
  ensureProfile?: () => Promise<Profile>;
  onDone: (r: ReservationView) => void;
  onCancel: () => void;
}) => {
  const [startAt, setStartAt] = useState(initialStart);
  const [title, setTitle] = useState('');
  const [host, setHost] = useState(you?.name ?? '');
  const [description, setDescription] = useState('');
  const [pass, setPass] = useState('');
  const left = leftMs ?? RESERVATION_KEY_TOTAL_MS;
  const maxLen = maxLengthFrom(startAt, list, left, now);
  const [minutes, setMinutes] = useState(Math.min(120, Math.max(30, maxLen / 60000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (minutes * 60000 > maxLen && maxLen >= SLOT_MS) setMinutes(maxLen / 60000);
  }, [maxLen]);
  useEffect(() => {
    if (!host && you?.name) setHost(you.name);
  }, [you?.name]);
  // 同じ日の、選べる開始の時刻（空いている枠）
  const day = jstDayStart(startAt);
  const starts = Array.from({ length: 48 }, (_, i) => day + i * SLOT_MS).filter(
    (st) => st >= slotFloor(now) && st <= now + RESERVATION_AHEAD_MS && maxLengthFrom(st, list, RESERVATION_KEY_TOTAL_MS, now) >= SLOT_MS,
  );
  const lengths = Array.from({ length: maxLen / SLOT_MS }, (_, i) => (i + 1) * 30);
  const passLen = len(pass.trim());
  const ok =
    maxLen >= SLOT_MS &&
    len(title.trim()) >= 1 &&
    len(title.trim()) <= RESERVATION_LIMITS.title &&
    len(host.trim()) >= 1 &&
    len(host.trim()) <= RESERVATION_LIMITS.host &&
    len(description) <= RESERVATION_LIMITS.description &&
    passLen >= RESERVATION_LIMITS.passMin &&
    passLen <= RESERVATION_LIMITS.passMax;

  const submit = async () => {
    if (busy || !ok) return;
    setBusy(true);
    setError(null);
    try {
      if (ensureProfile) await ensureProfile();
      const r = await api<{ reservation: ReservationView }>('POST', '/api/reservations', {
        startAt,
        minutes,
        title,
        host,
        description,
        passphrase: pass,
      });
      onDone(r.reservation);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  return (
    <form
      className="res-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>予約する</h3>
      <div className="res-left">
        あなたが予約できる残り：<b>{formatDuration(left)}</b>
        <span className="muted small">（1 人あわせて {RESERVATION_KEY_TOTAL_MS / 3600000} 時間まで。これからの予約と、使っている最中の予約の合計）</span>
      </div>
      <div className="res-form-row">
        <label className="field">
          <span>開始（{jstDate(startAt)}・日本時間）</span>
          <select value={startAt} onChange={(e) => setStartAt(Number(e.target.value))}>
            {!starts.includes(startAt) && <option value={startAt}>{jstTime(startAt)}</option>}
            {starts.map((st) => (
              <option key={st} value={st}>
                {jstTime(st)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>長さ</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!lengths.length}>
            {lengths.map((m) => (
              <option key={m} value={m}>
                {formatDuration(m * 60000)}（〜{jstTime(startAt + m * 60000)}）
              </option>
            ))}
          </select>
        </label>
      </div>
      {maxLen < SLOT_MS && (
        <p className="error small">{left < SLOT_MS ? '予約できる時間が残っていません（前の予約を取り消すか、終わるのを待ってください）' : 'この時刻は空いていません'}</p>
      )}
      <label className="field">
        <span>部屋名（{RESERVATION_LIMITS.title} 文字まで。予約表と予約部屋の中に出ます）</span>
        <input value={title} maxLength={RESERVATION_LIMITS.title * 2} onChange={(e) => setTitle(e.target.value)} onKeyDown={stop} placeholder="例：格闘ゲーム交流会" />
      </label>
      <label className="field">
        <span>予約する人の名前（{RESERVATION_LIMITS.host} 文字まで）</span>
        <input value={host} maxLength={RESERVATION_LIMITS.host * 2} onChange={(e) => setHost(e.target.value)} onKeyDown={stop} />
      </label>
      <label className="field">
        <span>説明（任意・{RESERVATION_LIMITS.description} 文字まで）</span>
        <input value={description} maxLength={RESERVATION_LIMITS.description * 2} onChange={(e) => setDescription(e.target.value)} onKeyDown={stop} />
      </label>
      <label className="field">
        <span>
          合言葉（{RESERVATION_LIMITS.passMin}〜{RESERVATION_LIMITS.passMax} 文字。参加する人に伝えてください。サーバには元に戻せない形でしか残りません）
        </span>
        <input value={pass} maxLength={RESERVATION_LIMITS.passMax * 2} autoComplete="off" onChange={(e) => setPass(e.target.value)} onKeyDown={stop} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="cab-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          もどる
        </button>
        <button className="primary" disabled={busy || !ok}>
          予約する
        </button>
      </div>
    </form>
  );
};

/**
 * 予約部屋に入る窓（扉・予約表・入店の画面から）。合言葉を入れる／予約した人・管理者はそのまま入れる／閉まっていれば「次は ○○」。
 * 予約部屋の中で扉を押したときは「オープン部屋へ戻る」。
 */
export const RoomDoorDialog = ({
  you,
  inReserved,
  liveKey,
  onClose,
  onEntered,
  onSchedule,
  ensureProfile,
}: {
  you: Profile | null;
  inReserved: boolean;
  liveKey?: unknown;
  onClose: () => void;
  /** 入れた（moved = 店内にいてその場で移った） */
  onEntered: (moved: boolean) => void;
  onSchedule: () => void;
  ensureProfile?: () => Promise<Profile>;
}) => {
  const { data, now } = useReservations(liveKey);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = now();
  const list = data?.reservations ?? [];
  const active = activeReservation(list, t);
  const free = !!active && !!you && (active.ownerPid === you.pid || you.admin);

  const go = async (room: 'open' | 'reserved') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (ensureProfile) await ensureProfile();
      const r = await api<{ moved: boolean }>('POST', `/api/rooms/${room}/enter`, room === 'reserved' ? { passphrase: pass } : {});
      onEntered(r.moved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal door-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{inReserved ? '🚪 オープン部屋へ' : '🔑 予約部屋'}</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {inReserved ? (
          <>
            <p>オープン部屋（いつものお店）へ戻りますか？{active ? `予約の時間（〜${jstTime(active.endAt)}）の間なら、また入れます。` : ''}</p>
            <div className="cab-actions">
              <button className="ghost" onClick={onClose}>
                やめる
              </button>
              <button className="primary" disabled={busy} onClick={() => go('open')}>
                オープン部屋へ戻る
              </button>
            </div>
          </>
        ) : !data ? (
          <p className="muted">読み込み中…</p>
        ) : !active ? (
          <>
            <div className="door-closed">
              <div className="door-closed-mark">🔒</div>
              <p className="door-closed-text">{closedRoomText(list, t)}</p>
            </div>
            <div className="cab-actions">
              <button onClick={onSchedule}>📅 予約表を見る・予約する</button>
              <button className="ghost" onClick={onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go('reserved');
            }}
          >
            <div className="res-item live">
              <ResLine r={active} active mine={!!you && active.ownerPid === you.pid} />
            </div>
            {free ? (
              <p className="ok small">{active.ownerPid === you?.pid ? 'あなたの予約です。合言葉なしで入れます。' : '管理者は合言葉なしで入れます。'}</p>
            ) : (
              <label className="field">
                <span>合言葉（予約した人から聞いたもの）</span>
                <input
                  value={pass}
                  autoFocus
                  autoComplete="off"
                  maxLength={RESERVATION_LIMITS.passMax * 2}
                  onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <div className="cab-actions">
              <button type="button" className="ghost" onClick={onSchedule}>
                📅 予約表
              </button>
              <button className="primary" disabled={busy || (!free && !pass.trim())}>
                予約部屋に入る
              </button>
            </div>
            <p className="muted small">何度も間違えると、しばらく入力できなくなります。予約の時間が終わると、オープン部屋に戻ります。</p>
          </form>
        )}
      </div>
    </div>
  );
};
