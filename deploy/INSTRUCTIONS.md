# サーバに置く手順書: バーチャルゲームセンターを https://example.com/arcade/ に置く

この文書は、Linux のサーバ（例として AlmaLinux 8 / 9 + Apache）にバーチャルゲームセンターを置く手順です。
サーバの上で動く Claude Code などにそのまま渡して進めることもできます。その場合は**作業する人（ユーザー）の確認を取りながら、1 段ずつ進めてください。**
認証情報（パスワード・鍵・管理者の合言葉）・IP アドレスはこの文書に書きません。聞かれても書き出さないでください。

以下では次の値を例として使います。自分の環境に合わせて読み替えてください。

| 例の値 | 意味 |
|---|---|
| `example.com` | 既存のサイトのドメイン（TLS = https はすでに動いている前提） |
| `/arcade/` | 置くパス（`BASE_PATH=/arcade`。別のパスにするなら、ユニット・Apache の設定・下の確認の URL をそろえて直す） |
| `8791` | アプリが待ち受けるポート（127.0.0.1 だけ。空いていれば何番でもよい。ユニットの `PORT` と Apache の設定をそろえる） |
| `0.7.0` | 版（`package.json` の `version`） |

## 0. 何を置くか

- `virtual-arcade-<版>.tar.gz`（例 `virtual-arcade-0.7.0.tar.gz`。作り方は手元の PC で `npm run package`）。中身はそのまま動く形にしてある:
  `server.js`（起動用。Node の版を確かめる）・`lib/app.js`（サーバ本体を 1 ファイルにまとめたもの。店のレイアウトも中に入っている）・
  `public/`（画面）・`data/bgm/`（店内の BGM の曲と一覧。置いたときだけ）・`tools/hash-admin.mjs`（管理者の合言葉のハッシュを作る）・`deploy/`（この文書・systemd・Apache の設定）。
  **`npm install` も `tsx` も要らない**。
- Node.js **22.13 以上**が必要（組み込みの `node:sqlite` を使うため）。サーバに既存の Node があっても**変えない**。
  **専用の Node を `/opt/virtual-arcade/node` に置く**（手順 3）。ほかのアプリの Node とも共有しない（片方の更新がもう片方に響かないように）。
- 待ち受けは **127.0.0.1:8791**（外から直接はつながない）。外からは既存の Apache が TLS（https）を終えて、
  **`/arcade/` を http、`/arcade/ws` を WebSocket で中継**する（パス方式。DNS・証明書の追加は要らない）。
- 保存先は SQLite 1 ファイル `/var/lib/virtual-arcade/virtual_arcade.db`（来た人の名前と見た目・入室の停止・筐体の設定・チャットの直近 200 件・お知らせ・ポスター・ノート・要望）。
  秘密鍵はハッシュだけを保存する。IP アドレスは保存しない。
- 管理者の合言葉は**ハッシュ**（`scrypt:…`）だけをサーバに置く（`/etc/virtual-arcade/admin.env`。手順 7）。合言葉そのものはユーザーが持つ。

## 1. 触ってはいけないもの

- **同じサーバの他のサイト・アプリには触れない（Apache は graceful のみ）。** その設定ファイル・プロセス・ポート・Node 本体を変えない・止めない・再起動しない。
- Apache は **`graceful`（つながっている人を切らない読み直し）だけ**。`restart` / `stop` はしない。
- ファイアウォール（firewalld）は **新しい穴を開けない**（443 は既に開いているはず。8791 は外に開けない）。
- 既存の証明書（certbot）を作り直さない。
- `dnf` で `nodejs` を入れ替えたり、`alternatives` で `node` の向き先を変えたりしない（ほかのアプリが使っていることがある）。

## 2. 前提の確認（変更はしない。結果をユーザーに見せる）

