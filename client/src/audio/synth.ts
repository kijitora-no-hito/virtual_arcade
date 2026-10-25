// 合成の曲の演奏（Web Audio）。曲のデータ（shared の bgm.ts / songs.ts）を音にする。
// SongRun は「いつまでの分を予約するか」を外から言われて、そこまでの音符を AudioContext の時刻で予約する（先読みのスケジューラ）。
// タイマーが揺れても音の時刻は AudioContext の時計で決まるので、リズムは崩れない。OfflineAudioContext でも同じように使える。

import { midiToFreq, type CompiledSong, type DrumEvent, type DrumTrack, type ToneEvent, type ToneTrack, type Wave } from '@va/shared';

/** 曲の出口の大きさ（音量のスライダーより前。トラックの音量の合計が大きくなりすぎないように） */
const SONG_TRIM = 0.8;

interface Kit {
  noise: AudioBuffer;
  pulse25: PeriodicWave;
  pulse12: PeriodicWave;
}
const kits = new WeakMap<BaseAudioContext, Kit>();

/** デューティ比 d の矩形波（フーリエ級数で作る） */
const pulseWave = (ctx: BaseAudioContext, d: number): PeriodicWave => {
  const n = 40;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 * Math.sin(k * Math.PI * d)) / (k * Math.PI);
  return ctx.createPeriodicWave(real, imag);
};

/** 音のもと（ノイズ・矩形波の形）は AudioContext ごとに 1 回だけ作る */
const kitFor = (ctx: BaseAudioContext): Kit => {
  let k = kits.get(ctx);
  if (!k) {
    const len = Math.floor(ctx.sampleRate * 1);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    k = { noise, pulse25: pulseWave(ctx, 0.25), pulse12: pulseWave(ctx, 0.125) };
    kits.set(ctx, k);
  }
  return k;
};

const setWave = (osc: OscillatorNode, wave: Wave, kit: Kit) => {
  if (wave === 'pulse25') osc.setPeriodicWave(kit.pulse25);
  else if (wave === 'pulse12') osc.setPeriodicWave(kit.pulse12);
  else osc.type = wave;
};

