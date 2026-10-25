"""店内の BGM（同梱の曲）をシームレスにループさせる。
（同じ作者の別のゲームの道具を写したもの。違うのは置き場所と一覧の形だけ）。

曲ごとに「後ろの位置 B からの音 ≒ 前の位置 A からの音」となる (A, B) を探し、
  data/bgm/<名前>.intro.ogg = 先頭の無音を削った頭 〜 A（A が頭とほぼ同じなら作らない）
  data/bgm/<名前>.loop.ogg  = A 〜 B（末尾 X ms は m[B-X:B] のフェードアウトと m[A-X:A] のフェードインを重ねる
                              = 最後のサンプルの次が先頭のサンプルへ連続につながる）
を書き、data/bgm/bgm.json の曲の欄に intro / body を書く。ブラウザは Web Audio でイントロ → 本体（AudioBufferSourceNode.loop）とつなぐ。
入力は bgm/ の元の mp3（git にも tar にも入れない）。

使い方（virtual_arcade フォルダで）:
    python tools/bgm/loop_bgm.py                 # find + build（全曲）
    python tools/bgm/loop_bgm.py find [曲名の一部 …]
        ループ点を探して tools/bgm/loops.json に書く。手で直した曲（"auto": false）は上書きしない（一致度を表示するだけ）。
    python tools/bgm/loop_bgm.py build [曲名の一部 …] [--quality 5]
        loops.json の値で intro.ogg / loop.ogg と確認用の WAV（bgm/_loop_preview/<曲>.wav）を書き、bgm.json に intro / body を書く。
    そのあと python tools/bgm/loudness.py --target -17 --apply（イントロ + 本体で測って gain を書く）。

loops.json（git に入れない（曲の名前が入るため）・手で直してよい）の曲ごとの欄（時刻はすべて元の mp3 を miniaudio でデコードした先頭からの秒）:
    start = A（本体の頭）、end = B（本体の終わり = A へ戻る所）、lead = イントロの頭（先頭の無音を削った位置）、
    crossfadeMs = 継ぎ目の重ね（X）、score = 継ぎ目の前後（B−1 秒〜B+0.5 秒 と A−1 秒〜A+0.5 秒）の波形の相関（ステレオ、1 = 同じ）、
    how = match（一致度が高い）/ weak（構造は同じだが波形は違う → 重ねを長く）/ fallback（戻れる所が無い → フェード前の拍の頭から頭へ）、
    bpm = 推定テンポ、auto = true（このツールの値。find で作り直す）/ false（手で直した。触らない）。

必要なもの: pip install --user miniaudio numpy scipy soundfile
曲ファイル（mp3・ogg・確認用の WAV）を公開リポジトリ・公開ページに置かない（素材の規約。data/bgm/README.md）。
"""
import argparse
import json
import os
import sys

import miniaudio
import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest  # noqa: E402

ROOT = manifest.ROOT
LOOPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "loops.json")
PREVIEW = manifest.PREVIEW
ABOUT = ("店内の BGM のループ点（tools/bgm/loop_bgm.py が書く。時刻は元の mp3 の先頭からの秒）。start = A（本体の頭）、end = B（A へ戻る所）、"
         "lead = イントロの頭、crossfadeMs = 継ぎ目の重ね、score = 継ぎ目の波形の一致度、auto = false の曲は手で直した値（ツールは上書きしない）。")

SR = 44100
ASR = 22050          # 特徴を取るときの標本化周波数
NFFT = 2048
HOP = 1024           # ≒ 46 ms
FPS = ASR / HOP
XFADE_MS = 30        # 一致度が高い曲の継ぎ目の重ね
XFADE_WEAK_MS = 150  # 一致度が低い曲・戻れる所が無い曲
GOOD = 0.85          # これ以上なら match
STRUCT_OK = 0.80     # 構造の一致（特徴の類似度）がこれ以上なら weak、未満なら fallback
WAVE_WEAK = 0.30     # weak にする波形の一致度の下限（これ未満は fallback）
PAD_S = 0.25         # イントロ・本体の後ろに足す続きの音（ブラウザが末尾を削っても足りるように）
MIN_INTRO_S = 0.02   # これより短いイントロは作らない（A ≒ 頭）
SILENCE = 0.002      # 先頭の無音のしきい値（≒ −54 dBFS）
CAND_RANGE = 0.12    # 波形で確かめる候補: 構造の一致が最良からこの差まで
CAND_MAX = 30        # 波形で確かめる候補の数（ずらし量が 0.5 秒以上違うもの）