```bash
cat /etc/os-release | head -3                     # AlmaLinux 8 か 9 か
uname -m                                           # x86_64（= Node の linux-x64）か aarch64（= linux-arm64）か
free -m                                            # 空きメモリ（目安: available が 300 MB 以上）
df -h /opt /var/lib                                # 空き容量（目安 200 MB 以上）
httpd -v                                           # Apache の版（2.4.37 = 8 系、2.4.5x = 9 系）
sudo httpd -M 2>/dev/null | grep -E 'proxy_module|proxy_http|proxy_wstunnel|alias_module|ssl_module'   # 5 つとも出るか
sudo apachectl -S 2>&1 | head -40                  # 443 の VirtualHost と、その設定ファイルの場所
sudo ss -ltnp | grep -E ':(80|443|8791)\b'         # 8791 が空いているか（使われていたら止めてユーザーに相談。別のポートにしてもよい）
node -v 2>&1 || echo "node なし"                   # 既存の Node の版（変えない）
which node 2>&1
sudo firewall-cmd --list-services                  # https があるか（無くても勝手に足さない。ユーザーに相談）
grep -rn -E 'ProxyPass(Match)?\s|RedirectMatch' /etc/httpd/conf.d/ /etc/httpd/conf/ 2>/dev/null | grep -v '^\s*#'   # 既存の中継
```

- `proxy_wstunnel` が無ければ（まれ）、`/etc/httpd/conf.modules.d/00-proxy.conf` に `LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so` があるかを見せて、ユーザーと相談する。
- 既存の設定に `/arcade` で始まる中継・Alias があれば、先にユーザーに見せて相談する（ぶつかる）。
- メモリが少ないとき（available が 300 MB 未満）は、先にユーザーに知らせる（常駐 100 MB 前後の見込み。`MemoryMax=256M` で頭打ち）。

## 3. 専用の Node（22.13 以上）を置く

既存の Node は変えない。`/opt/virtual-arcade/node` に公式バイナリの tar を展開するだけ:

```bash
# 版は Node 22 系の最新（https://nodejs.org/dist/latest-v22.x/ を見て決める。例 v22.20.0）。arch は手順 2 の uname -m で linux-x64 / linux-arm64
NODE_VER=v22.20.0
NODE_ARCH=linux-x64
cd /tmp
curl -fsSLO https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-${NODE_ARCH}.tar.xz
curl -fsSLO https://nodejs.org/dist/${NODE_VER}/SHASUMS256.txt
grep " node-${NODE_VER}-${NODE_ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c -     # 「OK」が出なければ止める
sudo mkdir -p /opt/virtual-arcade/node
sudo tar -xJf node-${NODE_VER}-${NODE_ARCH}.tar.xz -C /opt/virtual-arcade/node --strip-components=1 --no-same-owner
sudo chown -R root:root /opt/virtual-arcade/node
/opt/virtual-arcade/node/bin/node -v               # v22.20.0 など（22.13 以上）
node -v                                            # 既存の Node は変わっていないこと（手順 2 と同じ版）
rm -f /tmp/node-${NODE_VER}-${NODE_ARCH}.tar.xz /tmp/SHASUMS256.txt
```

- `PATH` には足さない（既存の `node` の向き先を変えないため）。ユニットからフルパスで使う。
- `tar` が `.xz` を読めなければ `sudo dnf install -y xz`（ユーザーの了承の後）。

## 4. 専用ユーザーと置き場所

```bash
sudo useradd --system --home-dir /opt/virtual-arcade --shell /sbin/nologin virtual-arcade
sudo mkdir -p /opt/virtual-arcade/releases
sudo install -d -o virtual-arcade -g virtual-arcade -m 0750 /var/lib/virtual-arcade     # DB の置き場所（systemd の StateDirectory でも作られる）
```

| 場所 | 中身 | 持ち主 |
|---|---|---|
| `/opt/virtual-arcade/node/` | 専用の Node（手順 3） | root（読むだけ） |
| `/opt/virtual-arcade/releases/virtual-arcade-<版>/` | アプリ（版ごと） | root（読むだけ） |
| `/opt/virtual-arcade/current` | 使う版への symlink | root |
| `/var/lib/virtual-arcade/` | DB（`virtual_arcade.db` と `-wal` `-shm`） | virtual-arcade（0750） |
| `/etc/virtual-arcade/admin.env` | 管理者の合言葉のハッシュ（手順 7） | root（0600） |

