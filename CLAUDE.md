# CLAUDE.md（virtual_arcade）

> **`CLAUDE.local.md` があれば、それも読むこと**（この PC・自分のサーバだけの事情。git に入れない）。

バーチャルゲームセンター：ブラウザから入れるクオータービューの店内を歩き、チャット・エモーションでやりとりし、筐体に YouTube の配信と宣伝を置ける。
**Android アプリではなく Web アプリ**（ワークスペース共通の Android 方針は当てはまらない）。仕様の正本は `docs/DESIGN.md`（Q1〜Q7 はユーザー決定済み。§8〜§10 は v0.3.0、§11〜§13 は v0.4.0）。

- 版: v0.4.1（2026-10-25。スマホでキーボードを出すと縦横が切り替わって発言の欄のキーボードがすぐ閉じていたのを直した。v0.4.0 でスマホのレイアウト・コミュニケーションノート・機能追加要望箱を足した。v0.1.0〜v0.3.0 も同じ日）。GitHub `kijitora-no-hito/virtual_arcade`（公開・MIT ライセンス）。
- Node 22.13 以降（`node:sqlite` の `DatabaseSync` を使う。ネイティブビルドの要るパッケージは使わない方針）。

## 引き継ぎ（2026-10-25 時点。続きから始めるときは最初にここを読む）

- **読む順**：この節 → `docs/DESIGN.md`（✅ = ユーザー指定、🔧 = 叩き台）→ 下の「DESIGN にない部分で決めたこと」。
- **状態**：v0.1 の範囲（DESIGN §1〜§4）・v0.2.0 の店内の BGM（DESIGN §7）・v0.3.0 のクレーンゲーム（§8）・ポスター欄（§9）・チャットのピン止め（§10）・
  v0.4.0 のスマホのレイアウト（§11）・コミュニケーションノート（§12）・機能追加要望箱（§13）を実装済み。
  `npm test` 202 件・`npm run build`・`npm run package` が通る。v0.4.0 は下の「0.4.0 で決めたこと」。**v0.4.0 はユーザー未確認・スマホの実機は未確認**（DESIGN の末尾の表 M1〜R1 が叩き台）。
  **v0.4.1**（画面だけの修正、DB 変更なし）：0.4.0 の公開版で Android Chrome（Pixel・縦）の人から「チャットの欄を押すとキーボードが一瞬出てすぐ閉じる」。
  `interactive-widget=resizes-content` でキーボードが出ると表示域が 412×400 になり、幅と高さで決めていた `useLayout` が横向きに切り替え、縦と横で別の場所にあった発言の欄が作り直されてフォーカスが外れていた。
  `layout.ts` の `nextLayout`（純粋・テストあり）で、文字の欄にフォーカスがある間と、幅が同じで高さだけ縮んだとき（screen.orientation が変わらない限り）は今のレイアウトのままにし、欄から離れたら決め直す。
  スマホの下の欄の `ChatForm` は縦横で同じ場所の同じ要素にした（横向きの `ChatPanel` は `form={false}`）。確認は `scripts/dev/keyboard-check.mjs`（412×915 → 412×400、修正前は NG 21・修正後は NG 0）。
  v0.3.0 は下の「0.3.0 で決めたこと」。**v0.3.0 はユーザー未確認**（DESIGN の末尾の表 C1〜P3 が叩き台）。
  BGM は下の「0.2.0 で決めたこと」。**BGM はユーザー未確認**（耳で確かめていない。曲の雰囲気・音量・順番に回す長さは叩き台）。
  `release/virtual-arcade-0.1.0.tar.gz` を展開して `BASE_PATH=/arcade`・別ポートで起動し、ページ・API・WebSocket（`/arcade/ws` は 101、`/arcade/ws/arcade/ws` は 404）と画面を確認した。
  **ユーザー未確認**（見た目・操作感・既定値はどれも叩き台）。
- **公開前にユーザーが決めること**：下の「今後の課題」の先頭。
- **進め方の決まり**（ユーザーの指示）：設計・検討はメイン、まとまった実装は opus のエージェントに詳しい仕様を渡して任せる。途中の報告も日本語。
- **画面の確認の手順**（自動で撮れる）：
  1. 別ポートで起動（PowerShell：`$env:PORT='8798'; $env:BASE_PATH='/arcade'; $env:DB_PATH="$env:TEMP\va_x.db"; $env:ADMIN_PASS_HASH='<npm run hash-admin の出力>'; npm start`）。
  2. `node scripts/dev/scene.mjs start http://127.0.0.1:8798/arcade <状態ファイル> <合言葉> 900`（バックグラウンドで。6 人が入って筐体 3 台に配信を設定し、
     お知らせを流し、発言・エモーションを続ける。「わたし」の鍵を状態ファイルに書く）。
  3. `node scripts/dev/scene.mjs me <URL> <状態ファイル> <x> <y> [admin]`（「わたし」をそのマスへ歩かせて切る。admin で管理者に）。
  4. `node scripts/dev/shot.mjs "http://127.0.0.1:8798/arcade/#dev" out.png 5000 "" "{\"va:key\":\"<鍵>\"}"`（Edge ヘッドレス・1920×1080）。
     URL の `#dev` で `window.__va`（`cab(id)`・`screen()`・`tile(x,y)` がページ上の位置を返す）が使えるので、
     `CLICK_EXPR="(p=>p.x+','+p.y)(__va.cab(3))"` で筐体をクリック、eval 式と `AFTER_MS` でボタンを押してから撮れる。
     v0.3.0 から `__va.crane(id)`・`__va.board()`・`__va.poster(i)`（掲示板の i 枚目）と、クレーンゲームの窓を開いている間の `__vaCrane`
     （`press('right'|'up')`・`release(…)`・`drop()`・`aimDrop()` = いちばん手前のカプセルの真上で下ろす・`phase()`）。
     `SCENE_CRANE=4 node scripts/dev/scene.mjs start …` で何人かがクレーンゲームでバッジを取る（サーバは `CRANE_COOLDOWN_SEC=1`・`CRANE_MAX_CHANCE=100` で起動しておく）。
     scene はポスターも 4 枚貼る（1 枚は管理者が固定）。
  5. 終わったら、そのポートで待ち受けているプロセスだけを止め、一時 DB を消す（ほかの node は止めない）。
  6. **スマホ（v0.4.0）**：shot.mjs に `VIEWPORT=390x844 MOBILE=1`（mobile: true・タッチの操作。横向きは `844x390`）、指のタップは `TAP="x,y"` / `TAP_EXPR`。
     `#dev` の `__va` に `cam()`（カメラ・倍率の範囲）・`me()`・`open({kind:'note'|'request'|'crane'|…})`・`pick(x,y)`・`passable(x,y)`・`canvasRect()` を足した。
     指の操作の確認：`node scripts/dev/touch-check.mjs <URL#dev> <鍵> [out.png]`（タップで歩く・ドラッグ・ピンチ・タップで筐体）、
     `VIEWPORT=390x844 node scripts/dev/reach-check.mjs <URL#dev> <鍵> [out.png]`（店の端・置いてある物の前まで指で歩けるか・カメラが付いてくるか・四隅まで見回せるか・長押し・
     チャットの欄のタップで店内が動かないか。横向きは `VIEWPORT=844x390`）、`node scripts/dev/note-check.mjs <URL#dev> <鍵>`（ノートのスワイプ・書く・その場の反映）、
     `node scripts/dev/keyboard-check.mjs <URL#dev> <鍵>`（v0.4.1。Pixel 412×915 で欄にフォーカス → 高さだけ 412×400 に縮めてキーボードを真似る。チャット・シート・ノート・要望・ポスター・管理者・名前の欄と回転）。
     どれも `OK / NG` を 1 行ずつ出し、NG の数で終わる。ヘッドレスの Edge は前面・フォーカスありにしないとタッチの返事が来ないことがある（スクリプトの中でしている）。
     scene.mjs は v0.4.0 からノート 8 件（見開き 1 つ分）と要望 3 件も書く（架空の名前・当たり障りのない文）。
