// クレーンゲームの効果音（短い合成音）。BGM とは別の出口（お知らせのチャイムと同じ sfx）で鳴らす。

import { midiToFreq } from '@va/shared';

export type SfxName = 'tick' | 'stop' | 'down' | 'grab' | 'up' | 'release' | 'fall' | 'win' | 'lose' | 'complete';

const tone = (
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  dur: number,
  level: number,
  type: OscillatorType,
  f0: number,
  f1 = f0,
) => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0006, at + dur);
  g.connect(dest);
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  o.connect(g);
  o.start(at);
  o.stop(at + dur + 0.02);
};

const notes = (ctx: BaseAudioContext, dest: AudioNode, at: number, level: number, seq: number[], step: number, last = 0.5) =>
  seq.forEach((n, i) => {
    const t = at + i * step;
    const dur = i === seq.length - 1 ? last : step * 1.6;
    tone(ctx, dest, t, dur, level, 'triangle', midiToFreq(n));
    tone(ctx, dest, t, dur, level * 0.15, 'square', midiToFreq(n));
  });

export const playSfx = (ctx: BaseAudioContext, dest: AudioNode, name: SfxName, level: number, at = ctx.currentTime + 0.01): void => {
  switch (name) {
    case 'tick':
      tone(ctx, dest, at, 0.035, level * 0.25, 'square', 330);
      break;
    case 'stop':
      tone(ctx, dest, at, 0.08, level * 0.5, 'square', 520, 260);
      break;
    case 'down':
      tone(ctx, dest, at, 0.9, level * 0.35, 'triangle', 700, 260);
      break;
    case 'grab':
      tone(ctx, dest, at, 0.09, level * 0.7, 'square', 180, 120);
      tone(ctx, dest, at + 0.1, 0.12, level * 0.6, 'square', 140, 90);
      break;
    case 'up':
      tone(ctx, dest, at, 0.9, level * 0.35, 'triangle', 260, 640);
      break;
    case 'release':
      tone(ctx, dest, at, 0.1, level * 0.5, 'triangle', 900, 1400);
      break;
    case 'fall':
      tone(ctx, dest, at, 0.25, level * 0.6, 'triangle', 500, 120);
      tone(ctx, dest, at + 0.26, 0.08, level * 0.4, 'square', 160, 110);
      break;
    case 'win':
      notes(ctx, dest, at, level * 0.55, [72, 76, 79, 84], 0.1, 0.6);
      break;
    case 'lose':
      notes(ctx, dest, at, level * 0.45, [67, 63], 0.18, 0.45);
      break;
    case 'complete':
      notes(ctx, dest, at, level * 0.55, [72, 76, 79, 84, 79, 84, 88, 91], 0.09, 0.9);
      break;
  }
};
