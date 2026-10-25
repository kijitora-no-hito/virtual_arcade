"""店内の BGM（同梱の曲）の音の大きさ（ラウドネス）を測って、data/bgm/bgm.json の gain をそろえる。
（同じ作者の別のゲームの道具を写したもの。違うのは一覧の形と gain の上限）。

usage（virtual_arcade フォルダで）:
  python tools/bgm/loudness.py                          # 測って表を出すだけ
  python tools/bgm/loudness.py --target -17 --apply     # gain を bgm.json に書き込む
  python tools/bgm/loudness.py --ref <WAV …>            # 比べるための WAV（合成の曲を書き出したものなど）も測る

測り方: ITU-R BS.1770 の統合ラウドネス（LUFS。pyloudnorm）。曲ごとに gain = 10^((目標 − 測った値) / 20) を 0.05 刻みで丸め、
0.1〜1.5 に収める（ブラウザの Web Audio の GainNode なので 1 を超えて大きくもできる。上げすぎは割れるので 1.5 まで）。
ループにした曲はイントロ + 本体 1 周（ブラウザで鳴る音）をつないで測る。
必要なもの: pip install --user miniaudio numpy pyloudnorm
"""
import argparse
import math
import os
import sys

import miniaudio
import numpy as np
import pyloudnorm as pyln

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest  # noqa: E402


def decode(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=2, sample_rate=44100)
    return np.frombuffer(d.samples, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def lufs_of(track):
    """曲の統合ラウドネスと長さ（秒）。ループの曲はイントロ + 本体 1 周（アプリで鳴る音）。"""
    files = [os.path.join(manifest.OUT, track[k]) for k in ('intro', 'body') if track.get(k)]
    if not files:
        files = [os.path.join(manifest.SRC, track['source'])]
    x = np.concatenate([decode(f) for f in files])
    return pyln.Meter(44100).integrated_loudness(x), len(x) / 44100


def gain_for(lufs, target):
    g = 10 ** ((target - lufs) / 20.0)
    return round(max(0.1, min(1.5, round(g / 0.05) * 0.05)), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', type=float, default=-17.0, help='目標のラウドネス（LUFS）')
    ap.add_argument('--ref', nargs='*', default=[], help='比べるために測るだけの WAV')
    ap.add_argument('--apply', action='store_true', help='bundled.json の gain を書き換える')
    a = ap.parse_args()

    data = manifest.load()
    rows = []
    for t in data['tracks']:
        if not t.get('body') and not os.path.isfile(os.path.join(manifest.SRC, t.get('source', ''))):
            continue
        lufs, dur = lufs_of(t)
        g = gain_for(lufs, a.target)
        after = lufs + 20 * math.log10(g)
        rows.append((t['source'], lufs, t.get('gain', 1.0), g, after, dur))
    print(f'target {a.target:.1f} LUFS')
    print(f'{"file":60} {"LUFS":>7} {"old":>5} {"new":>5} {"after":>7}')
    for f, l, old, g, after, dur in rows:
        print(f'{f:60} {l:7.1f} {old:5.2f} {g:5.2f} {after:7.1f}{"  (loop)" if any(t.get("source") == f and t.get("body") for t in data["tracks"]) else ""}')
    for r in a.ref:
        y = decode(r)
        print(f'{os.path.basename(r):60} {pyln.Meter(44100).integrated_loudness(y):7.1f}  (ref)')

    if a.apply:
        # gain を書き換える / 1 なら消す。
        new = {f: g for f, _, _, g, _, _ in rows}
        for t in data['tracks']:
            g = new.get(t.get('source'))
            if g is None:
                continue
            if g != 1.0:
                t['gain'] = g
            else:
                t.pop('gain', None)
        manifest.save(data)
        print('applied')


if __name__ == '__main__':
    sys.exit(main())
