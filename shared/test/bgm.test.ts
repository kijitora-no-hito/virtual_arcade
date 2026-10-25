import { describe, expect, it } from 'vitest';
import {
  BGM_RULES,
  compileSong,
  isBgmFileName,
  midiToFreq,
  noteToMidi,
  parseDrumPattern,
  parseTonePattern,
  songSeconds,
  SONGS,
  STEPS_PER_BAR,
  validateSong,
  type Song,
} from '../src';

describe('音符の読み取り', () => {
  it('音名 → MIDI', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('H4')).toBeNull();
    expect(noteToMidi('C')).toBeNull();
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });

  it('1 小節のパターン（長さ・休み・和音）', () => {
    expect(parseTonePattern('C5:4 r:4 E5+G5:8')).toEqual([
      { step: 0, len: 4, notes: [72] },
      { step: 8, len: 8, notes: [76, 79] },
    ]);
    // 長さを省くと 1
    expect(parseTonePattern(Array(16).fill('C4').join(' '))).toHaveLength(16);
    expect(() => parseTonePattern('C5:4 E5:4')).toThrow(/16/); // 足りない
    expect(() => parseTonePattern('C5:16 E5:1')).toThrow(/17/); // はみ出す
    expect(() => parseTonePattern('X5:16')).toThrow();
    expect(() => parseTonePattern('C5:0 C5:16')).toThrow();
  });

  it('ドラムのパターン', () => {
    const d = parseDrumPattern('K.h.S.h.c.......');
    expect(d.map((e) => e.step)).toEqual([0, 2, 4, 6, 8]);
    expect(d[0].hits).toEqual(['kick', 'hat']);
    expect(d[4].hits).toEqual(['crash', 'kick']);
    expect(() => parseDrumPattern('K.h.')).toThrow();
    expect(() => parseDrumPattern('K.h.S.h.K.h.S.hz')).toThrow();
  });
});

describe('合成の曲（SONGS）', () => {
  it('2〜4 曲・id が重ならない', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(2);
    expect(SONGS.length).toBeLessThanOrEqual(4);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
  });

  for (const song of SONGS) {
    describe(song.title, () => {
      it('決まり（音域・長さ・ループの長さ）に合う', () => {
        expect(validateSong(song)).toEqual([]);
      });

      it('ループは 30〜60 秒で、どのトラックも同じ長さ', () => {
        const sec = songSeconds(song);
        expect(sec).toBeGreaterThanOrEqual(BGM_RULES.minSeconds);
        expect(sec).toBeLessThanOrEqual(BGM_RULES.maxSeconds);
        const c = compileSong(song);
        expect(c.totalSteps).toBe(song.bars * STEPS_PER_BAR);
        for (const t of song.tracks) expect(t.seq.trim().split(/\s+/)).toHaveLength(song.bars);
      });

      it('音がループの終わりを越えず、継ぎ目の前後に音がある（途切れない）', () => {
        const c = compileSong(song);
        for (const t of c.tracks)
          if (t.kind === 'tone') for (const e of t.events) expect(e.step + e.len).toBeLessThanOrEqual(c.totalSteps);
        // 最後の小節と最初の小節のどちらにも何か鳴っている
        const lastBar = c.byStep.slice(-STEPS_PER_BAR).flat();
        const firstBar = c.byStep.slice(0, STEPS_PER_BAR).flat();
        expect(lastBar.length).toBeGreaterThan(0);
        expect(firstBar.length).toBeGreaterThan(0);
        // ベースは最初の拍で鳴る（ループの頭がはっきりする）
        const bass = c.tracks.find((t) => t.kind === 'tone' && t.track.name === 'bass');
        expect(bass && bass.kind === 'tone' && bass.events[0].step).toBe(0);
      });

      it('byStep にすべての出来事が入っている', () => {
        const c = compileSong(song);
        const n = c.tracks.reduce((a, t) => a + t.events.length, 0);
        expect(c.byStep.flat()).toHaveLength(n);
      });
    });
  }
});

describe('validateSong が誤りを見つける', () => {
  const base = (): Song => ({
    id: 'test',
    title: 'テスト',
    mood: '',
    bpm: 120,
    bars: 16, // 32 秒
    tracks: [
      { kind: 'tone', name: 'bass', wave: 'triangle', volume: 0.5, patterns: { A: 'C2:16' }, seq: Array(16).fill('A').join(' ') },
      { kind: 'drums', name: 'drums', volume: 0.5, patterns: { d: 'K.h.S.h.K.h.S.h.' }, seq: Array(16).fill('d').join(' ') },
    ],
  });
  it('正しい曲は誤りなし', () => expect(validateSong(base())).toEqual([]));
  it('ループが短すぎる・長すぎる', () => {
    expect(validateSong({ ...base(), bpm: 200 }).join()).toMatch(/秒/);
    expect(validateSong({ ...base(), bpm: 60 }).join()).toMatch(/秒/);
  });
  it('小節数が合わない', () => {
    const s = base();
    s.tracks[0].seq = 'A A A';
    expect(validateSong(s).join()).toMatch(/3 小節/);
  });
  it('音域外・ベースが高すぎる', () => {
    const s = base();
    (s.tracks[0] as { patterns: Record<string, string> }).patterns.A = 'C8:16';
    expect(validateSong(s).join()).toMatch(/音域外/);
    (s.tracks[0] as { patterns: Record<string, string> }).patterns.A = 'C5:16';
    expect(validateSong(s).join()).toMatch(/ベースが高すぎる/);
  });
  it('無いパターン・使われないパターン', () => {
    const s = base();
    s.tracks[1].seq = Array(16).fill('zz').join(' ');
    expect(validateSong(s).join()).toMatch(/zz/);
  });
  it('1 小節の長さが違う', () => {
    const s = base();
    (s.tracks[0] as { patterns: Record<string, string> }).patterns.A = 'C2:15';
    expect(validateSong(s).join()).toMatch(/15 ステップ/);
  });
});

describe('差し替えのファイル名', () => {
  it('許す', () => {
    for (const n of ['song.mp3', 'My Song 01.ogg', '店内.M4A', 'a-b_c.mp3']) expect(isBgmFileName(n)).toBe(true);
  });
  it('拒む（拡張子・区切り・. で始まる・制御文字）', () => {
    for (const n of ['song.wav', 'song.mp3.txt', '../song.mp3', 'a/b.mp3', 'a\\b.mp3', '.hidden.mp3', 'bgm.json', 'a\u0000.mp3', 'C:x.mp3', 'a..mp3', ''])
      expect(isBgmFileName(n)).toBe(false);
  });
});
