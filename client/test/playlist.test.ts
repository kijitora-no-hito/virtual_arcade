import { describe, expect, it } from 'vitest';
import { buildPlaylist, nextRotateIndex, partAt, rotateAt, synthItems } from '../src/audio/playlist';
import { SONGS, type BgmFile } from '@va/shared';

const file = (body: string, extra: Partial<BgmFile> = {}): BgmFile => ({
  id: body,
  title: body,
  author: '魔王魂',
  credit: null,
  intro: null,
  body,
  introSec: null,
  bodySec: null,
  gain: 0.5,
  rotate: true,
  ...extra,
});

describe('一覧', () => {
  it('何も無ければ合成の曲だけ', () => {
    const p = buildPlaylist(null, '/arcade');
    expect(p.map((i) => i.key)).toEqual(SONGS.map((s) => `synth:${s.id}`));
    expect(p.every((i) => !i.rotate)).toBe(true);
  });

  it('サーバの曲が先・合成の曲が後。URL は BASE_PATH 付き・クレジットは「音楽：作者」', () => {
    const p = buildPlaylist({ synth: true, files: [file('a b.ogg', { intro: 'a.intro.ogg', credit: '音楽：魔王魂（編集）' }), file('c.ogg')] }, '/arcade');
    expect(p.map((i) => i.key)).toEqual(['file:a b.ogg', 'file:c.ogg', ...synthItems().map((i) => i.key)]);
    expect(p[0]).toMatchObject({ body: '/arcade/bgm/a%20b.ogg', intro: '/arcade/bgm/a.intro.ogg', credit: '音楽：魔王魂（編集）', gain: 0.5 });
    expect(p[1]).toMatchObject({ intro: null, credit: '音楽：魔王魂' });
  });

  it('synth: false なら合成の曲を外す（曲が無いときは外さない）', () => {
    expect(buildPlaylist({ synth: false, files: [file('a.ogg')] }, '').map((i) => i.key)).toEqual(['file:a.ogg']);
    expect(buildPlaylist({ synth: false, files: [] }, '')).toHaveLength(SONGS.length);
  });

  it('順番に回す曲の次', () => {
    const p = buildPlaylist({ synth: true, files: [file('a'), file('b', { rotate: false }), file('c')] }, '');
    expect(nextRotateIndex(p, 0)).toBe(2);
    expect(nextRotateIndex(p, 2)).toBe(0); // 先頭へ戻る（合成の曲は飛ばす）
    expect(nextRotateIndex(p, 1)).toBeNull(); // rotate でない曲は回さない
    expect(nextRotateIndex(p, 3)).toBeNull(); // 合成の曲
    const one = buildPlaylist({ synth: true, files: [file('a')] }, '');
    expect(nextRotateIndex(one, 0)).toBe(0);
  });
});

describe('イントロ + 本体の位置', () => {
  it('イントロの中・本体の何周目', () => {
    expect(partAt(3, 10, 20)).toEqual({ inIntro: true, offset: 3, laps: 0 });
    expect(partAt(10, 10, 20)).toEqual({ inIntro: false, offset: 0, laps: 0 });
    expect(partAt(35, 10, 20)).toEqual({ inIntro: false, offset: 5, laps: 1 });
    expect(partAt(-1, 10, 20)).toEqual({ inIntro: true, offset: 0, laps: 0 });
    expect(partAt(5, 0, 20)).toEqual({ inIntro: false, offset: 5, laps: 0 });
  });
  it('次へ進める時刻 = イントロ + 本体 2 周', () => {
    expect(rotateAt(10, 20)).toBe(50);
    expect(rotateAt(0, 30, 3)).toBe(90);
  });
});
