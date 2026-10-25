// 管理者の合言葉のハッシュを作る（サーバの環境変数 ADMIN_PASS_HASH に入れる値）。
// 使い方:
//   node scripts/hash-admin.mjs            （合言葉を聞かれる。画面に出さない）
//   echo -n '合言葉' | node scripts/hash-admin.mjs --stdin
// 合言葉そのものはどこにも保存しない。長いもの（20 文字以上）をすすめる。
// 形: scrypt:<塩 base64url>:<ハッシュ base64url>（server/src/secret.ts と同じ）

import crypto from 'node:crypto';
import readline from 'node:readline';

const hash = (pw) => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw.normalize('NFC'), salt, 32);
  return `scrypt:${salt.toString('base64url')}:${h.toString('base64url')}`;
};

const readStdin = async () => {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  // Windows の PowerShell からパイプで渡すと先頭に BOM（U+FEFF）が付くことがあるので取り除く
  return s.replace(/^﻿/, '').replace(/\r?\n$/, '');
};

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // 入力した文字を画面に出さない
    rl._writeToOutput = (s) => {
      if (s.includes(q)) process.stdout.write(s);
    };
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolve(a);
    });
  });

const pw = process.argv.includes('--stdin') || !process.stdin.isTTY ? await readStdin() : await ask('管理者の合言葉: ');
if (!pw) {
  console.error('合言葉が空です');
  process.exit(1);
}
if ([...pw].length < 12) console.error('注意: 合言葉が短いです（20 文字以上をすすめます）');
console.log(hash(pw));