- **BGM の確認の手順**（音は聞けないので数字で。自動）：上の 1・2 のあと
  `node scripts/dev/bgm-check.mjs http://127.0.0.1:8798/arcade <状態ファイル> out.png`（自動再生の制限・全曲の再生と切り替え・順番に回す・継ぎ目・視聴画面のフェード・
  消音と設定・合成の曲の書き出し・曲の一覧の撮影。視聴画面の埋め込みは読み込ませずに偽の状態で確かめる）と、
  `REAL_EMBED=1 node scripts/dev/bgm-check.mjs …`（本物の YouTube の埋め込みが再生を始めたら BGM が止まるか）。`WAV_DIR=<フォルダ>` で合成の曲の WAV を書き、
  `python tools/bgm/loudness.py --ref <WAV …>` で同梱の曲と音量を比べられる。
- **版を上げるとき**：package.json 4 つ・`package-lock.json`・`server/src/app.ts` の `VERSION` の既定値（package では版が埋め込まれる）・`deploy/INSTRUCTIONS.md` の例を直し、`npm run package`
  （入店の画面の右下に `/api/meta` の版が出る）。

## 公開リポジトリと、git に入れないもの

- GitHub `kijitora-no-hito/virtual_arcade` は**公開**（MIT。`LICENSE`）。秘密（合言葉・ハッシュ・`.env`・DB）・サーバの IP・個人のメールアドレス・PC のフルパスを入れない。
- git に入れないもの（`.gitignore`）：`CLAUDE.local.md`（この PC・自分のサーバのメモ）・`deploy/INSTRUCTIONS.<サーバ名>.md`（自分のサーバ用の手順書）・
  店内の BGM の音声（`bgm/`・`data/bgm/*.ogg` など。**素材の規約で曲単体の再配布が禁止のものがあるので絶対に入れない**）・`data/bgm/bgm.json`・`tools/bgm/loops.json`・`release/`・DB。
- 公開の `deploy/INSTRUCTIONS.md` は一般的な書き方（example.com・`/arcade/`・ポートは例 8791）。同じサーバの他のサイト・アプリには触れない（Apache は graceful のみ）。

## 構成（npm workspaces）

| フォルダ | 中身 |
|---|---|
| `shared/` | 型・店のレイアウト・経路探索・YouTube の URL・NG 語・筐体の決まり・クレーンゲームの判定・ポスターの検証。TS のソースをそのまま参照（ビルドなし。`main: src/index.ts`） |
| `shared/data/` | `floor.json`（店のレイアウト。筐体 16 台・飾り（crane = 遊べるクレーンゲーム）・入口・大画面・掲示板 `board`・出現位置）・`ngwords.json`（NG 語）。**ビルド時にクライアントとサーバの両方に入る**（変えたら build / package し直す） |
| `server/` | Express（REST）+ `ws`（WebSocket `{BASE_PATH}/ws`）+ SQLite。開発は `tsx`、本番は esbuild で 1 ファイル（`npm run package`） |
| `client/` | React + Vite + TS。店内は Canvas 2D（ライブラリなし）。**相対パスでビルド**（`base: './'`） |
| `deploy/` | サーバに置く手順書 `INSTRUCTIONS.md`（一般的な書き方。example.com・`/arcade/`）・`virtual-arcade.service`・`apache-arcade.inc`（tar にも入る） |
| `scripts/` | `package.mjs`（release の tar.gz）・`hash-admin.mjs`（管理者の合言葉のハッシュ。tar の `tools/` にも入る）・`dev/shot.mjs`（Edge ヘッドレスで撮る。スマホの大きさ・タップも）・`dev/scene.mjs`（確認用に人を入れる）・`dev/bgm-check.mjs`（店内の BGM の確認）・`dev/touch-check.mjs`・`dev/reach-check.mjs`・`dev/note-check.mjs`（v0.4.0。スマホの指の操作・店のどこへでも行けるか・ノート）・`dev/keyboard-check.mjs`（v0.4.1。キーボードが出ても欄のフォーカス・縦横が変わらないか） |
| `data/` | 開発用の DB `virtual_arcade.db`（git 管理外）・`data/bgm/`（店内の BGM の曲：音声ファイルと一覧 `bgm.json` は git 管理外・tar に入る。git に入るのは `README.md` と例 `bgm.example.json`） |
| `bgm/` | 元の mp3（`tools/bgm/` の入力。**git にも tar にも入れない**）・`_loop_preview/`（確認用の WAV） |
| `tools/bgm/` | `loop_bgm.py`（ループ点を探してイントロ・本体の ogg を作る）・`loudness.py`（音量をそろえる）・`manifest.py`（bgm.json）・`loops.json`（ループ点。曲の名前が入るので git 管理外） |
| `release/` | `npm run package` の出力（git 管理外） |

### shared のファイル

- `floor.ts` レイアウトの型・`loadFloor`（重なり・範囲外・筐体の前のマスがふさがっていればエラー）・`FLOOR`・`isPassable`・`frontTile`・`cabinetDistance`（チェビシェフ）
- `path.ts` `findPath`（A*。8 方向・角をすり抜けない・200 マスまで）・`isStep` / `isValidPath`・`positionAt`（経路と出発時刻から今の位置。サーバとクライアントで同じ式）・`currentTile`（区間の半分を過ぎたら次のマス）・`WALK_SPEED` = 4 マス/秒
- `youtube.ts` `parseYouTubeUrl`（3 つの形だけ。ID は 11 文字）・`canonicalYouTubeUrl`・`thumbnailUrls`・`embedUrlMini` / `embedUrlFull`（youtube-nocookie.com）
- `text.ts` `stripControl` / `tidy` / `charLength` / `ellipsis`・`normalizeForNg`（NFKC・小文字・カタカナ→ひらがな・空白と記号を除く）・`hasNgWord`
- `cabinets.ts` `CabinetRecord`・`PROMO_LIMITS`（イベント名 30・ゲーム名 30・プレイヤー名 20・備考 120）・`claimError`（1 人 1 台・時間切れは空き扱い）・`claimCabinet` / `releaseCabinet` / `expireCabinets`・`validateCabinetInput`（URL・文字数・NG 語）
- `looks.ts` 体の色 8 種・帽子や髪 6 種・`checkName`（1〜20 文字・NG 語）・`EMOTES`（8 個）・吹き出し・チャットの定数
- `protocol.ts` REST の応答と WebSocket のメッセージの型（`MetaResponse.bgm` = 店内の BGM の曲の一覧。v0.3.0 で `PlayerView.badges` / `pinned`・`ChatMessage.badges`・
  `CraneStateResponse` / `CranePlayResponse`・`posters` / `bye` のメッセージ）