## 5. tar を送って確かめて置く

ユーザーが PC から tar を送る（scp・WinSCP など）。**送り先は自分のホーム**（例 `~/virtual-arcade-0.7.0.tar.gz`）にしてもらい、そこから置く。
PC 側のファイル: リポジトリの `release/virtual-arcade-0.7.0.tar.gz`（作り方 `npm run package`。
同じフォルダの `.sha256` に値がある。PowerShell なら `Get-FileHash release\virtual-arcade-0.7.0.tar.gz -Algorithm SHA256`）。

```bash
ls -l ~/virtual-arcade-*.tar.gz
sha256sum ~/virtual-arcade-*.tar.gz                 # ユーザーが PC で出した値と同じか確かめる（違えば止める）
tar -tzf ~/virtual-arcade-0.7.0.tar.gz | head -20   # virtual-arcade-0.7.0/server.js などが並ぶこと（../ や / で始まる名前が無いこと）
sudo tar -xzf ~/virtual-arcade-0.7.0.tar.gz -C /opt/virtual-arcade/releases --no-same-owner
sudo chown -R root:root /opt/virtual-arcade/releases/virtual-arcade-0.7.0
sudo chmod -R u=rwX,go=rX /opt/virtual-arcade/releases/virtual-arcade-0.7.0
sudo ln -sfn /opt/virtual-arcade/releases/virtual-arcade-0.7.0 /opt/virtual-arcade/current
ls -l /opt/virtual-arcade/current/
```

## 6. 単体で動くか（systemd・Apache の前に）

一時的な DB で、本番と同じ環境変数で起動して確かめる（確かめたら止めて一時 DB を消す）:

```bash
sudo install -d -o virtual-arcade -g virtual-arcade -m 0700 /tmp/va-check
sudo -u virtual-arcade env HOST=127.0.0.1 PORT=8791 BASE_PATH=/arcade DB_PATH=/tmp/va-check/check.db \
  /opt/virtual-arcade/node/bin/node /opt/virtual-arcade/current/server.js &
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8791/arcade/            # 200
curl -s http://127.0.0.1:8791/arcade/ | grep -o '<base href="/arcade/" />'         # <base href="/arcade/" /> が出る
curl -s http://127.0.0.1:8791/arcade/api/meta; echo                                # {"version":"0.7.0","maxPlayers":50,"online":0, …
curl -s -o /dev/null -w '%{http_code}\n' -m 3 --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:8791/arcade/ws   # 101
curl -s -o /dev/null -w '%{http_code}\n' -m 3 --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:8791/arcade/ws/arcade/ws   # 404
kill %1
sudo rm -rf /tmp/va-check
```

- 「バーチャルゲームセンターには Node.js 22.13 以降が必要です」と出て止まったら、手順 3 の Node を使っているか確かめる。
- `/tmp/va-check` は一時 DB の置き場所（確かめた後に消す）。本番の DB（`/var/lib/virtual-arcade`）には触らない。

## 7. 管理者の合言葉（ハッシュ）と systemd のユニット

管理者の合言葉は**ユーザーが決めて、ユーザーが入力する**（長いもの。20 文字以上をすすめる）。Claude などの作業する AI は合言葉を聞かない・書き出さない・履歴に残さない。

1. ユーザーに次を実行してもらう（入力した文字は画面に出ない。出てきた `scrypt:…` の 1 行だけを使う）:
   ```bash
   /opt/virtual-arcade/node/bin/node /opt/virtual-arcade/current/tools/hash-admin.mjs
   ```
   （手元の PC でリポジトリから作るなら `npm run hash-admin`。同じ形の 1 行が出る）
