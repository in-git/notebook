import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端纯静态，不再代理本地后端。
// 登录接口由前端直接请求新后端 `https://aab2b9dab7609fdb2.sh7.agentos-app.net/api`；
// 业务接口（笔记/AI/上传）的 baseURL 在 SettingsModal 中由用户配置。
// 业务 baseURL 配置后，开发态可直接访问跨域接口（后端需允许 origin）；
// 若同源受限，再把下方 server.proxy 恢复并指向业务 baseURL 即可。
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
