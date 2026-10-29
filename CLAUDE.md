# CLAUDE.md（virtual_arcade）

> **`CLAUDE.local.md` があれば、それも読むこと**（この PC・自分のサーバだけの事情。git に入れない）。

バーチャルゲームセンター：ブラウザから入れるクオータービューの店内を歩き、チャット・エモーションでやりとりし、筐体に YouTube の配信と宣伝を置ける。
**Android アプリではなく Web アプリ**（ワークスペース共通の Android 方針は当てはまらない）。仕様の正本は `docs/DESIGN.md`（Q1〜Q7 はユーザー決定済み。§8〜§10 は v0.3.0、§11〜§13 は v0.4.0、§14 は v0.5.0、§16 は v0.6.0）。

- 版: v0.6.0（2026-10-30。ゲーム筐体と 2048・スコアランキング・ベガ立ち。DESIGN §16・下の「0.6.0 で決めたこと」）。v0.5.1（2026-10-26。PC の上のバーの重なりを直した・チャットの発言を 24 時間で消す。DESIGN §15・下の「0.5.1 で決めたこと」）。v0.5.0（2026-10-26。オープン部屋と予約部屋。DESIGN §14・下の「0.5.0 で決めたこと」）。v0.4.1（2026-10-25。スマホでキーボードを出すと縦横が切り替わって発言の欄のキーボードがすぐ閉じていたのを直した。v0.4.0 でスマホのレイアウト・コミュニケーションノート・機能追加要望箱を足した。v0.1.0〜v0.3.0 も同じ日）。GitHub `kijitora-no-hito/virtual_arcade`（公開・MIT ライセンス）。
- Node 22.13 以降（`node:sqlite` の `DatabaseSync` を使う。ネイティブビルドの要るパッケージは使わない方針）。

## 引き継ぎ（2026-10-30 時点。続きから始めるときは最初にここを読む）

