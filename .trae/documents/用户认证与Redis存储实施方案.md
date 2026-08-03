# 用户认证与 Redis 存储实施方案

## Context（背景）

当前便签应用（`e:\git\note\notebook`）完全无用户体系：所有笔记数据存于浏览器 `localStorage`（键 `apple_notes_data_ai`），后端 `server.js` 仅提供 `/api/summarize` 与 `/api/upload` 两个公开接口，无任何认证。这导致笔记无法跨设备同步，且任何人访问 URL 即可使用。

本方案目标：为应用添加**用户注册/登录**功能，使用 **scrypt**（Node.js 内置 `crypto` 模块，无需额外依赖）进行密码哈希，所有数据（用户、会话、笔记、AI 配置）存入 **Redis**，实现多设备同步。首次登录时自动把浏览器 `localStorage` 中的旧笔记迁移到用户账号下。

环境已确认：Node.js v24.14.1、Redis 已安装在 `C:\Program Files\Redis\` 并可本地访问。

## 关键设计决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 密码哈希 | scrypt（N=16384, r=8, p=1, keyLen=64） | Node 内置，无原生编译依赖；异步 `promisify(crypto.scrypt)` 避免阻塞事件循环 |
| 会话管理 | Redis 存储 sessionId（256-bit random）+ httpOnly/sameSite=strict cookie | httpOnly 防 XSS 偷取；sameSite=strict 防 CSRF；同源自动携带 |
| 数据范围 | 用户 + 会话 + 笔记 + AI 配置全部入 Redis | 满足"用 redis 存储数据"且实现多端同步 |
| 笔记保存策略 | debounce 600ms 全量 POST + `beforeunload` 用 `navigator.sendBeacon` 冲刷 | 匹配现有 `saveNotes()` 9 处调用点，无需细粒度 CRUD 改造 |
| 登录标识 | 用户名（key 小写化，字段保留显示名） | 注册时大小写不敏感查重 |
| 笔记迁移 | 登录/注册后若 Redis 无笔记且本地有数据 → 上传后清 localStorage | 幂等，防数据丢失 |
| 多 tab 竞态 | 接受 last-write-wins | 个人便签场景可接受，v1 不引入乐观锁 |

## Redis Key 设计

```
user:{usernameLower}          → JSON {username, passwordHash, createdAt}     无 TTL
notes:{usernameLower}         → JSON 数组（note 结构不变）                    无 TTL
ai_config:{usernameLower}     → JSON {summaryEnabled}                        无 TTL
session:{sessionId}           → usernameLower 字符串                         TTL 604800（7天，滑动续期）
login_attempts:{usernameLower}→ 计数                                         TTL 900（15分钟，上限5次）
```

note 对象结构保持不变：`{id, title, body, updatedAt, createdAt, pinned, color, order}`

## 实施步骤

### 步骤 1：安装依赖

```powershell
cd e:\git\note\notebook
npm install ioredis cookie-parser
```

> scrypt 是 Node 内置 `crypto` 模块，无需安装。

### 步骤 2：新建 `lib/auth.js`（认证工具模块）

导出以下工具（基于 Node 内置模块 + 注入的 ioredis 实例）：

- `validateUsername(u)`：正则 `/^[a-zA-Z0-9_]{3,20}$/`
- `validatePassword(p)`：长度 6-128
- `hashPassword(plain)` → `"saltHex:hashHex"`，用 `crypto.randomBytes(16)` 生成盐、`promisify(crypto.scrypt)` 派生 64 字节密钥
- `verifyPassword(plain, stored)` → 用 `crypto.timingSafeEqual` 常量时间比较
- `createSession(redis, lower)` → `crypto.randomBytes(32).toString('hex')` 生成 sid，`redis.set('session:'+sid, lower, 'EX', 604800)`
- `getUserFromRequest(redis, req)` → 读 `req.cookies.sid`，查 Redis，命中则 `redis.expire` 滑动续期
- `requireAuth(redis)` 中间件工厂 → 失败 401，Redis 异常 503，成功挂 `req.user = { usernameLower }`
- `checkLoginLimit / resetLoginLimit` → 基于 `INCR` + `EXPIRE` 的 5 次/15 分钟限流

### 步骤 3：修改 `server.js`

**3a. 顶部 require + Redis 初始化**（在第 6 行 `const crypto = require('crypto');` 之后）

```js
const cookieParser = require('cookie-parser');
const Redis = require('ioredis');
const auth = require('./lib/auth');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
redis.on('error', (err) => console.error('Redis 错误:', err.message));
```

**3b. 中间件调整**（替换第 12-13 行）

```js
app.use(cors({ origin: true, credentials: true }));  // 允许 cookie 跨域
app.use(express.json({ limit: '2mb' }));             // 限制 body 防攻击
app.use(cookieParser());
```

**3c. 认证路由**（在 `/api/summarize` 第 47 行之前插入）

- `POST /api/auth/register`：校验 → `redis.exists(user:{lower})` 查重 → `hashPassword` → 存 `user:{lower}` → `createSession` → `res.cookie('sid', sid, { httpOnly:true, sameSite:'strict', secure: NODE_ENV==='production', path:'/', maxAge: 7*24*3600*1000 })` → 返回 `{username}`
- `POST /api/auth/login`：校验 → `checkLoginLimit` → 取 user → `verifyPassword` → 失败统一返回"用户名或密码错误"（防枚举）→ 成功 `resetLoginLimit` + `createSession` + set cookie
- `POST /api/auth/logout`：`redis.del(session:{sid})` + `res.clearCookie('sid')`
- `GET /api/auth/me`：`getUserFromRequest` → 返回 `{username}` 或 401

**3d. 笔记与 AI 配置路由**（紧跟认证路由之后）

- `GET /api/notes`（requireAuth）→ `redis.get(notes:{lower})` → `{notes: [] 或 JSON.parse}`
- `POST /api/notes`（requireAuth）→ 校验 `Array.isArray` + 序列化后 ≤5MB → `redis.set(notes:{lower}, ...)`
- `GET /api/ai-config`（requireAuth）→ `redis.get(ai_config:{lower})` → 默认 `{summaryEnabled:false}`
- `POST /api/ai-config`（requireAuth）→ `redis.set(ai_config:{lower}, JSON.stringify(req.body))`

**3e. 给现有路由加保护**

- 第 48 行 `app.post('/api/summarize', ...)` → 加 `auth.requireAuth(redis)` 作为第二参数
- 第 94 行 `app.post('/api/upload', ...)` → 加 `auth.requireAuth(redis)` 作为第二参数（在 `upload.single('image')` 之前）

### 步骤 4：修改 `index.html`（前端）

**4a. 新增认证状态 ref**（在第 475 行 `colorPopover` 之后、第 477 行 `let quill = null;` 之前）

```js
const currentUser = ref(null);       // {username} 或 null
const authView = ref('login');        // 'login' | 'register'
const authForm = reactive({ username: '', password: '' });
const authLoading = ref(false);
const authError = ref('');
const isInitializing = ref(true);     // 首屏 /api/auth/me 期间
```

**4b. 改造笔记初始化**（替换第 450-458 行）

`notes` 初始为空数组 `ref([])`，`currentNoteId` 初始 `null`。数据由 `onMounted` 内 `loadUserData()` 异步加载。保留 `initialNotes.forEach` 的字段补全逻辑，搬到 `loadUserData` 中对远端数据执行。

**4c. 改造 `saveNotes`**（替换第 523-525 行）

```js
let saveTimer = null;
const saveNotes = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNotes, 600);
};
const persistNotes = async () => {
    if (!currentUser.value) return;
    try {
        await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: notes.value }),
        });
    } catch (e) { console.error('保存失败:', e); }
};
// 关闭标签页冲刷
window.addEventListener('beforeunload', () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (!currentUser.value) return;
    const blob = new Blob([JSON.stringify({ notes: notes.value })], { type: 'application/json' });
    navigator.sendBeacon('/api/notes', blob);
});
```

**4d. 改造 `saveAiConfig`**（替换第 527-530 行）

`updateAIStatusDisplay()` 保留；若 `currentUser.value` 存在则立即 `fetch('/api/ai-config', { method:'POST', body: JSON.stringify(aiConfig) })`。配置变更频率低，无需 debounce。

**4e. 新增 `handleAuthSubmit` / `loadUserData` / `logout`**（在 `closeCustomAlert` 之后，约第 556 行后插入）

- `handleAuthSubmit`：根据 `authView` 调 `/api/auth/login` 或 `/api/auth/register`，成功后设 `currentUser`，清空表单，调 `loadUserData()`
- `loadUserData`：`Promise.all` 并行取 `/api/notes` 与 `/api/ai-config`；对远端笔记执行字段补全；**迁移逻辑**：若远端笔记为空且 `localStorage.getItem('apple_notes_data_ai')` 有数据 → POST 上传 → `localStorage.removeItem`；AI 配置同理迁移；最后设 `notes.value` 与 `currentNoteId.value`（选中第一条）
- `logout`：清 `saveTimer` → `await persistNotes()` 冲刷 → `fetch('/api/auth/logout', {method:'POST'})` → 清空 `currentUser`、`notes`、`currentNoteId`

**4f. 改造 `onMounted`**（第 884 行起）

将原函数改为 `async`，最前面插入：

```js
onMounted(async () => {
    try {
        const me = await fetch('/api/auth/me');
        if (me.ok) {
            const d = await me.json();
            currentUser.value = { username: d.username };
            await loadUserData();
        }
    } catch (e) { /* 离线静默 */ }
    isInitializing.value = false;
    if (!currentUser.value) {
        updateAIStatusDisplay();
        return;  // 未登录不初始化 Quill（#editor-container 不在 DOM）
    }
    updateAIStatusDisplay();
    // 以下保持原 Quill 初始化逻辑（第 887 行起）
    quill = new Quill('#editor-container', { /* 原配置 */ });
    // ...
});
```

> 关键：Quill 必须在登录后初始化，否则 `v-if` 隐藏 `#editor-container` 时 `querySelector` 返回 null 报错。

