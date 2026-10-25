// 店内の BGM：ブラウザの中（Web Audio）で合成して演奏する曲のデータの形と、その読み取り・検証。
// 曲そのものは songs.ts。サーバの data/bgm/ に置いた音声ファイル（差し替え）の型もここ。
//
// 曲の書き方（足すときはこの形で songs.ts に書き、npm test で検証する）：
// - 拍子は 4/4、1 小節 = 16 ステップ（16 分音符）。曲は bars 小節でループする。
// - トラックごとに「1 小節ぶんのパターン」に名前を付け（patterns）、seq に小節の順に並べる（空白区切り。'-' は 1 小節休み）。
//   どのトラックも seq の小節数 = bars。
// - 音のパターン：空白区切りの音符。`C5:4`（音名・オクターブ・長さ（ステップ））、`F#4:2`・`Bb3:2`（# / b）、
//   `r:4`（休み）、`C4+E4+G4:16`（和音）。長さを省くと 1。1 小節の合計はちょうど 16。小節をまたぐ音は書けない。
// - ドラムのパターン：16 文字。`k` キック・`s` スネア・`h` クローズのハイハット・`o` オープンのハイハット・`c` クラッシュ（+キック）・
//   `K` キック+ハイハット・`S` スネア+ハイハット・`.` 休み。

/** 1 小節のステップ数（16 分音符） */
export const STEPS_PER_BAR = 16;

/** 音色。pulse25 / pulse12 はデューティ比 25% / 12.5% の矩形波（チップチューンらしい音） */
export type Wave = 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'sawtooth';
export const WAVES: readonly Wave[] = ['square', 'pulse25', 'pulse12', 'triangle', 'sawtooth'];

export type DrumHit = 'kick' | 'snare' | 'hat' | 'open' | 'crash';
export const DRUM_CHARS: Record<string, DrumHit[]> = {
  '.': [],
  k: ['kick'],
  s: ['snare'],
  h: ['hat'],
  o: ['open'],
  c: ['crash', 'kick'],
  K: ['kick', 'hat'],
  S: ['snare', 'hat'],
};

export interface ToneTrack {
  kind: 'tone';
  name: string;
  wave: Wave;
  /** 0〜1 */
  volume: number;
  /** 音の長さのうち鳴らす割合（0〜1。既定 0.85）。短いほど歯切れがよい */
  gate?: number;
  /** 立ち上がり・余韻（秒。既定 0.005 / 0.04） */
  attack?: number;
  release?: number;
  /** 曲のこだま（Song.echo）に送る */
  echo?: boolean;
  /** 1 小節ぶんのパターン */
  patterns: Record<string, string>;
  /** パターンの名前を小節の順に（空白区切り。'-' は休み） */
  seq: string;
}

export interface DrumTrack {
  kind: 'drums';
  name: string;
  volume: number;
  patterns: Record<string, string>;
  seq: string;
}

export type Track = ToneTrack | DrumTrack;

export interface Song {
  id: string;
  title: string;
  /** 雰囲気（画面に出す短い説明） */
  mood: string;
  bpm: number;
  /**
   * 曲全体の音量の倍率（既定 1。0.1〜1.5）。同梱の曲（-17 LUFS 前後にそろえてある）と大きさがそろうよう、
   * scripts/dev/bgm-check.mjs を WAV_DIR 付きで動かして書き出した WAV を tools/bgm/loudness.py --ref で測って決める
   */
  gain?: number;
  /** ループの長さ（小節） */
  bars: number;
  /** こだま（echo: true のトラックだけ）。steps = 遅れ（ステップ）、feedback = 繰り返しの減り方、mix = こだまの大きさ */
  echo?: { steps: number; feedback: number; mix: number };
  tracks: Track[];
}

/** 合成の曲の作者の表示 */
export const SYNTH_CREDIT = 'オリジナル（このアプリのために作曲）';

