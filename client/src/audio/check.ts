// 確認用（URL の末尾に #dev のときだけ __va.bgmRender から使う）：合成の曲を OfflineAudioContext で書き出して、
// 音の大きさ（全体・0.5 秒ごと）・無音の切れ目・ループの継ぎ目の前後を数字で返す。耳で聞けないところで「鳴っている・途切れない・割れない」を確かめる。

import { compileSong, SONGS } from '@va/shared';
import { SongRun } from './synth';

export const renderSongOffline = async (id: string, loops = 2, sampleRate = 22050) => {
  const song = SONGS.find((s) => s.id === id);
  if (!song) throw new Error(`曲が無い: ${id}`);
  const c = compileSong(song);
  const loopSec = c.totalSteps * c.stepSec;
  const sec = loopSec * loops + 1;
  const ctx = new OfflineAudioContext(1, Math.ceil(sec * sampleRate), sampleRate);
  const run = new SongRun(ctx, c, ctx.destination, 0, 0);
  run.scheduleUntil(loopSec * loops);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const win = Math.floor(sampleRate / 2);
  const rmsOf = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += d[i] * d[i];
    return Math.sqrt(s / Math.max(1, b - a));
  };
  const windows: number[] = [];
  const end = Math.floor(loopSec * loops * sampleRate);
  for (let i = 0; i + win <= end; i += win) windows.push(+rmsOf(i, i + win).toFixed(4));
  let peak = 0;
  let nan = 0;
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]);
    if (!Number.isFinite(v)) nan++;
    else if (v > peak) peak = v;
  }
  const seam = Math.floor(loopSec * sampleRate);
  return {
    id,
    loopSec: +loopSec.toFixed(2),
    notes: run.scheduled,
    rms: +rmsOf(0, end).toFixed(4),
    peak: +peak.toFixed(3),
    nan,
    /** 0.5 秒ごとの大きさの最小・最大（最小が 0 に近ければ無音の切れ目がある） */
    minWindow: Math.min(...windows),
    maxWindow: Math.max(...windows),
    /** ループの継ぎ目の前 0.5 秒・後 0.5 秒の大きさ */
    seamBefore: +rmsOf(seam - win, seam).toFixed(4),
    seamAfter: +rmsOf(seam, seam + win).toFixed(4),
  };
};

/** 合成の曲を 1 ループ書き出した WAV（16 bit・44.1 kHz・ステレオ。左右同じ）を base64 で。ラウドネスを Python（tools/bgm/loudness.py --ref）で測るため */
export const renderSongWav = async (id: string): Promise<string> => {
  const song = SONGS.find((s) => s.id === id);
  if (!song) throw new Error(`曲が無い: ${id}`);
  const c = compileSong(song);
  const sr = 44100;
  const loopSec = c.totalSteps * c.stepSec;
  const ctx = new OfflineAudioContext(1, Math.ceil(loopSec * sr), sr);
  const run = new SongRun(ctx, c, ctx.destination, 0, 0);
  run.scheduleUntil(loopSec);
  const d = (await ctx.startRendering()).getChannelData(0);
  const n = d.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, d[i])) * 32767;
    v.setInt16(44 + i * 4, s, true);
    v.setInt16(46 + i * 4, s, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * ファイルの曲（イントロ + 本体）を FileRun（ブラウザで鳴らすのと同じ部品）で OfflineAudioContext に書き出し、
 * イントロ → 本体、本体 → 本体（ループ）の継ぎ目にすき間・段差が無いかを数字で返す。
 * 書き出すのはイントロの終わり 2 秒 → 本体 1 周 → 本体の頭 2 秒。
 */
export const renderFileSeams = async (introUrl: string | null, bodyUrl: string, introLen: number | null = null, bodyLen: number | null = null) => {
  const sr = 44100;
  const tmp = new OfflineAudioContext(2, sr, sr);
  const load = async (u: string) => tmp.decodeAudioData(await (await fetch(u)).arrayBuffer());
  const intro = introUrl ? await load(introUrl) : null;
  const body = await load(bodyUrl);
  const introSec = intro ? Math.min(introLen ?? intro.duration, intro.duration) : 0;
  const bodySec = Math.min(bodyLen ?? body.duration, body.duration);
  const lead = Math.min(2, introSec);
  const total = lead + bodySec + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil((total + 0.2) * sr), sr);
  const { FileRun } = await import('./fileRun');
  new FileRun(ctx, ctx.destination, 'check', { intro, body, introSec, bodySec }, 1, introSec - lead, 0);
  const out = await ctx.startRendering();
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  const t0 = 0.05; // FileRun は currentTime + 0.05 から鳴らす
  const diffs: number[] = [];
  for (let i = 1; i < L.length; i += 7) diffs.push(Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1])));
  diffs.sort((a, b) => a - b);
  const typical = diffs[Math.floor(diffs.length * 0.99)];
  const seam = (sec: number) => {
    const c = Math.round((t0 + sec) * sr);
    const w = Math.round(0.01 * sr);
    const rms = (a: number) => {
      let s = 0;
      for (let i = a; i < a + w; i++) s += L[i] * L[i] + R[i] * R[i];
      return Math.sqrt(s / (2 * w));
    };
    // 継ぎ目の前後 50 ms の 10 ms ごとの大きさの最小（すき間があれば 0 に近い）と、前後 1 秒の大きさ
    let minWin = Infinity;
    for (let a = c - 5 * w; a < c + 5 * w; a += w) minWin = Math.min(minWin, rms(a));
    let around = 0;
    for (let a = c - sr; a < c + sr; a += w) around += rms(a);
    around /= (2 * sr) / w;
    const d = (i: number) => Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]));
    let jump = 0;
    for (let i = c - 3; i <= c + 3; i++) jump = Math.max(jump, d(i));
    // 継ぎ目のまわり ±50 ms（継ぎ目の ±3 サンプルを除く）の隣どうしの差の最大。曲の頭の強い音などで元から大きいときの比べる相手
    let localMax = 0;
    for (let i = Math.max(1, c - 5 * w); i < c + 5 * w; i++) if (i < c - 3 || i > c + 3) localMax = Math.max(localMax, d(i));
    return {
      at: +sec.toFixed(3),
      minWin10ms: +minWin.toFixed(4),
      around: Number.isFinite(around) && c - sr >= 0 ? +around.toFixed(4) : null,
      jump: +jump.toFixed(4),
      localMax: +localMax.toFixed(4),
    };
  };
  return {
    introSec: +introSec.toFixed(3),
    bodySec: +bodySec.toFixed(3),
    /** ファイルをデコードした長さ（後ろに足した続きの音を含む。ブラウザが削った分は短い） */
    decoded: { intro: intro ? +intro.duration.toFixed(4) : null, body: +body.duration.toFixed(4) },
    typicalDiff: +typical.toFixed(4),
    introToBody: intro ? seam(lead) : null,
    bodyLoop: seam(lead + bodySec),
  };
};
