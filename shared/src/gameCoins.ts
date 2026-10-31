// ゲームを遊ぶとスロットのコイン（v0.7.0。DESIGN §17.9）。
// ユーザー指定「ゲームをプレイしたらスロットマシン用のコインが手にはいるようにしてください。6枚くらい。良いスコアだったら最大60枚くらい。」
//
// 記録された点数 score から：sMin 未満は 0 枚、sMin で 6 枚、sMax 以上で 60 枚、間は対数で
//   coins = round(6 + 54 × t)、t = clamp(log(score / sMin) / log(sMax / sMin), 0, 1)
// sMin = ふつうに 1 回遊んで負けたくらいの点・sMax = 上手な人の良い記録。根拠は DESIGN §17.9（scripts/dev/coin-sim.ts・hextris-sim.mjs）。

/** ゲームでもらえるいちばん少ない数（sMin のとき）・いちばん多い数（sMax 以上） */
export const GAME_COIN_MIN = 6;
export const GAME_COIN_MAX = 60;

/** ゲームごとの sMin・sMax（点数） */
export const GAME_COIN_RANGE: Readonly<Record<string, { min: number; max: number }>> = {
  '2048': { min: 2_000, max: 20_000 },
  columns: { min: 3_000, max: 50_000 },
  hextris: { min: 800, max: 20_000 },
};

/** 鍵ごとの 1 時間の上限の既定（ゲームからのコインの合計。GAME_COINS_PER_HOUR で変えられる） */
export const DEFAULT_GAME_COINS_PER_HOUR = 300;

/** その点数でもらえるコイン（上限を当てる前）。知らないゲーム・sMin 未満は 0 */
export const gameCoins = (game: string, score: number): number => {
  const r = GAME_COIN_RANGE[game];
  if (!r || !Number.isFinite(score) || score < r.min) return 0;
  const t = Math.min(1, Math.max(0, Math.log(score / r.min) / Math.log(r.max / r.min)));
  return Math.round(GAME_COIN_MIN + (GAME_COIN_MAX - GAME_COIN_MIN) * t);
};