- `crane.ts` クレーンゲーム：`SUITS`（♠♡♦♧）・`sortBadges` / `addBadge`（unique / stack）・`craneSpots`（floor.json の crane）・`newMachine`（カプセル 8 個）・
  `craneChance`（距離 → 確率）・`resolveCrane`（判定。乱数は引数）・`normalizeArm`
- `posters.ts` ポスター：`POSTER_KINDS`・`POSTER_LIMITS`・`validatePoster`（文字数・NG 語・URL・日時）・`checkPosterUrl`・`posterExpiresAt`・`sortPosters`・`upcomingPosters`・日時の表示
- `bgm.ts` 合成の曲の形（`Song`・音符の書き方）・`compileSong`・`validateSong`（音域・長さ・ループの長さ）・サーバの曲 `BgmFile`・`isBgmFileName`（配信してよいファイル名）・`bgmCredit`
- `songs.ts` 合成の曲 3 曲（`SONGS`）
- `notes.ts`（v0.4.0）ノート：`NOTE_LIMITS`（名前 20・文 90・3 行）・`validateNote`（空の行を詰める・NG 語）・ページ分け（`notePageCount` / `noteViewCount` / `viewPages` / `pageRange` / `convertView`）・
  要望：`REQUEST_KINDS`・`validateRequest`（500 文字・名前なし可・**NG 語では断らない**）・置き場所 `noteSpots` / `requestBoxSpots`（floor.json の decor の `note` / `requestbox`）

### server のファイル

- `config.ts` 環境変数（`BASE_PATH` / `MAX_PLAYERS` / `CABINET_TTL_HOURS` / `ADMIN_PASS_HASH` / `ADMIN_TTL_HOURS` / `TRUST_PROXY` …）と回数制限の既定。`ADMIN_PASS_HASH` の形が違えば起動しない
- `limits.ts` 回数制限（スライディングウィンドウ）と接続元 IP（直前が loopback のときだけ X-Forwarded-For の最後の 1 つ。IP は起動ごとの塩で HMAC にしてから数える）
- `secret.ts` `hashKey`（SHA-256）・`hashPassphrase` / `checkPassphrase`（scrypt。形は `scrypt:<塩>:<ハッシュ>`。`$` を使わないのは systemd の EnvironmentFile で崩れないため）・`newPid`
- `db.ts` SQLite（`users`（鍵のハッシュ・公開 ID・名前・見た目・最後の位置・管理者の期限）/ `bans` / `cabinets`（JSON）/ `chat`（直近 200 件。v0.3.0 で `badges` 列を足した。
  前の版の DB は起動時に `ALTER TABLE` で足す）/ `notices`（20 件）/ `posters`（v0.3.0））
- `arcade.ts` `Arcade`（店内にいる人・入室・移動・エモーション・視聴・チャット・筐体・管理者の操作。`Hooks` で全員・1 人へ送る・切る。
  v0.3.0：退店 `leave`・バッジとピン止め（メモリの `badges` の Map）・クレーンゲーム（台ごとのケースもメモリ）・ポスター）
- `app.ts` REST・静的配信（index.html に `<base href>` と `<meta name="va-base">` を差し込む）・WebSocket（最初のメッセージ `hello` で入る。1 人 1 本・ping/pong・回数制限）
- `paths.ts` 開発と本番（`__VA_BUNDLED__`）で置き場所を切り替え
- `bgm.ts` `listBgm`（`BGM_DIR` の bgm.json と音声ファイルの一覧）・`servableBgm`（配信してよいファイル名 = 一覧の intro / body）。配信は `app.ts` の `{BASE_PATH}/bgm/:file`
- v0.4.0：`db.ts` に `notes`・`requests` の表、`arcade.ts` に `listNotes` / `writeNote` / `deleteNote`・`sendRequest` / `listRequests` / `markRequest` / `deleteRequest`
  （要望の未読の件数は店内にいる管理者にだけ `requests` で送る。管理者がつないだ・合言葉を入れたときも）
- テスト：`test/harness.ts`（テスト用のサーバ・WebSocket の道具。v0.3.0 で api.test.ts から分けた）・`api.test.ts`・`v03.test.ts`（クレーンゲーム・バッジ・ポスター・ピン止め）・`v04.test.ts`（ノート・要望）・`unit.test.ts`

### client のファイル

- `api.ts` ベースパス・秘密鍵（localStorage `va:key`）・REST
- `game/client.ts` `ArcadeClient`（WebSocket で受け取った状態。描画は毎フレーム読む。React には `subscribe` で知らせる。位置だけの変化は知らせない）
- `game/iso.ts` 座標変換（タイル 64×32・壁の高さ 150・`fitView` で店全体が入る拡大率）
- `game/render.ts` 床・壁（別の canvas に 1 回だけ）・大画面・筐体・飾り・頭上のもの・宣伝の吹き出し・当たり判定・小さな埋め込みの置き場所
- `game/character.ts` 人形（足・腕・胴・頭・帽子や髪。歩くと揺れる。座ると後ろ姿で椅子に座る。自分は足もとに光る輪）
- `game/thumbs.ts` サムネイルの読み込み（`/live/` の形なら `hqdefault_live.jpg` → `hqdefault.jpg`。幅 120 以下は無いとみなす）
- `audio/` 店内の BGM：`bgm.ts`（`bgm` = 1 つだけのエンジン。自動再生の制限・曲の一覧・順番に回す・設定 `va:bgm`・動画でのフェード・チャイム・確認用の `debug`/`seek`）・
  `synth.ts`（合成の曲の演奏 `SongRun`・先読みのスケジューラ・チャイム）・`fileRun.ts`（ファイルの曲のイントロ → 本体のループ）・`playlist.ts`（一覧・位置の計算。純粋）・
  `videoDuck.ts`（視聴画面の動画と BGM の判断・YouTube の postMessage の読み取り。純粋）・`check.ts`（`#dev` の書き出しの確認だけ。遅延読み込み）
- `game/craneGame.ts` クレーンゲームのミニゲーム（アームの段階・サーバの結果どおりの演出の組み立て・Canvas の描画）
- `audio/sfx.ts` クレーンゲームの効果音（合成。`bgm.playSfx` で鳴らす。消音・音量に従う）
- v0.4.0：`layout.ts`（PC / スマホの判断 `decideLayout`・キーボードで切り替えない `nextLayout`（v0.4.1）・`useLayout`（`<html>` の class）・設定 `va:mobile`）・`game/camera.ts`（スマホのカメラ：追従・ピンチ・ドラッグ・範囲・床と壁の大きな canvas。純粋。
  テスト `client/test/camera.test.ts`）・`components/Mobile.tsx`（チャットの最新の行・下からのシート・メニュー）・`NoteDialog`（ノート）・`RequestDialog`（要望を送る）。
  `ArcadePage` はスマホのとき別の JSX（ヘッダ・店内・下の欄）と指の操作（pointer events）、PC は v0.3.0 のまま。`render.ts` は `View.ts`（文字の倍率）・`WorldLayer`・`promoDock`・`embedThumb`・ノートの机と要望箱
