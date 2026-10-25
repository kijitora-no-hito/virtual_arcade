// 店内の BGM の曲：BGM_DIR（既定 data/bgm/）の bgm.json と音声ファイル（mp3 / ogg / m4a）の一覧。
//
// bgm.json（任意。同梱の曲は tools/bgm/loop_bgm.py・loudness.py が書く。書き方は data/bgm/README.md）:
//   { "synth": true,
//     "tracks": [ { "title": "曲名", "author": "作者", "credit": "音楽：…", "intro": "x.intro.ogg", "body": "x.loop.ogg",
//                   "gain": 0.5, "rotate": true, "source": "x.mp3", "url": "…" } ] }
//   "synth": false で合成の曲を一覧から外す（曲が 1 つも無いときは外さない）。
// bgm.json に書いていない音声ファイルは、ファイル名を曲名にした本体だけの曲として一覧の後ろに加える。
// 配信するのは、この一覧の intro / body に入ったファイル名と完全に同じものだけ（パスの抜け道・ほかの拡張子・. で始まる名前・
// シンボリックリンク・フォルダは一覧に入らない）。

import fs from 'node:fs';
import path from 'node:path';
import { BGM_CREDIT_MAX, BGM_MAX_FILES, BGM_TITLE_MAX, isBgmFileName, tidy, type BgmFile, type BgmMeta } from '@va/shared';

interface JsonTrack {
  title?: unknown;
  author?: unknown;
  credit?: unknown;
  intro?: unknown;
  body?: unknown;
  gain?: unknown;
  rotate?: unknown;
  introSec?: unknown;
  bodySec?: unknown;
}

const sec = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 3600 ? v : null);
interface BgmJson {
  synth?: unknown;
  tracks?: unknown;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = [...tidy(v)].slice(0, max).join('');
  return t || null;
};

const readJson = (dir: string): BgmJson => {
  try {
    const raw = fs.readFileSync(path.join(dir, 'bgm.json'), 'utf8').replace(/^﻿/, '');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as BgmJson) : {};
  } catch {
    return {};
  }
};

/** フォルダの中のふつうのファイル（シンボリックリンク・フォルダは除く）で、配信してよい名前か */
const okFile = (dir: string, name: unknown): name is string => {
  if (typeof name !== 'string' || !isBgmFileName(name)) return false;
  try {
    return fs.lstatSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
};

/** 曲の一覧（bgm.json の順 → 書いていないファイルの名前順。50 曲まで） */
export const listBgm = (dir: string): BgmMeta => {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { files: [], synth: true };
  }
  const json = readJson(dir);
  const files: BgmFile[] = [];
  const used = new Set<string>();
  const tracks = Array.isArray(json.tracks) ? (json.tracks as JsonTrack[]) : [];
  for (const t of tracks) {
    if (files.length >= BGM_MAX_FILES) break;
    if (!t || typeof t !== 'object' || !okFile(dir, t.body) || used.has(t.body)) continue;
    const intro = t.intro !== undefined && t.intro !== null ? (okFile(dir, t.intro) ? t.intro : undefined) : null;
    if (intro === undefined) continue; // イントロを書いたのにファイルが無い
    const gain = typeof t.gain === 'number' && Number.isFinite(t.gain) ? Math.min(1.5, Math.max(0.1, t.gain)) : 1;
    used.add(t.body);
    if (intro) used.add(intro);
    files.push({
      id: t.body,
      title: text(t.title, BGM_TITLE_MAX) ?? t.body.replace(/\.[^.]+$/, ''),
      author: text(t.author, BGM_TITLE_MAX),
      credit: text(t.credit, BGM_CREDIT_MAX),
      intro,
      body: t.body,
      introSec: intro ? sec(t.introSec) : null,
      bodySec: sec(t.bodySec),
      gain,
      rotate: t.rotate !== false,
    });
  }
  for (const name of names.filter((n) => !used.has(n)).sort((a, b) => a.localeCompare(b, 'ja'))) {
    if (files.length >= BGM_MAX_FILES) break;
    if (!okFile(dir, name)) continue;
    files.push({
      id: name,
      title: name.replace(/\.[^.]+$/, ''),
      author: null,
      credit: null,
      intro: null,
      body: name,
      introSec: null,
      bodySec: null,
      gain: 1,
      rotate: true,
    });
  }
  return { files, synth: files.length === 0 || json.synth !== false };
};

/** 配信してよいファイル名（一覧の intro / body） */
export const servableBgm = (dir: string): Set<string> => {
  const s = new Set<string>();
  for (const f of listBgm(dir).files) {
    s.add(f.body);
    if (f.intro) s.add(f.intro);
  }
  return s;
};