- **読む順**：この節 → `docs/DESIGN.md`（✅ = ユーザー指定、🔧 = 叩き台）→ 下の「DESIGN にない部分で決めたこと」。
- **状態**：v0.1 の範囲（DESIGN §1〜§4）・v0.2.0 の店内の BGM（DESIGN §7）・v0.3.0 のクレーンゲーム（§8）・ポスター欄（§9）・チャットのピン止め（§10）・
  v0.4.0 のスマホのレイアウト（§11）・コミュニケーションノート（§12）・機能追加要望箱（§13）・v0.5.0 のオープン部屋と予約部屋（§14）・v0.6.0 のゲーム筐体と 2048・ランキング・ベガ立ち（§16）を実装済み。
  **v0.6.0**（2026-10-30。**未公開・ユーザー未確認**。DESIGN の末尾の表 G1〜G8 が叩き台）：ユーザー「virtual_arcadeでゲームが出来るようにしてください。まず以下をアーケード筐体から遊べるようにしてください。
  スコアランキングを店内のポスターで掲示されるようにしてください。https://github.com/gabrielecirulli/2048」・途中で「エモーションにベガ立ちを追加してください」。
  元の 2048（MIT）を `client/public/games/2048/` に同梱して iframe で動かし、サーバが種と手順をなぞり直して点数を決める（`shared/src/game2048.ts`。元の JS と一致することを vm で確かめるテストあり）。
  筐体は配信用の 8 番の隣 (14,4)（ユーザー指定）、立て看板は (17,4)。**(15,4)・(15,5) はあとで足す Hextris 用、(14,9) とその看板の場所はコラムス用に空けてある**（DESIGN §16.2）。
  DB は新しい表 `game_scores` を足すだけ（0.5.x へそのまま戻せる）。下の「0.6.0 で決めたこと」・「確認したこと（v0.6.0）」。`npm test` 276 件。
  **v0.5.1**（2026-10-26。未公開・ユーザー未確認）：(1) ユーザーのスクリーンショット（予約部屋・主催者でサイトの管理者・幅 1900px ほど）で PC の上のバーの項目が重なっていた不具合を直した。
  予約部屋の札・時計・部屋の管理・オープン部屋へは上のバーの下の帯（`.roombar`）に分け、狭い幅・拡大では「…」で省略（title あり）・段階的に隠す。下のバーの説明も短い版・隠す。
  確認は `scripts/dev/header-check.mjs`（104 通り NG 0）。(2) ユーザー「店内チャット24時間とかで消えるようにしましょう」：`CHAT_TTL_HOURS`（既定 24）を過ぎた発言を起動時と 1 分ごとに消す。
  **DB の形は変えない**（行を消すだけ。0.5.0 へ戻しても消えた発言は戻らない）。下の「0.5.1 で決めたこと」・「確認したこと（v0.5.1）」。`npm test` 247 件。
  **v0.5.0**（2026-10-26。ユーザー「現在のものをオープン部屋に、もう一つ予約部屋を立てられるようにしてください」）：下の「0.5.0 で決めたこと」・「確認したこと（v0.5.0）」。
  `npm test` 241 件・`npm run build`・`npm run package` が通る。**ユーザー未確認・未公開**（DESIGN の末尾の表 Y1〜Y7 が叩き台）。DB は新しい表 `reservations` を足すだけ（0.4.x へそのまま戻せる）。
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
     `node scripts/dev/keyboard-check.mjs <URL#dev> <鍵>`（v0.4.1。Pixel 412×915 で欄にフォーカス → 高さだけ 412×400 に縮めてキーボードを真似る。チャット・シート・ノート・要望・ポスター・管理者・名前の欄と回転。
     v0.5.0 で予約の形の欄と予約部屋の合言葉の欄（予約部屋が開いていて、自分の予約でも管理者でもない鍵のときだけ）も見る）。
     どれも `OK / NG` を 1 行ずつ出し、NG の数で終わる。ヘッドレスの Edge は前面・フォーカスありにしないとタッチの返事が来ないことがある（スクリプトの中でしている）。
     scene.mjs は v0.4.0 からノート 8 件（見開き 1 つ分）と要望 3 件も書く（架空の名前・当たり障りのない文）。
  7. **v0.5.0（部屋）**：前に来た人も、新しく開いたときは入店の画面になる（このタブで店内にいたときだけ自動で入る）。そのため確認の道具は sessionStorage `va:room` を入れてから開く
     （shot.mjs は `ROOM=open`（既定）/ `reserved` / `none`（入店の画面））。`#dev` の `__va` に `door()`・`calendar()`・`room()` と `open({kind:'reserve'|'door'})`。
     予約部屋を撮るには、API で今の枠の予約を入れて（`POST /api/reservations`）、予約した人の鍵で `ROOM=reserved`。予約の時間の移り変わりはサーバが 5 秒ごとに見る。
     scene.mjs・確認の道具の WebSocket は hello に `proto: 2` を付ける（無いと古いページとして切られる）。同じ IP から WebSocket は 10 本までなので、scene（6 人）にほかの bot を足すと確認の道具がつなげなくなる。
  9. **v0.6.0（ゲーム筐体と 2048・ランキング・ベガ立ち）**：`node scripts/dev/game-check.mjs <BASE の URL> [撮る先のフォルダ]`（CDP と API・WebSocket。遠くから筐体をクリック → 歩いて窓 → iframe に矢印キー
     （店内の人は動かない）→ ✕ で記録 → ゲームオーバーまで → 結果の帯 → Try again → ランキングの窓 → iframe の中の Esc → 2 人目が遊んで順位・立て看板の ranking → 不正な手順（でたらめ・動かない手・速すぎる・別のセッション・
     2048 の前の K・遠い・知らないゲーム）→ スマホ 390×844 でタップで開いてスワイプ・立て看板のタップ）。scene がいなくても動く（2 人を自分で作る。WebSocket を 2 本使う）。
     `#dev` の `__va` に `game(i)`・`ranking(i)`（位置）・`rankings()`（立て看板の上位）・`stance()`、2048 の窓を開いている間は `__vaGame`（`moves()`・`count()`・`gen()`）。
     scene.mjs は v0.6.0 から 5 人が 2048 を遊んで記録し（`SCENE_GAME=0` でしない）、てんちょう・むらさきがベガ立ちをする。2048 を種から動かす道具は `scripts/dev/lib2048.mjs`
     （記録するときは「手の数 × 40 ms」より後に finish）。ヘッドレスの Edge はタッチの返事が遅れて、返事を待ってから指を離すと長押し（床へ歩く）になるので、タップは返事を待たずに続けて送る。
  8. **v0.5.1（PC のバーの重なり）**：`node scripts/dev/header-check.mjs <BASE の URL> <状態ファイル> <管理者の合言葉> [撮る先] [頭]`。状態ファイルが無ければ API で主催者（名前 20 文字）・ふつうの人・管理者と
     今の枠から 5 時間の予約（部屋名 26 文字）を作る。大きさ 13 通り（2560〜900・拡大 125%/150% は CSS の幅と DPR で）× 役割 4 × 部屋 2 で、上のバー・予約部屋の帯・下のバーの項目の
     重なり・はみ出し・右の欄の下へのもぐり・省略に title があるか・「エモーション」が 1 行かを見る。`CASES=quick`（3 通りの大きさ）・`ROLES=visitor,host,…`。
     管理者の合言葉は IP ごとに 10 分 5 回までなので、続けて何度も回すときはサーバを起動し直す（回数はメモリだけ）。予約部屋の合言葉の記録もメモリだけなので、起動し直したら DB と状態ファイルも消す。
- **BGM の確認の手順**（音は聞けないので数字で。自動）：上の 1・2 のあと
  `node scripts/dev/bgm-check.mjs http://127.0.0.1:8798/arcade <状態ファイル> out.png`（自動再生の制限・全曲の再生と切り替え・順番に回す・継ぎ目・視聴画面のフェード・
  消音と設定・合成の曲の書き出し・曲の一覧の撮影。視聴画面の埋め込みは読み込ませずに偽の状態で確かめる）と、
  `REAL_EMBED=1 node scripts/dev/bgm-check.mjs …`（本物の YouTube の埋め込みが再生を始めたら BGM が止まるか）。`WAV_DIR=<フォルダ>` で合成の曲の WAV を書き、
  `python tools/bgm/loudness.py --ref <WAV …>` で同梱の曲と音量を比べられる。
