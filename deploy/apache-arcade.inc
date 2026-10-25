# バーチャルゲームセンターの中継（Apache のリバースプロキシ）。既存の TLS の <VirtualHost *:443>（例 example.com）の中に Include する:
#   Include conf.d/virtual-arcade.inc
# ファイル名は /etc/httpd/conf.d/virtual-arcade.inc（.conf にしない = 単独では読まれない）。
#
# 要るモジュール: mod_proxy・mod_proxy_http・mod_proxy_wstunnel・mod_alias（AlmaLinux の httpd は既定で入っている）。
# アプリは 127.0.0.1:8791（例。ポートを変えるときは virtual-arcade.service の PORT とこのファイルの 8791 を合わせて直す）で、BASE_PATH=/arcade の下（/arcade/…、WebSocket は /arcade/ws）で待ち受ける（virtual-arcade.service）。
# パスは削らずにそのまま渡す（/arcade/x → http://127.0.0.1:8791/arcade/x）。
#
# 前方一致の落とし穴を避ける書き方:
#   - 「ProxyPass /arcade …」（末尾の / なし）は /arcadex… まで中継してしまうので使わない。必ず "/arcade/"（末尾の / あり）。
#   - /arcade ちょうど（/ なし）は ^/arcade$ だけを /arcade/ へ転送する。
#   - 同じサーバの他のサイト・アプリの中継とパスが重ならないことを先に確かめる（INSTRUCTIONS.md 手順 2）。
# 全体を中継する ProxyPass / …（ほかのアプリ用など）がある VirtualHost では、それより前に Include する（先に書いた一致が使われる）。

# /arcade → /arcade/（ページの中の相対パスを /arcade/ の下で解決させるため）
RedirectMatch 301 "^/arcade$" "/arcade/"

# WebSocket（/arcade/ws ちょうどだけ）。ws:// の宛先 = mod_proxy_wstunnel（httpd 2.4.37（AlmaLinux 8）でも 2.4.5x（9）でも同じ書き方）。
# timeout = 1 回の待ち（秒）。サーバは 30 秒ごとに ping、ブラウザは 25 秒ごとに ping を送る。
# 行き先はホストまでにして、一致したパスを $1 で渡す（行き先に /arcade/ws を書くと ProxyPassMatch が一致したパスを付け足し、
# /arcade/ws/arcade/ws に届く。別のアプリで 2 回起きた誤り）。
ProxyPassMatch "^(/arcade/ws)$" "ws://127.0.0.1:8791$1" timeout=120

# ページ・API・静的ファイル（/arcade/ の下すべて。上の /arcade/ws の後に書くこと）
ProxyPass "/arcade/" "http://127.0.0.1:8791/arcade/" timeout=60
ProxyPassReverse "/arcade/" "http://127.0.0.1:8791/arcade/"

# 接続元の IP は X-Forwarded-For で渡る（アプリは回数制限の数えにだけ使い、メモリの中でもハッシュにしてから持つ。保存しない）。
