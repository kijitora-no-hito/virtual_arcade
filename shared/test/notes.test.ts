import { describe, expect, it } from 'vitest';
import {
  convertView,
  FLOOR,
  isPassable,
  noteSpots,
  notePageCount,
  noteViewCount,
  pageRange,
  requestBoxSpots,
  tidyNoteText,
  validateNote,
  validateRequest,
  viewOfIndex,
  viewPages,
} from '../src';

describe('ノートの検証（DESIGN §12）', () => {
  it('3 行まで・90 文字まで（改行は数えない）・空の行を詰める', () => {
    expect(validateNote({ name: 'たいよう', text: '一\n二\n三' }).value).toEqual({ name: 'たいよう', text: '一\n二\n三' });
    expect(validateNote({ name: 'たいよう', text: '一\n二\n三\n四' }).error?.code).toBe('too-long');
    expect(validateNote({ name: 'たいよう', text: 'あ'.repeat(90) }).value).toBeTruthy();
    expect(validateNote({ name: 'たいよう', text: 'あ'.repeat(91) }).error?.code).toBe('too-long');
    expect(validateNote({ name: 'たいよう', text: `${'あ'.repeat(30)}\n${'い'.repeat(30)}\n${'う'.repeat(30)}` }).value).toBeTruthy();
    expect(tidyNoteText('\r\n  一  \r\n\r\n\t二​\n\n')).toBe('一\n二');
  });

  it('名前・NG 語・形', () => {
    expect(validateNote({ name: '', text: 'x' }).error?.code).toBe('bad-input');
    expect(validateNote({ name: 'あ'.repeat(21), text: 'x' }).error?.code).toBe('too-long');
    expect(validateNote({ name: 'し ね', text: 'x' }).error).toBeUndefined();
    expect(validateNote({ name: '死ね', text: 'x' }).error?.code).toBe('ng');
    expect(validateNote({ name: 'たいよう', text: 'シ・ネ' }).error).toBeUndefined();
    expect(validateNote({ name: 'たいよう', text: '死 ね' }).error?.code).toBe('ng');
    expect(validateNote(null).error?.code).toBe('bad-input');
    expect(validateNote({ name: 1, text: 'x' }).error?.code).toBe('bad-input');
  });
});

describe('ノートのページ分け', () => {
  it('1 ページ 4 件、0 件でも 1 ページ', () => {
    expect(notePageCount(0)).toBe(1);
    expect(notePageCount(4)).toBe(1);
    expect(notePageCount(5)).toBe(2);
    expect(pageRange(0, 10)).toEqual({ start: 0, end: 4 });
    expect(pageRange(2, 10)).toEqual({ start: 8, end: 10 });
    expect(pageRange(3, 10)).toEqual({ start: 10, end: 10 });
  });

  it('見開き（2 ページ）と 1 ページずつ', () => {
    // 9 件 = 3 ページ → 見開き 2 つ（2 つ目は右が空）
    expect(noteViewCount(9, 2)).toBe(2);
    expect(viewPages(0, 2, 9)).toEqual([0, 1]);
    expect(viewPages(1, 2, 9)).toEqual([2]);
    expect(noteViewCount(9, 1)).toBe(3);
    expect(viewPages(2, 1, 9)).toEqual([2]);
    // いちばん新しい件（通し番号 8）の載る見開き = 最後の見開き
    expect(viewOfIndex(8, 2)).toBe(noteViewCount(9, 2) - 1);
    expect(viewOfIndex(8, 1)).toBe(2);
  });

  it('見開き ⇄ 1 ページずつ に変えても、見ていたページが入る', () => {
    // 1 ページずつの 5 ページ目（番号 4）→ 見開きの 3 つ目（4・5 ページ）
    expect(convertView(4, 1, 2)).toBe(2);
    // 見開きの 3 つ目（ページ 4・5）→ 1 ページずつの 4 番
    expect(convertView(2, 2, 1)).toBe(4);
  });
});

describe('要望の検証（DESIGN §13）', () => {
  it('種類・500 文字・名前を出さない・NG 語では断らない', () => {
    expect(validateRequest({ kind: 'feature', text: '  ミニゲームを増やして\r\n\r\n\r\n\r\nほしい ', name: ' たいよう ' }).value).toEqual({
      kind: 'feature',
      text: 'ミニゲームを増やして\n\nほしい',
      name: 'たいよう',
    });
    expect(validateRequest({ kind: 'bug', text: '死ね と書けてしまう', name: null }).value?.name).toBeNull();
    expect(validateRequest({ kind: 'bug', text: 'x', name: '   ' }).value?.name).toBeNull();
    expect(validateRequest({ kind: 'x', text: 'x' }).error?.code).toBe('bad-input');
    expect(validateRequest({ kind: 'other', text: 'あ'.repeat(500) }).value).toBeTruthy();
    expect(validateRequest({ kind: 'other', text: 'あ'.repeat(501) }).error?.code).toBe('too-long');
    expect(validateRequest({ kind: 'other', text: 'x', name: 'あ'.repeat(21) }).error?.code).toBe('too-long');
    expect(validateRequest({ kind: 'other', text: '' }).error?.code).toBe('bad-input');
  });
});

describe('店内の置き場所', () => {
  it('ノートの机と要望箱が 1 つずつあり、通れないマスで、前に通れるマスがある', () => {
    for (const spots of [noteSpots(), requestBoxSpots()]) {
      expect(spots).toHaveLength(1);
      const s = spots[0];
      expect(isPassable(FLOOR, s.x, s.y)).toBe(false);
      const around = [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
      ].some(([dx, dy]) => isPassable(FLOOR, s.x + dx, s.y + dy));
      expect(around).toBe(true);
    }
  });
});