2. その 1 行を root だけが読めるファイルに置く（ユーザーが貼り付ける。`scrypt:` で始まり `:` で 3 つに分かれた形。`$` は入らないので引用符は要らない）:
   ```bash
   sudo install -d -m 0700 /etc/virtual-arcade
   sudo touch /etc/virtual-arcade/admin.env && sudo chmod 0600 /etc/virtual-arcade/admin.env
   sudoedit /etc/virtual-arcade/admin.env      # 中身は 1 行: ADMIN_PASS_HASH=scrypt:…:…
   ```
   - 管理者を置かないときは、このファイルを作らなくてよい（管理者の画面に「合言葉が設定されていません」と出るだけ）。
   - 形が違うとサーバは起動しない（「ADMIN_PASS_HASH の形が不正です」とログに出る）。
3. ユニットを入れて起動する（中身は `virtual-arcade.service`。この文書と同じフォルダ。`/opt/virtual-arcade/current/deploy/` にもある。
   ポート・パスを変えるときは、入れる前に `PORT` / `BASE_PATH` を直す）:
   ```bash
   sudo install -m 0644 /opt/virtual-arcade/current/deploy/virtual-arcade.service /etc/systemd/system/virtual-arcade.service
   sudo systemd-analyze verify /etc/systemd/system/virtual-arcade.service    # 警告が出たら見せる
   sudo systemctl daemon-reload
   sudo systemctl enable --now virtual-arcade
   systemctl status virtual-arcade --no-pager
   journalctl -u virtual-arcade -n 20 --no-pager
   # 「バーチャルゲームセンター サーバ起動: http://127.0.0.1:8791/arcade/ (BASE_PATH=/arcade, 同時 50 人まで, 筐体は 6 時間で空きに, 管理者の合言葉 あり)」
   curl -s http://127.0.0.1:8791/arcade/api/meta; echo           # "adminEnabled":true（合言葉を置いたとき）
   ls -l /var/lib/virtual-arcade/                                 # virtual_arcade.db ができている（持ち主 virtual-arcade）
   ps -o rss,cmd -C node | grep virtual-arcade                    # 常駐のメモリ（KB）。目安 120 MB 以下
   ```

### 環境変数（ユニットの `Environment=`）

| 名前 | 既定 | 意味 |
|---|---|---|
| `HOST` / `PORT` | 127.0.0.1 / 8791 | 待ち受け |
| `BASE_PATH` | （空 = ルート） | 置くパス（例 `/arcade`）。ビルドし直さずに変えられる |
| `DB_PATH` | `data/virtual_arcade.db` | SQLite の DB |
| `ADMIN_PASS_HASH` | （なし） | 管理者の合言葉のハッシュ（`admin.env` に置く） |
| `ADMIN_TTL_HOURS` | 12 | 合言葉を入れてから管理者が続く時間 |
| `TRUST_PROXY` | `loopback` | `loopback` = 直前が 127.0.0.1（Apache）のときだけ X-Forwarded-For の 1 段を信頼 / `none` |
| `MAX_PLAYERS` | 50 | 同時に店内にいられる人数（管理者は満員でも入れる） |
| `CABINET_TTL_HOURS` | 6 | 筐体が最後の更新から空きに戻るまで |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | 300 / 10 | WebSocket の本数 |
| `BGM_DIR` | `data/bgm` | 店内の BGM の曲の置き場所 |
| `CRANE_COOLDOWN_SEC` / `CRANE_MAX_CHANCE` | 20 / 65 | クレーンゲームの待ち時間・ぴったりのときの確率 % |
| `BADGE_MODE` / `BADGE_STACK_MAX` / `BADGE_KEEP_MIN` | unique / 3 / 30 | バッジの持ち方・上限・切れてから消えるまで（分） |
| `POSTER_WHO` / `POSTER_MAX_PER_USER` / `POSTER_MAX_TOTAL` | all / 2 / 40 | ポスターを貼れる人・枚数 |
| `NOTE_MAX_TOTAL` / `REQUEST_MAX_TOTAL` | 2000 / 1000 | ノート・要望を残す件数 |
| `CHAT_TTL_HOURS` | 24 | チャットの発言を残す時間（過ぎたら DB からも開いている画面からも消える。1〜8760。0.5.1〜） |
| `SPECTATE` / `SPECTATE_MAX_VIEWERS` / `SPECTATE_FPS` / `SPECTATE_MAX_STREAMS` | on / 8 / 5 / 6 | ほかの人のプレイの観戦（0.6.0〜）。`off` で止める・1 人を見られる人数・画像の 1 秒の枚数・同時に見られている人の合計 |
| `CABINET_MAX_PER_USER` | 4 | 1 人が配信を登録できる筐体の数（部屋ごと。1〜16。0.7.0〜。0.6.x までは 1 台） |
| `SLOT_BIG_ODDS` / `SLOT_REG_ODDS` | 256 / 400 | スロットの BIG・REG の確率（1/n。0.7.0〜）。**画面の確認用**（本番では設定しない。変えると機械割が変わる） |