- `components/` `Badges`（名前の後ろのバッジ。4 色）・`CraneDialog`（クレーンゲームの窓）・`PosterDialog`（ポスターの一覧・詳細・書く）・`EntryPage`（入店・名前と見た目。入店のボタンで BGM を鳴らせるようにする・BGM のクレジット・版）・`BgmControls`（下のバーの BGM の操作と曲の一覧）・`ArcadePage`（店内・描画のループ・キーボード・マウス・埋め込み）・`ChatPanel`・`CabinetDialog`・`ScreenDialog`（大画面の一覧）・`WatchView`（視聴画面）・`AdminDialog`

## コマンド

```powershell
npm install
npm run build        # tsc（shared/server/client）+ vite build
npm test             # vitest（shared/test・server/test）
npm start            # http://127.0.0.1:8791/（PORT / HOST / BASE_PATH / DB_PATH / ADMIN_PASS_HASH などで変更）
npm run dev          # Vite :5174 + サーバ :8791
npm run hash-admin   # 管理者の合言葉のハッシュ（scrypt:…）を作る
python tools/bgm/loop_bgm.py                       # 店内の BGM：bgm/ の mp3 → data/bgm/ のイントロ・本体の ogg（PYTHONIOENCODING=utf-8）
python tools/bgm/loudness.py --target -17 --apply  # 店内の BGM の音量をそろえる
npm run package      # build → release/virtual-arcade-<版>.tar.gz（+ .sha256）。中身は node server.js で動く
```

- Git Bash から `BASE_PATH=/arcade` を渡すと MSYS が Windows のパスに書き換える（サーバは不正として止まる）。PowerShell の `$env:BASE_PATH='/arcade'` か `MSYS_NO_PATHCONV=1`。

## API（すべて `{BASE_PATH}/api` の下。識別はヘッダ `X-VA-Key`＝クライアントが作った秘密鍵）

- `GET /meta`（版・上限・人数・筐体の期限・管理者の有無・文字数・店内の BGM の曲の一覧 `bgm`）/ `GET /me`（前に入ったことがあれば `profile`。止められていれば `bannedUntil`）
- `POST /enter {name, look}`（初めて・名前と見た目の変更。満員なら 503 `full`、止められていれば 403 `banned`）
- `GET /cabinets` / `POST /cabinets/:id/claim`（店内にいて 2 マス以内。`too-far` / `taken` / `already-own`）/
  `PATCH /cabinets/:id {url, eventName, gameName, playerName, note}`（持ち主か管理者。`bad-url` / `too-long` / `ng`）/ `POST /cabinets/:id/release`（持ち主か管理者）
- `POST /chat {text}`（店内にいる人。200 文字・NG 語・1 秒に 1 回・15 秒に 6 回・IP ごと 1 分に 20 回）/
  `POST /chat/:id/pin {pinned}`（自分の発言を 1 つピン止め。`false` で外す。鍵ごとに 1 分 10 回）
- `POST /leave`（退店。バッジとピン止めが消え、WebSocket に `bye` を送って切る）
- クレーンゲーム：`GET /crane/:id`（カプセルの位置と色・次に遊べる時刻）/ `POST /crane/:id/play {x, z}`（店内にいて 2 マス以内・待ち時間。`too-far` / `cooldown`。結果とバッジ）
- ポスター：`GET /posters` / `POST /posters`（店内にいる人。`POSTER_WHO=admin` なら管理者だけ）/ `PATCH /posters/:id` / `DELETE /posters/:id`（書いた人か管理者）/
  `POST /admin/posters/:id/pin {pinned}`
- ノート（v0.4.0）：`GET /notes?before=&limit=`（誰でも。鍵なしでも読める。新しいものから 120 件・古い順）/ `POST /notes {name, text}`（店内にいる人。鍵ごと 10 分 3 件・IP ごと 10 分 10 件）/
  `DELETE /notes/:id`（書いた人か管理者）。WebSocket で `note {note, total}` / `note-delete {id, total}`
- 要望（v0.4.0）：`POST /requests {kind, text, name|null}`（入室したことのある鍵。鍵ごと 1 時間 5 件・IP ごと 1 時間 10 件。返事は `{ok:true}` だけ）/
  `GET /admin/requests`・`PATCH /admin/requests/:id {status: new|read|done}`・`DELETE /admin/requests/:id`（管理者だけ）。WebSocket で管理者にだけ `requests {unread, added?}`
- 管理者：`POST /admin/login {password}`（IP ごと・鍵ごとに 10 分 5 回）/ `POST /admin/logout` / `POST /admin/notices {text}` / `DELETE /admin/notices/:id` /
  `DELETE /admin/chat/:id` / `POST /admin/kick {pid, minutes}`（0 = 退室だけ、1〜10080 分 = その鍵の入室を止める）
- 店内の BGM のファイル：`GET {BASE_PATH}/bgm/<ファイル名>`（API の外。一覧の intro / body にあるものだけ。Range 可・`Cache-Control: public, max-age=3600`）
- WebSocket `{BASE_PATH}/ws`：最初に `{type:'hello', key}`（鍵を URL に載せない）。その後 `goto {x,y}`（サーバが A* で経路を決めて全員に `move`。通れないマスは `blocked`）/
  `emote {emoji}` / `watch {cabinet | null}`（配信中の筐体の前のマスに座る）。
  サーバからは `welcome`（自分・全員・筐体・チャット・お知らせ・ポスター・サーバの時刻）/ `join` / `leave` / `player`（バッジ・ピン止めの変化も）/ `move` / `emote` / `chat` / `chat-delete` / `cabinet` / `notices` /
  `posters` / `you` / `kicked` / `bye`（退店した）/ `error`。

## DESIGN にない部分で決めたこと（変えるならここ）

- **店のレイアウト**（`shared/data/floor.json`）：22×16 マス。筐体は 2 列 × 8 台（4 台ずつ 2 つの島。どれも画面は左手前向き = `face: S`）。奥の右の壁に大画面（10 マス幅）、
  左の壁の手前寄りに入口、右奥に自販機 2・クレーンゲーム 2、ベンチ 6、植木 3。床・壁は描画の飾りで、通れないのは筐体と飾りのマス・店の外。
- **見た目**：Canvas 2D をライブラリなしで（PixiJS は使わなかった。数十人なら十分軽い）。店全体が 1 画面に入る拡大率（1920×1080 で約 1.18 倍）で、カメラは動かさない。
  床・壁は大きさが変わったときだけ別の canvas に描く。筐体・飾り・人は `x + y`（中心）の小さい順に描く（人は同じ値なら後）。名前・吹き出し・札・宣伝は最後に重ねる。
- **筐体の画面の小さな埋め込み**：筐体の画面は 1 マスの幅（約 30 px）しかないので、**筐体の上に 224×126 px の枠**を出して、画面の中心へ線を引く（画面に直接重ねると小さすぎて見えない）。
  iframe は 356×200 で作って縮める（YouTube の埋め込みは 200×200 以上が推奨のため）。窓・視聴画面を開いている間は出さない。同時に 1 つだけ。
