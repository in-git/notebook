// API 客户端封装
// 登录类接口前缀 /auth/c/（对接文档第八章）
// 业务接口前缀 /api/（笔记 / AI 配置 / AI 总结 / 图片上传）
// baseURL 根据环境自动切换：
//   - 开发（vite dev）：http://localhost:82
//   - 生产（vite build）：https://aab2b9dab7609fdb2.sh7.agentos-app.net/api
// 也可通过 .env 的 VITE_API_BASE 覆盖

import { clearToken, getToken, getUserId } from './storage';

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
// 后端统一返回结构：{ code, msg, data, traceId }
//   code === 200 表示业务成功，否则 msg 为错误信息
// 同时兼容：无 code 的直接数据 / 字符串 / { token } 等老结构
const SUCCESS_CODES = new Set<number>([200, 0]);

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

// 从统一结构中提取 data；若不是统一结构则原样返回
const unwrapBusinessData = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.code === 'number') {
      // 统一结构：返回 data（可能为 null/{}）
      return obj.data ?? null;
    }
  }
  return payload;
};

const ensureOk = async (res: Response, fallbackMsg: string): Promise<unknown> => {
  // 401/403 触发 token 清理
  if (res.status === 401 || res.status === 403) {
    clearToken();
  }

  const payload = await parseJsonSafe(res);

  if (!res.ok) {
    throw new ApiError(
      res.status,
      extractErrorMessage(payload, `${fallbackMsg}（${res.status}）`),
      payload,
    );
  }

  // HTTP 成功，但需进一步校验业务 code
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.code === 'number') {
      // 统一返回结构
      if (!SUCCESS_CODES.has(obj.code)) {
        throw new ApiError(
          obj.code,
          extractErrorMessage(obj, fallbackMsg),
          payload,
        );
      }
      // 业务成功：返回 data
      return unwrapBusinessData(payload);
    }
  }

  // 非统一结构（直接数据 / 字符串 / 老结构）原样返回
  return payload;
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
    // 对接文档第五章：C端请求头用 `token`（不是 Authorization），值不带 Bearer 前缀
    if (token) finalHeaders['token'] = token;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body,
      headers: finalHeaders,
      credentials: 'omit', // 走 token 头，不依赖 cookie
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '网络异常';
    throw new ApiError(0, `网络异常：${msg}`);
  }
  return ensureOk(res, '请求失败');
};

// ========== 登录 / 注册类请求（走本地后端，登录/注册不带 token 头） ==========
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

  // 4. 获取当前登录用户  GET /auth/c/getLoginUser
  //    特殊：token 通过 URL query 参数传递（?token=xxx），不走请求头
  //    详见 md/C端用户信息对接文档.md 第一章
  getLoginUser: () => {
    const token = getToken();
    // 无 token 时仍发起请求（后端会返回 401，由调用方处理）
    const path = token
      ? withQuery('/auth/c/getLoginUser', { token })
      : '/auth/c/getLoginUser';
    return doRequest(AUTH_API_BASE, path, {
      method: 'GET',
      withAuth: false, // token 已在 query，不再重复放请求头
    });
  },

  // 5. 登出  GET /auth/c/doLogout（需 token 头）
  doLogout: () =>
    doRequest(AUTH_API_BASE, '/auth/c/doLogout', {
      method: 'GET',
    }),
};