## 8. Apache に `/arcade/` と `/arcade/ws` の中継を足す

設定の中身は `apache-arcade.inc`（この文書と同じフォルダ。ポート・パスを変えたならこのファイルも合わせて直す）。

1. 手順 2 の `apachectl -S` で、`example.com` の **443 の VirtualHost の設定ファイル**を確かめる（certbot が作った `…-le-ssl.conf` のことが多い）。
2. 中継の中身だけのファイルを置く（`.inc` = 単独では読まれない）:
   ```bash
   sudo install -m 0644 /opt/virtual-arcade/current/deploy/apache-arcade.inc /etc/httpd/conf.d/virtual-arcade.inc
   ```
3. その VirtualHost の `</VirtualHost>` の直前に **1 行だけ**足す（元のファイルは先に複製を取る）:
   ```bash
   sudo cp -a <443 の設定ファイル> <443 の設定ファイル>.bak-virtual-arcade
   # 編集: </VirtualHost> の直前に  Include conf.d/virtual-arcade.inc
   ```
   その VirtualHost に全体を中継する指定（`ProxyPass / http://127.0.0.1:…` など）があれば、
   **Include をその `ProxyPass /` の行より前に置く**（同じ所に書いた ProxyPass は先に書いた方が使われる）。
   `/arcade` 以外（既存のページ・ほかの中継）が変わらないことを後で確かめる。
4. 確かめてから読み直す:
   ```bash
   sudo apachectl configtest          # Syntax OK 以外なら止めて、元に戻す（手順 11）
   sudo apachectl graceful
   ```

**WebSocket の行は `ProxyPassMatch "^(/arcade/ws)$" "ws://127.0.0.1:PORT$1"`（PORT は例 8791）の形のまま使う。行き先はホストまで**にする。
行き先に `/arcade/ws` を書き足すと、ProxyPassMatch が一致したパスをさらに付け足して `/arcade/ws/arcade/ws` に届く（アプリは 404 を返し、店内に入れない）。

## 9. 外からの確認

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/arcade/                 # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://example.com/arcade   # 301 https://example.com/arcade/
curl -s https://example.com/arcade/api/meta; echo                                     # {"version":"0.7.0", …}
curl -s -o /dev/null -w '%{http_code}\n' -m 3 --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://example.com/arcade/ws   # 101
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/arcadex                  # 中継されない（既存のサイトの 404 など。8791 の応答でないこと）
```

- 既存のサイト・同じサーバのほかのアプリがいつもどおりかを確かめる。
- ユーザーにブラウザで `https://example.com/arcade/` を開いてもらい、名前と見た目を決めて入店し、床をクリックして歩けるか・
  別のブラウザ（またはシークレットウィンドウ）から入った人が見えるか・チャットが届くかを確かめてもらう。
  管理者の合言葉を置いたなら、右上の「管理者」から合言葉を入れて管理者になれるかも確かめてもらう。
