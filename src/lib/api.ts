// API 客户端封装
// 登录类接口（/auth/c/*）走新后端：https://aab2b9dab7609fdb2.sh7.agentos-app.net/api
// 业务类接口（笔记/AI配置/AI总结/图片上传）走用户配置的业务后端 baseURL
// 业务 baseURL 为空时，调用方应避免触发业务请求（前端降级本地模式）

import {
  clearToken,
  getBusinessApiBase,
  getToken,
  setBusinessApiBase,
} from './storage';

// ========== 基础配置 ==========
// 对接文档：新后端 baseURL（硬编码）
export const AUTH_API_BASE =
  'https://aab2b9dab7609fdb2.sh7.agentos-app.net/api';

// 业务后端 baseURL 由用户配置（对接文档未给出业务接口，统一让用户填）
export { getBusinessApiBase, setBusinessApiBase };

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
  withAuth?: boolean; // 默认 true；登录类接口传 false
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

// ========== 登录类请求（固定走新后端，不带 Authorization） ==========
export const authApi = {
  // 1. 账号密码登录
  doLogin: (params: {
    account: string;
    password: string;
    validCode?: string;
    validCodeReqNo?: string;
    tenCode?: string;
  }) =>
    doRequest(AUTH_API_BASE, 'auth/c/doLogin', {
      method: 'POST',
      body: JSON.stringify(params),
      withAuth: false,
    }),

  // 2. 手机号 + 短信验证码登录
  doLoginByPhone: (params: {
    phone: string;
    validCode: string;
    validCodeReqNo: string;
  }) =>
    doRequest(AUTH_API_BASE, 'auth/c/doLoginByPhone', {
      method: 'POST',
      body: JSON.stringify(params),
      withAuth: false,
    }),

  // 3. 邮箱 + 邮箱验证码登录
  doLoginByEmail: (params: {
    email: string;
    validCode: string;
    validCodeReqNo: string;
  }) =>
    doRequest(AUTH_API_BASE, 'auth/c/doLoginByEmail', {
      method: 'POST',
      body: JSON.stringify(params),
      withAuth: false,
    }),

  // 4. 获取手机短信验证码（GET）
  getPhoneValidCode: (phone: string) =>
    doRequest(AUTH_API_BASE, `auth/c/getPhoneValidCode?phone=${encodeURIComponent(phone)}`, {
      method: 'GET',
      withAuth: false,
    }),

  // 5. 获取邮箱验证码（GET）
  getEmailValidCode: (email: string) =>
    doRequest(AUTH_API_BASE, `auth/c/getEmailValidCode?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      withAuth: false,
    }),

  // 6. 图形验证码（GET）
  getPicCaptcha: () =>
    doRequest(AUTH_API_BASE, 'auth/c/getPicCaptcha', {
      method: 'GET',
      withAuth: false,
    }),

  // 7. 获取当前登录用户
  getLoginUser: () =>
    doRequest(AUTH_API_BASE, 'auth/c/getLoginUser', {
      method: 'GET',
    }),

  // 8. 登出
  doLogout: () =>
    doRequest(AUTH_API_BASE, 'auth/c/doLogout', {
      method: 'GET',
    }),
};

// ========== 业务类请求（走用户配置的业务后端 baseURL） ==========
// 业务 baseURL 为空时，调用方应避免触发业务请求；此处直接抛错以提示配置。
const requireBusinessBase = (): string => {
  const base = getBusinessApiBase();
  if (!base) {
    throw new ApiError(
      0,
      '未配置业务接口地址：请在「设置 → 业务接口地址」中填写后端 baseURL',
    );
  }
  return base;
};

export const businessApi = {
  // 业务通用 GET/POST
  get: (path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    doRequest(requireBusinessBase(), path, { ...(options || {}), method: 'GET' }),
  post: (path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    doRequest(requireBusinessBase(), path, {
      ...(options || {}),
      method: 'POST',
      body: body == null ? null : JSON.stringify(body),
    }),

  // 笔记
  getNotes: () => doRequest(requireBusinessBase(), 'api/notes', { method: 'GET' }),
  saveNotes: (notes: unknown) =>
    doRequest(requireBusinessBase(), 'api/notes', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  // AI 配置
  getAiConfig: () => doRequest(requireBusinessBase(), 'api/ai-config', { method: 'GET' }),
  saveAiConfig: (cfg: unknown) =>
    doRequest(requireBusinessBase(), 'api/ai-config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  // AI 总结
  summarize: (content: string) =>
    doRequest(requireBusinessBase(), 'api/summarize', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // 图片上传（FormData，Content-Type 由浏览器自动设置）
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return doRequest(requireBusinessBase(), 'api/upload', {
      method: 'POST',
      body: formData,
    });
  },
};
