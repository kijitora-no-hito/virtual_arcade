import { formatScore, GAMES, gameInfo, jstDate, type RankingEntry, type RankingResponse } from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

/**
 * ランキングの窓（v0.6.0。DESIGN §16.4・§16.8）：ゲームのタブ（2048 / Columns like game）× 総合・今月（日本時間の月）。
 * 上位 50 人と自分の順位。鍵ごとのいちばん良い記録で 1 人 1 行。サイトの管理者は 1 行ずつ消せる（不適切な名前など）
 */
export const RankingDialog = ({
  game: initialGame,
  admin,
  seq,
  onClose,
}: {
  /** 開いたときのゲームのタブ */
  game: string;
  /** サイトの管理者（行ごとに［消す］） */
  admin: boolean;
  /** ランキングが変わった合図（client.rankingSeq。変わったら読み直す） */
  seq: number;
  onClose: () => void;
}) => {
  const [game, setGame] = useState(initialGame);
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const title = gameInfo(game)?.title ?? game;
  const columns = game === 'columns';

  useEffect(() => {
    let alive = true;
    setData(null);
    api<RankingResponse>('GET', `/api/games/${game}/ranking?period=${period}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError(null);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [game, period, seq, reload]);

  const remove = async (e: RankingEntry) => {
    if (!window.confirm(`${e.name} さんの ${title} の記録（${formatScore(e.score)} 点）を消しますか？（元に戻せません。その人の次に良い記録が順位に出ます）`)) return;
    try {
      await api('DELETE', `/api/admin/games/${game}/scores/${e.id}`);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const me = data?.me ?? null;
  // 2048 は「最大」（いちばん大きいタイル）、Columns like game は「開始 Lv」と「ジュエル」
  const cols = columns ? 7 : 6;
  const row = (e: RankingEntry, mine: boolean) => (
    <tr key={`${mine ? 'me' : 'r'}-${e.id}`} className={`${mine ? 'rank-mine' : ''} ${e.rank <= 3 ? `rank-top rank-${e.rank}` : ''}`}>
      <td className="rank-no">{e.rank}</td>
      <td className="rank-name">{e.name}</td>
      <td className="rank-score">{formatScore(e.score)}</td>
      {columns ? (
        <>
          <td className="rank-tile" title={e.detail?.level ? `終わりのレベル ${e.detail.level}` : undefined}>
            {e.detail?.startLevel ?? '―'}
          </td>
          <td className="rank-tile rank-jewels">{e.detail?.jewels !== undefined ? formatScore(e.detail.jewels) : '―'}</td>
        </>
      ) : (
        <td className="rank-tile">{e.maxTile}</td>
      )}
      <td className="rank-at muted">{jstDate(e.at)}</td>
      {admin && (
        <td className="rank-del">
          <button className="small danger" onClick={() => void remove(e)} title="この記録を消す">
            消す
          </button>
        </td>
      )}
    </tr>
  );

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal ranking-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🏆 ランキング</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="tabs rank-games" role="tablist" aria-label="ゲーム">
          {GAMES.map((g) => (
            <button key={g.id} role="tab" aria-selected={g.id === game} className={`tab ${g.id === game ? 'on' : ''}`} onClick={() => setGame(g.id)}>
              {g.title}
            </button>
          ))}
        </div>
        <div className="tabs rank-periods" role="tablist" aria-label="期間">
          <button role="tab" aria-selected={period === 'all'} className={`tab ${period === 'all' ? 'on' : ''}`} onClick={() => setPeriod('all')}>
            総合
          </button>
          <button role="tab" aria-selected={period === 'month'} className={`tab ${period === 'month' ? 'on' : ''}`} onClick={() => setPeriod('month')}>
            今月
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="muted small rank-me">
          {data
            ? me
              ? `あなた：${me.rank} 位　${formatScore(me.score)} 点（${data.total} 人中）`
              : `あなた：${period === 'month' ? '今月の' : ''}記録はまだありません（${data.total} 人が記録）`
            : '読み込み中…'}
        </p>
        <div className="rank-scroll">
          <table className="rank-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>名前</th>
                <th>点数</th>
                {columns ? (
                  <>
                    <th title="開始レベル">開始Lv</th>
                    <th className="rank-jewels">ジュエル</th>
                  </>
                ) : (
                  <th>最大</th>
                )}
                <th className="rank-at">日付</th>
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((e) => row(e, !!me && me.id === e.id))}
              {me && !data?.entries.some((e) => e.id === me.id) && (
                <>
                  <tr className="rank-gap">
                    <td colSpan={admin ? cols : cols - 1}>…</td>
                  </tr>
                  {row(me, true)}
                </>
              )}
              {data && !data.entries.length && (
                <tr>
                  <td colSpan={admin ? cols : cols - 1} className="muted rank-empty">
                    まだ記録がありません。最初の記録を作りましょう！
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small rank-note">
          {title}：1 人 1 行（いちばん良い記録）。同じ点数は先に出した人が上。名前は記録したときのもの。「今月」は日本時間の月ごと。
          {columns && ' Standard・Colors 5・Height 0 の記録だけ（開始レベルは自由）。'}
        </p>
      </div>
    </div>
  );
};
