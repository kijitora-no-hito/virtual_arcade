# 店内の BGM の曲（data/bgm/）

サーバはこのフォルダ（環境変数 `BGM_DIR` で変えられる）の `bgm.json` と音声ファイルを読み、`/api/meta` で一覧を配り、`{BASE_PATH}/bgm/<ファイル名>` で配信します。
ブラウザは Web Audio で「イントロ → 本体（サンプル単位で継ぎ目なくループ）」とつないで鳴らします。一覧には、ここの曲の後ろに**合成の曲**
（ブラウザの中で合成するオリジナル 3 曲。権利の心配なし）が並びます。

## 曲のファイルはリポジトリに入っていません

このリポジトリには**曲のファイル（音声）も、その一覧 `bgm.json` も入っていません**（入っているのはこの README と一覧の例 `bgm.example.json` だけ）。
曲が 1 つも無ければ、店内にはブラウザの中で合成するオリジナル 3 曲だけが流れます（そのままで動きます）。
曲を流したいときは、下の「置き方」のとおり自分で用意したファイルをこのフォルダに置いてください（`bgm.json` は任意。`bgm.example.json` を写して使えます）。

### 作者のサーバで流している曲（魔王魂）について

作者のサーバでは魔王魂（https://maou.audio/ ）のアコースティック02 / 11 / 46 / 50 / 52 を、ループ用に加工して流しています。

- **規約（魔王魂 https://maou.audio/rule/ ）**
  - **クレジット表記必須**：「音楽：魔王魂」。画面の BGM の操作（曲名の下）・曲の一覧・入店の画面に出しています。
  - **改変したらその旨を記載**：ループのための切り出し・つなぎ目の重ね・Ogg Vorbis への再エンコード・音量の調整をしたので、
    クレジットは「音楽：魔王魂（ループ・音量の調整のため編集）」（`bgm.json` の `credit`）。曲そのものの編曲・音の差し替えはしていません。
  - **曲単体の再配布は禁止**：曲のファイルを単体で落とせる一覧ページは作らず、店内の BGM として流すだけ。
    元の mp3・加工した ogg・確認用の WAV は **git に入れない**（`.gitignore`）・公開リポジトリ・公開ページに置かない。
    `npm run package` の tar（自分のサーバに置くためのもの）には加工した ogg と `bgm.json` だけが入ります（元の mp3 は入れない）。
  - 他の素材サイトへの登録・配信・NFT・AI への組み込みは禁止。
- 同じ曲を使いたいときは、魔王魂のサイトから自分でダウンロードし、規約を確かめたうえで下の「曲を足す・作り直す」の手順で加工してください。

## ⚠ 自分で曲を足すとき：ファイルの権利は置く人の責任です

ここに置いたファイルは、店に入った人全員のブラウザに配信されます（公開サーバなら誰でも聞けます）。
**自分で作った曲、またはウェブでの公開・配信での利用が許諾された曲（素材サイトの利用規約を確かめたもの）だけを置いてください。**
市販の曲・ゲーム音楽などを許諾なく置くと、著作権・著作隣接権の侵害になります。アプリの作者は置かれたファイルについて責任を負いません。
クレジット表記が要る素材なら `bgm.json` の `credit` に書いてください（画面に出ます）。

## 置き方（いちばん簡単な形）

- mp3 / ogg / m4a をこのフォルダに置くだけで、一覧の後ろ（`bgm.json` の曲の後）に「ファイル名 = 曲名」の曲として加わります（ファイル全体をループ）。
- 配信しないもの：`.` で始まる名前・`/` `\` `..` を含む名前・ほかの拡張子・フォルダ・シンボリックリンク・`bgm.json` 自身。50 曲まで。
- サーバの再起動は要りません（ページを開くたびに一覧を読みます。店内にいる人は再読み込みで反映）。

## bgm.json の書き方

```json
{
  "synth": true,
  "tracks": [
    {
      "source": "maou_bgm_acoustic02.mp3",
      "title": "アコースティック02",
      "author": "魔王魂",
      "credit": "音楽：魔王魂（ループ・音量の調整のため編集）",
      "url": "https://maou.audio/bgm_acoustic02/",
      "rotate": true,
      "gain": 0.55,
      "intro": "maou_bgm_acoustic02.intro.ogg",
      "introSec": 49.062109,
      "body": "maou_bgm_acoustic02.loop.ogg",
      "bodySec": 51.903152
    },
    { "title": "わたしの曲", "author": "じぶん", "body": "my_song.mp3", "rotate": false }
  ]
}
```

- `body`（必須）= ループする部分のファイル、`intro` = 最初に 1 回だけ鳴らす部分（無ければ頭から本体）。
- `title` / `author`（60 文字まで）・`credit`（80 文字まで。無ければ「音楽：作者」）。
- `rotate`（既定 true）= 順番に回す曲（本体を 2 周したら次の rotate の曲へ）。false の曲は選んだらずっとくり返す。
- `gain`（0.1〜1.5、既定 1）= 音量の倍率（`tools/bgm/loudness.py` が書く）。
- `introSec` / `bodySec` = イントロ・本体の正しい長さ（秒）。ツールの ogg は後ろに続きの音を 0.25 秒足してある（ブラウザが短い Vorbis の末尾を削ることがあるため）ので、
  この長さでイントロを止め・本体をループします。自分で置くファイルには要りません。
- `source` / `url` はツール用・メモ（サーバは使わない）。`"synth": false` で合成の曲を一覧から外します（曲が 1 つも無いときは外しません）。

## 曲を足す・作り直す（ループと音量）

```powershell
# リポジトリのフォルダで
pip install --user miniaudio numpy scipy soundfile pyloudnorm   # 初めてのとき
$env:PYTHONIOENCODING = "utf-8"
# 1. 元の mp3 を bgm\ に置く（git にも tar にも入らない。ループ点 tools/bgm/loops.json・一覧 bgm.json も git に入らない）
python tools/bgm/loop_bgm.py                    # ループ点を探して（tools/bgm/loops.json）イントロ・本体の ogg と bgm.json を書く
python tools/bgm/loudness.py --target -17 --apply   # 音量をそろえて bgm.json の gain を書く
# 2. 確認用の WAV（bgm\_loop_preview\<曲>.wav：本体の終わり → 継ぎ目 → 本体の頭、イントロの終わり → 本体の頭）を聞く
#    気になれば loops.json のその曲の start / end / crossfadeMs を直して "auto": false にし、python tools/bgm/loop_bgm.py build
```

- 新しい mp3 の曲名などは `loop_bgm.py` が `bgm.json` に雛形を足します（魔王魂のファイル名なら曲名・作者・クレジット・ページも）。手で直してかまいません
  （ツールは `title` / `author` / `credit` / `url` / `rotate` を書き換えません）。
- 合成の曲と音量をそろえるときは、`scripts/dev/bgm-check.mjs` を `WAV_DIR` 付きで動かして書き出した WAV を `python tools/bgm/loudness.py --ref <WAV …>` で測ります。