- **版を上げるとき**：package.json 4 つ・`package-lock.json`・`server/src/app.ts` の `VERSION` の既定値（package では版が埋め込まれる）・`server/test/api.test.ts` の版・`deploy/INSTRUCTIONS.md` の例を直し、`npm run package`
  （入店の画面の右下に `/api/meta` の版が出る）。v0.5.0 からクライアントにも版が入る（`client/vite.config.ts` が package.json から読む）。サーバの版と違えば「新しい版があります［再読み込み］」。

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
| `client/` | React + Vite + TS。店内は Canvas 2D（ライブラリなし）。**相対パスでビルド**（`base: './'`）。`client/public/games/2048/`（v0.6.0）は元の 2048（MIT。素の JS。Vite がそのまま dist に写す。変えた所は同じフォルダの `CHANGES.md`） |
| `deploy/` | サーバに置く手順書 `INSTRUCTIONS.md`（一般的な書き方。example.com・`/arcade/`）・`virtual-arcade.service`・`apache-arcade.inc`（tar にも入る） |
| `scripts/` | `package.mjs`（release の tar.gz）・`hash-admin.mjs`（管理者の合言葉のハッシュ。tar の `tools/` にも入る）・`dev/shot.mjs`（Edge ヘッドレスで撮る。スマホの大きさ・タップも）・`dev/scene.mjs`（確認用に人を入れる）・`dev/bgm-check.mjs`（店内の BGM の確認）・`dev/touch-check.mjs`・`dev/reach-check.mjs`・`dev/note-check.mjs`（v0.4.0。スマホの指の操作・店のどこへでも行けるか・ノート）・`dev/keyboard-check.mjs`（v0.4.1。キーボードが出ても欄のフォーカス・縦横が変わらないか）・`dev/header-check.mjs`（v0.5.1。PC の上のバー・帯・下のバーの重なり）・`dev/game-check.mjs`・`dev/lib2048.mjs`（v0.6.0。ゲーム筐体と 2048・ランキング） |
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
- `rooms.ts`（v0.5.0）部屋 `RoomId`（open / reserved）・`PROTOCOL`（= 2）・予約の決まり（`SLOT_MS` 30 分・`RESERVATION_KEY_TOTAL_MS` 5 時間・14 日先・`RESERVATION_LIMITS`）・
  `validateReservation`（30 分の枠・長さ・文字数・NG 語・合言葉）・`overlaps`・`activeReservation` / `nextReservation` / `reservedTotalMs` / `maxLengthFrom`・JST の表示（`jstTime`・`jstDate`・`formatReservationRange`。Intl を使わない）・
  `closedRoomText`・扉と予約カレンダーの置き場所 `doorSpots` / `calendarSpots` / `doorFront`（floor.json の decor の `door` / `calendar`）
- `games.ts`（v0.6.0）`GAMES`（今は 2048 だけ。id・題名・iframe のページ）・`isGameId`・`gameSpots` / `rankingSpots`（floor.json の decor の `game` / `ranking`）・`GAME_NEAR`（2）・
  `GAME_MOVE_MIN_MS`（40）・`GAME_MAX_MOVES`（200,000）・`GAME_SESSION_TTL_MS`（24 時間）・`RANKING_LIST_MAX`（50）・`RANKING_POSTER_TOP`（5）・`RANKING_ANNOUNCE`・`jstMonthStart`・`formatScore`
- `game2048.ts`（v0.6.0）`mulberry32`・`Game2048`（元の game_manager.js と同じ順番・合体・乱数の使い方）・`replay2048(seed, moves)`（動かない手・終わった後の手・おかしな K は ok = false）・`MOVES_RE`・`countMoves`
- `floor.ts` の decor に `game` / `ranking`（`game` フィールド、game は `face` も。前のマスが通れること）・`looks.ts` に `STANCES`（v0.6.0。ベガ立ち）

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
- v0.5.0：`roomData.ts`（部屋ごとのチャット・お知らせ・筐体の置き場所。オープン部屋は今までの表、予約部屋は `MemRoomData`（メモリだけ・`clear`））。
  `arcade.ts` は部屋ごとの状態 `rooms`（データ・筐体・クレーンゲームのケースと待ち時間）を持ち、`Online.room`・`Hooks.broadcast(msg, room?)`（room を省くと全部の部屋）。
  予約：`reservations`（まだ終わっていない分の DB の写し）・`syncSlot`（時間の移り変わり。始まり・10 分前と 5 分前・終わりで全員をオープン部屋へ戻して `closeReservedRoom` で消す）・
  `grants`（合言葉を入れた鍵 → 予約の id。メモリだけ）・`createReservation` / `cancelReservation` / `listReservations` / `enterRoom`・`moveTo`（部屋を移す。新しい welcome を送る）。
  `db.ts` に `reservations` の表（新しい表だけ）。`app.ts` は hello の `proto` を見て古いページに再読み込みを頼む・5 秒ごとに `syncSlot`・合言葉の間違いだけを数える（`RateLimiter.blocked`）。
- v0.6.0：`db.ts` に `game_scores` の表（新しい表と索引だけ）と `gameBests`（鍵ごとのベスト。同点は先。since で今月）・`bestScoreOf`。
  `arcade.ts` にゲームのセッション（`gameSessions`。メモリだけ）・`startGame` / `finishGame`（なぞり直し・速すぎる手・チャットの案内）・`ranking` / `rankingTop` / `deleteGameScore`・`play`（🎮）・
  `setStance`（ベガ立ち。goto・watch・play・部屋を移るで外す）。`app.ts` は `/api/games/…` の口（finish だけ JSON 256 KB）と WebSocket の `play` / `stance`。
