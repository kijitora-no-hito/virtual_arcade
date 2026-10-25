import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { defineConfig } from 'vite';

// クライアントの版（サーバの版と違えば「新しい版があります」を出す。v0.5.0）
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

const target = `http://localhost:${process.env.PORT || 8791}`;

export default defineConfig({
  plugins: [react()],
  // 相対パスでビルドする。本番ではサーバが index.html に <base href="{BASE_PATH}/"> を差し込むので、
  // ビルドし直さずに BASE_PATH（例 /arcade）を変えられる。
  base: './',
  define: { __VA_CLIENT_VERSION__: JSON.stringify(version) },
  server: {
    port: 5174,
    proxy: {
      '/api': target,
      '/bgm': target,
      '/ws': { target, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