// ========== 业务类请求（统一走本地后端 AUTH_API_BASE，需 token 头） ==========
export const businessApi = {
  // 笔记
  getNotes: () => doRequest(AUTH_API_BASE, '/api/notes', { method: 'GET' }),
  saveNotes: (notes: unknown) =>
    doRequest(AUTH_API_BASE, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  // AI 配置
  saveAiConfig: (cfg: unknown) =>
    doRequest(AUTH_API_BASE, '/api/ai-config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  // AI 总结（旧接口，保留兼容）
  summarize: (content: string) =>
    doRequest(AUTH_API_BASE, '/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // 图片上传（FormData，Content-Type 由浏览器自动设置）
  // 对接文档：md/C端文件上传对接文档.md
  // POST /client/c/fileFolder/upload，字段名 file，返回 { code, data: { id, url, ... } }
  // 旧接口 /dev/file/uploadDynamicReturnId 已废弃
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return doRequest(AUTH_API_BASE, '/client/c/fileFolder/upload', {
      method: 'POST',
      body: formData,
    });
  },
};

// ========== AI 大模型（对接文档：md/AI大模型对接文档.md）==========
// POST /public/ai/chat —— 免登录（/public/** 全部免登录），Ollama 兼容协议
//   请求：{ model?, messages, stream?, format?, options?, keep_alive?, tools? }
//   响应：CommonResult<String>，data 字段是 Ollama 网关返回的原始 JSON 字符串
//         前端需要 JSON.parse(res.data) 一次拿到 { message: { content }, done, ... }
// 硬约束：
//   1. 不传 model 走后端默认模型（ai.ollama.default-model），前端别 hardcode
//   2. 多轮对话要保留完整 messages 数组（Ollama 本身无状态）
//   3. 同步接口 data 是字符串，前端要 JSON.parse 一次
//   4. 超时 300s（ai.ollama.timeout-read），loading 文案要友好
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[]; // base64 图片（多模态）
  tool_calls?: unknown[];
}

export interface AiChatRequest {
  model?: string; // 不传走后端默认模型
  messages: AiChatMessage[];
  stream?: boolean; // 后端强制 false（同步接口）
  format?: string; // 'json' 强制 JSON 输出
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    [k: string]: unknown;
  };
  keep_alive?: string; // 模型显存保留时长，默认 5m
  tools?: unknown[];
}

export interface AiChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string; tool_calls?: unknown[] };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export const aiApi = {
  // 多轮对话（同步）：返回解析后的 Ollama 响应对象
  // 抛 ApiError：网络异常 / HTTP 非 2xx / 业务 code 非 200
  chat: async (req: AiChatRequest): Promise<AiChatResponse> => {
    // /public/** 免登录，withAuth: false
    const raw = (await doRequest(AUTH_API_BASE, '/public/ai/chat', {
      method: 'POST',
      body: JSON.stringify(req),
      withAuth: false,
    })) as unknown;

    // ensureOk 已剥离统一结构（code/message/data），这里 raw 即为 data
    // 文档硬约束 4：data 是字符串，需 JSON.parse 一次
    let ollama: AiChatResponse;
    if (typeof raw === 'string') {
      try {
        ollama = JSON.parse(raw) as AiChatResponse;
      } catch {
        throw new ApiError(0, 'AI 响应解析失败：返回不是合法 JSON');
      }
    } else if (raw && typeof raw === 'object') {
      // 兼容后端直接返回对象的情况
      ollama = raw as AiChatResponse;
    } else {
      throw new ApiError(0, 'AI 响应为空');
    }
    return ollama;
  },

  // 单轮便捷调用：system prompt + user content，返回 assistant 文本
  chatOnce: async (
    content: string,
    systemPrompt?: string,
    options?: AiChatRequest['options'],
  ): Promise<string> => {
    const messages: AiChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content });
    const resp = await aiApi.chat({ messages, options });
    return resp.message?.content ?? '';
  },
};

// ========== C 端文件上传（对接文档：md/C端文件上传对接文档.md）==========
// POST /client/c/fileFolder/upload       —— 单文件，字段名 file，需 C 端登录态
// POST /client/c/fileFolder/uploadBatch  —— 批量，字段名 files，需 C 端登录态
//   返回 data.url 可直接访问（/file/client/** 免登录静态资源）
// 硬约束：
//   1. 鉴权依赖 CLIENT_TOKEN（localStorage key=CLIENT_TOKEN）
//   2. 路径必须 /client/c/fileFolder/...（不是 /biz/...）
//   3. 表单字段名：单文件 file，批量 files，不能混淆
//   4. Content-Type 必须 multipart/form-data（FormData 自动设置，勿手动塞）
//   5. 后端不限制大小，前端必须自己做大小校验
//   6. 后端黑名单后缀会直接拒绝，前端最好加白名单预校验
//   7. 返回的 url 任何人可直接访问，不要传敏感文件
//   8. 批量返回数组顺序与请求中文件顺序一致
export interface FileUploadResult {
  id: string;
  name: string;
  suffix: string;
  sizeKb: number;
  sizeInfo: string;
  objName: string;
  storagePath: string;
  url: string;
  contentType: string;
}