- **近い**の判定：チェビシェフ距離 2 マス以内（使う・埋め込み・宣伝の吹き出し）。埋め込みはその中でいちばん近い（ユークリッド距離）配信中の筐体。宣伝の吹き出しはカーソル優先、無ければ近くの設定済みの筐体。
- **移動の同期**：クライアントは目的地だけを送る。サーバは「今いるマス」（歩いている途中は区間の半分を過ぎたら次のマス）から A* で経路を作り、経路と出発時刻を全員に配る。
  クライアントは `positionAt` で位置を求め、描画中の位置をなめらかに追う（3 マス以上ずれたら飛ぶ）。人どうしはぶつからない（重なってよい）。
  キーボードは「今の経路の終わり＋1 歩」を、着く 90 ms 前に送る（斜めが通れなければ縦・横の片方へ滑る）。W = 画面の上（床では (-1,-1)）。
- **視聴中の姿**：`watch` で筐体の前のマスへ移して座らせる（後ろ姿・丸い椅子）。歩くと立つ。配信が外れたら全員立たせる。
- **入室・識別**：ブラウザが作った秘密鍵を localStorage `va:key` に置き、サーバは SHA-256 だけを持つ。画面に出す ID は鍵と関係のない乱数の `pid`。
  同じ鍵の 2 本目の WebSocket は 1 本目を切る（`replaced`。退室にはならない）。切れたら最後のマスを覚え、次に入るとそこから。来た人の記録は 180 日で消す。
- **満員**：店内（WebSocket がつながっている人）が `MAX_PLAYERS` に達したら新しい人は入れない。管理者は満員でも入れる。
- **筐体**：「使う」は店内にいて 2 マス以内のときだけ（管理者も）。管理者は持ち主のいない筐体にも直接設定できる（持ち主は空のまま、時間切れも同じ）。
  時間切れは操作の前と 1 分ごとの掃除で当てる。URL は貼られた文字列を保存せず、取り出した ID から作り直した URL を保存する。生配信かどうかは `/live/` の形かどうかだけで判断（API キーは使わない）。
  「配信が設定された筐体」はすべて「LIVE」と表示する（実際に配信中かは確かめない）。
- **NG 語**：照合の前に NFKC・小文字・カタカナ→ひらがな・空白と記号を除く。2 文字のひらがななど、ふつうの言葉に引っかかる短い語は入れない（「シネマ」が「しね」に当たる など）。
  名前・発言・宣伝に当てる（お知らせは管理者が出すので当てない）。
- **管理者**：合言葉を入れた鍵が 12 時間管理者（同じブラウザなら再読み込みしても管理者のまま）。退室させた人が管理者だったら外す。自分は退室させられない。
  管理者の名前には ★ を付ける。お知らせは直近 5 件を大画面に流し（3 件まで）、チャットにも「お知らせ」として流す。
- **回数制限**（IP ごと）：初めての入室（`/enter`。前に来たことのある人の入り直し・名前の変更は数えない）1 分に 20 回・WebSocket の hello 1 分に 60 回・発言 1 分に 20 回・合言葉 10 分に 5 回・API 全体 1 分に 600 回。
  鍵ごと：発言 1 秒に 1 回・15 秒に 6 回、エモーション 0.8 秒に 1 回・20 秒に 8 回、筐体の操作 1 分に 20 回。接続ごと：移動 1 秒に 10 回（超えた分は捨てる）・10 秒に 80 通（超えたら切る）。
  JSON 16 KB・WebSocket の 1 通 4 KB。WebSocket は全体 300 本・同じ IP から 10 本。
- **ログ**：起動・停止・内部エラーの内容だけ。IP・鍵・合言葉・チャットは出さない。
- **画面**：左に店内（上に見出し・人数・配信中の台数、下にエモーションと操作の説明）、右 400 px にチャット。筐体の窓は店内の右下に出す（筐体と宣伝の吹き出しが隠れないように）。

## 0.2.0 で決めたこと（店内の BGM。DESIGN §7）

- **経緯**：ユーザー「店内に BGM 流しましょうか」。近くの筐体の小さな配信に音を出す案はユーザーがやめた（小さな配信は音なしのまま・BGM と関係しない）。
  途中で「`bgm/` に魔王魂の mp3 を入れたので BGM にできるように。合成の曲も選べる感じで。ループさせて」「動画を再生し始めたら BGM はフェードアウトしながら止める」。
- **曲の並びと既定**：一覧はサーバの曲（`bgm.json` の順 = 魔王魂 5 曲）→ 合成の曲 3 曲。既定は先頭（アコースティック02）。魔王魂の 5 曲は `rotate`
  （イントロ + 本体 2 周で次の曲へ。最後の次は先頭）、合成の曲は選んだらずっとくり返す（自分で判断）。［次の曲］は一覧の次（合成の曲も含む）。
- **曲名**：魔王魂のサイトの表記「アコースティック02」など（2026-10-25 にサイトで確かめた）。`bgm.json` の `title` で直せる。
- **クレジット**：「音楽：魔王魂（ループ・音量の調整のため編集）」を BGM の操作の曲名の下・曲の一覧の下・入店の画面の下に出す。合成の曲は「オリジナル（このアプリのために作曲）」。
- **ループ**：`tools/bgm/loop_bgm.py` で作る。結果（`tools/bgm/loops.json`）：02・46 は一致度 0.998・52 は 0.953（match、重ね 30 ms）、
  11・50 は戻れる所が見つからず fallback（曲の終わりの手前の拍の頭 → 曲の頭へ 150 ms の等パワーの重ね）。確認用の WAV `bgm/_loop_preview/` は**ユーザー未試聴**。
- **ブラウザが短い Vorbis の末尾を削る**：0.15 秒のイントロ（11・50）を Chrome の decodeAudioData が 87 サンプル短くデコードし、継ぎ目に段差が出た。
  ogg の後ろに続きの音を 0.25 秒足して書き、正しい長さを `bgm.json` の `introSec` / `bodySec` に持たせ、その長さでイントロを止め・本体を `loopEnd` でループするようにした。
- **音量**：魔王魂の 5 曲は −6.5〜−12.1 LUFS → `gain` 0.30〜0.55 で −17 前後。合成の曲は −10〜−13 LUFS だったので曲ごとの `gain`（0.45 / 0.47 / 0.62）で −17 前後。
  そのうえで音量のスライダー（既定 25%、0〜100 を 1.5 乗）と、割れ止めのコンプレッサ（−14 dB・4:1）。
- **メモリ**：デコード済みのバッファ（44.1 kHz ステレオの float で 2 分 ≒ 40 MB）は今の曲と次の曲の分だけ。次の曲は切り替えの 25 秒前から読み込む。
- **視聴画面**：再生の開始（YouTube の状態 1）で 1.8 秒のフェードアウト、店内に戻ったら 1.5 秒のフェードインで続きから。状態が 1 度も届かなければ開いて 5 秒で止める。
  一時停止・終了では戻さない。埋め込みの URL に `enablejsapi=1&origin=…`（大きな埋め込みだけ。小さな配信の URL は変えていない）。