- 接続元の IP がアプリに届いているかの確認（回数制限が全員で 1 つにまとまらないように）: 管理者の画面で間違った合言葉を 6 回続けて入れると 6 回目が
  「合言葉の入力が多すぎます」になる（10 分で戻る）。別の回線（スマホのモバイル回線など）からはその間も入力できれば、X-Forwarded-For が届いている。

## 10. 更新（新しい版を入れる）

```bash
# 手順 5 と同じように tar を送って SHA-256 を確かめ、releases/ に展開する（例 0.7.0）
sudo tar -xzf ~/virtual-arcade-0.7.0.tar.gz -C /opt/virtual-arcade/releases --no-same-owner
sudo chown -R root:root /opt/virtual-arcade/releases/virtual-arcade-0.7.0
sudo ln -sfn /opt/virtual-arcade/releases/virtual-arcade-0.7.0 /opt/virtual-arcade/current
sudo systemctl restart virtual-arcade              # 筐体・チャット・名前は DB に残る。画面は自動で再接続する
journalctl -u virtual-arcade -n 5 --no-pager
```

- `deploy/virtual-arcade.service` や `apache-arcade.inc` が変わった版では、その版の説明に従ってユニット・Apache の設定も入れ替える（`daemon-reload` / `configtest` → `graceful`）。
- 再起動の数秒、店内の人は切れて自動でつなぎ直す（位置は最後にいたマスに戻る）。人の多い時間を避ける。
- 古い版のフォルダは 1〜2 個残しておく（戻すため）。
- 管理者の合言葉を変えるときは、手順 7 の 1・2 でハッシュを作り直して `admin.env` を書き換え、`sudo systemctl restart virtual-arcade`。

## 11. 元に戻す（ロールバック）

```bash
# 前の版に戻す
sudo ln -sfn /opt/virtual-arcade/releases/virtual-arcade-<前の版> /opt/virtual-arcade/current
sudo systemctl restart virtual-arcade

# Apache の中継を外す
sudo cp -a <443 の設定ファイル>.bak-virtual-arcade <443 の設定ファイル>
sudo rm -f /etc/httpd/conf.d/virtual-arcade.inc
sudo apachectl configtest && sudo apachectl graceful

# すべて外す（DB も消える。ユーザーの了承を得てから）
sudo systemctl disable --now virtual-arcade
sudo rm -f /etc/systemd/system/virtual-arcade.service && sudo systemctl daemon-reload
sudo rm -rf /opt/virtual-arcade /var/lib/virtual-arcade /etc/virtual-arcade && sudo userdel virtual-arcade
```

- 0.1.0 が最初の版。DB の形が変わる版では、その版の説明に戻し方を書く。
- 0.2.0（店内の BGM）は DB の形を変えていない。
- 0.3.0（クレーンゲーム・ポスター欄・チャットのピン止め）は、起動時に DB へ `posters` の表と `chat.badges` の列を**足すだけ**（消す・変える列はない）。
  前の版へ戻しても、前の版はこれらを使わないだけで動く（貼ったポスターは前の版では見えず、0.3.0 に戻すとまた見える）。バッジとピン止めはメモリだけなので再起動で消える。
- 0.4.0（スマホのレイアウト・コミュニケーションノート・機能追加要望箱）：**スマホのレイアウトは DB を変えていない**（画面だけの変更）。
  ノートと要望箱のために、起動時に DB へ `notes` と `requests` の表を**足すだけ**（消す・変える表・列はない）。前の版へ戻しても、前の版はこれらの表を使わないだけで動く
  （書かれたノート・届いた要望は前の版では見えず、0.4.0 に戻すとまた見える）。
