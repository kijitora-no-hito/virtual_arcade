# 2048（バーチャルゲームセンターに同梱するにあたって変えた所）

元：<https://github.com/gabrielecirulli/2048>（コミット `478b6ec`）。MIT License、© 2014 Gabriele Cirulli（`LICENSE.txt` はそのまま）。
バーチャルゲームセンター（v0.6.0、DESIGN §16）の店のゲーム筐体の窓の中（同じオリジンの iframe）で動かす。
ゲームの見た目（盤・タイル・色・アニメーション）と動きは変えていない。変えた所はコードに「va:」と書いた。

## 入れたファイル・入れていないファイル

- 入れた：`index.html`・`LICENSE.txt`・`js/`（`local_storage_manager.js` を除く）・`style/main.css`・`style/fonts/` の woff 3 つと `clear-sans.css`。
- 入れていない：`favicon.ico`・`meta/`（apple の画像）・`style/*.scss`・字体の eot / svg・`Rakefile`・`README.md`・`CONTRIBUTING.md`・`.jshintrc`。
- 足した：`js/va_bridge.js`（親の窓とのやりとり・乱数・ベストの置き場所）・`style/fonts/LICENSE-ClearSans.txt`（Clear Sans の Apache License 2.0 の本文）・このファイル。

## 変えた所

- **乱数**：`Math.random()` の 2 か所（`game_manager.js` の数字 2 / 4、`grid.js` の置き場所）を、サーバが渡す種（seed）から作る乱数（mulberry32、`va_bridge.js`）にした。
  呼ぶ順番は元のまま（先に数字、次に場所）。`GameManager` に 5 つ目の引数 `rng` を足し、`Grid.prototype.randomAvailableCell(rng)` で受け取る。
  サーバ（`shared/src/game2048.ts`）は同じ種と手の並びから盤をなぞり直して点数を決める。
- **始め方**：読み込んですぐには始めない（`application.js`）。親から `va2048:start` を受け取ったら始める。もう一度受け取ったら新しいゲーム（元の `restart` の中身を `newGame` にした）。
- **New Game・Try again・R キー**：親の窓に `va2048:restart` を送るだけ（親が今のゲームを記録してから、新しい種で始め直す）。
- **Keep going**：2048 を作って止まっているときだけ効くようにした（元は状態を見ずに続ける。サーバのなぞり直しと合わせるため）。続けたら親に `va2048:keep`。
- **親への知らせ**：盤が動いた手だけ `va2048:move`（0 上・1 右・2 下・3 左）、終わったら `va2048:over`、Esc で `va2048:close`。
- **保存**：途中の盤を localStorage に残さない（種と合わなくなるため）。ベストは親から受け取った「サーバに記録された自分のベスト」（`local_storage_manager.js` の代わりに `va_bridge.js` の `VAStorageManager`）。
- **index.html**：「This site is the official version of 2048 …」の注意書き（このサイトには当てはまらない）と favicon・apple の起動画像などの meta を外した。
  下の説明を日本語の操作説明と出典（Original: 2048 by Gabriele Cirulli（MIT License））にした。窓の中に収まるよう、上下の余白（`body` の margin）だけ詰めた。
- **字体**：Clear Sans（© 2012 Intel Corporation、Apache License 2.0）は woff だけ（`clear-sans.css` も woff だけを読むようにした）。
