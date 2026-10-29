# Columns like game（バーチャルゲームセンターに同梱するにあたって変えた所）

元：<https://github.com/jcfieldsdev/columns>（コミット `8c6f90c`）。MIT License、© 2020 J.C. Fields（`columns.js` の先頭の著作権表示と許諾文・`LICENSE.md` はそのまま）。
「Columns（コラムス）」はセガのゲームの名前で、元のコードは非公式のクローンなので、画面に出す名前は「Columns like game」にした。
バーチャルゲームセンター（v0.6.0、DESIGN §16.8）の店のゲーム筐体の窓の中（同じオリジンの iframe）で動かす。
ゲームの決まり（井戸の大きさ・そろい方・点数・レベル・マジックジュエル）は変えていない（下の不具合の修正を除く）。変えた所はコードに「va:」と書いた。
元のファイルの行末は CRLF（元のリポジトリのまま）。

## 入れたファイル・入れていないファイル

- 入れた：`index.html`・`columns.js`・`layout/style.css`・`layout/fonts/` の Laila 3 つ（Regular・Medium・Bold。CSS が使っていない Light・SemiBold は入れていない）・`LICENSE.md`。
- 入れていない：背景の写真 `images/`（Pexels の写真 12 枚・33 MB。再配布の条件があいまいで重い）・字体 Dalek Pinpoint（同梱してよいかの条件がはっきりしない）・
  `layout/manifest.json`・`favicon.png`・`homeicon.*`・`screenshot.jpg`・`README.md`・`.github/`。
- 足した：`va_bridge.js`（親の窓とのやりとり・種からの乱数）・`layout/fonts/OFL-Laila.txt`（Laila の SIL Open Font License 1.1 の本文。google/fonts の `ofl/laila/OFL.txt` と同じ）・このファイル。

## 変えた所

- **名前**：`index.html` の題名・見出しを「Columns like game」に。
- **宝石の色**：`COLORS` の表を、元の赤・青・黄・緑・紫・橙から、ピンク・空色・黄緑・琥珀・紫・ターコイズに（明・中・暗の 3 段）。マジックジュエルは真珠色。色の数・並びは同じ。
- **乱数**：ゲームに効く `Math.random()`（ピースの色 3 つ・マジックジュエル・Height の段）を、サーバが渡す種（seed）からの mulberry32（`VAColumns.rng()`）にした。呼ぶ順番は元のまま。
  見た目だけのもの（マジックジュエルの縁の色・背景のグラデーション）は `Math.random()` のまま。
  サーバ（`shared/src/columns.ts`）は同じ種と「置いた記録」から井戸をなぞり直して点数を決める。
- **始め方**：Play を押すと、すぐには始めず親の窓に `va-columns:play {options}` を送る。親がサーバに start を頼み、`va-columns:start {seed, gen, options}` が来たら、その設定で `game.play()`。
- **親への知らせ**：ピースが固まるたびに `va-columns:place {x, rot, bonus, t}`（列・回した回数・そのピースの ↓ と落下の点・経過秒）、
  ゲームオーバーで `va-columns:over {score, x, bonus}`、Reset（ボタン・Backspace）で `va-columns:reset`、Esc で `va-columns:close`。
  回した回数（`Piece.rot`）・ピースごとの ↓ の点（`Game.pieceBonus`・`addBonus`）を数えるようにした。
- **元の不具合の修正**：↓（`moveDown`）で、ピースが動かなかったとき（段の境目・固まった後）も点が入っていた。動いたときだけ点を入れる。
  落とす（`drop`）も、固まりかけ（段の途中）で押すと点が減ることがあったので、下りた段の分だけ（0 未満にしない）。
- **保存**：途中のゲーム・ローカルのハイスコアの表・オプション・名前を localStorage に残さない（`Storage` は使わない）。ハイスコアの表・名前の入力（`#scores`・`#prompt`）は出さない（記録は店のランキング）。
- **背景**：写真は入れないので Gradient だけ（Backdrop の選択と写真のクレジットを外した）。
- **字体**：見出しと数字の欄の名前（Dalek Pinpoint）は Laila の太字にした。見出しは名前が長くなったので小さく。使っていない Laila Light の `@font-face` を外した。
- **index.html**：manifest・favicon・apple の icon・作者のメールアドレス（mailto）を外し、足もとに操作の説明と出典（Original code: columns by J.C. Fields（MIT License）・GitHub へのリンク）。
  Options に「ランキングに載るのは Standard・Colors 5・Height 0」の説明。
- **窓に収める**（`style.css` の末尾）：井戸は枠に収まる大きさに（縦長の狭い画面で右にはみ出していた）。マウスの画面では下の大きなボタンを出さない。
  横長（PC の窓）は出典と操作の説明を右下に、縦長（スマホ）はいちばん下に出典の 1 行。
