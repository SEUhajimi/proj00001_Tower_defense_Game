import { createServer } from 'node:http';
import { createApp } from './app';
import { openDb } from './db';

// 启动后端：npm start（连同前端一起）或 npm run server。前端开发服务器把 /api 转发到这里。
const PORT = Number(process.env.PORT ?? 8787);

const DEV = process.env.NODE_ENV !== 'production';

const db = openDb();
createServer(createApp(db, { dev: DEV })).listen(PORT, () => {
  console.log(`基地守卫服务器已启动：http://localhost:${PORT}/api`);
});
