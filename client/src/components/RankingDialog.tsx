import { formatScore, gameInfo, jstDate, type RankingEntry, type RankingResponse } from '@va/shared';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

/**
 * ランキングの窓（v0.6.0。DESIGN §16.4）：総合・今月（日本時間の月）。上位 50 人と自分の順位。
 * 鍵ごとのいちばん良い記録で 1 人 1 行。サイトの管理者は 1 行ずつ消せる（不適切な名前など）
 */
export const RankingDialog = ({
  game,
  admin,
  seq,
  onClose,
}: {
  game: string;
  /** サイトの管理者（行ごとに［消す］） */
  admin: boolean;
  /** ランキングが変わった合図（client.rankingSeq。変わったら読み直す） */
  seq: number;
  onClose: () => void;
}) => {
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const title = gameInfo(game)?.title ?? game;

  useEffect(() => {
    let alive = true;
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
    if (!window.confirm(`${e.name} さんの記録（${formatScore(e.score)} 点）を消しますか？（元に戻せません。その人の次に良い記録が順位に出ます）`)) return;
    try {
      await api('DELETE', `/api/admin/games/${game}/scores/${e.id}`);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const me = data?.me ?? null;
  const row = (e: RankingEntry, mine: boolean) => (
    <tr key={`${mine ? 'me' : 'r'}-${e.id}`} className={`${mine ? 'rank-mine' : ''} ${e.rank <= 3 ? `rank-top rank-${e.rank}` : ''}`}>
      <td className="rank-no">{e.rank}</td>
      <td className="rank-name">{e.name}</td>
      <td className="rank-score">{formatScore(e.score)}</td>
      <td className="rank-tile">{e.maxTile}</td>
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
          <h2>🏆 {title} ランキング</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="tabs">
          <button className={`tab ${period === 'all' ? 'on' : ''}`} onClick={() => setPeriod('all')}>
            総合
          </button>
          <button className={`tab ${period === 'month' ? 'on' : ''}`} onClick={() => setPeriod('month')}>
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
                <th>最大</th>
                <th>日付</th>
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((e) => row(e, !!me && me.id === e.id))}
              {me && !data?.entries.some((e) => e.id === me.id) && (
                <>
                  <tr className="rank-gap">
                    <td colSpan={admin ? 6 : 5}>…</td>
                  </tr>
                  {row(me, true)}
                </>
              )}
              {data && !data.entries.length && (
                <tr>
                  <td colSpan={admin ? 6 : 5} className="muted rank-empty">
                    まだ記録がありません。最初の記録を作りましょう！
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small rank-note">
          1 人 1 行（いちばん良い記録）。同じ点数は先に出した人が上。名前は記録したときのもの。「今月」は日本時間の月ごと。
        </p>
      </div>
    </div>
  );
};
