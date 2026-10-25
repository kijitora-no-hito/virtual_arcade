// 店内の BGM（合成して演奏する曲）。どれもこのアプリのために作ったオリジナル（実在の曲・既存のゲーム音楽のメロディは使っていない）。
// 書き方は bgm.ts の先頭。曲を足すときは SONGS に足して npm test（音域・長さ・ループの長さを確かめる）。

import type { Song } from './bgm';

/** 同じ並びを n 回 */
const rep = (s: string, n: number): string => Array(n).fill(s).join(' ');
/** 8 分のオクターブ跳躍のベース（lo hi lo hi …） */
const octave = (lo: string, hi: string): string => rep(`${lo}:2 ${hi}:2`, 4);
/** 16 分で刻むベース（lo lo hi lo × 4） */
const drive = (lo: string, hi: string): string => rep(`${lo} ${lo} ${hi} ${lo}`, 4);
/** 16 分のアルペジオ（4 音 × 4） */
const arp = (notes: string): string => rep(notes, 4);

/** 明るいメインのループ。C メジャー・136 BPM・24 小節（約 42 秒） */
const neonStart: Song = {
  id: 'neon-start',
  title: 'ネオン・スタート',
  mood: '明るい店内のメイン',
  bpm: 136,
  gain: 0.45, // −10.0 LUFS → −17 前後
  bars: 24,
  tracks: [
    {
      kind: 'tone',
      name: 'lead',
      wave: 'pulse25',
      volume: 0.3,
      gate: 0.82,
      patterns: {
        a1: 'E5:4 G5:2 E5:2 C6:4 G5:4',
        a2: 'B5:2 A5:2 G5:4 D5:4 r:4',
        a3: 'C5:2 E5:2 A5:4 G5:2 E5:2 C5:4',
        a4: 'F5:4 A5:4 G5:2 F5:2 E5:4',
        a5: 'E5:4 G5:2 E5:2 C6:4 D6:4',
        a6: 'B5:2 D6:2 B5:2 G5:2 D5:8',
        a7: 'A5:2 C6:2 A5:2 F5:2 G5:4 A5:4',
        a8: 'B5:4 G5:2 A5:2 B5:2 D6:2 r:4',
        a8b: 'B5:4 C6:2 D6:2 E6:4 r:4',
        b1: 'A5:6 G5:2 E5:4 C5:4',
        b2: 'F5:6 G5:2 A5:4 C6:4',
        b3: 'G5:6 E5:2 C5:4 E5:4',
        b4: 'D5:4 G5:4 B5:4 D6:4',
        b5: 'C6:4 B5:2 A5:2 E5:4 A5:4',
        b6: 'A5:4 G5:2 F5:2 C5:4 F5:4',
        b7: 'F5:4 E5:2 D5:2 A5:4 F5:4',
        b8: 'G5:2 F5:2 E5:2 D5:2 B4:4 D5:4',
      },
      seq: 'a1 a2 a3 a4 a5 a6 a7 a8  a1 a2 a3 a4 a5 a6 a7 a8b  b1 b2 b3 b4 b5 b6 b7 b8',
    },
    {
      kind: 'tone',
      name: 'bass',
      wave: 'triangle',
      volume: 0.55,
      gate: 0.7,
      patterns: {
        C: octave('C2', 'C3'),
        G: octave('G2', 'G3'),
        Am: octave('A2', 'A3'),
        F: octave('F2', 'F3'),
        Dm: octave('D2', 'D3'),
      },
      seq: 'C G Am F C G F G  C G Am F C G F G  Am F C G Am F Dm G',
    },
    {
      kind: 'tone',
      name: 'arp',
      wave: 'pulse12',
      volume: 0.1,
      gate: 0.6,
      patterns: {
        C: arp('C4 G4 C5 E5'),
        G: arp('B3 G4 B4 D5'),
        Am: arp('A3 E4 A4 C5'),
        F: arp('A3 F4 A4 C5'),
        Dm: arp('D4 A4 D5 F5'),
      },
      seq: '- - - - - - - -  C G Am F C G F G  Am F C G Am F Dm G',
    },
    {
      kind: 'drums',
      name: 'drums',
      volume: 0.5,
      patterns: {
        c1: 'c.h.S.h.K.h.S.h.',
        d1: 'K.h.S.h.K.h.S.h.',
        d1f: 'K.h.S.h.K.hkS.ss',
        d2: 'K.hhS.h.K.hhS.hh',
        d2f: 'K.h.S.h.K.ssSsss',
      },
      seq: 'c1 d1 d1 d1 d1 d1 d1 d1f  c1 d1 d1 d1 d1 d1 d1 d1f  c1 d2 d2 d2 d2 d2 d2 d2f',
    },
  ],
};

