# Hextris のフォルダに入れた第三者のもの

このフォルダ（`client/public/games/hextris/`）は Hextris（<https://github.com/Hextris/hextris>、コミット `3f4847d`）を写したもので、
**GNU General Public License v3**（`LICENSE.md`。© 2018 Logan Engstrom ほか）。このフォルダで変えたもの・足したもの（`va_bridge.js` など）も GPLv3。
リポジトリのほかの部分（バーチャルゲームセンターの本体）は MIT のまま（ルートの `LICENSE`）。本体とはブラウザの postMessage でやりとりするだけで、本体に GPL のコードは入っていない。

Hextris に同梱されていた部品のうち、ライセンスを確かめられたものだけを残した。

| もの | ファイル | ライセンス | 本文・出典 |
|---|---|---|---|
| jQuery 1.9.1 | `vendor/jquery.js` | MIT（© 2012 jQuery Foundation and other contributors） | `vendor/LICENSE-jquery.txt`（jquery/jquery の 1.9.1 の `MIT-LICENSE.txt`）。ファイルの先頭にも表示あり |
| Keypress 1.0.8 | `vendor/keypress.min.js` | Apache License 2.0（© 2013 David Mauro） | `vendor/LICENSE-keypress.txt`（apache.org の本文）。ファイルの先頭にも表示あり |
| Font Awesome 4.1.0（字体） | `style/fa/fonts/fontawesome-webfont.woff` | SIL Open Font License 1.1（Dave Gandy） | `style/fa/LICENSE-FontAwesome.txt`（v4.1.0 の README の License の節） |
| Font Awesome 4.1.0（CSS） | `style/fa/css/font-awesome.min.css` | MIT（Dave Gandy） | 同上。CSS の先頭にも表示あり。woff だけを読むよう `@font-face` の `src` を変えた |
| Exo 2（字体。Regular・SemiBold・ExtraLight） | `style/fonts/Exo2-*.otf` | SIL Open Font License 1.1（© 2013 The Exo 2 Project Authors。デザイン Natanael Gama） | `style/fonts/OFL-Exo2.txt`（google/fonts の `ofl/exo2/OFL.txt`）。字体の名前の表にも OFL の URL あり |

## 入れなかったもの

- 字体：Lovelo（配布の条件を確かめられなかった）・Quattrocento Sans・Roboto（どちらもページから使われていない）、Font Awesome の eot・ttf・svg・otf と `font-awesome.css`（min と同じ）。
- 部品：Hammer.js・js-cookie・sweet-alert・jsonfn・rrssb（SNS の共有。どれも外した処理でしか使っていない、または使っていない）。
- 画像：アプリストアのバッジ（`android.png`・`appstore.svg`）・SNS のボタン・og / twitter の画像・`images/icons/`（apple / manifest の icon）・`favicon.ico`。
- `manifest.webmanifest`・`CNAME`・`a.js`（外のサイトから読み込む広告用の空のファイル）・`.github/`・`README.md`。