- テスト：`test/harness.ts`（テスト用のサーバ・WebSocket の道具。v0.3.0 で api.test.ts から分けた。v0.5.0 から hello に proto: 2、`connect(key, path, room)`）・`api.test.ts`・`v03.test.ts`（クレーンゲーム・バッジ・ポスター・ピン止め）・`v04.test.ts`（ノート・要望）・
  `v05.test.ts`（予約・合言葉・部屋ごと・時間の終わり。時計は `clock.t` で進めて `syncSlot()`）・`unit.test.ts`。shared は `test/rooms.test.ts`（v0.5.0）。
  v0.6.0：`server/test/v06.test.ts`（ゲームの API・WebSocket・DB・ベガ立ち。種は `Config.rng` で決める）・`server/test/game2048-vm.test.ts`（同梱した元の JS を `node:vm` で動かし、
  ランダムな手で 300 ゲーム、1 手ごとの盤・点数・終わりと `replay2048` が一致するか。2048 まで遊んだ記録（K あり）も）・`shared/test/game2048.test.ts`（なぞり直しの決まり・置き場所・あとで足す筐体の場所でも歩けるか）。
  2048 まで遊んだ記録は `shared/test/fixtures/win2048.json`（種 2）

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
- v0.5.0：`components/ReservationDialog.tsx`（予約表 `ReservationDialog`：カレンダー（PC 7 日・スマホ 1 日）・一覧・予約の形、扉の窓 `RoomDoorDialog`：合言葉・閉まっているときの「次は ○○」・オープン部屋へ戻る、`useReservations`）。
  `game/client.ts` に `room`・`roomSeq`・`reservations`・`outdated`（`CLIENT_VERSION`）。`render.ts` は部屋の色 `THEMES`（`drawStatic(…, room)`）・扉と予約カレンダー・上の中央の部屋名の帯。
  `App` は sessionStorage `va:room`（再読み込みのときだけ自動で入る）、`EntryPage` に「🔑 予約部屋」の欄、`AdminDialog` に「🔑 予約」タブ、スマホのメニューに［📅 予約表］［🔑 予約部屋に入る / 🚪 オープン部屋へ戻る］。
- v0.6.0：`components/Game2048Dialog.tsx`（iframe・postMessage（送り主とオリジンを確かめる）・start / finish・`gen` で古い手を捨てる・閉じる / 退店 / pagehide は keepalive で記録して結果を toast）・
  `components/RankingDialog.tsx`（総合・今月・上位 50・自分・管理者の削除）。`render.ts` にゲーム筐体の絵（金色の看板・4×4 の盤・上の看板）・ランキングの立て看板（中身は変わったときだけ描き直す）・
  当たり判定 `games` / `rankings`・札・頭上の 🎮 とベガ立ちの印。`character.ts` に腕組みのポーズと印 `drawCrossedArms`。`client.ts` に `rankings`・`rankingSeq`。
  `ArcadePage` のエモーションの欄に 9 個目（ベガ立ち）。
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
- 予約部屋（v0.5.0）：`GET /reservations`（誰でも。これからの予約・`activeId`・鍵があれば `myLeftMs`）/ `POST /reservations {startAt, minutes, title, host, description, passphrase}`
  （入店したことのある鍵。`bad-time` / `too-long` / `ng` / `bad-pass` / `overlap` / `too-much`（5 時間を超える）。鍵ごと 1 時間 6 回・IP ごと 12 回）/ `DELETE /reservations/:id`（予約した人か管理者）/
  `POST /rooms/:room/enter {passphrase?}`（room = reserved | open。`room-closed` / `need-passphrase` / `bad-passphrase`（間違いだけを鍵ごと 10 分 5 回・IP ごと 20 回数える）/ `full`。
  店内にいればその場で移って新しい `welcome`、いなければ `moved: false`（入店の画面。このあと hello の room で入る））。合言葉のハッシュ・鍵はどの返事にも載せない。
  主催者（予約部屋の中で、その予約の間）とサイトの管理者：`POST /room/remove {pid}`（オープン部屋へ戻し、この予約の間は入れない）/ `POST /room/passphrase {passphrase}` / `POST /room/end`（早めに終える）。
  お知らせ・発言の削除（`/admin/notices`・`/admin/chat/:id`）と筐体を空ける（`/cabinets/:id/release`）も主催者は予約部屋でだけできる
- ゲーム（v0.6.0。DESIGN §16）：`POST /games/:game/start`（店内にいて、そのゲームの筐体に 2 マス以内。`too-far`。鍵ごと 1 分 20 回・IP ごと 60 回）→ `{session, seed, best}` /
  `POST /games/:game/finish {session, moves}`（鍵ごと 1 分 20 回。この口だけ JSON 256 KB。店内にいなくてよい。`no-session` / `bad-moves` / `too-fast`）→
  `{recorded, score, maxTile, moves, best, newBest, rank: {all, month}}` / `GET /games/:game/ranking?period=all|month`（誰でも。鍵があれば `me`）/
  `DELETE /admin/games/:game/scores/:id`（サイトの管理者）。知らない `:game` は 404。2048 のページは `{BASE_PATH}/games/2048/index.html`（静的配信）
- 店内の BGM のファイル：`GET {BASE_PATH}/bgm/<ファイル名>`（API の外。一覧の intro / body にあるものだけ。Range 可・`Cache-Control: public, max-age=3600`）
- WebSocket `{BASE_PATH}/ws`：最初に `{type:'hello', key, proto: 2, v, room}`（鍵を URL に載せない。v0.5.0 から proto が無ければ `kicked`「再読み込みしてください」で切る）。その後 `goto {x,y}`（サーバが A* で経路を決めて全員に `move`。通れないマスは `blocked`）/
  `emote {emoji}` / `watch {cabinet | null}`（配信中の筐体の前のマスに座る）。
  サーバからは `welcome`（自分・全員・筐体・チャット・お知らせ・ポスター・サーバの時刻）/ `join` / `leave` / `player`（バッジ・ピン止めの変化も）/ `move` / `emote` / `chat` / `chat-delete` / `cabinet` / `notices` /
  `posters` / `you` / `kicked` / `bye`（退店した）/ `error`。v0.5.0：`welcome` に `room`・`version`・`reservations`・`reason`、`reservations`（予約の一覧が変わった・全部の部屋へ）。
  部屋ごとのメッセージはその部屋の人にだけ（ノート・ポスター・予約の一覧は全員）。
  v0.6.0：クライアントから `play {game|null}`（ゲームの窓を開いた・閉じた。`PlayerView.playing` = 頭上の 🎮）・`stance {stance: 'vega'|null}`（ベガ立ち。`PlayerView.stance`。エモーションと同じ回数の枠）。
  サーバから `welcome.rankings`（ゲームごとの総合の上位 5 人）・`ranking {game, top}`（上位が変わった。全部の部屋へ）。

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

