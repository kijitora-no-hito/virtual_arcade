import { describe, expect, it } from 'vitest';
import {
  checkPosterUrl,
  posterExpiresAt,
  sortPosters,
  upcomingPosters,
  urlDomain,
  validatePoster,
  type PosterView,
} from '../src';

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = 1_800_000_000_000;
const ok = { title: '格闘ゲーム交流大会', kind: 'tournament', startsAt: NOW + 2 * D };

describe('ポスターの検証', () => {
  it('正しいもの（題名・種類・開始だけでよい）', () => {
    const r = validatePoster(ok, NOW);
    expect(r.error).toBeUndefined();
    expect(r.value).toMatchObject({ title: '格闘ゲーム交流大会', kind: 'tournament', game: '', body: '', url: null, endsAt: null });
  });

  it('文字数（題名 40・ゲーム名 30・内容 400）・題名は必須', () => {
    expect(validatePoster({ ...ok, title: '' }, NOW).error?.code).toBe('bad-input');
    expect(validatePoster({ ...ok, title: '   ' }, NOW).error?.code).toBe('bad-input');
    expect(validatePoster({ ...ok, title: 'あ'.repeat(40) }, NOW).error).toBeUndefined();
    expect(validatePoster({ ...ok, title: 'あ'.repeat(41) }, NOW).error?.code).toBe('too-long');
    expect(validatePoster({ ...ok, game: 'あ'.repeat(31) }, NOW).error?.code).toBe('too-long');
    expect(validatePoster({ ...ok, body: 'あ'.repeat(400) }, NOW).error).toBeUndefined();
    expect(validatePoster({ ...ok, body: 'あ'.repeat(401) }, NOW).error?.code).toBe('too-long');
    // 絵文字は 1 文字
    expect(validatePoster({ ...ok, title: '🎮'.repeat(40) }, NOW).error).toBeUndefined();
  });

  it('内容の改行は残す（3 行以上の空行は 2 行に）', () => {
    expect(validatePoster({ ...ok, body: '1 行目\r\n2 行目\n\n\n\n3 行目' }, NOW).value?.body).toBe('1 行目\n2 行目\n\n3 行目');
  });

  it('NG 語（題名・ゲーム名・内容・URL）', () => {
    expect(validatePoster({ ...ok, title: '死ね' }, NOW).error?.code).toBe('ng');
    expect(validatePoster({ ...ok, game: '死 ね' }, NOW).error?.code).toBe('ng');
    expect(validatePoster({ ...ok, body: 'しね' }, NOW).error).toBeUndefined(); // 2 文字のひらがなは一覧に入れていない
    expect(validatePoster({ ...ok, body: 'きっと殺す' }, NOW).error?.code).toBe('ng');
    expect(validatePoster({ ...ok, url: 'https://example.com/fuck' }, NOW).error?.code).toBe('ng');
  });

  it('種類は 4 つのどれか', () => {
    for (const k of ['tournament', 'match', 'event', 'other']) expect(validatePoster({ ...ok, kind: k }, NOW).error).toBeUndefined();
    expect(validatePoster({ ...ok, kind: 'spam' }, NOW).error?.code).toBe('bad-input');
  });

  it('URL：http(s) だけ・ユーザー名とパスワードなし・ホスト名にドット・300 文字まで', () => {
    expect(checkPosterUrl('https://start.gg/tournament/x')).toBe('https://start.gg/tournament/x');
    expect(checkPosterUrl('http://example.com')).toBe('http://example.com/');
    expect(checkPosterUrl('javascript:alert(1)')).toBeNull();
    expect(checkPosterUrl('data:text/html,x')).toBeNull();
    expect(checkPosterUrl('ftp://example.com/')).toBeNull();
    expect(checkPosterUrl('https://user:pw@example.com/')).toBeNull();
    expect(checkPosterUrl('https://localhost/')).toBeNull();
    expect(checkPosterUrl('https://exa mple.com/')).toBeNull();
    expect(checkPosterUrl(`https://example.com/${'a'.repeat(300)}`)).toBeNull();
    expect(validatePoster({ ...ok, url: 'javascript:alert(1)' }, NOW).error?.code).toBe('bad-url');
    expect(validatePoster({ ...ok, url: '' }, NOW).value?.url).toBeNull();
    expect(urlDomain('https://www.youtube.com/watch?v=x')).toBe('youtube.com');
  });

  it('日時：開始は必須・30 日先まで・終了は開始より後で 7 日まで・もう終わったものは不可', () => {
    expect(validatePoster({ ...ok, startsAt: undefined }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, startsAt: 'あした' }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, startsAt: NOW + 31 * D }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, startsAt: NOW + 29 * D }, NOW).error).toBeUndefined();
    expect(validatePoster({ ...ok, endsAt: ok.startsAt - 1 }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, endsAt: ok.startsAt + 8 * D }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, endsAt: ok.startsAt + 3 * H }, NOW).value?.endsAt).toBe(ok.startsAt + 3 * H);
    // 始まっていても、終わっていなければ貼れる（終了なし = 開始から 1 日）
    expect(validatePoster({ ...ok, startsAt: NOW - 3 * H }, NOW).error).toBeUndefined();
    expect(validatePoster({ ...ok, startsAt: NOW - 25 * H }, NOW).error?.code).toBe('bad-time');
    expect(validatePoster({ ...ok, startsAt: NOW - 3 * H, endsAt: NOW - H }, NOW).error?.code).toBe('bad-time');
  });

  it('自動ではがす時刻：終了、無ければ開始から 1 日', () => {
    expect(posterExpiresAt({ startsAt: NOW, endsAt: null })).toBe(NOW + D);
    expect(posterExpiresAt({ startsAt: NOW, endsAt: NOW + 2 * H })).toBe(NOW + 2 * H);
  });
});

describe('ポスターの並び順', () => {
  const p = (id: number, startsAt: number, pinned = false, createdAt = NOW): PosterView => ({
    id,
    kind: 'event',
    title: `p${id}`,
    game: '',
    body: '',
    url: null,
    startsAt,
    endsAt: null,
    authorName: 'あ',
    authorPid: 'x',
    pinned,
    createdAt,
    updatedAt: createdAt,
    expiresAt: startsAt + D,
  });

  it('ピンのもの → 開始の近い順 → 新しい順', () => {
    const list = [p(1, NOW + 5 * D), p(2, NOW + D), p(3, NOW + 9 * D, true), p(4, NOW + D, false, NOW + 10), p(5, NOW - H)];
    expect(sortPosters(list).map((x) => x.id)).toEqual([3, 5, 4, 2, 1]);
  });

  it('大画面の「近日のイベント」は 7 日以内を 3 件まで（開始の順）', () => {
    const list = [p(1, NOW + 5 * D), p(2, NOW + D), p(3, NOW + 9 * D, true), p(4, NOW + 2 * D), p(5, NOW + 3 * D)];
    expect(upcomingPosters(list, NOW).map((x) => x.id)).toEqual([2, 4, 5]);
  });
});
