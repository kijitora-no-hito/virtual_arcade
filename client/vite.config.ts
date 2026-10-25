import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = `http://localhost:${process.env.PORT || 8791}`;

export default defineConfig({
  plugins: [react()],
  // 相対パスでビルドする。本番ではサーバが index.html に <base href="{BASE_PATH}/"> を差し込むので、
  // ビルドし直さずに BASE_PATH（例 /arcade）を変えられる。
  base: './',
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
