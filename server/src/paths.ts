import path from 'node:path';

declare const __VA_BUNDLED__: boolean | undefined;

/** npm run package で 1 ファイルにまとめたとき（release の server.js から読み込まれる lib/app.js） */
export const BUNDLED = typeof __VA_BUNDLED__ !== 'undefined' && __VA_BUNDLED__;

/**
 * 置き場所のルート。
 * - 開発: リポジトリのルート（virtual_arcade/。このファイルは server/src/）
 * - 本番（release）: server.js のあるフォルダ（このファイルは lib/app.js にまとめられる）
 */
export const ROOT = BUNDLED ? path.resolve(import.meta.dirname, '..') : path.resolve(import.meta.dirname, '..', '..');
/** ビルド済みのクライアント（開発 client/dist、本番 public/） */
export const CLIENT_DIST = BUNDLED ? path.join(ROOT, 'public') : path.join(ROOT, 'client', 'dist');
export const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(ROOT, 'data', 'virtual_arcade.db');