// 图片白名单后缀（前端预校验，文档第七章硬约束 6）
export const IMAGE_EXT_WHITELIST = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
]);

export const fileApi = {
  // 单文件上传
  // 返回 FileUploadResult（ensureOk 已剥离统一结构，raw 即为 data）
  upload: async (file: File): Promise<FileUploadResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const data = (await doRequest(
      AUTH_API_BASE,
      '/client/c/fileFolder/upload',
      {
        method: 'POST',
        body: formData,
      },
    )) as unknown;
    return data as FileUploadResult;
  },

  // 批量上传
  // 返回 FileUploadResult[]，顺序与请求中文件顺序一致
  uploadBatch: async (files: File[]): Promise<FileUploadResult[]> => {
    if (!files.length) {
      throw new ApiError(0, '上传文件列表不能为空');
    }
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const data = (await doRequest(
      AUTH_API_BASE,
      '/client/c/fileFolder/uploadBatch',
      {
        method: 'POST',
        body: formData,
      },
    )) as unknown;
    return (data as FileUploadResult[]) || [];
  },

  // 校验图片文件后缀（返回错误消息，null 表示通过）
  validateImageExt: (file: File): string | null => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!IMAGE_EXT_WHITELIST.has(ext)) {
      return `不支持的图片格式：.${ext || '未知'}（仅支持 jpg/png/gif/webp/svg 等）`;
    }
    return null;
  },

  // 校验文件大小（默认 20MB 上限，文档第七章：后端不限制，前端必须自校验）
  validateSize: (file: File, maxMB = 20): string | null => {
    if (file.size > maxMB * 1024 * 1024) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      return `文件过大：${sizeMB}MB（上限 ${maxMB}MB）`;
    }
    return null;
  },
};

// ========== 便签（用户备注 JSON 数据）==========
// 对接文档：md/便签保存和获取.md
//   - GET  /client/c/userNote/get?userId=xxx  → data 为纯文本字符串（需前端 JSON.parse）
//   - POST /client/c/userNote/save?userId=xxx → body 为纯文本字符串，Content-Type: text/plain
// userId 取自 getLoginUser 返回的 id（登录后存入 CLIENT_USER_INFO）
// 详见 md/C端用户信息对接文档.md
export interface UserNoteResult<T = unknown> {
  userId: string;
  data: T | null;
}

// 内部：拼带 query 的 URL
const withQuery = (path: string, params: Record<string, string>): string =>
  `${path}?${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}`;

export const userNoteApi = {
  // 获取当前用户的便签数据
  // 后端返回 data 为纯文本字符串（保存时原样写回），需前端 JSON.parse
  // 返回 { userId, data }：data 为解析后的对象，解析失败或为空时为 null
  getNote: async <T = unknown>(userId?: string): Promise<UserNoteResult<T>> => {
    const uid = userId || getUserId();
    if (!uid) {
      throw new ApiError(0, '未获取到用户 ID，无法加载便签');
    }
    const raw = (await doRequest(
      AUTH_API_BASE,
      withQuery('/client/c/userNote/get', { userId: uid }),
      { method: 'GET' },
    )) as unknown;

    // ensureOk 已剥离统一结构，这里 raw 即为 data（字符串 / null）
    let parsed: T | null = null;
    if (typeof raw === 'string' && raw) {
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        // data 不是合法 JSON，原样返回字符串
        parsed = raw as unknown as T;
      }
    } else if (raw && typeof raw === 'object') {
      // 兼容后端直接返回对象的情况
      parsed = raw as T;
    }
    return { userId: uid, data: parsed };
  },

  // 保存当前用户的便签数据
  // data 会被 JSON.stringify 后以 text/plain 提交（对接文档第二章：Content-Type 必须 text/plain）
  saveNote: async (data: unknown, userId?: string): Promise<void> => {
    const uid = userId || getUserId();
    if (!uid) {
      throw new ApiError(0, '未获取到用户 ID，无法保存便签');
    }
    await doRequest(
      AUTH_API_BASE,
      withQuery('/client/c/userNote/save', { userId: uid }),
      {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'text/plain' },
      },
    );
  },
};