- **自動再生**：入店のボタンの onSubmit の中で `bgm.unlock()`（AudioContext を作る）。再読み込みで自動入店したときは window の最初の pointerdown / keydown（capture）。
- **合成の曲**：Web Audio で 16 分のステップごとに OscillatorNode（矩形波 50% は既定、25% / 12.5% は PeriodicWave）と、1 秒のノイズのバッファ（ドラム）を予約する。
  ミッドナイト・ロビーはメロディとベルにこだま（DelayNode のフィードバック）。曲を足すときは `songs.ts` に同じ形で書いて `npm test`（`validateSong`）。
- **自分の曲**：`data/bgm/` に置いた mp3 / ogg / m4a（bgm.json に無いもの）は本体だけの曲として後ろに加わる。権利は置く人の責任（README・`data/bgm/README.md`）。
  VPS では版のフォルダの中なので、差し替えは PC で tar を作り直す（`deploy/INSTRUCTIONS.md` の「ログと運用」）。
- **お知らせのチャイム**：お知らせの id が増えたとき（最初に受け取った分・消えた分では鳴らさない）。BGM とは別の出口で、消音なら鳴らさない。

## 0.3.0 で決めたこと（クレーンゲーム・ポスター欄・チャットのピン止め。DESIGN §8〜§10）

- **経緯**：ユーザー「端にあるクレーンゲームをクリックすると、クレーンゲームのミニゲームが始まるようにしてください。カプセルの中身は♠、♡、♦、♧が入ったバッチでログアウトまで名前の後ろに付きます。
  ポスター欄には大会やイベント情報を書き込めるようにしてください。」・追加で「自分のチャットのうち一つだけピン止め出来るようにしてください。ピン止めすると吹き出しが出っぱなしになります。」
- **遠くからクレーンゲームをクリック**：前のマス（なければまわりの通れるマス）まで歩き、止まって 2 マス以内になったら窓を自動で開く（途中で床をクリック・キーで歩くと取りやめ）。
  当たり判定は筐体と同じ段（吹き出し・小さな配信の後）で、箱の輪郭。カーソルを置くと札「クレーンゲーム　クリックで遊ぶ」。
- **確率と待ち時間（既定）**：アームとカプセルの中心の距離 d が 0.025 以下（ケースの床の幅 = 1）で **65%**、d = 0.11 で 0（`(1 − t)^1.3` で下がる）。カプセルの半径 0.075。
  d = 0.05 で約 40%。つかめなかったときは、触れていれば半分「途中で落ちた」（位置が変わる）・半分「つかみ損ね」、触れていなければ「空振り」。待ち時間 **20 秒**（鍵ごと・サーバ）。
  `CRANE_MAX_CHANCE`（5〜100 %）・`CRANE_COOLDOWN_SEC` で変えられる。テストでは乱数を `Config.rng` で差し替える。
- **ケース**：台ごとにサーバのメモリ（最初に見られたときに作る。8 個。取れたら 1 個補充）。中身はクライアントに送らない。ほかの人が遊ぶと配置が変わるので、
  結果の `grabAt`（サーバの位置）で演出し、終わったら結果の `machine` に差し替える。窓を開いた時と 1 回ごとに読み直す（ほかの人の結果は即時には届かない）。
- **ミニゲームの作り**：Canvas 520×380。返事を待たずに下ろし始め、返事が来たら「つかむ → 持ち上げる → 出口へ運ぶ → 離す → 開ける」を組む（1 回の演出は約 5〜7 秒、動かす時間を含めて 10〜15 秒）。
  断られたら（待ち時間・遠い）アームを戻してエラーを出す。何もしないと 10 秒で次の段階へ（↑ 待ちなら今の位置で下ろす）。ねらいやすいよう、動かしている間は爪の真下の床に点線と輪を出す。
- **バッジ**：既定は 4 種類を 1 つずつ（ダブりは「もう持っています」・案内なし）。`BADGE_MODE=stack` で各 `BADGE_STACK_MAX` 個まで。並びは ♠♡♦♧。
  色は 4 色のトランプ（♠ 白・♡ 赤・♦ 青・♧ 緑。自分の黄色い名札では濃い色）。名前の 20 文字とは別。チャットの名前は**発言したときのバッジ**（DB の `chat.badges`）。
  筐体の持ち主・ポスターの書いた人は**いま店内にいればそのバッジ**。取れたら「〇〇 さんがクレーンゲームで ♦ を取った！」、そろったら「🎉 〇〇 さんが 4 種類コンプリート！」（system）。
- **ログアウト**：上のバーに［退店］（確認あり。`POST /api/leave` → `bye` → 入店の画面へ。名前・見た目・最後の位置は残る）。バッジとピン止めは**メモリだけ**で、
  退店・管理者の退室・接続が切れてから 30 分（`BADGE_KEEP_MIN`）・サーバの再起動で消える。再読み込み・一時的な切断では残る。
- **ポスター**：掲示板は左の壁の y = 6〜12（`floor.json` の `board`。v0.2 の飾りのポスター 2 枚の所。植木を (0,7) → (0,5) へ動かした）。壁には一覧の順に 4 枚（それ以上は「ほか n 枚」）。
  開始の日時は**必須**（30 日先まで）、終了は任意（開始から 7 日まで）。終了、なければ開始から 1 日で自動ではがす。URL は **http(s) ならどのサイトでも**（ユーザー名・パスワード入りは不可・300 文字）。
  窓ではドメインを横に出し `noopener noreferrer nofollow` で開く。日時はブラウザの時刻で入れる（サーバはミリ秒）。1 人 2 枚・店全体 40 枚・貼る/直すは鍵ごと 10 分 6 回・貼るのは IP ごと 10 分 10 回
  （形の検証の後に数える）。管理者は直す・はがす・固定。書いた人が直すと書いた人の名前も今のものに。新しく貼るとチャットに「📌 〇〇 さんがポスターを貼りました：「題名」（日時）」、
  壁の大画面の帯に「📅 近日のイベント：…」（開始が 7 日以内のものを 3 件まで。お知らせの後ろ）。
- **ピン止め**：チャット欄の自分の発言の行にだけ［📌］（ホバーで出る。ピン止め中は出しっぱなし・行に黄色の線）。1 人 1 つ（差し替え）・もう一度で外す。
  頭上ではふつうの吹き出しが優先、消えたらピン止めの吹き出し（黄色っぽい紙・📌）。管理者が発言を消したら外れる。消えるタイミングはバッジと同じ。
- **お知らせの削除**（メインの修正）：お知らせとチャットのお知らせの行は、どちらを消してももう片方が消える。
- **効果音**：合成の短い音（動かす・止める・下ろす・つかむ・持ち上げる・離す・落ちる・当たり・外れ・コンプリート）。お知らせのチャイムと同じ出口で、BGM の消音・音量に従う。**ユーザー未試聴**。

## 2026-10-25 に直したこと（ユーザーがこの PC で試して見つけたもの）

- 筐体に近づいて、宣伝の吹き出しや小さな配信の枠をクリックすると、その下の床へ歩いていた（小さな配信の枠は `pointer-events: none` でクリックが canvas に届き、
  吹き出しは canvas に描くだけで当たり判定が無かった）。`SceneHits` に `promo`（吹き出しの位置）と `embedCab` を足し、`ArcadePage.pick` で筐体より先に見て、その筐体を開くようにした。
- `scripts/hash-admin.mjs` に PowerShell のパイプで合言葉を渡すと先頭に BOM（U+FEFF）が付き、それを含んだハッシュになって「合言葉が違います」になった。先頭の BOM を取り除くようにした。