// ---------------------------------------------------------------- 読み取り

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60、'F#5' → 78、'Bb3' → 58。読めなければ null */
export const noteToMidi = (s: string): number | null => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** 音の出来事（ステップは曲の頭から数える） */
export interface ToneEvent {
  step: number;
  len: number;
  /** MIDI ノート番号（和音なら複数） */
  notes: number[];
}

export interface DrumEvent {
  step: number;
  hits: DrumHit[];
}

/** 1 小節の音のパターンを読む（step は小節の頭から）。書き方が違えば Error */
export const parseTonePattern = (p: string): ToneEvent[] => {
  const out: ToneEvent[] = [];
  let step = 0;
  for (const tok of p.trim().split(/\s+/).filter(Boolean)) {
    const m = /^([^:]+)(?::(\d+))?$/.exec(tok);
    if (!m) throw new Error(`読めない音符: ${tok}`);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    if (!Number.isInteger(len) || len < 1) throw new Error(`長さが不正: ${tok}`);
    if (m[1] !== 'r') {
      const notes = m[1].split('+').map((n) => {
        const v = noteToMidi(n);
        if (v === null) throw new Error(`読めない音名: ${tok}`);
        return v;
      });
      out.push({ step, len, notes });
    }
    step += len;
  }
  if (step !== STEPS_PER_BAR) throw new Error(`1 小節の長さが ${step} ステップ（${STEPS_PER_BAR} のはず）: ${p}`);
  return out;
};

/** 1 小節のドラムのパターン（16 文字）を読む */
export const parseDrumPattern = (p: string): DrumEvent[] => {
  if (p.length !== STEPS_PER_BAR) throw new Error(`ドラムのパターンは ${STEPS_PER_BAR} 文字: ${p}`);
  const out: DrumEvent[] = [];
  [...p].forEach((ch, step) => {
    const hits = DRUM_CHARS[ch];
    if (!hits) throw new Error(`読めないドラムの文字: ${ch}（${p}）`);
    if (hits.length) out.push({ step, hits });
  });
  return out;
};

export interface CompiledTone {
  kind: 'tone';
  track: ToneTrack;
  events: ToneEvent[];
}
export interface CompiledDrums {
  kind: 'drums';
  track: DrumTrack;
  events: DrumEvent[];
}
export interface CompiledSong {
  song: Song;
  totalSteps: number;
  /** 1 ステップの秒数 */
  stepSec: number;
  tracks: Array<CompiledTone | CompiledDrums>;
  /** ステップごとの出来事（演奏のときに引く）。byStep[s] = そのステップで始まるもの */
  byStep: Array<Array<{ t: number; tone?: ToneEvent; drum?: DrumEvent }>>;
}

export const stepSeconds = (bpm: number): number => 60 / bpm / 4;
export const songSeconds = (song: Song): number => song.bars * STEPS_PER_BAR * stepSeconds(song.bpm);

const seqOf = (t: Track): string[] => t.seq.trim().split(/\s+/).filter(Boolean);

