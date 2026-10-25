"""店内の BGM（同梱の曲）の一覧 data/bgm/bgm.json を読み書きする（loop_bgm.py・loudness.py から使う）。

置き場所:
    bgm/                 元の mp3（ツールの入力。git に入れない・npm run package の tar にも入れない）
    bgm/_loop_preview/   確認用の WAV（loop_bgm.py build が書く。git の外）
    data/bgm/            加工したイントロ・本体の ogg（git に入れない・tar には入る）と bgm.json（曲の一覧。git に入れない・tar に入る。例は bgm.example.json）
    tools/bgm/loops.json ループ点（git に入れない）

bgm.json の形（サーバが読んで /api/meta で配る。書き方の説明は data/bgm/README.md）:
    {"about": "…", "synth": true,
     "tracks": [{"source": "maou_bgm_acoustic02.mp3", "title": "アコースティック02", "author": "魔王魂",
                 "credit": "音楽：魔王魂（ループ・音量の調整のため編集）", "url": "https://maou.audio/bgm_acoustic02/",
                 "rotate": true, "gain": 0.85, "intro": "maou_bgm_acoustic02.intro.ogg", "introSec": 49.06, "body": "maou_bgm_acoustic02.loop.ogg", "bodySec": 51.9}]}
    introSec / bodySec = イントロ・本体の正しい長さ（ファイルの後ろには続きの音を 0.25 秒足してある。ブラウザが末尾を削っても継ぎ目が切れないように）
曲名・作者・クレジットは手で直してよい（ツールは source が同じ欄の title / author / credit / url / rotate を書き換えない）。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "bgm")
OUT = os.path.join(ROOT, "data", "bgm")
MANIFEST = os.path.join(OUT, "bgm.json")
PREVIEW = os.path.join(SRC, "_loop_preview")
ABOUT = ("店内の BGM（同梱の曲）の一覧。tools/bgm/loop_bgm.py・loudness.py が intro / body / gain を書く。title / author / credit / url / rotate は手で直してよい。"
         "rotate = true の曲は本体を 2 周したら次の rotate の曲へ。synth = false で合成の曲を一覧から外す。")

MAOU_CREDIT = "音楽：魔王魂（ループ・音量の調整のため編集）"


def guess(source):
    """新しい mp3 の欄の初期値（魔王魂のファイル名なら曲名・作者・クレジット・ページ）。"""
    stem = source.rsplit(".", 1)[0]
    m = re.match(r"^maou_(bgm_([a-z]+?)(\d+))$", stem)
    if m:
        kinds = {"acoustic": "アコースティック", "piano": "ピアノ", "cyber": "サイバー", "fantasy": "ファンタジー", "healing": "ヒーリング"}
        return {"title": f"{kinds.get(m.group(2), m.group(2))}{m.group(3)}", "author": "魔王魂", "credit": MAOU_CREDIT,
                "url": f"https://maou.audio/{m.group(1)}/", "rotate": True}
    return {"title": stem, "author": None, "credit": None, "url": None, "rotate": True}


def sources():
    if not os.path.isdir(SRC):
        return []
    return sorted(f for f in os.listdir(SRC) if f.lower().endswith((".mp3", ".ogg", ".m4a", ".wav")) and not f.startswith("."))


def load():
    """bgm.json（無ければ空）に、bgm/ にあって一覧に無い曲の欄を足して返す。"""
    if os.path.isfile(MANIFEST):
        with open(MANIFEST, encoding="utf-8-sig") as f:
            d = json.load(f)
    else:
        d = {"about": ABOUT, "synth": True, "tracks": []}
    d.setdefault("tracks", [])
    have = {t.get("source") for t in d["tracks"]}
    for s in sources():
        if s not in have:
            d["tracks"].append({"source": s, **guess(s)})
    return d


def save(d):
    order = ["source", "title", "author", "credit", "url", "rotate", "gain", "intro", "introSec", "body", "bodySec"]
    out = {"about": d.get("about", ABOUT), "synth": d.get("synth", True), "tracks": []}
    for t in d["tracks"]:
        out["tracks"].append({k: t[k] for k in order if k in t and t[k] is not None} | {k: v for k, v in t.items() if k not in order})
    os.makedirs(OUT, exist_ok=True)
    s = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
