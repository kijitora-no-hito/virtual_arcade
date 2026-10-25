import { describe, expect, it } from 'vitest';
import {
  DUCK_INITIAL,
  duckReducer,
  FALLBACK_MS,
  isYouTubeOrigin,
  listeningMessage,
  playerStateFromMessage,
  type DuckEvent,
  type DuckState,
} from '../src/audio/videoDuck';

const run = (events: DuckEvent[], s: DuckState = DUCK_INITIAL) => events.reduce(duckReducer, s);
const NOCOOKIE = 'https://www.youtube-nocookie.com';

describe('視聴画面と BGM（duckReducer）', () => {
  it('開いただけでは止めない・再生が始まったら止める', () => {
    const s1 = run([{ type: 'open', at: 0 }]);
    expect(s1).toMatchObject({ watching: true, ducked: false });
    expect(run([{ type: 'player', state: -1 }, { type: 'player', state: 3 }], s1).ducked).toBe(false);
    expect(run([{ type: 'player', state: 1 }], s1).ducked).toBe(true);
  });

  it('一時停止・終了では戻さない。閉じたら戻す', () => {
    const s = run([{ type: 'open', at: 0 }, { type: 'player', state: 1 }, { type: 'player', state: 2 }, { type: 'player', state: 0 }]);
    expect(s.ducked).toBe(true);
    expect(run([{ type: 'close' }], s)).toEqual(DUCK_INITIAL);
  });

  it('状態が届かなければ数秒で止める（予備）', () => {
    const s = run([{ type: 'open', at: 1000 }, { type: 'tick', at: 1000 + FALLBACK_MS - 1 }]);
    expect(s.ducked).toBe(false);
    expect(run([{ type: 'tick', at: 1000 + FALLBACK_MS }], s).ducked).toBe(true);
  });

  it('状態が届いていれば予備は使わない（自動再生が止められて再生していない）', () => {
    const s = run([{ type: 'open', at: 0 }, { type: 'player', state: -1 }, { type: 'tick', at: FALLBACK_MS * 3 }]);
    expect(s.ducked).toBe(false);
  });

  it('閉じている間の状態・時間は無視', () => {
    expect(run([{ type: 'player', state: 1 }, { type: 'tick', at: 99999 }])).toEqual(DUCK_INITIAL);
  });

  it('開いたまま別の筐体へ（open が続く）は止めたまま', () => {
    const s = run([{ type: 'open', at: 0 }, { type: 'player', state: 1 }, { type: 'open', at: 100 }]);
    expect(s.ducked).toBe(true);
  });
});

describe('YouTube の埋め込みのメッセージ', () => {
  it('送り元のオリジンを確かめる', () => {
    expect(isYouTubeOrigin(NOCOOKIE)).toBe(true);
    expect(isYouTubeOrigin('https://www.youtube.com')).toBe(true);
    for (const o of ['https://evil.example', 'http://www.youtube-nocookie.com', 'https://www.youtube-nocookie.com.evil.example', 'null', ''])
      expect(isYouTubeOrigin(o)).toBe(false);
    expect(playerStateFromMessage('https://evil.example', '{"event":"onStateChange","info":1}')).toBeNull();
  });

  it('状態を取り出す（3 つの形）', () => {
    expect(playerStateFromMessage(NOCOOKIE, '{"event":"onStateChange","info":1}')).toBe(1);
    expect(playerStateFromMessage(NOCOOKIE, '{"event":"infoDelivery","info":{"playerState":2,"currentTime":3}}')).toBe(2);
    expect(playerStateFromMessage(NOCOOKIE, '{"event":"initialDelivery","info":{"playerState":-1}}')).toBe(-1);
    expect(playerStateFromMessage(NOCOOKIE, { event: 'onStateChange', info: 1 })).toBe(1);
  });

  it('関係のない・壊れたメッセージは null', () => {
    for (const d of ['{"event":"infoDelivery","info":{"currentTime":3}}', '{"event":"onReady"}', 'not json', '{"event":"onStateChange","info":"1"}', '{"event":"onStateChange","info":9}', null, 42])
      expect(playerStateFromMessage(NOCOOKIE, d)).toBeNull();
  });

  it('listening のメッセージ', () => {
    expect(JSON.parse(listeningMessage('va'))).toEqual({ event: 'listening', id: 'va', channel: 'widget' });
  });
});