/** 落ち着いた夜の店内。A マイナー（セブンスの和音）・92 BPM・16 小節（約 42 秒）。メロディにこだま */
const midnightLobby: Song = {
  id: 'midnight-lobby',
  title: 'ミッドナイト・ロビー',
  mood: '落ち着いた夜の店内',
  bpm: 92,
  gain: 0.47, // −10.5 LUFS → −17 前後
  bars: 16,
  echo: { steps: 3, feedback: 0.35, mix: 0.32 },
  tracks: [
    {
      kind: 'tone',
      name: 'pad',
      wave: 'triangle',
      volume: 0.16,
      gate: 1,
      attack: 0.12,
      release: 0.5,
      patterns: {
        Am7: 'A3+C4+E4+G4:16',
        Dm7: 'A3+C4+D4+F4:16',
        G7: 'G3+B3+D4+F4:16',
        C7M: 'G3+B3+C4+E4:16',
        F7M: 'A3+C4+E4+F4:16',
        Bm7b5: 'A3+B3+D4+F4:16',
        E7: 'G#3+B3+D4+E4:16',
      },
      seq: rep('Am7 Dm7 G7 C7M F7M Bm7b5 E7 Am7', 2),
    },
    {
      kind: 'tone',
      name: 'bass',
      wave: 'triangle',
      volume: 0.5,
      gate: 0.9,
      release: 0.08,
      patterns: {
        Am7: 'A2:6 A2:2 E2:4 G2:4',
        Dm7: 'D2:6 D2:2 A2:4 C3:4',
        G7: 'G2:6 G2:2 D2:4 F2:4',
        C7M: 'C3:6 C3:2 G2:4 B2:4',
        F7M: 'F2:6 F2:2 C3:4 E3:4',
        Bm7b5: 'B2:6 B2:2 F2:4 A2:4',
        E7: 'E2:6 E2:2 B2:4 G#2:4',
      },
      seq: rep('Am7 Dm7 G7 C7M F7M Bm7b5 E7 Am7', 2),
    },
    {
      kind: 'tone',
      name: 'lead',
      wave: 'square',
      volume: 0.13,
      gate: 0.8,
      attack: 0.02,
      release: 0.12,
      echo: true,
      patterns: {
        l1: 'E5:6 D5:2 C5:4 r:4',
        l2: 'F5:6 E5:2 D5:4 A4:4',
        l3: 'B4:4 D5:4 F5:6 E5:2',
        l4: 'E5:12 r:4',
        l5: 'A5:6 G5:2 E5:4 C5:4',
        l6: 'D5:6 F5:2 A5:4 G5:4',
        l7: 'G#5:6 F5:2 E5:4 D5:4',
        l8: 'C5:4 B4:2 C5:2 A4:8',
        l9: 'r:4 A5:4 G5:2 E5:2 C5:4',
        l10: 'D5:4 F5:2 A5:2 C6:8',
        l11: 'B5:4 A5:2 G5:2 F5:4 D5:4',
        l12: 'E5:4 G5:4 B5:8',
        l13: 'C6:6 A5:2 G5:4 E5:4',
        l14: 'F5:6 D5:2 B4:4 A4:4',
        l15: 'B4:4 D5:4 G#5:4 B5:4',
        l16: 'A5:8 E5:4 r:4',
      },
      seq: 'l1 l2 l3 l4 l5 l6 l7 l8  l9 l10 l11 l12 l13 l14 l15 l16',
    },
    {
      kind: 'tone',
      name: 'bell',
      wave: 'pulse12',
      volume: 0.08,
      gate: 0.5,
      release: 0.15,
      echo: true,
      patterns: {
        Am7: 'r:8 A4:2 C5:2 E5:2 G5:2',
        Dm7: 'r:8 D5:2 F5:2 A5:2 C6:2',
        G7: 'r:8 G4:2 B4:2 D5:2 F5:2',
        C7M: 'r:8 E5:2 G5:2 B5:2 C6:2',
        F7M: 'r:8 F4:2 A4:2 C5:2 E5:2',
        Bm7b5: 'r:8 B4:2 D5:2 F5:2 A5:2',
        E7: 'r:8 E5:2 G#5:2 B5:2 D6:2',
      },
      seq: '- - - - - - - -  Am7 Dm7 G7 C7M F7M Bm7b5 E7 Am7',
    },
    {
      kind: 'drums',
      name: 'drums',
      volume: 0.32,
      patterns: {
        n1: 'k..hh.h.s..h.hh.',
        n2: 'k..hh.h.s..hk.o.',
      },
      seq: rep('n1 n1 n1 n2', 4),
    },
  ],
};

