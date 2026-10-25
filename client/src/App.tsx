import type { Look, MeResponse, MetaResponse, Profile, RoomId } from '@va/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText, session } from './api';
import { ArcadePage } from './components/ArcadePage';
import { EntryPage } from './components/EntryPage';
import { useLayout } from './layout';

type Phase = { kind: 'loading' } | { kind: 'entry'; message?: string } | { kind: 'arcade' };

export const App = () => {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  /** v0.5.0：入る部屋（入店の画面で予約部屋の合言葉を入れたら reserved） */
  const [room, setRoom] = useState<RoomId>('open');
  // PC / スマホのレイアウト（<html> の class も付け替える。DESIGN §11.1）
  const layout = useLayout();

  useEffect(() => {
    (async () => {
      try {
        const [m, me] = await Promise.all([api<MetaResponse>('GET', '/api/meta'), api<MeResponse>('GET', '/api/me')]);
        setMeta(m);
        if (me.bannedUntil) {
          setPhase({ kind: 'entry', message: `管理者により入室が止められています（${new Date(me.bannedUntil).toLocaleString('ja-JP')} まで）` });
          setProfile(me.profile);
          return;
        }
        // 同じブラウザなら同じ人として戻る（入れなかったときも名前と見た目は入力欄に残す）
        if (me.profile) setProfile(me.profile);
        // v0.5.0：このタブで店内にいた（再読み込み）ときだけ自動で入り直す（その部屋へ）。
        // 新しく開いたときは入店の画面（オープン部屋か、予約部屋の合言葉かを選べるように。名前と見た目は入っている）
        const saved = session.get('va:room');
        if (me.profile && (saved === 'open' || saved === 'reserved')) {
          const r = await api<{ profile: Profile }>('POST', '/api/enter', { name: me.profile.name, look: me.profile.look });
          setProfile(r.profile);
          setRoom(saved);
          setPhase({ kind: 'arcade' });
        } else setPhase({ kind: 'entry' });
      } catch (e) {
        setPhase({ kind: 'entry', message: errorText(e) });
      }
    })();
  }, []);

  const onLeft = useCallback(() => {
    session.set('va:room', null);
    setPhase({ kind: 'entry', message: '退店しました。またのご来店をお待ちしています' });
  }, []);

  /** 名前と見た目を決める（入店の画面から予約する・予約部屋に入る前にも） */
  const ensure = async (name: string, look: Look) => {
    const r = await api<{ profile: Profile }>('POST', '/api/enter', { name, look });
    setProfile(r.profile);
    return r.profile;
  };
  const enter = async (name: string, look: Look, to: RoomId = 'open') => {
    const r = await api<{ profile: Profile }>('POST', '/api/enter', { name, look });
    setProfile(r.profile);
    setEditing(false);
    // 見た目を変えただけ（店内から）なら部屋はそのまま
    if (phase.kind !== 'arcade') {
      setRoom(to);
      session.set('va:room', to);
    }
    setPhase({ kind: 'arcade' });
  };

  if (phase.kind === 'loading') return <div className="loading">読み込み中…</div>;
  if (phase.kind === 'entry')
    return <EntryPage meta={meta} initial={profile} message={phase.message} onEnter={enter} onEnsure={ensure} mobile={layout.mobile} />;
  return (
    <>
      <ArcadePage
        meta={meta}
        layout={layout}
        initialRoom={room}
        onNeedEntry={(message) => {
          session.set('va:room', null);
          setPhase({ kind: 'entry', message });
        }}
        onEditProfile={() => setEditing(true)}
        onLeft={onLeft}
      />
      {editing && (
        <div className="modal-back" onClick={() => setEditing(false)}>
          <div className="modal entry-modal" onClick={(e) => e.stopPropagation()}>
            <EntryPage meta={meta} initial={profile} onEnter={enter} onCancel={() => setEditing(false)} asDialog />
          </div>
        </div>
      )}
    </>
  );
};
