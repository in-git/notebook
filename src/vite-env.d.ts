/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 通用覆盖（优先级最高），不区分环境
  readonly VITE_API_BASE?: string;
  // 仅开发（vite dev）环境生效
  readonly VITE_API_BASE_DEV?: string;
  // 仅生产（vite build）环境生效
  readonly VITE_API_BASE_PROD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
