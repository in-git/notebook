import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端纯静态，不再代理后端。
// 接口 baseURL 由 src/lib/api.ts 根据环境自动切换：
//   - 开发（vite dev）：http://localhost:82
//   - 生产（vite build）：https://aab2b9dab7609fdb2.sh7.agentos-app.net/api
// 可用项目根目录 .env 的 VITE_API_BASE 覆盖。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