**4g. 扩展 return 语句**（第 991-1031 行 return 对象内追加）

```js
currentUser, authView, authForm, authLoading, authError, isInitializing,
handleAuthSubmit, logout,
```

**4h. 模板：登录视图 + 主应用条件渲染**

在第 168 行 `@click="closeColorPopover">` 之后、第 169 行 `<!-- 侧边栏 -->` 之前插入三段：

1. **首屏 loading**：`<div v-if="isInitializing" class="flex-1 flex items-center justify-center text-[#86868b] text-sm">加载中...</div>`
2. **登录/注册视图**：`<div v-else-if="!currentUser" class="flex-1 flex items-center justify-center">`，内含 iOS 毛玻璃卡片（`bg-[rgba(255,255,255,0.7)] backdrop-blur-[30px] rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.08)]`，宽 340px，圆角 24px），表单含用户名/密码输入、错误提示、提交按钮、登录/注册切换链接。表单 `@submit.prevent="handleAuthSubmit"`。
3. **主应用包裹**：`<template v-else>`，包裹现有侧边栏 + 主编辑区，结束 `</template>` 放在第 429 行 `</div>`（#app 闭合）之前。

**4i. 侧边栏顶部加用户信息条**（在第 172 行 `<!-- 搜索框 + 新建按钮 -->` 之前插入）