- 0.4.1（スマホでキーボードが出ると縦横のレイアウトが切り替わり、発言の欄のキーボードがすぐ閉じていたのを直した）：**画面だけの修正、DB 変更なし**。前の版へそのまま戻せる。
- 0.5.0（オープン部屋と予約部屋。DESIGN §14）：起動時に DB へ `reservations` の表を**足すだけ**（消す・変える表・列はない。予約部屋のチャット・お知らせ・筐体は DB に書かずメモリだけ）。
  **0.4.x へ戻しても、0.4.x はこの表を読まないだけでそのまま動く**（予約部屋は無くなり、入った予約は見えなくなる。0.5.0 に戻すと、まだ終わっていない予約はまた見える）。
  WebSocket の取り決めが変わったので、0.5.0 に上げた直後は、開いたままの古いページに「新しい版になりました。ページを再読み込みしてください」が出る（再読み込みで直る）。
  戻したときは逆に 0.5.0 のページが古い版のサーバにつながるが、前の版の形のまま入れる（部屋の情報が来ないだけ）。再読み込みをすすめる。
- 0.5.1（PC の上のバーの項目が重なっていたのを直した・チャットの発言を 24 時間で消す）：**画面だけ、DB 変更なし**（表・列は変えない。上のバーは画面だけの修正）。前の版へそのまま戻せる。
  ただし 0.5.1 は残す時間（`CHAT_TTL_HOURS`、既定 24 時間）を過ぎた**チャットの行を DB から消す**（起動時と 1 分ごと）ので、**0.5.0 へ戻しても、消えた発言は戻らない**
  （お知らせ・ポスター・ノート・要望は消さない。お知らせのチャットの行が消えても、お知らせそのものは残る）。
- 0.6.0（ゲーム筐体と 2048・スコアランキング・ベガ立ち。DESIGN §16）：起動時に DB へ `game_scores` の表と索引を**足すだけ**（消す・変える表・列はない）。
  **0.5.x へ戻しても、0.5.x はこの表を読まないだけでそのまま動く**（ゲーム筐体とランキングは無くなる。0.6.0 に戻すと記録はまた見える）。
  遊んでいる途中のゲーム（種と手順の受付）はメモリだけなので、再起動をまたいだゲームは記録できない（画面に「サーバが再起動したため…」と出る）。
  2048 は `public/games/2048/`（元の 2048 の MIT・字体 Clear Sans の Apache 2.0 の本文が同じフォルダにある）。
- 0.7.0（スロットマシンとコイン。DESIGN §17）：**DB 変更なし**（コイン・スロットの持ち越しはバッジと同じくメモリだけ。再起動で消える）。前の版へそのまま戻せる。
- どの版もユニット・Apache の設定は変わらない。

## 12. ログと運用

- **店内の BGM**: tar の `data/bgm/` に置いた曲（`bgm.json` と音声ファイル）を `/arcade/bgm/<ファイル名>` で配る
  （一覧の intro / body にあるファイルだけ。`bgm.json` 自身・ほかの拡張子・`..` などは 404）。曲が無くても、ブラウザの中で合成するオリジナル曲が流れる。
  - リポジトリには曲のファイルは入っていない。置き方・権利の注意は `data/bgm/README.md`（**ファイルの権利は置く人の責任**。素材の規約で再配布が禁止されている曲は、公開ページ・公開リポジトリ・ほかの場所に置かない・コピーして配らない）。
  - 確認: `curl -s http://127.0.0.1:8791/arcade/api/meta` の `"bgm":{"files":[…]}` に曲が並ぶこと、
    `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8791/arcade/bgm/<一覧のファイル名>` が `200 audio/ogg`（mp3 なら `audio/mpeg`）。
  - 曲を差し替える・足すのはユーザーに頼まれたときだけ。版のフォルダ（`releases/…/data/bgm/`）は版の入れ替えで変わるので、
    差し替えるなら PC 側で `data/bgm/` を作り直して新しい tar を作るのがよい。サーバで別の場所に置くなら、曲をそこへ写してから
    ユニットに `Environment=BGM_DIR=/var/lib/virtual-arcade/bgm` を足す（`daemon-reload` → `restart`）。
- 状態: `systemctl status virtual-arcade`、ログ: `journalctl -u virtual-arcade --since today`。
  出すのは起動・停止・内部エラーの内容だけ（**IP アドレス・秘密鍵・合言葉・チャットの中身は出さない**）。