## 0.4.0 で決めたこと（スマホのレイアウト・コミュニケーションノート・機能追加要望箱。DESIGN §11〜§13）

- **経緯**：ユーザー「現在の表示はそのままで、スマホでアクセスした場合にはレイアウト変えて見やすくなるように出来ますか？」・
  「3行くらいの文章と名前が書ける　コミュニケーションノートを置いてください。見開きで表示されます。ページをめくっていけます。それと機能追加要望箱を設けてください。」（ノートは誰でも読める・要望は管理者だけ）。
  途中で、公開中の 0.3.0 をスマホで遊んだ人の声（「スマホだとこれ以上右に行けない」「横画面にすると行けるが、チャットと重なってうまく動かせない」）があり、
  店のどこへでも行けること・横画面でチャットが店内を隠さないことを確かめた（reach-check）。
- **PC は変えない**：PC の JSX は v0.3.0 のまま（`ArcadePage` の最後）。描画は `View.ts`（文字の倍率）が無ければ今までどおり。スクリーンショットの前後の差分で、ヘッダ・下のバー・チャットの欄・壁は 0 画素
  （変わったのは人の動き・吹き出し・チャットの中身と、新しく置いたノートの机・要望箱だけ）。管理者に未読の要望があるときだけ［管理者］に数の印が付く。
- **切り替え**：幅 900px 未満・指の端末で短い辺 600px 未満・スマホの UA（タブレットは入れない）。`?layout=pc` / `?layout=mobile` で強制。CSS は `.layout-mobile` の下だけ。
- **スマホの店内**：カメラは自分を追う（既定は店全体の 2.4 倍）。ピンチ（指の間の点を中心に）・ドラッグ（離して 3 秒で戻る・［◎ 自分の所へ］）・ホイール。タップ = 10px 以下・1 本指。
  **長押し 0.45 秒**で指の下の床へ歩く（筐体の陰の床へ行くため。物の当たり判定を見ない）。店の端の外まで少し動かせる（横 18%・縦 30%）。
  文字（名前・吹き出し・札・宣伝）は拡大率を 1.0〜1.4 に収めた倍率。宣伝は画面の下端の中央（筐体の上の小さな配信の枠と重ならない）。近くの配信はサムネイルの枠（メニューで動画に）。
  床・壁は店全体の大きな canvas（余白 240）に 1 回描いてずらして貼る（倍率が止まってから描き直す。長い辺 4096・1600 万画素まで）。
- **タップのあとの合成の click**：スマホでタップして窓を開くと、そのあとブラウザが合成する click が開いたばかりの窓の背景に届いて窓が閉じていた（確認の途中で見つけた）。
  店内の Canvas の `touchend` で preventDefault して止めた。
- **縦向き**：ヘッダ 44px（V.ARCADE・👥・📺・☰）・店内・下の欄（エモーションの横スクロール・チャットの最新 3 行・発言欄）。チャットはシート（画面の 6 割・▴ で全画面・下へスワイプ／外側／✕ で閉じる）。
  メニュー：名前とバッジ・見た目を変える・BGM（「🔇 タップで BGM」）・近くの配信を動画で出す・管理者（未読の数）・退店・操作の説明・版。
- **横向き**：店内の右に 300px の欄（ヘッダ・エモーション・チャットの履歴と発言欄。ロゴは出さない）。［›］でたたむと幅 56px の帯（［💬］［☰］）。欄は店内に重ならない。
- **窓**：下からのシート（全幅・ボタン 44px 以上）、ポスター・ノート・見た目の変更は全画面。入力欄は 16px。視聴画面は縦向きで 動画（幅いっぱい）→ 宣伝 → チャット、横向きで 動画｜宣伝とチャット。
- **ノート**：置き場所は入口の近くの (1, 10)（掲示板の手前の机）。1 ページ 4 件・古い順・開くと最後のページ。書いたらそのページへ・ほかの人の書き込みはページを動かさない。
  めくりは 0.35 秒の紙のアニメーション（CSS）。字は `--hand`（UD デジタル 教科書体・Klee など。無ければふつうの字）・罫線は背景のグラデーション。チャットへの案内は同じ人は 30 分に 1 回。
  読むのは鍵なしでも（`GET /api/notes`）。新しいものから 120 件ずつ読み、古いページへめくったら続きを読む（読んだ分はいつも新しい方から続いた範囲なので、通し番号 = 全体の件数 − 読んだ件数 + 位置）。
- **要望箱**：置き場所は右の手前の (21, 11)（ベンチの横の赤いポスト）。送った人には `{ok:true}` だけ返す（自分の要望も後から見えない）。名前は「名前を出さない」で null。
  NG 語では断らない。管理者の窓のタブ「📮 要望」（未読があればこのタブで開く）。未読の数は［管理者］のボタン・スマホは ☰ の赤い点とメニューの［管理者］。
- **DB**：`notes`（id・at・author_key（鍵のハッシュ）・author_pid・name・text）・`requests`（id・at・kind・name・text・status）。起動時に CREATE TABLE IF NOT EXISTS で足すだけ。

## 今後の課題

- **v0.3.0 でユーザーに確かめること**：DESIGN の末尾の表（C1 遠くからのクリック・C2 バッジの集め方・C3 残し方・C4 確率と待ち時間・P1 開始の日時を必須・P2 URL・P3 書ける人と枚数）、
  ミニゲームの操作感と見た目・効果音、掲示板の大きさと置き場所、ピン止めの吹き出しの見た目。
- クレーンゲームはアームの位置をクライアントが送るので、偽って送れば毎回ぴったりにできる（それでも 65% まで・20 秒に 1 回）。ケースの変化はほかの人には即時に届かない（開いた時と 1 回ごとに読み直す）。

- **BGM（0.2.0）でユーザーに確かめること**：曲の雰囲気・音量（既定 25%）・魔王魂の曲の順番に回す長さ（本体 2 周）・11 と 50 の継ぎ目（fallback。`bgm/_loop_preview/` を聞く）・
  合成の曲の出来。魔王魂のクレジットの書き方（「ループ・音量の調整のため編集」）でよいか。
- **公開前にユーザーが決めること**：管理者の合言葉（長いもの）と、置くかどうか／チャットに通報・ブロックが無いまま公開してよいか（管理者の削除・退室・入室の停止はある）／
  上限の数値（50 人・6 時間・回数制限）／NG 語の一覧の中身（`shared/data/ngwords.json` は叩き台の 25 語）／VPS の `node -v` と専用の Node を置くこと（手順書にある）。
- 見た目・操作感はユーザー未確認（店のレイアウト、筐体の大きさ、小さな埋め込みを筐体の上に出す形、キャラクターの絵）。
- 実際に配信中かどうか・タイトルの自動取得（YouTube Data API のキーが要る。DESIGN §5 🔧）。埋め込みが無効な配信は「YouTube で開く」だけになるが、それを見分けて出し分けてはいない。
- 鍵を盗まれた・なくした人の救済は無い（鍵 = 人）。荒らしは鍵を作り直せば入れる（入室の停止は鍵ごと。IP では止めない）。
- キャラクターをクリックしての操作（個別の通報など）は無い。
- **v0.4.0 でユーザーに確かめること**：スマホの実機（iPhone Safari・Android Chrome）での見た目・指の操作・キーボードが出たときの発言欄・セーフエリア、
  DESIGN の末尾の表（M1 切り替えの幅・M2 既定の倍率と戻るまで・M3 横向きのチャット・M4 近くの配信・N1 ノートの置き場所・N2 ノートの案内・R1 要望箱の置き場所）、ノートの見た目（罫線・字）。
