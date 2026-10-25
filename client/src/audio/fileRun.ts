// ファイルの曲（イントロ + 本体）の演奏。デコード済みの AudioBuffer を AudioBufferSourceNode で鳴らす。
// イントロの終わりの時刻ちょうどに本体（loop = true）を始めるので、イントロ → 本体・本体 → 本体の継ぎ目はサンプル単位でつながる
// （本体の末尾は tools/bgm/loop_bgm.py が頭へ連続につながるよう重ねてある）。HTML の <audio loop> は継ぎ目にすき間が出るので使わない。

import { partAt } from './playlist';

export interface Buffers {
  intro: AudioBuffer | null;
  body: AudioBuffer;
  /**
   * イントロ・本体の正しい長さ（秒）。tools/bgm/loop_bgm.py の ogg は後ろに続きの音を足してあるので、イントロはこの長さで止めて本体へ、
   * 本体は loopEnd = この長さでループする（ブラウザが短い Vorbis の末尾を削っても継ぎ目が切れない）。無ければバッファの長さ
   */
  introSec?: number | null;
  bodySec?: number | null;
}

export class FileRun {
  readonly out: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  /** 曲の頭（位置 0）にあたる AudioContext の時刻 */
  private readonly t0: number;
  readonly introSec: number;
  readonly bodySec: number;
  stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    readonly key: string,
    bufs: Buffers,
    gain: number,
    /** 曲の頭からの位置（秒。続きから鳴らすとき） */
    pos: number,
    fadeIn: number,
  ) {
    this.introSec = bufs.intro ? Math.min(bufs.introSec ?? bufs.intro.duration, bufs.intro.duration) : 0;
    this.bodySec = Math.min(bufs.bodySec ?? bufs.body.duration, bufs.body.duration);
    const at = ctx.currentTime + 0.05;
    this.t0 = at - pos;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(fadeIn > 0 ? 0 : gain, at);
    if (fadeIn > 0) this.out.gain.linearRampToValueAtTime(gain, at + fadeIn);
    this.out.connect(dest);
    const where = partAt(pos, this.introSec, this.bodySec);
    const body = ctx.createBufferSource();
    body.buffer = bufs.body;
    body.loop = true;
    body.loopStart = 0;
    body.loopEnd = this.bodySec;
    body.connect(this.out);
    if (where.inIntro && bufs.intro) {
      const intro = ctx.createBufferSource();
      intro.buffer = bufs.intro;
      intro.connect(this.out);
      intro.start(at, where.offset, this.introSec - where.offset);
      this.sources.push(intro);
      body.start(at + (this.introSec - where.offset), 0);
    } else body.start(at, where.offset);
    this.sources.push(body);
  }

  /** 曲の頭からの位置（秒。イントロ → 本体 → 本体 … の通し） */
  position(): number {
    return Math.max(0, this.ctx.currentTime - this.t0);
  }

  stop(fade: number): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    for (const s of this.sources) {
      try {
        s.stop(t + Math.max(0.01, fade) + 0.05);
      } catch {
        /* まだ始まっていない・止まっている */
      }
    }
    setTimeout(() => {
      try {
        this.out.disconnect();
      } catch {
        /* もう外れている */
      }
    }, (fade + 0.2) * 1000);
  }
}
