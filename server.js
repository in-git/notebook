const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4200;

// 中间件
app.use(cors());
app.use(express.json());

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

// ========== 路由：AI 标题总结 ==========
app.post('/api/summarize', async (req, res) => {
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: '内容不能为空' });
    }

    try {
        const response = await fetch('https://ac2a2be1e22709fa5.bj5.agentos-app.net/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen25vl',
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
        const title = data.choices?.[0]?.message?.content?.trim();

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
app.post('/api/upload', upload.single('image'), (req, res) => {
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
app.use(express.static(__dirname));

// 根路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== 启动服务器 ==========
app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
});