/** 曲を演奏できる形にする（書き方が違えば Error） */
export const compileSong = (song: Song): CompiledSong => {
  const totalSteps = song.bars * STEPS_PER_BAR;
  const tracks: CompiledSong['tracks'] = [];
  for (const track of song.tracks) {
    const seq = seqOf(track);
    if (seq.length !== song.bars) throw new Error(`${song.id}/${track.name}: seq が ${seq.length} 小節（${song.bars} のはず）`);
    const parsed = new Map<string, ToneEvent[] | DrumEvent[]>();
    const get = (name: string) => {
      if (name === '-') return [];
      let v = parsed.get(name);
      if (!v) {
        const src = track.patterns[name];
        if (src === undefined) throw new Error(`${song.id}/${track.name}: パターン ${name} が無い`);
        try {
          v = track.kind === 'tone' ? parseTonePattern(src) : parseDrumPattern(src);
        } catch (e) {
          throw new Error(`${song.id}/${track.name}/${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        parsed.set(name, v);
      }
      return v;
    };
    if (track.kind === 'tone') {
      const events: ToneEvent[] = [];
      seq.forEach((name, bar) => {
        for (const e of get(name) as ToneEvent[]) events.push({ ...e, step: e.step + bar * STEPS_PER_BAR });
      });
      tracks.push({ kind: 'tone', track, events });
    } else {
      const events: DrumEvent[] = [];
      seq.forEach((name, bar) => {
        for (const e of get(name) as DrumEvent[]) events.push({ ...e, step: e.step + bar * STEPS_PER_BAR });
      });
      tracks.push({ kind: 'drums', track, events });
    }
  }
  const byStep: CompiledSong['byStep'] = Array.from({ length: totalSteps }, () => []);
  tracks.forEach((ct, t) => {
    if (ct.kind === 'tone') for (const e of ct.events) byStep[e.step].push({ t, tone: e });
    else for (const e of ct.events) byStep[e.step].push({ t, drum: e });
  });
  return { song, totalSteps, stepSec: stepSeconds(song.bpm), tracks, byStep };
};

/** 曲の決まり（音域・長さ・ループの長さなど）を確かめる。問題があれば説明の配列 */
export const BGM_RULES = {
  minSeconds: 30,
  maxSeconds: 60,
  minBpm: 60,
  maxBpm: 200,
  /** 音域（MIDI）。A1（55 Hz）〜 C7（2093 Hz） */
  minNote: 33,
  maxNote: 96,
  /** ベース（名前に bass を含むトラック）の上限：C4 */
  bassMax: 60,
  maxTracks: 6,
} as const;

export const validateSong = (song: Song): string[] => {
  const errs: string[] = [];
  const R = BGM_RULES;
  if (!/^[a-z0-9-]{1,32}$/.test(song.id)) errs.push(`id が不正: ${song.id}`);
  if (!song.title.trim()) errs.push(`${song.id}: 曲名が空`);
  if (!(song.bpm >= R.minBpm && song.bpm <= R.maxBpm)) errs.push(`${song.id}: テンポ ${song.bpm} が範囲外`);
  if (!Number.isInteger(song.bars) || song.bars < 1) errs.push(`${song.id}: 小節数が不正`);
  const sec = songSeconds(song);
  if (sec < R.minSeconds || sec > R.maxSeconds) errs.push(`${song.id}: ループが ${sec.toFixed(1)} 秒（${R.minSeconds}〜${R.maxSeconds} 秒のはず）`);
  if (song.gain !== undefined && !(song.gain >= 0.1 && song.gain <= 1.5)) errs.push(`${song.id}: gain ${song.gain} が範囲外`);
  if (!song.tracks.length || song.tracks.length > R.maxTracks) errs.push(`${song.id}: トラックの数が ${song.tracks.length}`);
  if (song.echo && !(song.echo.steps >= 1 && song.echo.feedback >= 0 && song.echo.feedback < 0.8 && song.echo.mix >= 0 && song.echo.mix <= 1))
    errs.push(`${song.id}: echo の値が範囲外`);
  for (const t of song.tracks) {
    if (!(t.volume > 0 && t.volume <= 1)) errs.push(`${song.id}/${t.name}: 音量 ${t.volume} が範囲外`);
    if (t.kind === 'tone' && !WAVES.includes(t.wave)) errs.push(`${song.id}/${t.name}: 音色 ${t.wave} が無い`);
    if (t.kind === 'tone' && t.gate !== undefined && !(t.gate > 0 && t.gate <= 1)) errs.push(`${song.id}/${t.name}: gate が範囲外`);
    if (t.kind === 'tone' && t.echo && !song.echo) errs.push(`${song.id}/${t.name}: echo: true なのに曲に echo が無い`);
    const used = new Set(seqOf(t));
    for (const name of Object.keys(t.patterns)) if (!used.has(name)) errs.push(`${song.id}/${t.name}: パターン ${name} が使われていない`);
  }
  let compiled: CompiledSong;
  try {
    compiled = compileSong(song);
  } catch (e) {
    errs.push(e instanceof Error ? e.message : String(e));
    return errs;
  }
  for (const ct of compiled.tracks) {
    if (ct.kind !== 'tone') continue;
    const bass = /bass/i.test(ct.track.name);
    for (const e of ct.events)
      for (const n of e.notes) {
        if (n < R.minNote || n > R.maxNote) errs.push(`${song.id}/${ct.track.name}: 音域外の音 ${n}（ステップ ${e.step}）`);
        if (bass && n > R.bassMax) errs.push(`${song.id}/${ct.track.name}: ベースが高すぎる ${n}（ステップ ${e.step}）`);
      }
    if (ct.events.some((e) => e.step + e.len > compiled.totalSteps)) errs.push(`${song.id}/${ct.track.name}: ループの終わりを越える音がある`);
  }
  return errs;
};

// ---------------------------------------------------------------- 差し替え（サーバの data/bgm/ の音声ファイル）

/**
 * サーバの data/bgm/ の曲 1 つ（/api/meta で配る）。ファイルは {BASE_PATH}/bgm/<ファイル名> で配信し、
 * ブラウザが Web Audio でイントロ → 本体（本体はサンプル単位で継ぎ目なくループ）とつないで鳴らす。
 * 同梱の曲（魔王魂）は tools/bgm/loop_bgm.py が作ったイントロ・本体の ogg。bgm.json に書いていないファイルは本体だけの曲になる。
 */
export interface BgmFile {
  /** 曲の識別子（本体のファイル名） */
  id: string;
  title: string;
  /** 作者（無ければ null） */
  author: string | null;
  /** 画面に出すクレジット（例「音楽：魔王魂（ループ・音量の調整のため編集）」。無ければ null） */
  credit: string | null;
  /** イントロのファイル名（無ければ null = 頭から本体） */
  intro: string | null;
  /** 本体（ループする部分）のファイル名 */
  body: string;
  /**
   * イントロ・本体の正しい長さ（秒。無ければファイルの長さ）。tools/bgm/loop_bgm.py の ogg は後ろに続きの音を 0.25 秒足してあり
   * （ブラウザが短い Vorbis の末尾を削ることがあるため）、ブラウザはこの長さでイントロを止め・本体をループする
   */
  introSec: number | null;
  bodySec: number | null;
  /** 音量の倍率（tools/bgm/loudness.py で曲ごとの大きさをそろえた値。0.1〜1.5） */
  gain: number;
  /** 順番に回す曲か（true = 本体を BGM_ROTATE_LAPS 周したら、次の rotate の曲へ） */
  rotate: boolean;
}

export interface BgmMeta {
  files: BgmFile[];
  /** 合成の曲も一覧に入れるか（bgm.json の "synth": false で外せる。ファイルが 1 つも無ければ常に入れる） */
  synth: boolean;
}

/** 順番に回す曲は、本体を何周したら次へ進むか */
export const BGM_ROTATE_LAPS = 2;

export const BGM_EXTENSIONS = ['mp3', 'ogg', 'm4a'] as const;
export const BGM_MIME: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4' };
/** 置ける音声ファイルの数・曲名の長さの上限 */
export const BGM_MAX_FILES = 50;
export const BGM_TITLE_MAX = 60;
export const BGM_CREDIT_MAX = 80;

/** 画面に出すクレジット（credit が無ければ「音楽：作者」、作者も無ければ null） */
export const bgmCredit = (f: Pick<BgmFile, 'credit' | 'author'>): string | null => f.credit ?? (f.author ? `音楽：${f.author}` : null);

/**
 * 配信してよいファイル名か：区切り（/ \）・制御文字・Windows で使えない文字を含まず、. で始まらず、
 * 拡張子が mp3 / ogg / m4a（小文字・大文字どちらも）。長さは 120 文字まで。
 */
export const isBgmFileName = (name: string): boolean =>
  typeof name === 'string' &&
  name.length <= 120 &&
  !name.startsWith('.') &&
  !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) &&
  /\.(mp3|ogg|m4a)$/i.test(name) &&
  !name.includes('..');
