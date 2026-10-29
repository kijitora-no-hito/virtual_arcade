// Hextris の記録の確かめ方（v0.6.0。DESIGN §16.9）。このファイルはバーチャルゲームセンターのために書いたもの（MIT）で、
// Hextris（GPLv3）のコードは写していない。Hextris は時間（フレームの間隔）と回転の入力で動くので、2048・Columns like game のように
// サーバが盤をなぞり直すことはしない（記録はブラウザの申告）。代わりに、点の入り方の決まりに合っているかと、速すぎないかだけを見る。
//
// 点の入り方（元のゲームの決まり）：同じ色のブロックが k 個（3 個以上）つながると消え、k × k × m 点（m = コンボの倍率）。
// m は前に消してからコンボの残り時間のうちに消せば 1 つ上がり、間に合わなければ 1 に戻る（ゲームの最初の消去は 1）。

/** 1 回のゲームで消せる回数の上限（1 時間遊んでもおよそ 6,000 回。記録の大きさを抑える） */
export const HEXTRIS_MAX_CLEARS = 20_000;
/** 1 回に消える数の上限（6 本の列 × はみ出す手前の段 + 1。スマホは 7 段・PC は 8 段なので 6 × 9 = 54 に余裕） */
export const HEXTRIS_MAX_GROUP = 60;
/**
 * 点数の増える速さの上限（点 / 秒。始めてからの実際の時間で割る）。DESIGN §16.9 の根拠：
 * ブロックは出てくる間隔の下限 600 ms で、いちばん多く出る形（6 個の輪・3 個の半円）でも 1 秒に約 5.5 個（スマホは時計が 16.67/14 倍速く約 6.5 個）。
 * 上手な人が出てきた分を全部 4 個ずつ・平均の倍率 2 で消すと 6.5 × 4 × 2 ≒ 52 点 / 秒。その 3 倍ほど
 */
export const HEXTRIS_SCORE_PER_SEC = 150;
/** 消したブロックの数の上限（個 / 秒）：↓ を押し続けると時計が 4 倍になるので 6.5 × 4 = 26 に余裕を見て 30 */
export const HEXTRIS_BLOCKS_PER_SEC = 30;

export type HextrisCheck =
  | { ok: true; score: number; clears: number; blocks: number; maxCombo: number }
  | { ok: false; code: 'bad-moves' | 'too-fast' };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * finish の中身を確かめる。score = ブラウザの言う点数、clears = [[k, m], …]（消した順）、elapsedMs = start からの実際の時間。
 * 合わなければ bad-moves、速すぎれば too-fast。点数はブラウザの言う値（消した記録の合計と一致したときだけ受け付ける）
 */
export const checkHextris = (score: unknown, clears: unknown, elapsedMs: number): HextrisCheck => {
  if (!isInt(score) || score < 0 || !Array.isArray(clears) || clears.length > HEXTRIS_MAX_CLEARS) return { ok: false, code: 'bad-moves' };
  let sum = 0;
  let blocks = 0;
  let prev = 0;
  let maxCombo = 0;
  for (const c of clears) {
    if (!Array.isArray(c) || c.length !== 2) return { ok: false, code: 'bad-moves' };
    const [k, m] = c as unknown[];
    if (!isInt(k) || !isInt(m) || k < 3 || k > HEXTRIS_MAX_GROUP) return { ok: false, code: 'bad-moves' };
    // 倍率は 1 に戻るか、前の 1 つ上だけ
    if (m !== 1 && m !== prev + 1) return { ok: false, code: 'bad-moves' };
    prev = m;
    if (m > maxCombo) maxCombo = m;
    sum += k * k * m;
    blocks += k;
  }
  if (sum !== score) return { ok: false, code: 'bad-moves' };
  const sec = Math.max(0, elapsedMs) / 1000;
  if (score > sec * HEXTRIS_SCORE_PER_SEC || blocks > sec * HEXTRIS_BLOCKS_PER_SEC) return { ok: false, code: 'too-fast' };
  return { ok: true, score, clears: clears.length, blocks, maxCombo };
};