显示用户名首字母头像 + 用户名 + 退出登录按钮（点击调 `logout`）。样式沿用 iOS 风：头像 `w-8 h-8 rounded-full bg-[#0071e3]/10 text-[#0071e3]`，退出按钮 hover 变 `#ff3b30`。

## 复用的现有函数

- `saveNotes()`（index.html:523）— 保留函数名与 9 处调用点，仅替换内部实现为 debounce + fetch
- `saveAiConfig()`（index.html:527）— 保留函数名，内部加 fetch
- `updateAIStatusDisplay()`（index.html:532）— 复用，登录/登出后调用
- `getPlainSnippet` / `filteredNotes` / `currentNote` 等计算属性 — 不变
- `showCustomAlert` / `showToast`（index.html:542-552）— 复用，登录异常也可调用
- `note` 对象结构（id/title/body/pinned/color/order/createdAt/updatedAt）— 完全不变，迁移无字段转换成本

## 风险与边界处理

1. **Quill 初始化时序**：`onMounted` 内 Quill 必须在 `currentUser` 确定后初始化（步骤 4f 已处理），未登录时 `#editor-container` 不在 DOM。
2. **迁移幂等性**：仅在"远端空 + 本地有数据"触发，迁移后清 localStorage，天然幂等。
3. **`secure` cookie 本地 HTTP**：开发环境 `NODE_ENV !== 'production'` → `secure:false`，localhost 正常；生产 HTTPS 设 `NODE_ENV=production` 自动启用。
4. **登录失败信息统一**："用户名或密码错误"，防用户名枚举；注册"用户名已被占用"无法避免。
5. **Redis 故障降级**：`requireAuth` 与各路由 catch 异常返回 503，不让进程崩溃。
6. **`/uploads/` 图片迁移后 URL 仍有效**（文件在服务端文件系统），无需处理。
7. **同源 fetch 默认携带 cookie**：无需每处加 `credentials: 'include'`。
8. **`sendBeacon` 的 `Blob` 指定 `application/json`**：Express `express.json` 能正确解析。

