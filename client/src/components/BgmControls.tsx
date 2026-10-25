import { SYNTH_CREDIT } from '@va/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bgm, type BgmItem } from '../audio/bgm';

/** 一覧の見出し（ファイルの曲は作者ごと、合成の曲はまとめて） */
const groupOf = (it: BgmItem): string =>
  it.kind === 'synth' ? 'オリジナル（ブラウザで合成。選んだ曲をくり返す）' : `${it.credit.replace(/（.*$/, '')}${it.rotate ? '（順番に流れます）' : ''}`;

/** 下のバーの BGM の操作：［🔈/🔇］・音量・曲名とクレジット（クリックで一覧）・［次の曲］。鳴らせるようになるまでは「🔇 クリックで BGM」 */
export const BgmControls = ({ touch = false }: { touch?: boolean }) => {
  const s = useSyncExternalStore(bgm.subscribe, bgm.getState);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 一覧の外をクリック・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!s.unlocked)
    return (
      <div className="bgm">
        <button className="bgm-unlock" onClick={() => bgm.unlock()} title="ブラウザの決まりで、最初のクリックかキー入力から BGM が鳴ります">
          {touch ? '🔇 タップで BGM' : '🔇 クリックで BGM'}
        </button>
      </div>
    );
  const off = s.muted || s.volume === 0;
  const groups: Array<{ name: string; rows: Array<{ it: BgmItem; i: number }> }> = [];
  s.items.forEach((it, i) => {
    const name = groupOf(it);
    const g = groups[groups.length - 1];
    if (g && g.name === name) g.rows.push({ it, i });
    else groups.push({ name, rows: [{ it, i }] });
  });
  const credits = [...new Set(s.items.filter((it) => it.kind === 'file').map((it) => it.credit))];

  return (
    <div className="bgm" ref={boxRef}>
      <button className="bgm-mute" onClick={() => bgm.toggleMute()} title={off ? 'BGM を鳴らす' : 'BGM を消す'} aria-label={off ? 'BGM を鳴らす' : 'BGM を消す'}>
        {off ? '🔇' : '🔈'}
      </button>
      <input
        className="bgm-volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={s.muted ? 0 : s.volume}
        onChange={(e) => bgm.setVolume(Number(e.target.value))}
        title={`BGM の音量 ${s.muted ? 0 : s.volume}%`}
        aria-label="BGM の音量"
      />
      <button className={`bgm-info ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="曲を選ぶ" aria-haspopup="listbox" aria-expanded={open}>
        <span className="bgm-title">
          <span className="bgm-note">♪</span>
          {s.item?.title ?? '—'}
          {s.loading && <span className="muted small">（読み込み中…）</span>}
          {s.ducked && <span className="muted small">（動画の再生中は停止）</span>}
          <span className="bgm-caret">▴</span>
        </span>
        <span className="bgm-credit">{s.item?.credit ?? ''}</span>
      </button>
      <button className="bgm-next" onClick={() => bgm.next()} disabled={s.items.length < 2} title="次の曲">
        次の曲 ⏭
      </button>
      {open && (
        <div className="bgm-list" role="listbox" aria-label="BGM の曲">
          {groups.map((g) => (
            <div key={g.name} className="bgm-group">
              <div className="bgm-group-name">{g.name}</div>
              {g.rows.map(({ it, i }) => (
                <button
                  key={it.key}
                  role="option"
                  aria-selected={i === s.index}
                  className={`bgm-row ${i === s.index ? 'on' : ''}`}
                  onClick={() => {
                    bgm.select(i);
                    setOpen(false);
                  }}
                >
                  <span className="bgm-row-mark">{i === s.index ? '▶' : ''}</span>
                  <span className="bgm-row-title">{it.title}</span>
                  {it.mood && <span className="bgm-row-mood">{it.mood}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="bgm-list-foot">
            {credits.map((c) => (
              <div key={c}>{c}</div>
            ))}
            <div>合成の曲：{SYNTH_CREDIT}</div>
          </div>
        </div>
      )}
    </div>
  );
};