/** 1 曲ぶんの演奏（止めたら捨てる。次の曲は新しく作る） */
export class SongRun {
  readonly out: GainNode;
  private readonly dry: GainNode;
  private readonly echoIn: GainNode | null = null;
  private readonly hatF: BiquadFilterNode;
  private readonly snareF: BiquadFilterNode;
  private readonly crashF: BiquadFilterNode;
  private readonly kit: Kit;
  /** 次に予約するステップと、その時刻（AudioContext の秒） */
  step: number;
  nextTime: number;
  /** 予約した音の数（確認用） */
  scheduled = 0;
  stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly song: CompiledSong,
    dest: AudioNode,
    startAt: number,
    startStep = 0,
    /** 頭のフェードイン（秒。0 ならすぐ元の大きさ） */
    fadeIn = 0,
  ) {
    this.kit = kitFor(ctx);
    this.step = ((startStep % song.totalSteps) + song.totalSteps) % song.totalSteps;
    this.nextTime = startAt;
    this.out = ctx.createGain();
    const level = SONG_TRIM * (song.song.gain ?? 1);
    if (fadeIn > 0) {
      this.out.gain.setValueAtTime(0, startAt);
      this.out.gain.linearRampToValueAtTime(level, startAt + fadeIn);
    } else this.out.gain.value = level;
    this.out.connect(dest);
    this.dry = ctx.createGain();
    this.dry.connect(this.out);
    const e = song.song.echo;
    if (e) {
      // こだま：遅らせた音を少しずつ小さくして繰り返す（フィードバック）。高い音を少し削ってやわらかく
      const echoIn = ctx.createGain();
      const delay = ctx.createDelay(2);
      delay.delayTime.value = e.steps * song.stepSec;
      const fb = ctx.createGain();
      fb.gain.value = e.feedback;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3500;
      const wet = ctx.createGain();
      wet.gain.value = e.mix;
      echoIn.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(wet);
      wet.connect(this.out);
      this.echoIn = echoIn;
    }
    const filter = (type: BiquadFilterType, freq: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.connect(this.dry);
      return f;
    };
    this.hatF = filter('highpass', 7000);
    this.snareF = filter('highpass', 1300);
    this.crashF = filter('highpass', 4000);
  }

  /** until（AudioContext の秒）より前に始まる音符をすべて予約する */
  scheduleUntil(until: number): void {
    if (this.stopped) return;
    const { song } = this;
    // タブが止まっていたなどで大きく遅れたら、今から鳴らし直す（過去の時刻に山ほど予約しない）
    if (this.nextTime < this.ctx.currentTime - 0.05) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < until) {
      for (const item of song.byStep[this.step]) {
        const tr = song.tracks[item.t];
        if (item.tone && tr.kind === 'tone') this.tone(tr.track, item.tone, this.nextTime);
        else if (item.drum && tr.kind === 'drums') this.drums(tr.track, item.drum, this.nextTime);
      }
      this.nextTime += song.stepSec;
      this.step = (this.step + 1) % song.totalSteps; // ループ（継ぎ目もステップの刻みのまま）
    }
  }

  /** 今から fade 秒で小さくして止める（予約済みの音は出口ごと外す） */
  stop(fade = 0.25): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      try {
        this.out.disconnect();
      } catch {
        /* もう外れている */
      }
    }, (fade + 0.1) * 1000);
  }

  private tone(tr: ToneTrack, ev: ToneEvent, t: number): void {
    const { ctx, song } = this;
    const attack = tr.attack ?? 0.005;
    const release = tr.release ?? 0.04;
    const hold = Math.max(attack + 0.001, ev.len * song.stepSec * (tr.gate ?? 0.85));
    const level = tr.volume / Math.sqrt(ev.notes.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.linearRampToValueAtTime(0, t + hold + release);
    g.connect(this.dry);
    if (tr.echo && this.echoIn) g.connect(this.echoIn);
    const end = t + hold + release + 0.02;
    for (const n of ev.notes) {
      const osc = ctx.createOscillator();
      setWave(osc, tr.wave, this.kit);
      osc.frequency.value = midiToFreq(n);
      osc.connect(g);
      osc.start(t);
      osc.stop(end);
      this.scheduled++;
    }
  }

  private noise(t: number, level: number, decay: number, dest: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.kit.noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
    this.scheduled++;
  }

  private drums(tr: DrumTrack, ev: DrumEvent, t: number): void {
    const { ctx } = this;
    const v = tr.volume;
    for (const hit of ev.hits) {
      if (hit === 'kick') {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
        osc.connect(g);
        g.connect(this.dry);
        osc.start(t);
        osc.stop(t + 0.22);
        this.scheduled++;
      } else if (hit === 'snare') {
        this.noise(t, v * 0.55, 0.14, this.snareF);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, t);
        osc.frequency.exponentialRampToValueAtTime(120, t + 0.07);
        const g = ctx.createGain();
        g.gain.setValueAtTime(v * 0.4, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
        osc.connect(g);
        g.connect(this.dry);
        osc.start(t);
        osc.stop(t + 0.1);
        this.scheduled++;
      } else if (hit === 'hat') this.noise(t, v * 0.3, 0.04, this.hatF);
      else if (hit === 'open') this.noise(t, v * 0.26, 0.22, this.hatF);
      else if (hit === 'crash') this.noise(t, v * 0.32, 1.0, this.crashF);
    }
  }
}

/** 短いチャイム（管理者のお知らせ）。BGM とは別に鳴らす */
export const playChime = (ctx: BaseAudioContext, dest: AudioNode, level: number, at = ctx.currentTime + 0.02): void => {
  // 下から上へ 3 音（G5 → C6 → E6）。三角波＋少しの矩形波で、ゲームセンターの呼び出し音ふう
  const notes = [79, 84, 88];
  notes.forEach((n, i) => {
    const t = at + i * 0.13;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (i === notes.length - 1 ? 0.9 : 0.45));
    g.connect(dest);
    for (const [type, mul] of [['triangle', 1], ['square', 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(n);
      const og = ctx.createGain();
      og.gain.value = mul;
      osc.connect(og);
      og.connect(g);
      osc.start(t);
      osc.stop(t + 1);
    }
  });
};