## 验证方案

### 1. 启动前检查 Redis

```powershell
& "C:\Program Files\Redis\redis-cli.exe" ping   # 期望 PONG
```

### 2. 启动服务

```powershell
cd e:\git\note\notebook
npm start   # 期望 🚀 服务器运行在 http://localhost:4200
```

### 3. curl 后端流程测试

```powershell
# 注册（cookie 存 cookie.txt）
curl.exe -c cookie.txt -X POST http://localhost:4200/api/auth/register -H "Content-Type: application/json" -d '{\"username\":\"alice\",\"password\":\"secret123\"}'
# 期望 {"username":"alice"}

# me
curl.exe -b cookie.txt http://localhost:4200/api/auth/me   # 期望 {"username":"alice"}

# 保存笔记
curl.exe -b cookie.txt -X POST http://localhost:4200/api/notes -H "Content-Type: application/json" -d '{\"notes\":[{\"id\":1,\"title\":\"测试\",\"body\":\"<p>hi</p>\",\"createdAt\":1,\"updatedAt\":1,\"pinned\":false,\"color\":null,\"order\":0}]}'
# 期望 {"ok":true}

# 读取
curl.exe -b cookie.txt http://localhost:4200/api/notes   # 期望返回笔记数组

# 未登录访问受保护接口
curl.exe http://localhost:4200/api/notes   # 期望 401

# 大小写不敏感查重
curl.exe -X POST http://localhost:4200/api/auth/register -H "Content-Type: application/json" -d '{\"username\":\"Alice\",\"password\":\"secret123\"}'
# 期望 409 用户名已被占用

# 登出
curl.exe -b cookie.txt -X POST http://localhost:4200/api/auth/logout
curl.exe -b cookie.txt http://localhost:4200/api/auth/me   # 期望 401
```

### 4. Redis 直查

```powershell
& "C:\Program Files\Redis\redis-cli.exe" KEYS "*"
& "C:\Program Files\Redis\redis-cli.exe" GET "user:alice"      # 应含 passwordHash 字段
& "C:\Program Files\Redis\redis-cli.exe" GET "notes:alice"
```

### 5. 浏览器端到端

1. 清空 localStorage → 访问 `http://localhost:4200` → 显示登录视图
2. 注册 `alice / secret123` → 进入主应用，侧边栏顶部显示头像 `A` + 用户名 + 退出按钮
3. 新建便签输入内容 → 等 1 秒 → DevTools Network 见 `POST /api/notes` 200
4. 刷新页面 → 笔记仍在（来自 Redis）
5. **迁移测试**：`redis-cli FLUSHDB` 清库 → localStorage 手动写旧笔记 → 刷新登录 → 应自动上传，localStorage 中 `apple_notes_data_ai` 被清除
6. **多设备模拟**：普通 + 隐身窗口都登录 alice → 一端改笔记 → 另一端刷新可见
7. 点退出登录 → 回登录视图，cookie 清除

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | npm install 自动写入 ioredis、cookie-parser |
| `lib/auth.js` | 新建 | scrypt 哈希、会话、限流、requireAuth 中间件 |
| `server.js` | 修改 | Redis 接入、中间件调整、6 个新路由、2 个现有路由加保护 |
| `index.html` | 修改 | 认证状态、登录视图、saveNotes/saveAiConfig 改造、onMounted 改造、迁移逻辑、return 扩展、侧边栏用户条 |