# ------------------------------------------------------------------ 読み込みと特徴

def decode(path, sr, ch):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=ch, sample_rate=sr)
    x = np.frombuffer(d.samples, dtype=np.float32)
    return x.reshape(-1, ch) if ch > 1 else x


def features(m):
    """フレームごとの特徴（帯域の形 + クロマ、単位ベクトル）・オンセットの強さ・音量（dB）。"""
    n = (len(m) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(m[idx] * np.hanning(NFFT).astype(np.float32), axis=1)).astype(np.float32) ** 2
    freqs = np.fft.rfftfreq(NFFT, 1 / ASR)
    bi = np.searchsorted(freqs, np.geomspace(60, 10000, 41))
    bands = np.stack([spec[:, a:max(b, a + 1)].sum(axis=1) for a, b in zip(bi[:-1], bi[1:])], axis=1)
    lb = np.log(bands + 1e-8)
    lb -= lb.mean(axis=1, keepdims=True)
    lb /= np.linalg.norm(lb, axis=1, keepdims=True) + 1e-9
    ok = (freqs > 55) & (freqs < 5000)
    pc = (np.round(12 * np.log2(freqs[ok] / 440.0)) % 12).astype(int)
    sub = spec[:, ok]
    chroma = np.sqrt(np.stack([sub[:, pc == k].sum(axis=1) for k in range(12)], axis=1))
    chroma /= np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-9
    chroma -= 1 / np.sqrt(12)
    chroma /= np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-9
    ls = np.log1p(spec[:, freqs < 8000] * 100)
    flux = np.concatenate([[0], np.maximum(0, np.diff(ls, axis=0)).sum(axis=1)])
    db = 20 * np.log10(np.sqrt(spec.sum(axis=1) / NFFT) + 1e-9)
    f = np.concatenate([lb * 0.6, chroma * 0.8], axis=1)
    f /= np.linalg.norm(f, axis=1, keepdims=True) + 1e-9
    return f.astype(np.float32), flux, db


