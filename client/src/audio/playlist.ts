// 店内の BGM の曲の一覧と、イントロ + 本体（ループ）の曲の位置の計算（純粋な関数。テストは client/test/playlist.test.ts）。

import { bgmCredit, BGM_ROTATE_LAPS, compileSong, SONGS, SYNTH_CREDIT, type BgmMeta, type CompiledSong } from '@va/shared';

export interface BgmItem {
  /** 'synth:<id>' / 'file:<本体のファイル名>' */
  key: string;
  kind: 'synth' | 'file';
  title: string;
  /** 画面に出すクレジット（合成の曲は「オリジナル（このアプリのために作曲）」） */
  credit: string;
  mood?: string;
  song?: CompiledSong;
  /** イントロ・本体の URL（ファイルの曲） */
  intro?: string | null;
  body?: string;
  /** イントロ・本体の正しい長さ（秒。null ならファイルの長さ。BgmFile の introSec / bodySec） */
  introSec?: number | null;
  bodySec?: number | null;
  /** 音量の倍率（ファイルの曲。tools/bgm/loudness.py でそろえた値） */
  gain: number;
  /** 順番に回す（本体を BGM_ROTATE_LAPS 周したら次の rotate の曲へ）。合成の曲は回さない（選んだらその曲をループ） */
  rotate: boolean;
}

let synthCache: BgmItem[] | null = null;
/** 合成の曲（読み取りは 1 回だけ） */
export const synthItems = (): BgmItem[] =>
  (synthCache ??= SONGS.map((s) => ({
    key: `synth:${s.id}`,
    kind: 'synth' as const,
    title: s.title,
    credit: SYNTH_CREDIT,
    mood: s.mood,
    song: compileSong(s),
    gain: 1,
    rotate: false,
  })));

/** 一覧：サーバの曲（bgm.json の順）が先、合成の曲が後 */
export const buildPlaylist = (meta: BgmMeta | null | undefined, base: string): BgmItem[] => {
  const url = (f: string) => `${base}/bgm/${encodeURIComponent(f)}`;
  const files: BgmItem[] = (meta?.files ?? []).map((f) => ({
    key: `file:${f.body}`,
    kind: 'file',
    title: f.title,
    credit: bgmCredit(f) ?? f.body,
    intro: f.intro ? url(f.intro) : null,
    body: url(f.body),
    introSec: f.introSec,
    bodySec: f.bodySec,
    gain: f.gain,
    rotate: f.rotate,
  }));
  const synth = !files.length || meta?.synth !== false ? synthItems() : [];
  return [...files, ...synth];
};

/** 順番に回す曲の次（今の曲が rotate でなければ null。rotate の曲が 1 つだけならその曲） */
export const nextRotateIndex = (items: readonly BgmItem[], index: number): number | null => {
  if (!items[index]?.rotate) return null;
  for (let d = 1; d <= items.length; d++) {
    const j = (index + d) % items.length;
    if (items[j].rotate) return j;
  }
  return index;
};

/**
 * 曲の頭からの位置 pos（秒。イントロ → 本体 → 本体 …）を、どの部分のどこかに直す。
 * laps = 本体を何周し終えたか（イントロの間は 0）
 */
export const partAt = (pos: number, introSec: number, bodySec: number): { inIntro: boolean; offset: number; laps: number } => {
  const p = Math.max(0, pos);
  if (p < introSec) return { inIntro: true, offset: p, laps: 0 };
  const b = p - introSec;
  return { inIntro: false, offset: bodySec > 0 ? b % bodySec : 0, laps: bodySec > 0 ? Math.floor(b / bodySec) : 0 };
};

/** 順番に回す曲を次へ進める時刻（曲の頭からの秒）：イントロ + 本体 BGM_ROTATE_LAPS 周 */
export const rotateAt = (introSec: number, bodySec: number, laps = BGM_ROTATE_LAPS): number => introSec + bodySec * laps;
