import { createServer } from './app';
import { DB_PATH } from './paths';

const port = Number(process.env.PORT) || 8791;
const host = process.env.HOST || '127.0.0.1';

const { server, close, config } = createServer({ dbPath: DB_PATH });

server.listen(port, host, () => {
  console.log(
    `バーチャルゲームセンター サーバ起動: http://${host.includes(':') ? `[${host}]` : host}:${port}${config.basePath}/ ` +
      `(BASE_PATH=${config.basePath || '(なし)'}, 同時 ${config.maxPlayers} 人まで, 筐体は ${Math.round(config.cabinetTtlMs / 3600000)} 時間で空きに, ` +
      `管理者の合言葉 ${config.adminPassHash ? 'あり' : 'なし'})`,
  );
});
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `ポート ${port} は使用中です（PORT で変えられます）` : `起動できません: ${e.message}`);
  process.exit(1);
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('停止しています…');
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