## 0.5.0 で決めたこと（オープン部屋と予約部屋。DESIGN §14）

- **経緯**：ユーザー「現在のものをオープン部屋に、もう一つ予約部屋を立てられるようにしてください。」決定：空いていれば誰でも予約できる・入るのは合言葉・日時の枠で予約。
  途中の変更：1 人あわせて 5 時間まで（最初の案は 1 人 1 件・3 時間まで）・予約表に予約した人の名前と部屋名（題名 → 部屋名）・部屋名を予約部屋の中にも出す・
  入店の画面から予約して合言葉でそのまま予約部屋へ・オープン部屋に扉と予約カレンダー（物）を置く（カレンダーは日 × 時間の枠、空いている枠を押して予約。スマホは日ごとの枠の一覧）。
- **作り**：部屋ごとの状態をサーバの `Arcade` の中に 2 つ持つ（`rooms.open` は今までの DB の表、`rooms.reserved` はメモリ）。人は 1 つの部屋にだけいる（`Online.room`）。
  WebSocket は 1 本のまま、部屋を移るとサーバが新しい `welcome` を送る（クライアントは `roomSeq` が変わったら描画・窓を作り直す）。部屋を移る操作は REST（`/api/rooms/:room/enter`）。
- **合言葉**：予約ごとに scrypt（塩つき）でハッシュにして `reservations.pass_hash` に入れる（管理者の合言葉と同じ `hashPassphrase`）。前後の空白は落として NFC。
  合った鍵は `grants` に覚え、その予約の間は合言葉なしで入り直せる（再読み込み・扉の行き来）。予約が終わる・取り消す・サーバの再起動で消える。管理者の退室（kick）でも消す。
- **時間**：枠は UTC の 30 分の倍数（JST は +9 時間で 30 分の倍数なので、そのまま JST の 00 分・30 分になる）。今の枠（始まっている 30 分）からは予約できる。
  終わりは `syncSlot`（5 秒ごと・入る前・予約を作る・取り消すとき）で当てるので、最大 5 秒ほど遅れて戻る。案内は 10 分前・5 分前を 1 回ずつ（予約が 5 分を切ってから作られたら残りの分数で 1 回）。
- **予約部屋の中身**：チャット・お知らせ・筐体・クレーンゲームはメモリだけ。閉じるときは先に全員をオープン部屋へ戻してから消す（`closeReservedRoom`）。続けての予約でも、いったん全員戻して消してから次を開く。
  筐体の「1 人 1 台」とクレーンゲームの待ち時間は部屋ごと（オープン部屋と予約部屋で 1 台ずつ持てる）。
- **位置**：DB の最後の位置（`users.x/y`）はオープン部屋のものだけ。部屋を移ると扉の前のマス（`doorFront` = (2,1)）に立つ。
- **入店の画面**：前に来た人も、新しく開いたときは入店の画面（名前と見た目は入っている。［入店する］で今までどおりオープン部屋）。再読み込み（sessionStorage `va:room` がある）ときだけ自動で入る。
  入店の画面で予約する・予約部屋に入るときは、先にその画面の名前と見た目で `/api/enter` してから（BGM を鳴らせるようにする `bgm.unlock()` もこの操作の中）。
- **PC のオープン部屋**：上のバー・下のバー・チャットの欄は変えていない（差分は奥の壁ぎわの扉・予約カレンダー・その札だけ。予約部屋のときだけ上のバーに部屋名の札と［🚪 オープン部屋へ］）。
  扉とカレンダーは `render.ts` の `panelBox`（壁ぎわの薄い板）。当たり判定は筐体・クレーンゲーム・ノート・要望箱の後、大画面より前。
- **古いページ**：hello に `proto` が無ければ `kicked`「新しい版になりました。ページを再読み込みしてください」（0.4.x の画面は退室の札にこの文を出し、つなぎ直さない）。
  index.html は no-cache・assets は名前にハッシュなので、再読み込みで新しい版になる。
- **行末**：このリポジトリは CRLF のファイルと LF のファイルが混ざっている（`git ls-files --eol`）。編集したら元の行末にそろえる。
- **主催者（予約した人）= 予約部屋の管理者**（途中のユーザー指定。DESIGN §14.6）：`Arcade.isRoomHost`（いまの予約の ownerKey・予約の時刻の間）と `requireRoomPower`
  （サイトの管理者はどこでも、主催者は予約部屋の中にいるときだけ）。お知らせ・発言の削除は今までの `/api/admin/notices`・`/api/admin/chat/:id` のまま（サーバが部屋と主催かを見る）、
  筐体を空けるのは `/api/cabinets/:id/release`、ほかは `/api/room/remove`・`/api/room/passphrase`・`/api/room/end`。出した人は `roomBans`（この予約の間だけ。`closeReservedRoom` で消す）。
  早めに終えると予約の行の `end_at` をその時刻に書き換える。`PlayerView.host`・`ChatMessage.host`（予約部屋のメモリのチャットだけ）で「［主催］」「主催」。画面は `components/RoomAdmin.tsx` の `RoomAdminDialog`。
