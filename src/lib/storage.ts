// 统一本地存储管理（对接文档第五章约定）
// - CLIENT_TOKEN: C端鉴权凭证，区分后台管理端 token
// - CLIENT_USER_INFO: 登录用户信息
// - REMEMBER_ACCOUNT: 勾选记住我，仅存放账号字符串
// - CAPTCHA_OPEN: 图形验证码开关（系统配置接口返回）
// - LOCAL_NOTES_KEY / LOCAL_AI_CONFIG_KEY: 未登录时的本地数据
//
// 业务后端地址固定为本地 http://localhost:82，不再由用户配置。
// 所有读写封装在工具函数中，避免散落在各组件里。

const CLIENT_TOKEN = 'CLIENT_TOKEN';
const CLIENT_USER_INFO = 'CLIENT_USER_INFO';
const REMEMBER_ACCOUNT = 'REMEMBER_ACCOUNT';
const CAPTCHA_OPEN = 'CAPTCHA_OPEN';
export const LOCAL_NOTES_KEY = 'apple_notes_data_ai';
export const LOCAL_AI_CONFIG_KEY = 'ai_config';

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 忽略（隐私模式等）
  }
};

const safeRemove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // 忽略
  }
};

// ========== 鉴权凭证 ==========
export const getToken = (): string | null => safeGet(CLIENT_TOKEN);
export const setToken = (token: string): void => safeSet(CLIENT_TOKEN, token);
export const clearToken = (): void => safeRemove(CLIENT_TOKEN);

// ========== 用户信息 ==========
export interface StoredUser {
  username?: string;
  phone?: string;
  email?: string;
  // 后端用户 ID（对接文档"便签保存和获取"接口所需 userId）
  userId?: string;
  id?: string;
  [key: string]: unknown;
}

// 便签接口所需 userId：优先 userId，其次 id，最后 account
export const getUserId = (): string | null => {
  const u = getUserInfo();
  if (!u) return null;
  return (
    (typeof u.userId === 'string' && u.userId) ||
    (typeof u.id === 'string' && u.id) ||
    (typeof u.account === 'string' && u.account) ||
    null
  );
};

export const getUserInfo = (): StoredUser | null => {
  const raw = safeGet(CLIENT_USER_INFO);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
};
export const setUserInfo = (user: StoredUser): void =>
  safeSet(CLIENT_USER_INFO, JSON.stringify(user));
export const clearUserInfo = (): void => safeRemove(CLIENT_USER_INFO);

// ========== 记住账号 ==========
export const getRememberedAccount = (): string | null => safeGet(REMEMBER_ACCOUNT);
export const setRememberedAccount = (account: string): void =>
  safeSet(REMEMBER_ACCOUNT, account);
export const clearRememberedAccount = (): void => safeRemove(REMEMBER_ACCOUNT);

// ========== 验证码开关（系统配置接口返回） ==========
export const getCaptchaOpen = (): boolean => {
  const raw = safeGet(CAPTCHA_OPEN);
  return raw === '1' || raw === 'true';
};
export const setCaptchaOpen = (open: boolean): void =>
  safeSet(CAPTCHA_OPEN, open ? '1' : '0');

// ========== 退出登录清理 ==========
export const clearAuth = (): void => {
  clearToken();
  clearUserInfo();
  // 注意：保留 REMEMBER_ACCOUNT（对接文档第六章约定）
};
