// コインの預かり（v0.7.0 の途中のユーザー指定「コインは残せる方にしましょう。預け入れを選ぶとアルファベット4文字のキーが発行されます。」。DESIGN §17.7）。
// 手元のコインはメモリだけ（退店で消える）。残したい人は預けてキーをもらい、あとでキーを入れて引き出す（1 回だけ）。

import { BANK_CODE_LEN, type SlotDepositResponse, type SlotWithdrawResponse } from '@va/shared';
import { useState } from 'react';
import { api, errorText } from '../api';
import { bgm } from '../audio/bgm';
import type { ArcadeClient } from '../game/client';

/** 手元のコインを画面の上のバーにもすぐ反映する（サーバからも you が届く） */
const setYouCoins = (client: ArcadeClient, coins: number) => {
  if (client.you && client.you.coins !== coins) {
    client.you = { ...client.you, coins };
    client.notify();
  }
};

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/** 発行されたキー（大きく・コピーのボタン・メモの注意） */
export const BankCode = ({ code, deposited, expiresAt }: { code: string; deposited: number; expiresAt: number }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="bank-code" role="status">
      <div className="small">🪙 {deposited.toLocaleString('en-US')} 枚を預けました。引き出すときのキー：</div>
      <div className="bank-code-row">
        <b className="bank-code-text" data-code={code}>
          {code}
        </b>
        <button className="small" onClick={() => void copy()}>
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <div className="bank-code-warn">このキーをメモしてください。なくすと引き出せません（1 回だけ使えます・{fmtDate(expiresAt)} まで）。</div>
    </div>
  );
};

/** 預ける・引き出す（スロットの窓・スマホのメニューから開く窓） */
export const CoinBank = ({ client, coins, busy, onCoins }: { client: ArcadeClient; coins: number; busy?: boolean; onCoins?: (n: number) => void }) => {
  const [issued, setIssued] = useState<SlotDepositResponse | null>(null);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [working, setWorking] = useState(false);

  const deposit = async () => {
    if (!window.confirm(`手元のコイン ${coins.toLocaleString('en-US')} 枚を全部預けます。よろしいですか？`)) return;
    setWorking(true);
    try {
      const r = await api<SlotDepositResponse>('POST', '/api/slot/deposit');
      setIssued(r);
      setYouCoins(client, r.coins);
      onCoins?.(r.coins);
      setMsg(null);
      bgm.playSfx('coin');
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setWorking(false);
    }
  };
  const withdraw = async () => {
    setWorking(true);
    try {
      const r = await api<SlotWithdrawResponse>('POST', '/api/slot/withdraw', { code: input });
      setYouCoins(client, r.coins);
      onCoins?.(r.coins);
      setInput('');
      setMsg({ text: `🪙 ${r.withdrawn.toLocaleString('en-US')} 枚を引き出しました（このキーはもう使えません）`, error: false });
      bgm.playSfx('coin');
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="coin-bank" aria-label="コインの預かり">
      <h3>コインを預ける・引き出す</h3>
      <p className="muted small">手元のコインは退店すると消えます。預けるとアルファベット {BANK_CODE_LEN} 文字のキーが出ます（180 日まで）。</p>
      <div className="bank-row">
        <button className="small" disabled={working || busy || coins <= 0} onClick={() => void deposit()} title="手元のコインを全部預けて、キーをもらう">
          🏦 コインを預ける（{coins.toLocaleString('en-US')} 枚）
        </button>
      </div>
      {issued && <BankCode code={issued.code} deposited={issued.deposited} expiresAt={issued.expiresAt} />}
      <form
        className="bank-row"
        onSubmit={(e) => {
          e.preventDefault();
          void withdraw();
        }}
      >
        <input
          className="bank-input"
          value={input}
          maxLength={8}
          placeholder="キー 4 文字"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="引き出すキー（アルファベット 4 文字）"
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="small" type="submit" disabled={working || input.trim().length < BANK_CODE_LEN}>
          コインを引き出す
        </button>
      </form>
      {msg && <div className={`small bank-msg ${msg.error ? 'error' : ''}`}>{msg.text}</div>}
    </section>
  );
};

/** スマホのメニューから開く窓 */
export const CoinBankDialog = ({ client, onClose }: { client: ArcadeClient; onClose: () => void }) => (
  <div className="modal-back" onClick={onClose}>
    <div className="modal bank-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <h2>🪙 コイン（手元 {(client.you?.coins ?? 0).toLocaleString('en-US')} 枚）</h2>
        <button className="ghost" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <CoinBank client={client} coins={client.you?.coins ?? 0} />
    </div>
  </div>
);

/** 退店の確認（手元にコインがあるとき）：［預けてから退店］［そのまま退店］ */
export const LeaveDialog = ({ client, onLeave, onClose }: { client: ArcadeClient; onLeave: () => void; onClose: () => void }) => {
  const coins = client.you?.coins ?? 0;
  const badges = client.you?.badges ?? '';
  const [issued, setIssued] = useState<SlotDepositResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const depositThenLeave = async () => {
    setWorking(true);
    try {
      const r = await api<SlotDepositResponse>('POST', '/api/slot/deposit');
      setIssued(r);
      setYouCoins(client, 0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="modal-back" onClick={issued ? undefined : onClose}>
      <div className="modal bank-modal leave-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>退店しますか？</h2>
          {!issued && (
            <button className="ghost" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          )}
        </div>
        {issued ? (
          <>
            <BankCode code={issued.code} deposited={issued.deposited} expiresAt={issued.expiresAt} />
            <div className="row-gap leave-actions">
              <button className="primary" onClick={onLeave}>
                メモしたので退店する
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              コインが <b>{coins.toLocaleString('en-US')} 枚</b>あります。退店すると消えます。
              {badges && <span className="muted">（クレーンゲームのバッジ {badges} も消えます）</span>}
            </p>
            {error && <p className="error small">{error}</p>}
            <div className="row-gap leave-actions">
              <button className="primary" disabled={working} onClick={() => void depositThenLeave()}>
                🏦 預けてから退店
              </button>
              <button disabled={working} onClick={onLeave}>
                そのまま退店
              </button>
              <button className="ghost" onClick={onClose}>
                やめる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