- **時計と残り時間**（途中のユーザー指定。DESIGN §14.7）：`RoomClock`（1 秒ごと。`formatRemaining`・`remainLevel`（10 分で warn・5 分で urgent））。時刻は `client.serverNow()`。
  サーバは `pong` に `serverNow` を付け、クライアントは ping を送った時刻と受け取った時刻の真ん中で差を出す（`estimateOffset`。つないで 1.5 秒後にも 1 回）。
  PC は上のバー（予約部屋のとき。部屋名の札は短くして 1 行に収めた）、スマホは見出し（縦は 📺 の代わり・横は部屋名の札を出さない・たたんだ帯は 2 行）。
- **確認の道具の Edge**（2026-10-26）：ヘッドレスでも BGM が PC のスピーカーから鳴ったので、`scripts/dev` の Edge はすべて `--mute-audio` で起動し、終わり・失敗・Ctrl+C で必ず閉じる（`process.on('exit')` で kill）。

## 0.5.1 で決めたこと（PC の上のバー・チャットの残す時間。DESIGN §15）

- **上のバー**：予約部屋のときだけ、上のバー（54px）の下に帯（40px、`.roombar`。grid の行を 54px 40px 1fr に。スマホの `.m-arcade` には当てない）。帯は札「🔑 予約部屋「部屋名」〜終わり（予約：名前）」（縮む・…・title）・時計・空き・［🛠 部屋の管理］・［🚪 オープン部屋へ］。
  PC では Canvas の上の中央の札（`ui.roomBanner`）を出さない（スマホだけ）。上のバーは予約部屋でもオープン部屋と同じ並び。
- しきい値（画面の幅）：1599 以下 名前 10em・「見た目を変える」を隠す／1439 以下 ロゴの日本語を隠す／1279 以下 余白を詰め名前 7em／1099 以下 ロゴ 17px・名前 4em・「配信中」と「エモーション」の見出しを隠す・エモーションのボタン 40px。
  名前の上限は 20em（20 文字の名前は 1920 で全部出る）。人数・配信中の札は「…」で縮む（title）。
- 下のバー：説明は 1 行ずつ「…」（`.help` は縮みやすく `flex-shrink: 100`）、1499 以下は 2 行の短い版、1299 以下は出さない（全文は title）。BGM の「クリックで BGM」は 1 行。
  `.stage` の列を `minmax(0, 1fr)` にした（狭いと下のバーの中身で列が広がり、右の欄の下にもぐっていた）。
- 1920×1080 のオープン部屋は 0.5.0 と画像の差分で同じ（名前の位置で 1×2 ピクセルの違いだけ。BGM のボタンの点滅は除く）。
- **チャットの残す時間**：`Config.chatTtlMs`（`CHAT_TTL_HOURS`、1〜8760、既定 24）。`Arcade.expireChat()` を sweep（起動時・1 分ごと）とピン止めの前に呼ぶ。
  DB は `Store.expireChat(before)`（`DELETE FROM chat WHERE at < ?` を直接。`deleteChat` の「お知らせの行を消すと元のお知らせも消す」は通さない）、予約部屋は `MemRoomData.expireChat`。
  消えた行ごとに `chat-delete` を送り、`unpinDeleted` でピン止めを外す。`welcome` の chat は `Arcade.recentChat(room)`（過ぎたものを除く）。クライアントは変えていない（chat-delete で消える。最大 1 分遅れ）。

## 0.6.0 で決めたこと（ゲーム筐体と 2048・スコアランキング・ベガ立ち。DESIGN §16）

- **経緯**：ユーザー「virtual_arcadeでゲームが出来るようにしてください。まず以下をアーケード筐体から遊べるようにしてください。スコアランキングを店内のポスターで掲示されるようにしてください。
  https://github.com/gabrielecirulli/2048」。途中で「8 番の隣に 2048・16 番の隣はコラムス用に空ける・画面にゲームの画面っぽい絵」「(15,4) は Hextris 用に空ける」「エモーションにベガ立ちを追加してください。
  腕を組んだマークが移動するまで頭の上に出続ける感じで」。仕様は DESIGN §16（16.6 に実装で決めたこと、16.7 にベガ立ち）。
- **2048 の取り込み**：元のコミット `478b6ec` の JS・CSS・woff を `client/public/games/2048/` に写し、変えたのは乱数（`Math.random()` の 2 か所 → 種の mulberry32）・始め方（親の `va2048:start` 待ち）・
  New Game / Try again / R（親に頼む）・Keep going の守り・親への知らせ（`js/va_bridge.js`）・保存しない・index.html の説明と出典・上下の余白だけ。変えた所はコードに「va:」、一覧は `CHANGES.md`。
  元のファイルの行末は LF（元のリポジトリのまま）。
- **点数の決め方**：サーバが種（`crypto` の 32 bit）と手の並び（`0〜3` と `K`）から盤をなぞり直す。クライアントの点数は使わない。速すぎる（手の数 × 40 ms より早い）・動かない手・終わった後の手・おかしな K は断る。
  セッションは鍵ごと 1 つ・1 回だけ・24 時間・メモリだけ（再起動をまたいだゲームは記録できない）。点数 0 は記録しない。**自動で解くプログラムに遊ばせることは防げない**（既知の限界）。
