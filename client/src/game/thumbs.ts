// YouTube のサムネイル（i.ytimg.com の静止画）を読み込んで覚えておく。
// 生配信の形（/live/）なら hqdefault_live.jpg を先に試し、無ければ hqdefault.jpg。
// 無い画像は 120×90 の灰色の代わりの絵が返ることがあるので、幅 120 以下は「無い」とみなす。

import { thumbnailUrls } from '@va/shared';

interface Entry {
  img: HTMLImageElement | null;
  state: 'loading' | 'ok' | 'none';
}

const cache = new Map<string, Entry>();

export const getThumb = (id: string, live: boolean): HTMLImageElement | null => {
  const key = `${id}:${live ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit.state === 'ok' ? hit.img : null;
  const entry: Entry = { img: null, state: 'loading' };
  cache.set(key, entry);
  const urls = thumbnailUrls({ id, live });
  const tryAt = (i: number) => {
    if (i >= urls.length) {
      entry.state = 'none';
      return;
    }
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (img.naturalWidth <= 120 && i + 1 < urls.length) return tryAt(i + 1);
      entry.img = img;
      entry.state = 'ok';
    };
    img.onerror = () => tryAt(i + 1);
    img.src = urls[i];
  };
  tryAt(0);
  return null;
};

/** サムネイルの URL（<img> で出すとき用。読み込みが済んでいればその URL） */
export const thumbSrc = (id: string, live: boolean): string => {
  const img = getThumb(id, live);
  return img?.src ?? thumbnailUrls({ id, live }).at(-1)!;
};