- 筐体の箱は高いので、その奥の床は画面の上で箱と重なり、タップ・クリックでは筐体が開く（PC はキーボード、スマホは長押しで行ける）。
- 店内の人数が多いと名前・吹き出しが重なる（重なりの調整はしていない）。

## 確認したこと（v0.4.1）

- `npm run build`・`npm test`（210 件。`client/test/layout.test.ts` を足した）・`npm run package`（SHA-256 `6afe51a9f3745ac771aacf6f21e175943eca231ac3aed85225f6c2b0a4549cd2`）が通る。
- keyboard-check（別ポート 8798）：修正前の 0.4.0 の画面で NG 21（縦のチャットの欄はキーボードで横向きに切り替わり欄が作り直される・ほかの欄も横向きに切り替わる）、修正後は NG 0。
- note-check は NG 0。touch-check・reach-check（縦）は NG 0 の回もあるが、走らせるたびに「タップで筐体の窓が開く」「ドラッグの分だけ店が動く」などが NG になる回がある。
  reach-check（横 844×390）は「筐体の陰の床をタップすると筐体が開く」「チャットの欄の上のタップ・ドラッグで店内は動かない」が毎回 NG。
  **どれも 0.4.0 の画面に戻して同じ手順で走らせても同じように NG になる**（この PC の今の Edge ヘッドレスでの揺れ。0.4.1 の変更によるものではない）。原因は未調査。

## 確認したこと（v0.4.0）

- `npm run build`・`npm test`（202 件：shared 115・server 46・client 41）・`npm run package` が通る。展開した tar を `BASE_PATH=/arcade`・別ポートで起動し、
  `/arcade/api/meta`（版 0.4.0）・`/arcade/api/notes`・`/arcade/api/admin/requests`（鍵なしで 401）・index.html の viewport を確かめた。
- 画面（別ポート 8799）：PC 1920×1080 の前後（差分はヘッダ・下のバー・チャットの欄・壁で 0 画素）・ノートの見開き・要望を送る窓・管理者の要望の一覧、
  スマホ 390×844 の店内・チャットのシート・筐体のシート・視聴画面・クレーンゲーム・ポスター・ノート（1 ページ・書く）・メニュー・入店、844×390 の横向き（欄あり・たたんだ）。
- 指の操作（CDP の Input.dispatchTouchEvent）：touch-check・reach-check（縦・横）・note-check がすべて OK
  （タップで歩く・カメラの追従・ドラッグで店がずれる量 = 指の量・ドラッグでは歩かない・3 秒で戻る・8px 動いたタップ・ピンチの倍率 = 指の間の距離の比・上限と下限・タップで筐体が開く・
  ページは拡大されない・店の右奥の端（クレーンゲームの前）・右手前の角・要望箱・ノート・左奥・筐体の陰の床（長押し）まで歩ける・四隅まで見回せる・チャットの欄の上のタップで店内が動かない・
  ノートのスワイプ・最後のページで止まる・その場の反映・3 行まで・書いたら最後のページ）。

## 確認したこと（v0.3.0）

- `npm run build`・`npm test`（164 件：shared 108・server 40・client 16）・`npm run package`（8.4 MB）が通る。展開した tar を `BASE_PATH=/arcade`・別ポートで起動し、
  `/arcade/api/meta`（版 0.3.0・crane・posters）・`/arcade/api/posters`・`/arcade/` を確かめた。
- 画面（別ポート 8799・`CRANE_COOLDOWN_SEC=1`・`CRANE_MAX_CHANCE=100`・`SCENE_CRANE=4`）を撮って見た：ミニゲームの窓（アームが奥へ動いている途中・ねらいの点線）・取れたところ（♡ をゲット・紙吹雪・
  バッジの枠）・店内の名前のバッジ（頭上・チャット・上のバー）・壁の掲示板（4 枚・ホバー）・ポスターの一覧と詳細・書く窓・ピン止めの吹き出しとチャット欄の 📌。
  遠くからクレーンゲームをクリックすると「クレーンゲームまで歩いています…」→ 着いて窓が開くことも撮った画面で確かめた。

## 確認したこと（v0.2.0）

- `npm run build`・`npm test`（133 件：shared 88・server 29・client 16）・`npm run package`（8.3 MB。`data/bgm/` の ogg 10 個・bgm.json・README だけで mp3 なし）が通る。
- 展開した tar を `BASE_PATH=/arcade`・別ポートで起動：`/arcade/api/meta` に bgm の一覧・`/arcade/bgm/maou_bgm_acoustic52.intro.ogg` が `audio/ogg`・`/arcade/bgm/bgm.json` は 404。
- `scripts/dev/bgm-check.mjs`（Edge ヘッドレス）で 38 件 OK：開いた直後は鳴らない → 床のクリックで鳴る／8 曲すべてが鳴り［次の曲］で一巡／バッファは今と次の曲だけ／
  本体 2 周の手前から鳴らすと次の曲へ／5 曲の継ぎ目（イントロ → 本体・本体 → 本体）を書き出して、10 ms ごとの大きさの落ち込みなし・継ぎ目の段差 0.010〜0.07（まわりの差の最大 0.05〜0.26 以下）／
  視聴画面を開いただけでは止めない・再生の開始で 1.8 秒のフェードアウト（途中の倍率 0.26 → 0）・一時停止と終了では戻さない・店内に戻ると 1.5 秒のフェードインで続きから・状態が来なければ 5 秒で止める・
  小さな配信の URL は変わらない／消音・音量が `va:bgm` に残る／チャイムで例外なし／合成の曲 3 曲の書き出し（NaN なし・割れなし・無音の切れ目なし）。
  `REAL_EMBED=1` で本物の埋め込みからの状態が届き、再生が始まると BGM が止まり、店内に戻ると戻ることも確かめた（7 件 OK）。
- 画面：下のバーの BGM の操作と曲の一覧を撮って確かめた。

## 確認したこと（v0.1.0）

- `npm run build`・`npm test`（91 件：shared 64・server 27）・`npm run package` が通る。
- 展開した tar を `BASE_PATH=/arcade`・ポート 8798 で起動：`/arcade/` 200（`<base href="/arcade/" />` あり）・`/arcade` 301 → `/arcade/`・`/arcade/api/meta` 200・
  `/api/meta` 404・`/arcade/ws` 101・`/arcade/ws/arcade/ws` 404・`/ws` 404。
- Edge ヘッドレスで店内（7 人・配信中 3 台・大画面・吹き出し・エモーション・筐体の陰に入った人・座って視聴中の人・小さな埋め込み（ヘッドレスでも再生された））・
  筐体の宣伝の吹き出しと「使う」の窓・視聴画面（大きな埋め込みはヘッドレスでは読み込み中のまま。枠の位置は正しい）・管理者の窓・大画面の一覧・入店の画面を撮って確かめた。
