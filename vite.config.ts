import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // /api 转发给后端（npm run server），前后端同源，cookie 直接可用
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
