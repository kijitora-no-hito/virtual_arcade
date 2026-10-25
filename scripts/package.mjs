// 本番用の tar.gz を作る: release/virtual-arcade-<version>.tar.gz（＋ .sha256）
// 中身: server.js（Node の版を確かめて起動）・lib/app.js（サーバを esbuild で 1 ファイルに。店のレイアウトも中に入る）・
//       public/（ビルド済みクライアント）・tools/hash-admin.mjs（管理者の合言葉のハッシュを作る）・
//       deploy/（VPS の手順書・systemd・Apache）・data/bgm/（店内の BGM の ogg・bgm.json・README.md。元の mp3 は入れない）・package.json。DB は入れない
// 本番の VPS では npm install も tsx も要らない（node:sqlite は Node の組み込み）。
// 使い方: npm run package（先に npm run build を実行する）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const name = `virtual-arcade-${version}`;
const relDir = path.join(ROOT, 'release');
const stage = path.join(relDir, 'stage', name);

const dist = path.join(ROOT, 'client', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('client/dist がありません。先に npm run build を実行してください。');
  process.exit(1);
}

fs.rmSync(path.join(relDir, 'stage'), { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'lib'), { recursive: true });

// ---- サーバを 1 ファイルに（express・ws も中に入れる）
await build({
  entryPoints: [path.join(ROOT, 'server', 'src', 'index.ts')],
  outfile: path.join(stage, 'lib', 'app.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  legalComments: 'external',
  define: { __VA_BUNDLED__: 'true', __VA_VERSION__: JSON.stringify(version) },
  // ws の任意の高速化モジュール（無くても動く）
  external: ['bufferutil', 'utf-8-validate'],
  // express などの CommonJS が require('fs') するので、ESM の中で require を使えるようにする
  banner: { js: "import { createRequire as __vaCreateRequire } from 'node:module';\nconst require = __vaCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

// ---- 起動用（Node の版を先に確かめる。node:sqlite の import より前に動かすため別ファイル）
fs.writeFileSync(
  path.join(stage, 'server.js'),
  `// バーチャルゲームセンター サーバ（本番用）。起動: node server.js
// 環境変数: HOST（既定 127.0.0.1）/ PORT（既定 8791）/ BASE_PATH（例 /arcade、空ならルート）/ DB_PATH /
//           MAX_PLAYERS（既定 50）/ CABINET_TTL_HOURS（既定 6）/ ADMIN_PASS_HASH（tools/hash-admin.mjs で作る）/
//           ADMIN_TTL_HOURS（既定 12）/ TRUST_PROXY（loopback | none）/ BGM_DIR（店内の BGM の差し替え。既定 data/bgm）
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    'バーチャルゲームセンターには Node.js 22.13 以降が必要です（今は ' + process.version + '）。' +
      'node:sqlite を使うためです。deploy/INSTRUCTIONS.md の「専用の Node を置く」を見てください。',
  );
  process.exit(1);
}
// node:sqlite の ExperimentalWarning は毎回出るだけなので消す（ほかの警告はそのまま）
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' && String(warning && warning.message ? warning.message : warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...rest);
};
await import('./lib/app.js');
`,
);

fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    { name: 'virtual-arcade', version, private: true, type: 'module', engines: { node: '>=22.13' }, scripts: { start: 'node server.js' } },
    null,
    2,
  ) + '\n',
);

const copyDir = (from, to, filter = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else if (filter(s)) fs.copyFileSync(s, d);
  }
};
copyDir(dist, path.join(stage, 'public'));
fs.mkdirSync(path.join(stage, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'hash-admin.mjs'), path.join(stage, 'tools', 'hash-admin.mjs'));
copyDir(path.join(ROOT, 'deploy'), path.join(stage, 'deploy'));
// 店内の BGM：data/bgm/ の曲（tools/bgm/loop_bgm.py が作ったイントロ・本体の ogg）・一覧 bgm.json・説明 README.md だけ。
// 元の mp3（bgm/）・確認用の WAV は入れない（魔王魂などの規約で曲単体の再配布は禁止。tar はサーバに置くためだけのもの）
const bgmSrc = path.join(ROOT, 'data', 'bgm');
const bgmDst = path.join(stage, 'data', 'bgm');
fs.mkdirSync(bgmDst, { recursive: true });
let bgmBytes = 0;
for (const f of fs.readdirSync(bgmSrc)) {
  const ok = f === 'README.md' || f === 'bgm.json' || (/^[^.].*\.(ogg|mp3|m4a)$/i.test(f) && !f.includes('..'));
  if (!ok || !fs.statSync(path.join(bgmSrc, f)).isFile()) continue;
  fs.copyFileSync(path.join(bgmSrc, f), path.join(bgmDst, f));
  bgmBytes += fs.statSync(path.join(bgmSrc, f)).size;
}
console.log(`店内の BGM: data/bgm/ ${(bgmBytes / 1e6).toFixed(1)} MB`);

// ---- tar（ustar）を自前で書いて gzip（Windows でも同じものができるように）
const files = [];
const walk = (dir, rel) => {
  files.push({ rel: rel + '/', dir: true });
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(p, r);
    else files.push({ rel: r, dir: false, data: fs.readFileSync(p) });
  }
};
walk(stage, name);

const mtime = Math.floor(Date.now() / 1000);
const header = (rel, size, dir) => {
  const h = Buffer.alloc(512);
  let nm = rel;
  let prefix = '';
  if (Buffer.byteLength(nm) > 100) {
    const cut = rel.lastIndexOf('/', rel.length - 2);
    prefix = rel.slice(0, cut);
    nm = rel.slice(cut + 1);
    if (Buffer.byteLength(nm) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`パスが長すぎます: ${rel}`);
  }
  const put = (s, off, len) => h.write(s, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(nm, 0, 100);
  put(oct(dir ? 0o755 : 0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(mtime, 12), 136, 12);
  h.fill(' ', 148, 156);
  put(dir ? '5' : '0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put('root', 265, 32);
  put('root', 297, 32);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
};
const parts = [];
for (const f of files) {
  const size = f.dir ? 0 : f.data.length;
  parts.push(header(f.rel, size, f.dir));
  if (!f.dir) {
    parts.push(f.data);
    const pad = (512 - (size % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
}
parts.push(Buffer.alloc(1024));
const gz = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
const out = path.join(relDir, `${name}.tar.gz`);
fs.writeFileSync(out, gz);
const sha = crypto.createHash('sha256').update(gz).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sha}  ${name}.tar.gz\n`);
fs.rmSync(path.join(relDir, 'stage'), { recursive: true, force: true });

console.log(`作りました: release/${name}.tar.gz（${(gz.length / 1024).toFixed(0)} KB、${files.filter((f) => !f.dir).length} ファイル）`);
console.log(`SHA-256: ${sha}`);
