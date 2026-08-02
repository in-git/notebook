# Node.js AI 标题总结 + 富文本图片上传 实现计划

## Context
当前项目是一个纯前端单页应用（index.html），使用 Quill.js 富文本编辑器，直接从前端调用外部 AI API 生成标题。存在的问题：
1. 前端直接暴露 AI API 地址，不安全也不利于管理
2. AI 触发时机不合理：每次 text-change 都触发，即使有 1 分钟节流，仍可能发多余请求
3. 无图片上传功能：Quill 工具栏没有 image 按钮，无法在笔记中插入图片
4. 节流时间过长（1分钟），用户期望 15 秒

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server.js` | 新建 | Node.js 服务器：AI 代理 + 图片上传 + 静态文件服务 |
| `package.json` | 新建 | 声明 express/multer/cors 依赖 |
| `.gitignore` | 新建 | 忽略 node_modules 和 uploads |
| `index.html` | 修改 | blur 触发、15秒节流、内容比对、API 路由切换、图片上传、粘贴/拖拽支持 |

## 一、后端：server.js

### 路由设计

| 路由 | 方法 | 功能 |
|------|------|------|
| `/` | GET | 返回 index.html |
| `/api/summarize` | POST | 代理 AI 模型，接收 `{ content }`，返回 `{ title }` |
| `/api/upload` | POST | 接收图片（multipart），存储到 uploads/，返回 `{ url }` |
| `/uploads/:filename` | GET | 静态服务已上传图片 |

### /api/summarize 实现
- 从 `req.body.content` 获取纯文本
- 组装 messages 数组（system prompt 集中在后端管理）
- 转发到 `https://ac2a2be1e22709fa5.bj5.agentos-app.net/v1/chat/completions`
- 提取 `choices[0].message.content` 返回 `{ title }`
- 错误返回 `{ error }` + HTTP 502

### /api/upload 实现
- multer 中间件，限制 5MB，仅允许 image/jpeg/png/gif/webp/svg+xml
- 文件名：`{timestamp}-{random6chars}.{ext}`
- 启动时自动创建 uploads/ 目录
- 返回 `{ url: "/uploads/filename" }`

## 二、前端：index.html 改动

### 2.1 AI 触发：text-change → blur
- 移除 `quill.on('text-change')` 中的 `triggerAISummary` 调用
- 改为监听 `quill.root` 的 `focusout` 事件
- **关键**：用 `event.relatedTarget` 检测焦点去向，若移到 Quill 工具栏内则不触发（避免点击加粗等按钮误触）
- 切换便签时，对当前便签主动触发一次 AI 总结

### 2.2 节流：60秒 → 15秒
- `cooldown` 从 `60 * 1000` 改为 `15 * 1000`
- placeholder 文本同步更新

### 2.3 内容变化检测
- 新增 `lastSubmittedContent = {}` 记录每个便签上次发送的内容
- `triggerAISummary` 开头比对：内容未变则跳过
- 请求成功后更新记录

### 2.4 AI 请求改为本地服务器
- fetch 目标从外部 AI URL 改为 `/api/summarize`
- 请求体改为 `{ content: textContent }`
- 响应解析改为 `data.title`

### 2.5 图片上传功能
- Quill toolbar 添加 `'image'` 按钮
- 自定义 image handler：点击 → 打开文件选择器 → FormData 上传到 `/api/upload` → 获取 URL → insertEmbed
- 粘贴图片：监听 paste 事件，检测 clipboardData 中的 image 项 → 同样上传流程
- 拖拽图片：监听 drop 事件，检测 dataTransfer.files → 同样上传流程
- 上传失败时 toast 提示，不插入坏图

## 三、实现步骤

1. 创建 `package.json`（express + multer + cors）
2. 创建 `server.js`（静态文件 + /api/summarize + /api/upload）
3. 创建 `.gitignore`
4. 修改 `index.html`：blur 触发 + focusout relatedTarget 检测
5. 修改 `index.html`：15 秒节流 + 内容变化检测
6. 修改 `index.html`：AI 请求改为 /api/summarize
7. 修改 `index.html`：Quill 图片上传 handler + 粘贴/拖拽支持
8. `npm install` + 测试

## 四、验证方式
1. `npm start` 启动服务器，访问 http://localhost:3000
2. 输入便签内容 → 点击编辑器外部（失焦）→ 15 秒内应触发 AI 标题总结
3. 连续快速编辑 → 失焦 → 仅发一次请求（15秒节流 + 内容比对）
4. 点击 Quill 工具栏（加粗等）→ 不应触发 AI
5. 点击 image 按钮 → 选择图片 → 上传成功后插入编辑器
6. 粘贴/拖拽图片到编辑器 → 同样上传并插入
7. 切换便签 → 对前一个便签触发 AI 总结
