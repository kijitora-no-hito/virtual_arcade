// 店内の BGM（1 つだけ。画面のどこからでも同じものを使う）。
// - 曲：サーバの data/bgm/ の曲（同梱の魔王魂の曲など。/api/meta の bgm）＋合成の曲（shared の SONGS）。playlist.ts。
//   ファイルの曲は Web Audio でイントロ → 本体（AudioBufferSourceNode.loop）とつなぐ（fileRun.ts）。合成の曲は synth.ts。
// - 順番に回す曲（rotate）は本体を 2 周したら次の rotate の曲へ。合成の曲は選んだらその曲をループ。
// - ブラウザの自動再生の制限があるので、AudioContext は利用者の操作（入店のボタン・最初のクリックやキー）の中で作って鳴らし始める（unlock）。
// - 設定（音量・消音・曲）は localStorage の va:bgm に覚える。
// - 視聴画面の動画が再生を始めたら 1.8 秒でフェードアウトして止め、店内に戻ったら 1.5 秒でフェードインして続きから（setVideoDucked。videoDuck.ts）。
// - デコード済みのバッファは、今の曲と次の曲（と切り替えの途中の前の曲）の分だけ持つ。
// - React には subscribe / getState で知らせる（useSyncExternalStore）。

import type { BgmMeta } from '@va/shared';
import { BASE, storage } from '../api';
import { FileRun, type Buffers } from './fileRun';
import { buildPlaylist, nextRotateIndex, rotateAt, synthItems, type BgmItem } from './playlist';
import { playSfx, type SfxName } from './sfx';
import { playChime, SongRun } from './synth';
import { VIDEO_FADE_IN_SEC, VIDEO_FADE_OUT_SEC } from './videoDuck';

export type { BgmItem } from './playlist';

export interface BgmState {
  /** 鳴らせる状態になったか（自動再生の制限を越えたか）。false のあいだは「🔇 クリックで BGM」 */
  unlocked: boolean;
  muted: boolean;
  /** 0〜100 */
  volume: number;
  /** いまの曲 */
  item: BgmItem | null;
  index: number;
  items: readonly BgmItem[];
  /** 視聴画面の動画のために止めている */
  ducked: boolean;
  /** 曲を読み込んでいる */
  loading: boolean;
  /** 実際に音を出している */
  playing: boolean;
}

interface Saved {
  volume: number;
  muted: boolean;
  track: string | null;
}

const STORE = 'va:bgm';
export const DEFAULT_VOLUME = 25;
/** 先読み：見えているときは 0.3 秒先まで、裏に回っているとき（タイマーが 1 秒ごとに間引かれる）は 1.5 秒先まで予約 */
const AHEAD_VISIBLE = 0.3;
const AHEAD_HIDDEN = 1.5;
const TICK_MS = 50;
/** 曲の切り替え・消音のフェード（秒） */
const SWITCH_FADE = 0.6;
const MUTE_FADE = 0.3;
/** 順番に回す曲の、次の曲を読み込み始める残り時間（秒） */
const PREFETCH_SEC = 25;

/** スライダー（0〜100）→ 音の大きさ（耳に自然なように少し曲げる） */
const curve = (v: number) => Math.pow(Math.max(0, Math.min(100, v)) / 100, 1.5);

const loadSaved = (): Saved => {
  const v = storage.get<Partial<Saved> | null>(STORE, null);
  return {
    volume: typeof v?.volume === 'number' && v.volume >= 0 && v.volume <= 100 ? Math.round(v.volume) : DEFAULT_VOLUME,
    muted: v?.muted === true,
    track: typeof v?.track === 'string' ? v.track : null,
  };
};

type Run = { kind: 'synth'; key: string; run: SongRun } | { kind: 'file'; key: string; run: FileRun };

class BgmEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private sfx: GainNode | null = null;
  private items: BgmItem[] = synthItems();
  private index = 0;
  private saved = loadSaved();
  private active = false;
  private ducked = false;
  private cur: Run | null = null;
  /** 最後に止めた（フェードアウト中かもしれない）演奏（確認用） */
  private last: Run | null = null;
  /** 止めたところ（同じ曲なら続きから）。合成の曲はステップ、ファイルの曲は頭からの秒 */
  private resume: { key: string; at: number } | null = null;
  /** 次に鳴らし始めるときのフェードイン（秒） */
  private fadeIn = SWITCH_FADE;
  private timer: number | null = null;
  /** デコード済み・読み込み中のバッファ（URL ごと） */
  private bufs = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();
  private loadingKey: string | null = null;
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  private state: BgmState;
  /** 確認用（#dev の __va.bgm()）：起きた例外 */
  readonly errors: string[] = [];

  constructor() {
    this.pickSaved();
    this.state = this.makeState();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.tick());
  }

  // ---------------------------------------------------------------- React

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): BgmState => this.state;

  private makeState(): BgmState {
    return {
      unlocked: !!this.ctx && this.ctx.state === 'running',
      muted: this.saved.muted,
      volume: this.saved.volume,
      item: this.items[this.index] ?? null,
      index: this.index,
      items: this.items,
      ducked: this.ducked,
      loading: this.loadingKey !== null,
      playing: !!this.cur && !this.cur.run.stopped,
    };
  }
  private changed(): void {
    this.state = this.makeState();
    for (const fn of this.listeners) fn();
  }

  // ---------------------------------------------------------------- 外から

  /** 利用者の操作（クリック・キー・入店のボタン）の中で呼ぶ。AudioContext を作る / 再開する */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx({ latencyHint: 'playback' });
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        comp.connect(ctx.destination);
        this.bus = ctx.createGain();
        this.bus.gain.value = 0;
        this.bus.connect(comp);
        this.sfx = ctx.createGain();
        this.sfx.connect(comp);
        ctx.addEventListener('statechange', () => this.sync());
        this.ctx = ctx;
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.sync(), () => undefined);
      this.sync();
    } catch (e) {
      this.err(e);
    }
  }

  /** 店内の画面が出ている間だけ鳴らす */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.fadeIn = SWITCH_FADE;
    this.sync(on ? SWITCH_FADE : MUTE_FADE);
  }

  /** 視聴画面の動画が再生を始めたら true（フェードアウトして止める）、店内に戻ったら false（フェードインして続きから） */
  setVideoDucked(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.fadeIn = VIDEO_FADE_IN_SEC;
    this.sync(VIDEO_FADE_OUT_SEC);
  }

  /** サーバの曲（/api/meta の bgm）。サーバの曲が先、合成の曲が後 */
  setPlaylist(meta: BgmMeta | undefined | null): void {
    const next = buildPlaylist(meta, BASE);
    if (next.map((i) => i.key).join('\n') === this.items.map((i) => i.key).join('\n')) return;
    this.stopAll(SWITCH_FADE);
    this.items = next;
    // 前に選んだ曲が一覧にあればそれ、無ければ先頭（サーバの曲があればその先頭）
    this.pickSaved();
    this.fadeIn = SWITCH_FADE;
    this.sync();
  }

  setVolume(v: number): void {
    this.saved.volume = Math.max(0, Math.min(100, Math.round(v)));
    if (this.saved.volume > 0 && this.saved.muted) this.saved.muted = false;
    this.save();
    this.fadeIn = MUTE_FADE;
    this.sync(MUTE_FADE);
  }

  toggleMute(): void {
    this.saved.muted = !this.saved.muted;
    if (!this.saved.muted && this.saved.volume === 0) this.saved.volume = DEFAULT_VOLUME;
    this.save();
    this.fadeIn = SWITCH_FADE;
    this.sync(MUTE_FADE);
  }

  next(): void {
    if (this.items.length) this.select((this.index + 1) % this.items.length);
  }

  /** 一覧から曲を選ぶ（頭から） */
  select(i: number): void {
    if (!this.items[i]) return;
    this.stopAll(SWITCH_FADE);
    this.resume = null;
    this.index = i;
    this.saved.track = this.items[i].key;
    this.failed.delete(this.items[i].key);
    this.save();
    this.fadeIn = SWITCH_FADE;
    this.sync();
  }

  /** 管理者のお知らせのチャイム（消音なら鳴らさない。BGM とは別の出口） */
  chime(): void {
    const { ctx, sfx } = this;
    if (!ctx || !sfx || ctx.state !== 'running' || this.saved.muted || this.saved.volume === 0) return;
    try {
      playChime(ctx, sfx, 0.35 * Math.max(curve(this.saved.volume), 0.08));
    } catch (e) {
      this.err(e);
    }
  }

  /** クレーンゲームの効果音（消音なら鳴らさない。チャイムと同じ出口） */
  playSfx(name: SfxName): void {
    const { ctx, sfx } = this;
    if (!ctx || !sfx || ctx.state !== 'running' || this.saved.muted || this.saved.volume === 0) return;
    try {
      playSfx(ctx, sfx, name, 0.4 * Math.max(curve(this.saved.volume), 0.08));
    } catch (e) {
      this.err(e);
    }
  }

  /** 確認用（#dev）：今の曲を頭から sec 秒の所から鳴らし直す */
  seek(sec: number): void {
    const item = this.items[this.index];
    if (!item) return;
    this.stopAll(0.05);
    this.resume = { key: item.key, at: sec };
    this.fadeIn = 0.05;
    this.sync();
  }

  /** 確認用（#dev） */
  debug() {
    const c = this.cur;
    return {
      unlocked: this.state.unlocked,
      muted: this.state.muted,
      volume: this.state.volume,
      ducked: this.ducked,
      loading: this.state.loading,
      playing: this.state.playing,
      index: this.index,
      count: this.items.length,
      item: this.state.item && { key: this.state.item.key, title: this.state.item.title, credit: this.state.item.credit },
      ctxState: this.ctx?.state ?? null,
      busGain: this.bus?.gain.value ?? null,
      runGain: c && !c.run.stopped ? c.run.out.gain.value : null,
      fadingGain: this.last ? this.last.run.out.gain.value : null,
      scheduled: c?.kind === 'synth' ? c.run.scheduled : 0,
      step: c?.kind === 'synth' ? c.run.step : null,
      filePos: c?.kind === 'file' ? +c.run.position().toFixed(2) : null,
      fileParts: c?.kind === 'file' ? { intro: +c.run.introSec.toFixed(3), body: +c.run.bodySec.toFixed(3) } : null,
      buffers: [...this.bufs.keys()].map((u) => decodeURIComponent(u.split('/').pop() ?? u)),
      errors: [...this.errors],
    };
  }

  // ---------------------------------------------------------------- 中

  private pickSaved(): void {
    const i = this.saved.track ? this.items.findIndex((x) => x.key === this.saved.track) : -1;
    this.index = i >= 0 ? i : 0;
  }

  private save(): void {
    storage.set(STORE, this.saved);
  }

  private err(e: unknown): void {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (this.errors.length < 20) this.errors.push(m);
    console.warn('BGM:', m);
  }

  private shouldPlay(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.active && !this.ducked && !this.saved.muted && this.saved.volume > 0;
  }

  private applyVolume(): void {
    if (!this.ctx || !this.bus) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(curve(this.saved.volume), t, 0.05);
  }

  /** 今の状態に合わせて鳴らす・止める（止めるときのフェード stopFade 秒） */
  private sync(stopFade = SWITCH_FADE): void {
    try {
      this.applyVolume();
      const item = this.items[this.index];
      if (!this.shouldPlay() || !item) this.stopAll(stopFade);
      else if (!this.cur || this.cur.run.stopped || this.cur.key !== item.key) {
        this.stopAll(SWITCH_FADE);
        if (item.kind === 'synth') this.startSynth(item);
        else void this.startFile(item);
      }
      this.ensureTimer();
    } catch (e) {
      this.err(e);
    }
    this.changed();
  }

  private ensureTimer(): void {
    const want = !!this.cur && !this.cur.run.stopped;
    if (want && this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    if (!want && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private takeResume(key: string): number {
    const at = this.resume?.key === key ? this.resume.at : 0;
    this.resume = null;
    return at;
  }

  private startSynth(item: BgmItem): void {
    const ctx = this.ctx!;
    const step = this.takeResume(item.key);
    this.cur = { kind: 'synth', key: item.key, run: new SongRun(ctx, item.song!, this.bus!, ctx.currentTime + 0.08, step, this.fadeIn) };
    this.tick();
  }

  private async startFile(item: BgmItem): Promise<void> {
    this.loadingKey = item.key;
    this.changed();
    let b: Buffers;
    try {
      b = await this.buffersFor(item);
    } catch (e) {
      if (this.loadingKey === item.key) this.loadingKey = null;
      this.err(new Error(`曲を読み込めません: ${item.title}（${e instanceof Error ? e.message : String(e)}）`));
      this.fileFailed(item);
      return;
    }
    // 読み込みの間に曲・状態が変わっていたら鳴らさない
    if (this.loadingKey !== item.key) return;
    this.loadingKey = null;
    if (!this.shouldPlay() || this.items[this.index]?.key !== item.key || (this.cur && !this.cur.run.stopped)) {
      this.changed();
      return;
    }
    const pos = this.takeResume(item.key);
    this.cur = { kind: 'file', key: item.key, run: new FileRun(this.ctx!, this.bus!, item.key, b, item.gain, pos, this.fadeIn) };
    this.prune();
    this.ensureTimer();
    this.changed();
  }

  /** 読めなかった曲は飛ばして次へ（全部だめなら止まる） */
  private fileFailed(item: BgmItem): void {
    this.failed.add(item.key);
    if (this.items[this.index]?.key !== item.key) return;
    for (let d = 1; d <= this.items.length; d++) {
      const j = (this.index + d) % this.items.length;
      if (!this.failed.has(this.items[j].key)) {
        this.index = j;
        this.fadeIn = SWITCH_FADE;
        this.sync();
        return;
      }
    }
    this.changed();
  }

  private async decode(url: string): Promise<AudioBuffer> {
    const have = this.bufs.get(url);
    if (have) return have;
    let p = this.inflight.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const buf = await this.ctx!.decodeAudioData(data);
        this.bufs.set(url, buf);
        return buf;
      })();
      this.inflight.set(url, p);
      p.finally(() => this.inflight.delete(url)).catch(() => undefined);
    }
    return p;
  }

  private async buffersFor(item: BgmItem): Promise<Buffers> {
    const [intro, body] = await Promise.all([item.intro ? this.decode(item.intro) : Promise.resolve(null), this.decode(item.body!)]);
    return { intro, body, introSec: item.introSec, bodySec: item.bodySec };
  }

  /** 持つバッファは今の曲と次の曲（順番に回す曲の次）の分だけ */
  private prune(): void {
    const keep = new Set<string>();
    const add = (it: BgmItem | undefined) => {
      if (it?.kind !== 'file') return;
      if (it.intro) keep.add(it.intro);
      keep.add(it.body!);
    };
    add(this.items[this.index]);
    const n = nextRotateIndex(this.items, this.index);
    if (n !== null) add(this.items[n]);
    for (const u of [...this.bufs.keys()]) if (!keep.has(u)) this.bufs.delete(u);
  }

  private tick(): void {
    const c = this.cur;
    if (!c || c.run.stopped || !this.ctx) return;
    try {
      if (c.kind === 'synth') {
        c.run.scheduleUntil(this.ctx.currentTime + (document.hidden ? AHEAD_HIDDEN : AHEAD_VISIBLE));
        return;
      }
      // 順番に回す曲：本体を 2 周したら次の曲へ（少し前から次の曲を読み込んでおく）
      const n = nextRotateIndex(this.items, this.index);
      if (n === null || n === this.index) return;
      const pos = c.run.position();
      const end = rotateAt(c.run.introSec, c.run.bodySec);
      if (end - pos < PREFETCH_SEC) void this.buffersFor(this.items[n]).catch(() => undefined);
      if (pos >= end - SWITCH_FADE) {
        this.resume = null;
        this.stopAll(SWITCH_FADE);
        this.index = n;
        this.fadeIn = SWITCH_FADE;
        this.sync();
      }
    } catch (e) {
      this.err(e);
      this.stopAll(0.1);
    }
  }

  /** 止める（続きから鳴らせるように位置を覚える） */
  private stopAll(fade: number): void {
    this.loadingKey = null;
    const c = this.cur;
    if (c && !c.run.stopped && this.ctx) {
      if (c.kind === 'synth') {
        // いま聞こえているところ（予約の先頭ではなく）
        const ahead = Math.max(0, Math.round((c.run.nextTime - this.ctx.currentTime) / c.run.song.stepSec));
        const total = c.run.song.totalSteps;
        this.resume = { key: c.key, at: (((c.run.step - ahead) % total) + total) % total };
      } else this.resume = { key: c.key, at: c.run.position() };
      c.run.stop(fade);
      this.last = c;
    }
    this.cur = null;
    this.ensureTimer();
  }
}

export const bgm = new BgmEngine();