/** 大会の盛り上がり。E マイナー・152 BPM・24 小節（約 38 秒）。16 分で刻むベースとハイハット */
const tournamentFire: Song = {
  id: 'tournament-fire',
  title: 'トーナメント・ファイア',
  mood: '大会の盛り上がり',
  bpm: 152,
  gain: 0.62, // −12.9 LUFS → −17 前後
  bars: 24,
  tracks: [
    {
      kind: 'tone',
      name: 'lead',
      wave: 'pulse25',
      volume: 0.28,
      gate: 0.85,
      patterns: {
        t1: 'E5:2 E5:2 G5:2 B5:4 A5:2 G5:2 F#5:2',
        t2: 'G5:4 E5:4 C5:2 E5:2 G5:4',
        t3: 'F#5:2 F#5:2 A5:2 D6:4 C6:2 B5:2 A5:2',
        t4: 'B5:6 A5:2 F#5:4 D#5:4',
        t5: 'E5:2 E5:2 G5:2 B5:4 E6:2 D6:2 B5:2',
        t6: 'C6:4 B5:2 G5:2 E5:4 G5:4',
        t7: 'A5:2 B5:2 C6:2 D6:4 C6:2 B5:2 A5:2',
        t8: 'B5:4 F#5:4 D#6:8',
        u1: 'C6:4 B5:2 A5:2 E5:4 A5:4',
        u2: 'F#5:4 A5:2 D6:2 C6:4 A5:4',
        u3: 'B5:4 D6:2 B5:2 G5:4 D5:4',
        u4: 'E5:4 G5:2 B5:2 E6:8',
        u5: 'E6:4 D6:2 C6:2 A5:4 C6:4',
        u6: 'D6:4 C6:2 A5:2 F#5:4 A5:4',
        u7: 'B5:2 A5:2 F#5:2 D#5:2 B4:2 D#5:2 F#5:2 A5:2',
        u8: 'B5:12 r:4',
      },
      seq: 't1 t2 t3 t4 t5 t6 t7 t8  t1 t2 t3 t4 t5 t6 t7 t8  u1 u2 u3 u4 u5 u6 u7 u8',
    },
    {
      kind: 'tone',
      name: 'bass',
      wave: 'square',
      volume: 0.2,
      gate: 0.55,
      patterns: {
        Em: drive('E2', 'E3'),
        C: drive('C2', 'C3'),
        D: drive('D2', 'D3'),
        B: drive('B1', 'B2'),
        Am: drive('A2', 'A3'),
        G: drive('G2', 'G3'),
      },
      seq: 'Em C D B Em C D B  Em C D B Em C D B  Am D G Em Am D B B',
    },
    {
      kind: 'tone',
      name: 'arp',
      wave: 'pulse12',
      volume: 0.09,
      gate: 0.6,
      patterns: {
        Em: arp('E4 G4 B4 E5'),
        C: arp('C4 E4 G4 C5'),
        D: arp('D4 F#4 A4 D5'),
        B: arp('B3 D#4 F#4 B4'),
        Am: arp('A3 C4 E4 A4'),
        G: arp('G3 B3 D4 G4'),
      },
      seq: '- - - - - - - -  Em C D B Em C D B  Am D G Em Am D B B',
    },
    {
      kind: 'drums',
      name: 'drums',
      volume: 0.5,
      patterns: {
        c: 'chhhShhhKhKhShhh',
        m: 'KhhhShhhKhKhShhh',
        f: 'KhShShSSKSSSSSSS',
        m2: 'KhhKShhhKhKhShhK',
        f2: 'K.S.S.SSKSKSSSSo',
      },
      seq: 'c m m m m m m f  c m m m m m m f  c m2 m2 m2 m2 m2 m2 f2',
    },
  ],
};

/** 合成の曲の一覧（最初の曲が既定） */
export const SONGS: readonly Song[] = [neonStart, midnightLobby, tournamentFire];
