import type { Look, MeResponse, MetaResponse, Profile } from '@va/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api';
import { ArcadePage } from './components/ArcadePage';
import { EntryPage } from './components/EntryPage';
import { useLayout } from './layout';

type Phase = { kind: 'loading' } | { kind: 'entry'; message?: string } | { kind: 'arcade' };

export const App = () => {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
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
        if (me.profile) {
          // 同じブラウザなら同じ人として戻る（入れなかったときも名前と見た目は入力欄に残す）
          setProfile(me.profile);
          const r = await api<{ profile: Profile }>('POST', '/api/enter', { name: me.profile.name, look: me.profile.look });
          setProfile(r.profile);
          setPhase({ kind: 'arcade' });
        } else setPhase({ kind: 'entry' });
      } catch (e) {
        setPhase({ kind: 'entry', message: errorText(e) });
      }
    })();
  }, []);

  const onLeft = useCallback(() => setPhase({ kind: 'entry', message: '退店しました。またのご来店をお待ちしています' }), []);

  const enter = async (name: string, look: Look) => {
    const r = await api<{ profile: Profile }>('POST', '/api/enter', { name, look });
    setProfile(r.profile);
    setEditing(false);
    setPhase({ kind: 'arcade' });
  };

  if (phase.kind === 'loading') return <div className="loading">読み込み中…</div>;
  if (phase.kind === 'entry')
    return <EntryPage meta={meta} initial={profile} message={phase.message} onEnter={enter} mobile={layout.mobile} />;
  return (
    <>
      <ArcadePage
        meta={meta}
        layout={layout}
        onNeedEntry={(message) => setPhase({ kind: 'entry', message })}
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
