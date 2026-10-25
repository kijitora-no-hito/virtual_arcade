import {
  bgmCredit,
  BODY_COLORS,
  checkName,
  DEFAULT_LOOK,
  HEADWEAR,
  NAME_MAX,
  SYNTH_CREDIT,
  type Look,
  type MetaResponse,
  type Profile,
  type RoomId,
} from '@va/shared';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../api';
import { bgm } from '../audio/bgm';
import { drawCharacter } from '../game/character';
import { ReservationDialog, RoomDoorDialog } from './ReservationDialog';

/** キャラクターの見本（大きく描く） */
export const CharPreview = ({ look, size = 160 }: { look: Look; size?: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const loop = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawCharacter(ctx, size / 2, size * 0.86, size / 72, look, { dir: 1, walk: null, sitting: false, me: false, t });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [look, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="char-preview" />;
};

export const EntryPage = ({
  meta,
  initial,
  message,
  onEnter,
  onCancel,
  asDialog,
  mobile = false,
  onEnsure,
}: {
  meta: MetaResponse | null;
  initial: Profile | null;
  message?: string;
  onEnter: (name: string, look: Look, room?: RoomId) => Promise<void>;
  /** v0.5.0：予約する・予約部屋に入る前に、名前と見た目を決める（入店の画面だけ） */
  onEnsure?: (name: string, look: Look) => Promise<Profile>;
  onCancel?: () => void;
  asDialog?: boolean;
  /** スマホのレイアウト（BGM の操作の場所の案内だけ変える） */
  mobile?: boolean;
}) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [look, setLook] = useState<Look>(initial?.look ?? DEFAULT_LOOK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const len = [...name.trim()].length;
  // v0.5.0：入店の画面から予約表・予約部屋（DESIGN §14.3）
  const [roomDialog, setRoomDialog] = useState<'schedule' | 'door' | null>(null);
  const [me, setMe] = useState<Profile | null>(initial);
  const ensureProfile = async (): Promise<Profile> => {
    // 押した操作の中で BGM を鳴らせるようにする（予約部屋にそのまま入るとき）
    bgm.unlock();
    const c = checkName(name);
    if (!c.name) throw new Error(`先に名前を入れてください（${c.error ?? '1〜20 文字'}）`);
    const p = await onEnsure!(c.name, look);
    setMe(p);
    return p;
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onEnter(name.trim(), look);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form
      className="entry-card"
      onSubmit={(e) => {
        e.preventDefault();
        // 入店のボタンを押した操作の中で BGM を鳴らせるようにする（ブラウザの自動再生の制限）。鳴るのは店内に入ってから
        bgm.unlock();
        submit();
      }}
    >
      {!asDialog && (
        <div className="entry-title">
          <div className="neon-title">VIRTUAL ARCADE</div>
          <div className="neon-sub">バーチャルゲームセンター</div>
        </div>
      )}
      {asDialog && <h2>名前と見た目を変える</h2>}
      {message && <p className="error">{message}</p>}
      <div className="entry-body">
        <div className="entry-preview">
          <CharPreview look={look} />
          <div className="entry-preview-name">{name.trim() || '（名前）'}</div>
        </div>
        <div className="entry-fields">
          <label className="field">
            <span>名前（{NAME_MAX} 文字まで）</span>
            <input value={name} maxLength={NAME_MAX * 2} autoFocus onChange={(e) => setName(e.target.value)} placeholder="店内で表示される名前" />
          </label>
          <div className="field">
            <span>体の色</span>
            <div className="swatches">
              {BODY_COLORS.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  title={c.label}
                  aria-label={c.label}
                  className={`swatch ${look.color === c.id ? 'on' : ''}`}
                  style={{ background: c.color }}
                  onClick={() => setLook({ ...look, color: c.id })}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <span>帽子・髪</span>
            <div className="chips">
              {HEADWEAR.map((h) => (
                <button type="button" key={h.id} className={`chip ${look.hat === h.id ? 'on' : ''}`} onClick={() => setLook({ ...look, hat: h.id })}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="entry-actions">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            やめる
          </button>
        )}
        <button className="primary big" disabled={busy || len < 1 || len > NAME_MAX}>
          {asDialog ? '変える' : '入店する'}
        </button>
      </div>
      {!asDialog && onEnsure && (
        <div className="entry-rooms">
          <div className="entry-rooms-head">
            <b>🔑 予約部屋</b>
            <span className="muted small">予約した時間だけ合言葉で入れる、もう 1 つの部屋です</span>
          </div>
          <div className="entry-rooms-actions">
            <button type="button" onClick={() => setRoomDialog('schedule')}>
              📅 予約表・予約する
            </button>
            <button type="button" onClick={() => setRoomDialog('door')}>
              🔑 予約部屋に入る（合言葉）
            </button>
          </div>
        </div>
      )}
      {!asDialog && (
        <p className="muted small">
          {meta ? `いま店内に ${meta.online} 人（${meta.maxPlayers} 人まで）。` : ''}
          アカウント登録はありません。このブラウザに保存した鍵で同じ人として戻れます（別のブラウザ・端末では別の人になります）。
          店内では BGM が流れます（{mobile ? '右上のメニュー ☰' : '下のバー'}で音量・消音・曲を変えられます）。
        </p>
      )}
      {!asDialog && meta && (
        <p className="entry-credit">
          店内の BGM：
          {[...new Set((meta.bgm?.files ?? []).map((f) => bgmCredit(f)).filter((c): c is string => !!c))].map((c) => (
            <span key={c}>{c}　</span>
          ))}
          {(meta.bgm?.synth ?? true) && <span>合成の曲 {SYNTH_CREDIT}</span>}
        </p>
      )}
      {!asDialog && meta && <p className="entry-version">v{meta.version}</p>}
    </form>
  );
  if (asDialog) return form;
  return (
    <div className="entry-page">
      {form}
      {roomDialog === 'schedule' && (
        <ReservationDialog
          you={me}
          mobile={mobile}
          onClose={() => setRoomDialog(null)}
          onEnterRoom={() => setRoomDialog('door')}
          ensureProfile={ensureProfile}
        />
      )}
      {roomDialog === 'door' && (
        <RoomDoorDialog
          you={me}
          inReserved={false}
          onClose={() => setRoomDialog(null)}
          onSchedule={() => setRoomDialog('schedule')}
          ensureProfile={ensureProfile}
          onEntered={() => {
            setRoomDialog(null);
            void onEnter(name.trim(), look, 'reserved').catch((e) => setError(errorText(e)));
          }}
        />
      )}
    </div>
  );
};