- **一致の確かめ方**：`server/test/game2048-vm.test.ts` が同梱した元の JS をそのまま `node:vm` で動かし、1 手ごとに TS の `Game2048` と盤・点数・終わりを比べる（300 ゲーム）。元の JS を変えたら必ず回す。
- **置き場所**：筐体 (14,4)・立て看板 (17,4)。板（画面に平行）は筐体の 1 マス右に置くと筐体の画面を隠す（(15,4) で撮って確かめた）ので 2 マス右。
  (15,4)・(15,5) は Hextris、(14,9)〜(16,9) はコラムス用に空けてある（叩き台の並び：Hextris の看板 (20,3)・コラムスの看板 (16,9)。テストで歩けることは確かめた）。
- **絵**：ゲーム筐体は配信用より高い茶色の箱・金色の看板「2048」・大きな画面に 4×4 の盤（3 つの盤を順に）・箱の上に光る金色の看板。立て看板は元の 2048 の色の板に「2048 RANKING」と上位 5 人。
- **窓**：PC は真ん中の窓（幅 600・iframe の高さ min(720px, 100vh − 190px)）、スマホは全画面のシート。開いたら iframe にフォーカス（親の矢印キーは iframe に取られるので店内の人は動かない）。
  ［🏆 ランキング］はこの窓の上に重ねて開く（閉じても 2048 はそのまま）。iframe の中の Esc は親に知らせて閉じる。
- **記録の結果**：ゲームオーバー・New Game のときは窓の上の帯「記録しました：12,345 点（自己ベスト更新！総合 3 位・今月 1 位）」、閉じる・退店・ページを離れるときは店内の下の帯（toast）。
  順位は自己ベストでの順位（更新しなかったら「自己ベストは ○ 点・…」）。チャットの案内は自己ベストで総合 10 位以内、今月の自己ベストで今月 3 位以内。
- **ランキング**：鍵ごとのベスト（同点は先、さらに同じなら id の小さい方）。SQLite の `ROW_NUMBER() OVER (PARTITION BY key_hash …)`。今月は日本時間の月の初め（`jstMonthStart`）から。
  記録の名前はそのときの名前。来た人の記録の掃除（180 日）とは別でランキングは残る。行は増え続ける（消すのは管理者の 1 行ずつだけ）。
- **ベガ立ち**：`PlayerView.stance`（メモリだけ）。付ける・外すは WebSocket の `stance`（トグルはクライアント）。歩く（goto）・座る（watch）・ゲーム（play）・部屋を移る・切断で外れる。
  頭上の印は Canvas の絵（赤い帽子の上半身の腕組み）で、エモーション・吹き出しが出ている間はそちらを出す。人形も腕を組む（止まっているときだけ）。エモーションの欄の 9 個目（押している間は赤く沈んだ見た目）。
- **確認の道具**：`scripts/dev/game-check.mjs`・`lib2048.mjs`、`scene.mjs` に 2048 の記録とベガ立ち（上の「画面の確認の手順」9）。

## 今後の課題

- **v0.6.0 でユーザーに確かめること**：DESIGN の末尾の表（G1 置き場所・G2 占有しない・G3 途中でやめた点数も記録・G4 総合と今月・G5 チャットの案内・G6 不正の防ぎ方・G7 元の見た目・G8 ベガ立ち）、
  ゲーム筐体と立て看板の絵、2048 の窓の大きさ（PC・スマホ）、ベガ立ちの印とポーズ。Hextris・コラムスを足すときは `GAMES` と floor.json に足し、iframe のゲームごとになぞり直しを書く。
- 2048 は自動で解くプログラム（AI）に遊ばせることを防げない。ランキングの行は増え続ける（多くなったら古い・低い記録を間引く仕組みが要る）。再起動をまたいだゲームは記録できない。
- keepalive の fetch は 64 KB までなので、とても長いゲーム（約 6 万手より長い）を閉じたときはふつうの fetch で送る（ページを離れたときは届かないことがある）。
- `header-check` の quick（24 通り）で、幅 900 の管理者（主催者＋管理者・管理者）の上のバーの人数の札と名前のボタンが 1 ピクセル重なる NG が 4 つ出る。
  **0.5.1 の画面に戻しても同じ NG が出る**（今回の変更によるものではない。0.5.1 のときは 104 通り NG 0 だったので、字体などこの PC の環境の違いと思われる。原因は未調査）。

- **v0.5.0 でユーザーに確かめること**：DESIGN の末尾の表（Y1 見分け方・Y2 扉とカレンダーの置き場所・Y3 新しく開いたときは入店の画面・Y4 移るとピン止めが外れる・Y5 予約の案内・Y6 回数制限・Y7 PC の入り口・
  Y8 主催者の印・Y9 主催者が出した人・Y10 時計の場所）、
  扉・カレンダーの絵、予約表の使い勝手（PC・スマホ）。予約部屋の通報・ブロックは無い（管理者の削除・退室・取り消しはある）。合言葉を忘れた人の救済は無い（予約した人が取り消して取り直す）。
- 予約部屋の中身はメモリだけなので、予約の途中でサーバを再起動するとチャット・筐体が消え、合言葉を入れた人は入れ直しになる（予約そのものは DB に残る）。

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

## 確認したこと（v0.6.0）

