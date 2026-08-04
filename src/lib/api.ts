// API 客户端封装
// 登录类接口前缀 /auth/c/（对接文档第八章）
// 业务接口前缀 /api/（笔记 / AI 配置 / AI 总结 / 图片上传）
// baseURL 根据环境自动切换：
//   - 开发（vite dev）：http://localhost:82
//   - 生产（vite build）：https://aab2b9dab7609fdb2.sh7.agentos-app.net/api
// 也可通过 .env 的 VITE_API_BASE 覆盖

import { clearToken, getToken } from './storage';

// ========== 基础配置 ==========
const PROD_API_BASE = 'https://aab2b9dab7609fdb2.sh7.agentos-app.net/api';
const DEV_API_BASE = 'http://localhost:82';

export const AUTH_API_BASE: string =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? DEV_API_BASE : PROD_API_BASE);

// ========== 错误类型 ==========
export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

// ========== 响应处理 ==========
// 解析后端返回，兼容多种结构：{ code, data, msg } / { code, msg, result } / 直接数据
const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    // 常见字段
    for (const key of ['msg', 'message', 'error', 'errMsg']) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
    }
  }
  return fallback;
};

const parseJsonSafe = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const ensureOk = async (res: Response, fallbackMsg: string): Promise<unknown> => {
  if (res.ok) {
    return parseJsonSafe(res);
  }
  const payload = await parseJsonSafe(res);
  // 401/403 触发 token 清理
  if (res.status === 401 || res.status === 403) {
    clearToken();
  }
  throw new ApiError(
    res.status,
    extractErrorMessage(payload, `${fallbackMsg}（${res.status}）`),
    payload,
  );
};

// ========== 通用请求 ==========
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: BodyInit | null;
  headers?: Record<string, string>;
  withAuth?: boolean; // 默认 true；登录/注册接口传 false
  signal?: AbortSignal;
}

const doRequest = async (
  baseURL: string,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> => {
  const { method = 'POST', body = null, headers = {}, withAuth = true, signal } = options;
  const url = `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

  const finalHeaders: Record<string, string> = { ...headers };
  if (!(body instanceof FormData) && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (withAuth) {
    const token = getToken();
    if (token) finalHeaders['Authorization'] = token;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body,
      headers: finalHeaders,
      credentials: 'omit', // 走 Authorization 头，不依赖 cookie
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '网络异常';
    throw new ApiError(0, `网络异常：${msg}`);
  }
  return ensureOk(res, '请求失败');
};

// ========== 登录 / 注册类请求（走本地后端，登录/注册不带 Authorization） ==========
// 文档第八章：C 端接口统一前缀 /auth/c/
export const authApi = {
  // 1. 账号密码登录  POST /auth/c/doLogin
  doLogin: (params: {
    account: string;
    password: string; // 前端 SM2 加密后的 hex（对接文档第三章，禁止明文）
    validCode?: string;
    validCodeReqNo?: string;
    tenCode?: string;
  }) =>
    doRequest(AUTH_API_BASE, '/auth/c/doLogin', {
      method: 'POST',
      body: JSON.stringify(params),
      withAuth: false,
    }),

  // 2. 注册  POST /auth/c/register
  //    密码前端 SM2 加密；返回 code=200 无 data，不自动登录，需跳登录页
  register: (params: {
    account: string;
    password: string; // 前端 SM2 加密后的 hex
    validCode?: string;
    validCodeReqNo?: string;
  }) =>
    doRequest(AUTH_API_BASE, '/auth/c/register', {
      method: 'POST',
      body: JSON.stringify(params),
      withAuth: false,
    }),

  // 3. 图形验证码  GET /auth/c/getPicCaptcha
  //    返回：{ base64 图片, validCodeReqNo }
  getPicCaptcha: () =>
    doRequest(AUTH_API_BASE, '/auth/c/getPicCaptcha', {
      method: 'GET',
      withAuth: false,
    }),

  // 4. 获取当前登录用户  GET /auth/c/getLoginUser（需 Authorization）
  getLoginUser: () =>
    doRequest(AUTH_API_BASE, '/auth/c/getLoginUser', {
      method: 'GET',
    }),

  // 5. 登出  GET /auth/c/doLogout（需 Authorization）
  doLogout: () =>
    doRequest(AUTH_API_BASE, '/auth/c/doLogout', {
      method: 'GET',
    }),
};

// ========== 业务类请求（统一走本地后端 AUTH_API_BASE，需 Authorization） ==========
export const businessApi = {
  // 笔记
  getNotes: () => doRequest(AUTH_API_BASE, '/api/notes', { method: 'GET' }),
  saveNotes: (notes: unknown) =>
    doRequest(AUTH_API_BASE, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  // AI 配置
  getAiConfig: () => doRequest(AUTH_API_BASE, '/api/ai-config', { method: 'GET' }),
  saveAiConfig: (cfg: unknown) =>
    doRequest(AUTH_API_BASE, '/api/ai-config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  // AI 总结
  summarize: (content: string) =>
    doRequest(AUTH_API_BASE, '/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // 图片上传（FormData，Content-Type 由浏览器自动设置）
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return doRequest(AUTH_API_BASE, '/api/upload', {
      method: 'POST',
      body: formData,
    });
  },
};
