# Hextris（バーチャルゲームセンターに同梱するにあたって変えた所）

元：<https://github.com/Hextris/hextris>（コミット `3f4847d`）。**GNU General Public License v3**（`LICENSE.md` はそのまま）。
© 2018 Logan Engstrom（作者：Logan Engstrom・Garrett Finucane・Noah Moroze・Michael Yang）。
このフォルダは GPLv3 のまま。ここで変えたもの・足したもの（`va_bridge.js`・このファイル・`THIRD_PARTY.md`）も GPLv3。
バーチャルゲームセンター（v0.6.0、DESIGN §16.9）の店のゲーム筐体の窓の中（同じオリジンの iframe）で動かす。本体（MIT）とは postMessage でやりとりするだけ。
ゲームの決まり（ブロックの落ち方・消え方・点数・コンボ・難しさの上がり方）と見た目は変えていない。変えた所はコードに「va:」と書いた。
元のファイルの行末は LF（元のリポジトリのまま）。2026-10-30 の変更。

## 入れたファイル・入れていないファイル

- 入れた：`index.html`・`LICENSE.md`・`js/` の 14 個すべて・`style/style.css`・`images/` のボタン 5 つ（help・back・pause・resume・restart）・
  `vendor/jquery.js`・`vendor/keypress.min.js`・`style/fa/`（CSS の min と woff）・`style/fonts/` の Exo 2 の 3 つ。
- 入れていない・足したもの：`THIRD_PARTY.md` を見る。

## 変えた所

- **外への通信をなくした**（`index.html`・`js/`）：広告（adsbygoogle）・Google Analytics（`index.html` と `initialization.js` の 2 か所）・Google Fonts の読み込み・
  外のサイトの `a.js` の読み込み（`main.js`）・ゲームオーバーで外の IP へ点数を送る `$.get`（`main.js` の `checkGameOver`）・SNS の共有（rrssb・Twitter・Facebook・VK）・
  アプリストアのバッジ・og / twitter の meta・manifest・apple の icon・favicon を外した。一時停止の画面の「広告なし版」の宣伝のリンクも外した（`view.js`）。
- **乱数**：`randInt`（`math.js`）の `Math.random()` を、サーバが渡す種（seed）からの mulberry32（`VAHextris.rng()`）にした。落ちてくるブロックの並びが種で決まる。
- **保存**：途中の状態（saveState）・ローカルのハイスコア・Cookie（visited）を localStorage / Cookie に残さない（`save-state.js`・`initialization.js`・`Block.js`・`main.js`・`view.js`）。
  ハイスコアの表はこのページを開いている間だけ（親から受け取った「サーバに記録された自分のベスト」も並べる）。画面の上の「HIGH SCORE」は「BEST」に。
- **始め方**：Play（クリック・タップ）・Enter・やり直し（一時停止の Restart・ゲームオーバーの Restart・遊んでいる途中の Enter）は、すぐには始めず親の窓に `va-hextris:play` を送る
  （`initialization.js` の `startBtnHandler`・`input.js`）。親が今のゲームを記録してからサーバに start を頼み、`va-hextris:start {seed, gen, best}` が来たら `init(1)` で始める（`va_bridge.js`）。
- **親への知らせ**：ブロックを消すたびに `va-hextris:clear {k, m, add, score}`（消した数・コンボの倍率・点。`checking.js` の `consolidateBlocks`）、
  ゲームオーバーで `va-hextris:over {score}`（`main.js` の `animLoop`）、Esc で `va-hextris:close`。店のサーバは消した記録から点数を確かめる（なぞり直しはしない。DESIGN §16.9）。
- **遊び方の説明**（`main.js` の `showHelp`）：日本語にし、アプリストア・サイトへの案内を外して出典（GitHub へのリンク・作者・GNU GPL v3）に。足もとの右下にも出典の 1 行（`index.html`・`style.css` の末尾）。
- **Font Awesome の CSS**：同梱しない eot・ttf・svg を読まないよう、`@font-face` を woff だけにした。
