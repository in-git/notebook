const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const Redis = require('ioredis');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 4200;

// Redis 客户端
// 配置说明：
//   commandTimeout: 单条命令超时 3s，防止高并发下请求永久挂起
//   maxRetriesPerRequest: 最多重试 1 次，避免默认 20 次重试导致请求长时间阻塞
//   enableOfflineQueue: 断线时直接拒绝新命令（抛错），fail-fast 而非排队堆积
//   retryStrategy: 指数退避重连，上限 1s，加快从短暂网络抖动中恢复
//   connectTimeout: 建连超时 3s，避免首次启动长时间卡在连接阶段
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    commandTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 1000),
});
redis.on('error', (err) => console.error('Redis 错误:', err.message));
redis.on('reconnecting', (delay) => console.warn(`Redis 重连中，${delay}ms 后重试`));

// 会话 cookie 配置
const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 天
};

// 中间件
app.use(cors({ origin: true, credentials: true }));  // 允许携带 cookie
app.use(express.json({ limit: '2mb' }));             // 限制 body 大小防攻击
app.use(cookieParser());

// 确保 uploads 目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// ========== 图片上传配置 ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const randomStr = crypto.randomBytes(3).toString('hex'); // 6位随机字符
        const filename = `${Date.now()}-${randomStr}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的图片格式，仅允许 JPG/PNG/GIF/WebP/SVG'));
        }
    }
});

// ========== 路由：认证 ==========
// 注册
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (!auth.validateUsername(username) || !auth.validatePassword(password)) {
        return res.status(400).json({ error: '用户名需 3-20 位字母数字下划线，密码至少 6 位' });
    }
    const lower = username.toLowerCase();
    try {
        if (await redis.exists(`user:${lower}`)) {
            return res.status(409).json({ error: '用户名已被占用' });
        }
        const passwordHash = await auth.hashPassword(password);
        const record = { username, passwordHash, createdAt: Date.now() };
        await redis.set(`user:${lower}`, JSON.stringify(record));
        const sid = await auth.createSession(redis, lower);
        res.cookie('sid', sid, COOKIE_OPTIONS);
        res.json({ username });
    } catch (e) {
        console.error('register error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!auth.validateUsername(username) || !auth.validatePassword(password)) {
        return res.status(400).json({ error: '用户名或密码错误' });
    }
    const lower = username.toLowerCase();
    try {
        // 登录限流
        if (!(await auth.checkLoginLimit(redis, lower))) {
            return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
        }
        const raw = await redis.get(`user:${lower}`);
        if (!raw) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        const record = JSON.parse(raw);
        const ok = await auth.verifyPassword(password, record.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        await auth.resetLoginLimit(redis, lower);
        const sid = await auth.createSession(redis, lower);
        res.cookie('sid', sid, COOKIE_OPTIONS);
        res.json({ username: record.username });
    } catch (e) {
        console.error('login error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// 登出
app.post('/api/auth/logout', async (req, res) => {
    const sid = req.cookies && req.cookies.sid;
    if (sid) {
        try { await redis.del(`session:${sid}`); } catch (e) { /* 忽略 */ }
    }
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
});

// 获取当前登录用户
app.get('/api/auth/me', async (req, res) => {
    try {
        const lower = await auth.getUserFromRequest(redis, req);
        if (!lower) return res.status(401).json({ error: '未登录' });
        const raw = await redis.get(`user:${lower}`);
        if (!raw) return res.status(401).json({ error: '未登录' });
        res.json({ username: JSON.parse(raw).username });
    } catch (e) {
        console.error('me error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// ========== 路由：笔记 / AI 配置（需登录） ==========
// 获取当前用户笔记
app.get('/api/notes', auth.requireAuth(redis), async (req, res) => {
    try {
        const raw = await redis.get(`notes:${req.user.usernameLower}`);
        res.json({ notes: raw ? JSON.parse(raw) : [] });
    } catch (e) {
        console.error('get notes error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// 保存当前用户笔记（全量替换）
app.post('/api/notes', auth.requireAuth(redis), async (req, res) => {
    const { notes } = req.body || {};
    if (!Array.isArray(notes)) {
        return res.status(400).json({ error: 'notes 必须为数组' });
    }
    try {
        const serialized = JSON.stringify(notes);
        // 单 key 上限 5MB，避免过大
        if (serialized.length > 5 * 1024 * 1024) {
            return res.status(413).json({ error: '数据过大' });
        }
        await redis.set(`notes:${req.user.usernameLower}`, serialized);
        res.json({ ok: true });
    } catch (e) {
        console.error('save notes error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// 获取 AI 配置
app.get('/api/ai-config', auth.requireAuth(redis), async (req, res) => {
    try {
        const raw = await redis.get(`ai_config:${req.user.usernameLower}`);
        res.json(raw ? JSON.parse(raw) : { summaryEnabled: false });
    } catch (e) {
        console.error('get ai-config error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// 保存 AI 配置
app.post('/api/ai-config', auth.requireAuth(redis), async (req, res) => {
    try {
        await redis.set(`ai_config:${req.user.usernameLower}`, JSON.stringify(req.body || {}));
        res.json({ ok: true });
    } catch (e) {
        console.error('save ai-config error:', e);
        res.status(503).json({ error: '服务暂不可用' });
    }
});

// ========== 路由：AI 标题总结 ==========
app.post('/api/summarize', auth.requireAuth(redis), async (req, res) => {
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: '内容不能为空' });
    }

    try {
        const response = await fetch('https://a46120a2561f5ff2c.gz1.agentos-app.net/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:3b',
                stream: false,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个标题生成助手。请根据用户提供的便签内容，用最简短精炼的语言（控制在15个字以内）总结出一个核心标题。不要输出任何多余的解释、标点或前缀，只输出标题本身。'
                    },
                    {
                        role: 'user',
                        content: content.trim()
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`AI 接口返回 ${response.status}`);
        }

        const data = await response.json();
        const title = data.message?.content?.trim();

        if (title) {
            res.json({ title: title.replace(/^["']|["']$/g, '') });
        } else {
            res.status(502).json({ error: 'AI 未返回有效标题' });
        }
    } catch (error) {
        console.error('AI 总结请求失败:', error.message);
        res.status(502).json({ error: 'AI 服务暂不可用' });
    }
});

// ========== 路由：图片上传 ==========
app.post('/api/upload', auth.requireAuth(redis), upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '未接收到图片文件' });
    }

    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
});

// multer 错误处理
app.use('/api/upload', (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '图片大小不能超过 5MB' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

// ========== 静态文件服务 ==========
app.use('/uploads', express.static(uploadsDir));

// 生产环境：Vite 构建产物在 dist/，由 Express 托管
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// 根路由 + SPA 兜底：未匹配的 GET 请求统一回退到 dist/index.html
const indexHtmlPath = path.join(distDir, 'index.html');
app.get('/', (req, res) => {
    if (fs.existsSync(indexHtmlPath)) {
        return res.sendFile(indexHtmlPath);
    }
    res.status(200).type('html').send(
        '<meta charset="utf-8"><div style="font-family:sans-serif;padding:40px;color:#333">' +
        '<h2>前端尚未构建</h2><p>开发请运行 <code>npm run dev</code>（访问 http://localhost:5173），' +
        '生产部署请先执行 <code>npm run build</code> 再启动服务。</p></div>'
    );
});

// ========== 启动服务器 ==========
const server = app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
});

// 优雅关闭：收到终止信号时停止接收新连接并关闭 Redis，避免连接泄漏
function gracefulShutdown(signal) {
    console.log(`\n收到 ${signal}，开始优雅关闭...`);
    server.close((err) => {
        if (err) console.error('关闭 HTTP 服务出错:', err.message);
    });
    redis.quit().then(() => {
        console.log('Redis 连接已关闭');
        process.exit(0);
    }).catch(() => process.exit(1));
    // 兜底：5s 后强制退出，防止卡死
    setTimeout(() => {
        console.warn('优雅关闭超时，强制退出');
        process.exit(1);
    }, 5000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