def beat_grid(flux):
    """テンポ（拍の秒）と位相（拍の格子の 0 番目の秒）。オンセットの自己相関（70〜200 BPM、120 寄り）。"""
    o = np.maximum(flux - np.convolve(flux, np.ones(16) / 16, mode="same"), 0)
    ac = np.correlate(o, o, mode="full")[len(o) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * FPS / np.maximum(lags, 1)
    ok = (bpm >= 70) & (bpm <= 200)
    w = np.exp(-0.5 * np.log2(bpm / 120) ** 2)
    best = int(lags[ok][np.argmax(ac[ok] * w[ok])])
    period = float(best)
    a, b, c = ac[best - 1], ac[best], ac[best + 1]
    if a - 2 * b + c != 0:
        period = best + 0.5 * (a - c) / (a - 2 * b + c)
    # 位相: 格子の上のオンセットの和が最大になるずれ。
    steps = 64
    sums = [o[np.round(np.arange(ph * period / steps, len(o) - 1, period)).astype(int)].sum() for ph in range(steps)]
    phase = int(np.argmax(sums)) * period / steps
    return period / FPS, phase / FPS


def body_end_sec(db):
    """本体の終わり（フェードアウト・最後の音の残響が始まる所）の秒。後ろから見て、音量が直前 8 秒の最大から 1.5 dB 以内に戻る最後の所。"""
    k = int(FPS)
    sm = np.convolve(db, np.ones(k) / k, mode="same")
    med = np.median(sm)
    w8 = int(8 * FPS)
    for t in range(len(sm) - 1, 0, -1):
        if sm[t] >= med - 10 and sm[t] >= sm[max(0, t - w8):t + 1].max() - 1.5:
            return t / FPS
    return len(sm) / FPS


def lead_samples(x):
    """先頭の無音の長さ（サンプル。しきい値を超える 5 ms 前）。"""
    a = np.abs(x).max(axis=1)
    i = int(np.argmax(a > SILENCE)) if (a > SILENCE).any() else 0
    return max(0, i - int(0.005 * SR))


def corr(x, i, j, before, after):
    """x[i-before:i+after] と x[j-before:j+after] の正規化相関（ステレオ）。"""
    if i - before < 0 or j - before < 0 or i + after > len(x) or j + after > len(x):
        return -1.0
    a = x[i - before:i + after]
    b = x[j - before:j + after]
    den = np.sqrt((a * a).sum() * (b * b).sum()) + 1e-12
    return float((a * b).sum() / den)


def best_lag(x, b, lag0, search, before, after):
    """B = b を固定し、A を b − lag0 の前後 ±search サンプルで動かして相関が最大のずらし量（サンプル）と相関。"""
    t = x[b - before:b + after]
    a0 = b - lag0
    lo = max(0, a0 - search - before)
    hi = min(len(x), a0 + search + after)
    seg = x[lo:hi]
    if len(seg) < len(t):
        return lag0, -1.0
    num = sum(fftconvolve(seg[:, c], t[::-1, c], mode="valid") for c in range(x.shape[1]))
    e = np.concatenate([[0], np.cumsum((seg ** 2).sum(axis=1))])
    den = np.sqrt((e[len(t):] - e[:-len(t)]) * (t ** 2).sum()) + 1e-12
    c = num / den
    i = int(np.argmax(c))
    a = lo + i + before
    return b - a, float(c[i])


# ------------------------------------------------------------------ ループ点を探す

def find_loop(path):
    m = decode(path, ASR, 1)
    x = decode(path, SR, 2).astype(np.float64)
    feat, flux, db = features(m)
    n = len(feat)
    lead = lead_samples(x)
    end_s = body_end_sec(db)
    beat, phase = beat_grid(flux)
    leadf = int(lead / SR * FPS)
    bef = int(end_s * FPS)
    tbmax = bef - int(1.0 * FPS)
    wb, wa = int(6 * FPS), int(1 * FPS)
    lmin = max(int(20 * FPS), int(0.3 * (bef - leadf)))

    def along(lag):
        """ずらし量 lag での、B の候補（フレーム）ごとの「B の前 6 秒〜後 1 秒が lag 前と似ているか」。"""
        s = np.einsum("ij,ij->i", feat[lag:], feat[:-lag])  # s[k] = フレーム k と k + lag の類似度
        cs = np.concatenate([[0], np.cumsum(s)])
        tb = np.arange(max(lag + leadf + wb // 2, lag + wb), tbmax + 1)
        k0, k1 = tb - lag - wb, tb - lag + wa
        ok = (k0 >= 0) & (k1 <= len(s))
        tb, k0, k1 = tb[ok], k0[ok], k1[ok]
        return (cs[k1] - cs[k0]) / np.maximum(k1 - k0, 1), tb

    # 1) 特徴でずらし量 L ごとの最良の B。
    coarse = []
    for lag in range(lmin, bef - leadf):
        sc, tb = along(lag)
        if len(tb) == 0:
            continue
        i = int(np.argmax(sc + 0.0005 * (tb - tb.max()) / FPS))
        coarse.append((float(sc[i]), lag, int(tb[i])))
    coarse.sort(key=lambda c: -c[0])
    top = coarse[0][0] if coarse else 0.0
    cands = []
    for c in coarse:
        if c[0] < top - CAND_RANGE:
            break
        if all(abs(c[1] - d[1]) > 0.5 * FPS for d in cands):
            cands.append(c)
        if len(cands) >= CAND_MAX:
            break

    # 2) 波形で L を詰め、拍の格子の上で B を選ぶ。
    before, after = int(1.0 * SR), int(0.5 * SR)
    grid = np.arange(phase, len(x) / SR, beat)
    results = []
    for sim, lag, tb in cands:
        sc, tbs = along(lag)
        b0 = int(tb / FPS * SR)
        lagx, _ = best_lag(x, b0, int(lag / FPS * SR), int(0.12 * SR), int(2 * SR), int(0.5 * SR))
        lo_s = (lead + lagx) / SR + 1.5
        good_tb = tbs[sc >= sim - 0.06] / FPS
        best = None
        for g in grid:
            if g < lo_s or g > tbmax / FPS:
                continue
            if len(good_tb) and np.min(np.abs(good_tb - g)) > 2.0:
                continue
            bi = int(round(g * SR))
            r = corr(x, bi, bi - lagx, before, after)
            key = r + 0.01 * g / (tbmax / FPS)
            if best is None or key > best[0]:
                best = (key, r, bi)
        if best is None:
            continue
        _, r, bi = best
        lagf, r2 = best_lag(x, bi, lagx, int(0.003 * SR), before, after)
        results.append({"sim": sim, "lag": lagf, "b": bi, "score": r2})
    total = (int(end_s * SR) - lead)
    pick = None
    if results:
        hi = max(r["score"] for r in results)
        near = [r for r in results if r["score"] >= hi - 0.03]
        pick = max(near, key=lambda r: (r["lag"] / total * 0.5 + r["score"], r["b"]))

    info = {"lead": lead / SR, "bpm": 60 / beat, "bodyEnd": end_s, "struct": top}
    if pick and pick["score"] >= GOOD:
        a, b, xf, how = pick["b"] - pick["lag"], pick["b"], XFADE_MS, "match"
    elif pick and pick["sim"] >= STRUCT_OK and pick["score"] >= WAVE_WEAK:
        a, b, xf, how = pick["b"] - pick["lag"], pick["b"], XFADE_WEAK_MS, "weak"
    else:
        # 3) 戻れる所が無い: フェード・残響の前の最後の拍の頭 → 先頭の無音を除いた頭（重ね 150 ms。A は頭 + X）。
        xf = XFADE_WEAK_MS
        g = grid[grid <= end_s - 0.5]
        b = int(round((g[-1] if len(g) else end_s - 0.5) * SR))
        a = lead + int(xf / 1000 * SR)
        how = "fallback"
    score = corr(x, b, a, before, after)
    return {"start": a / SR, "end": b / SR, "lead": lead / SR, "crossfadeMs": xf, "score": round(score, 3), "how": how,
            "bpm": round(info["bpm"], 1), "auto": True}, info


# ------------------------------------------------------------------ 書き出し

def samples(t):
    return int(round(t * SR))


def make_parts(x, e):
    """loops.json の欄 e から (イントロ or None, 本体) を作る（float32 のステレオ）。"""
    a, b, lead = samples(e["start"]), samples(e["end"]), samples(e.get("lead", 0.0))
    xf = max(1, samples(e.get("crossfadeMs", XFADE_MS) / 1000))
    if not (0 <= lead <= a < b <= len(x)) or a - xf < 0 or b - a <= 2 * xf:
        raise ValueError(f"ループ点がおかしい: lead {lead} start {a} end {b} (長さ {len(x)})")
    body = x[a:b].copy()
    t = (np.arange(xf) + 0.5) / xf
    if e.get("how", "match") == "match":
        fo, fi = 1 - t, t                                   # 似た音どうし = 直線（振幅を保つ）
    else:
        fo, fi = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)  # 似ていない音どうし = 等パワー
    body[-xf:] = x[b - xf:b] * fo[:, None] + x[a - xf:a] * fi[:, None]
    intro = None
    if a - lead >= MIN_INTRO_S * SR:
        intro = x[lead:a].copy()
        k = min(len(intro), int(0.003 * SR))
        intro[:k] *= np.linspace(0, 1, k)[:, None]  # 頭のクリックを避ける 3 ms
    return intro, body


def write_ogg(path, data, quality):
    data = np.clip(data, -1.0, 1.0).astype(np.float32)
    # libsndfile の Vorbis は一度に大きく書くとスタックがあふれる（Windows で落ちる）ので小分けに書く。
    with sf.SoundFile(path, "w", SR, 2, format="OGG", subtype="VORBIS", compression_level=1.0 - quality / 10.0) as out:
        for i in range(0, len(data), 4096):
            out.write(data[i:i + 4096])
    back = decode(path, SR, 2)
    if len(back) != len(data):
        raise RuntimeError(f"{path}: 読み直したサンプル数が違う（{len(back)} ≠ {len(data)}）")
    return back


def write_preview(name, intro, body):
    """確認用: 本体の終わり 8 秒 → 継ぎ目 → 本体の頭 8 秒、2 秒の無音、イントロの終わり（8 秒まで）→ 本体の頭 8 秒。"""
    os.makedirs(PREVIEW, exist_ok=True)
    k = 8 * SR
    gap = np.zeros((2 * SR, 2), np.float32)
    parts = [body[-k:], body[:k], gap]
    parts += [intro[-k:], body[:k]] if intro is not None else [body[:k]]
    path = os.path.join(PREVIEW, name + ".wav")
    sf.write(path, np.clip(np.concatenate(parts), -1, 1), SR, subtype="PCM_16")
    return path


# ------------------------------------------------------------------ loops.json

def load_loops():
    if not os.path.isfile(LOOPS):
        return {"about": ABOUT, "tracks": {}}
    with open(LOOPS, encoding="utf-8") as f:
        return json.load(f)


def save_loops(d):
    order = ["start", "end", "lead", "crossfadeMs", "score", "how", "bpm", "auto", "note"]
    lines = []
    for k, e in d["tracks"].items():
        keys = [o for o in order if o in e] + [o for o in e if o not in order]
        lines.append(f'    {json.dumps(k, ensure_ascii=False)}: {{' +
                     ", ".join(f'"{o}": {fmt(e[o])}' for o in keys) + "}")
    s = ('{\n  "about": ' + json.dumps(d.get("about", ABOUT), ensure_ascii=False) + ',\n  "tracks": {\n' +
         ",\n".join(lines) + "\n  }\n}\n")
    json.loads(s)
    with open(LOOPS, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def fmt(v):
    if isinstance(v, float):
        return f"{v:.6f}".rstrip("0").rstrip(".") if abs(v) < 10000 else str(v)
    return json.dumps(v, ensure_ascii=False)


def selected(files, words):
    return [f for f in files if not words or any(w.lower() in f.lower() for w in words)]


def cmd_find(a):
    m = manifest.load()
    manifest.save(m)
    loops = load_loops()
    tr = loops.setdefault("tracks", {})
    for f in selected([t["source"] for t in m["tracks"] if t.get("source")], a.only):
        old = tr.get(f)
        path = os.path.join(manifest.SRC, f)
        if not os.path.isfile(path):
            print(f"{f}: bgm/ に元の曲が無い（飛ばす）")
            continue
        if old is not None and old.get("auto") is False:
            x = decode(path, SR, 2).astype(np.float64)
            s = corr(x, samples(old["end"]), samples(old["start"]), SR, SR // 2)
            print(f"{f}: 手で直した値のまま（auto: false）。継ぎ目の一致度 {s:.3f}")
            continue
        e, info = find_loop(path)
        tr[f] = e
        print(f"{f}: A {e['start']:.3f} B {e['end']:.3f} loop {e['end'] - e['start']:.2f}s score {e['score']:.3f} {e['how']} "
              f"(構造 {info['struct']:.3f}, 頭の無音 {e['lead']:.2f}s, 本体の終わり {info['bodyEnd']:.1f}s, {e['bpm']} BPM)", flush=True)
        save_loops(loops)
    save_loops(loops)


def cmd_build(a):
    m = manifest.load()
    loops = load_loops()["tracks"]
    rows = []
    for t in m["tracks"]:
        f = t.get("source")
        if not f:
            continue
        if a.only and not selected([f], a.only):
            continue
        e = loops.get(f)
        if e is None:
            print(f"{f}: loops.json に無い（find を先に）。飛ばす")
            continue
        src = os.path.join(manifest.SRC, f)
        x = decode(src, SR, 2)
        intro, body = make_parts(x, e)
        stem = f.rsplit(".", 1)[0]
        rel_i, rel_b = stem + ".intro.ogg", stem + ".loop.ogg"
        os.makedirs(manifest.OUT, exist_ok=True)
        p_i, p_b = os.path.join(manifest.OUT, rel_i), os.path.join(manifest.OUT, rel_b)
        # ブラウザ（Chrome の decodeAudioData）は短い Vorbis の末尾を数十サンプル削ることがあった（0.15 秒のイントロで 87 サンプル）。
        # そこで、イントロ・本体とも後ろに「続きの音」を PAD 秒足して書き、正しい長さ（秒）を bgm.json の introSec / bodySec に書く。
        # ブラウザはイントロを introSec で止めて本体を始め、本体は loopEnd = bodySec でループする（足した分は鳴らない）。
        pad = int(PAD_S * SR)
        body_back = write_ogg(p_b, np.concatenate([body, body[:pad]]), a.quality)[:len(body)]
        intro_back = None
        if intro is not None:
            intro_back = write_ogg(p_i, np.concatenate([intro, body[:pad]]), a.quality)[:len(intro)]
        elif os.path.isfile(p_i):
            os.remove(p_i)
        # 継ぎ目の段差（デコードし直した本体の最後 → 最初のサンプル。ふつうの隣どうしの差と比べる）。
        jump = float(np.abs(body_back[0] - body_back[-1]).max())
        typical = float(np.percentile(np.abs(np.diff(body_back[:SR * 4], axis=0)).max(axis=1), 99))
        wav = write_preview(os.path.basename(stem), intro_back, body_back)
        t.pop("intro", None)
        t.pop("introSec", None)
        if intro is not None:
            t["intro"] = rel_i
            t["introSec"] = round(len(intro) / SR, 6)
        t["body"] = rel_b
        t["bodySec"] = round(len(body) / SR, 6)
        size = os.path.getsize(p_b) + (os.path.getsize(p_i) if intro is not None else 0)
        rows.append((f, size, os.path.getsize(src)))
        print(f"{f}: intro {0 if intro is None else len(intro) / SR:.2f}s + loop {len(body) / SR:.2f}s  "
              f"{size / 1e6:.2f} MB (mp3 {os.path.getsize(src) / 1e6:.2f} MB)  score {e['score']:.3f} {e['how']}  継ぎ目の段差 {jump:.4f}（ふつう {typical:.4f}） -> {os.path.relpath(wav, ROOT)}",
              flush=True)
    manifest.save(m)
    if rows:
        print(f"ogg {sum(r[1] for r in rows) / 1e6:.1f} MB（元の mp3 {sum(r[2] for r in rows) / 1e6:.1f} MB）。data/bgm/bgm.json に intro / body を書いた")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cmd", nargs="?", default="all", choices=["all", "find", "build"])
    p.add_argument("only", nargs="*", help="曲のファイル名の一部（省略 = 全曲）")
    p.add_argument("--quality", type=float, default=5.0, help="Vorbis の品質 0〜10（既定 5 ≒ 160 kbps）")
    a = p.parse_args()
    if a.cmd in ("all", "find"):
        cmd_find(a)
    if a.cmd in ("all", "build"):
        cmd_build(a)


if __name__ == "__main__":
    main()