- **Apache のアクセスログには接続元の IP と `/arcade/…` の URL が残る**（既存の VirtualHost の CustomLog。ローテーションは既存の設定のまま）。
  URL には秘密は入らない（秘密鍵はヘッダと WebSocket の中で送る）。
  残したくなければ、ユーザーと相談のうえ `SetEnvIf Request_URI "^/arcade/" nolog` と `CustomLog … env=!nolog` を使う（既存のログの書式は変えない）。
- 上限（既定。変えるときはユニットの `Environment=` を書き換えて `daemon-reload` → `restart`。一覧は手順 7 の「環境変数」）:
  同時に店内 50 人（`MAX_PLAYERS`。管理者は満員でも入れる）・筐体は最後の更新から 6 時間で空きに（`CABINET_TTL_HOURS`）・
  管理者は合言葉を入れてから 12 時間（`ADMIN_TTL_HOURS`）・WebSocket 全体 300 本（`MAX_CONNECTIONS`）・同じ IP から 10 本（`MAX_CONNECTIONS_PER_IP`）。
  回数制限（IP ごと）: 初めての入室 1 分に 20 回・WebSocket の接続 1 分に 60 回・発言 1 分に 20 回（同じ人は 1 秒に 1 回・15 秒に 6 回まで）・合言葉の入力 10 分に 5 回（同じ鍵でも 5 回）・
  API 全体 1 分に 600 回。同じ人のエモーションは 0.8 秒に 1 回・20 秒に 8 回、筐体の操作は 1 分に 20 回、移動の指示は 1 秒に 10 回まで。
  JSON は 16 KB まで、WebSocket の 1 通は 4 KB まで（1 本から 10 秒に 80 通を超えたら切る）。0.6.0 から、観戦の画像（1 枚 32 KB まで）と 2048 の手のまとめだけ 48 KB まで
  （遊んでいて見る人がいるときだけ受け取る・観戦の中継は別に 1 秒 15 通まで）。見る人 1 人あたり約 10〜20 KB/秒（Apache の設定は変えなくてよい）。
- 来た人の記録（名前・見た目・最後の位置）は、最後に来てから 180 日で消える（入室を止めている人は残す）。
- **チャット**（0.5.1〜）: 発言は **24 時間**（`CHAT_TTL_HOURS`。1〜8760）で消える（起動時と 1 分ごとに DB から消し、開いている画面からも消える。ピン止めも外れる）。
  件数も今までどおり部屋ごとに新しい 200 件まで。お知らせのチャットの行が消えても、お知らせそのもの（大画面の帯・一覧）は残る。
- **予約部屋**（0.5.0〜）: 予約は DB の `reservations` の表（合言葉は scrypt のハッシュだけ。終わってから 30 日・2000 行を超えた古い行は消す）。
  予約部屋のチャット・お知らせ・筐体・クレーンゲームは**メモリだけ**で、予約の時間が終わると中の人をオープン部屋へ戻して消す（サーバの再起動でも消え、合言葉を入れた人も入れ直しになる）。
  回数制限: 予約は鍵ごと 1 時間に 6 回・IP ごと 12 回、合言葉の**間違い**は鍵ごと 10 分に 5 回・IP ごと 20 回。1 人の予約はあわせて 5 時間まで・14 日先まで。
  管理者は管理者の窓の「🔑 予約」タブでどの予約も取り消せる（使っている最中なら予約部屋はすぐ閉まる）。
- バックアップ（任意）: `sudo systemctl stop virtual-arcade` → `sudo cp -a /var/lib/virtual-arcade /var/lib/virtual-arcade.bak-$(date +%F)` → `sudo systemctl start virtual-arcade`
  （止めずに写すと `-wal` との食い違いが起きることがあるので、止めてから）。
- メモリ: `MemoryMax=256M`（超えたら systemd が止めて 3 秒後に立ち上げ直す）。Node のヒープは 128 MiB。