- `npm run build`・`npm test`（276 件：shared の game2048.test.ts 16 件・server の v06.test.ts 10 件・game2048-vm.test.ts 3 件を足した）・`npm run package`
  （SHA-256 `f5c8d815c6ad46c24d9f75ec538286c5e985cef83126b09967f70bfdc4062b26`）が通る。展開した tar を `BASE_PATH=/arcade`・別ポート 8797・一時 DB で起動し、`/arcade/games/2048/index.html`（200 text/html）・
  `js/va_bridge.js`・woff・`LICENSE.txt`（200）・`/arcade/api/meta`（版 0.6.0）・`/arcade/api/games/2048/ranking`（空の一覧）・知らないゲーム（404）・`/games/2048/index.html`（404）を確かめた。
- `game-check.mjs`：展開した tar のサーバ（8797）で 49 通り NG 0（開発のサーバ 8796・scene ありでも 48 通り NG 0。Esc の確かめは後から足した）。
- 一致のテスト：元の JS（vm）と TS のなぞり直しが、ランダムな手（動かない手を含む）の 300 ゲーム（2 万手以上・100 ゲーム以上が終わりまで）で 1 手ごとに一致。2048 まで遊んだ記録（K あり）も一致。
- 画面（別ポート 8796・一時 DB・scene）：PC 1920×1080 の店内（筐体・立て看板・ベガ立ちの人・吹き出しと重なったとき）・筐体のホバーの札・2048 の窓・ゲームオーバーと結果の帯・ランキングの窓・
  スマホ 390×844 の店内（ベガ立ちの印）・2048 の全画面のシート・ランキングのシート・エモーションの欄の 9 個目（押された見た目）を撮って見た。
  途中で、立て看板を (15,4)（筐体の 1 マス右）に置くと板が筐体の画面を隠すのを見つけて (17,4) へ移した。
- 既存の確認：`keyboard-check` NG 0（66 通り）。`header-check` の quick は 24 通り NG 4（幅 900 の管理者の上のバー。0.5.1 の画面でも同じ NG。上の「今後の課題」）。

## 確認したこと（v0.5.1）

- `npm run build`・`npm test`（247 件：server の v051.test.ts 6 件を足した）・`npm run package`（SHA-256 `e46faffd5728d0d49006c126e2094777df9f5d407a46ccd7fcda519ab1cfc316`）が通る。
  展開した tar を `BASE_PATH=/arcade`・別ポート・`CHAT_TTL_HOURS=2` で起動し、`/arcade/api/meta`（版 0.5.1）とページ（200）を確かめた。
- テスト：既定 24 時間と環境変数（おかしな値は既定・下限 1）・welcome に過ぎた発言を入れない（掃除の前でも）・掃除で DB からも開いている画面からも消える・sweep からも・
  ピン止めが外れる・過ぎた発言はピン止めできない・お知らせの行が消えてもお知らせは残る・短くした時間で消える・予約部屋（メモリ）も同じ。
- 画面（別ポート 8797・一時 DB）：`header-check.mjs` 104 通り NG 0（直す前の 0.5.0 は quick の 24 通りで NG 18。1366 の予約部屋で時計・オープン部屋へと名前・退店・管理者が重なり、900 では上のバーがあふれていた）。
  撮った大きさ：予約部屋の主催者＋管理者 1920・1600・1366・1280・1024・900・1920 の拡大 125%、ふつうの人の予約部屋 1920・オープン部屋 1920。スマホの予約部屋（縦・横）も見た（変わらない）。
  keyboard-check NG 0。

## 確認したこと（v0.5.0）

- `npm run build`・`npm test`（241 件：shared の rooms.test.ts 15 件・server の v05.test.ts 16 件を足した）・`npm run package`（SHA-256 `1083a0be8ed8fbff0f81c72593d77815e675a1aadcd06164275fe69095220d32`）が通る。
  展開した tar を `BASE_PATH=/arcade`・別ポートで起動し、`/arcade/api/meta`（版 0.5.0・onlineByRoom）・`/arcade/api/reservations` を確かめた。
- テスト：重なり・30 分の枠・5 時間（1 つでもあわせても）・14 日・1 人の合計と取り消し・合言葉（間違いの回数制限を鍵ごと・IP ごと、ハッシュを返さない）・予約した人と管理者は合言葉なし・
  閉まっている部屋・入店の画面から入る（hello の room）・古いクライアント・10 分前と 5 分前・終わりで全員戻して消す・続けての予約に前のチャットが残らない・取り消し・
  部屋ごとのチャット・エモーション・筐体・人数と、店全体のノート・ポスター・バッジ・主催者の力（印・発言とお知らせ・筐体・出す・合言葉・早めに終える・時間切れ・オープン部屋ではできない・サイトの管理の操作はできない・合言葉で入った人はできない）・残り時間の表示と時計の差。
- 画面（別ポート 8797・一時 DB）：オープン部屋の PC の前後（上のバー・下のバー・チャットの欄は同じ。変わったのは扉・予約カレンダー・その札だけ）・予約表（PC 7 日・スマホ 1 日）・予約の形・
  合言葉の窓（PC・入店の画面からスマホ）・入店の画面から合言葉で予約部屋へ入る・予約部屋（PC・スマホ）・閉まっているとき・時計（PC・スマホ縦・横・たたんだ横、残り 5 分の赤）・部屋の管理の窓。
- CDP の確認（Edge は `--mute-audio`）：keyboard-check NG 0（予約の形・合言葉の欄を足した）・note-check NG 0・touch-check NG 0・reach-check 縦 NG 0・横 NG 0（最後の回）。
  ただし reach-check は 0.4.1 のときと同じく回によって「筐体の陰の床をタップすると筐体が開く」「チャットの欄の上のタップで店内が動かない」が NG になることがある（今回も途中の回で出た。0.4.1 から続く揺れ）。

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
