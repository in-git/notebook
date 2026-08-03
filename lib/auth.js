// 认证工具模块：scrypt 密码哈希、会话管理、登录限流、requireAuth 中间件
// 全部基于 Node.js 内置 crypto 模块，无需额外原生依赖

const crypto = require('crypto');
const { promisify } = require('util');

// 异步 scrypt，避免 scryptSync 阻塞事件循环（每次约 50-80ms）
const scrypt = promisify(crypto.scrypt);

const SESSION_TTL = 604800;       // 会话有效期 7 天（秒）
const LOGIN_MAX = 5;              // 登录失败上限
const LOGIN_WINDOW = 900;         // 登录限流窗口 15 分钟（秒）

// scrypt 参数：N=16384（2^14）兼顾安全与性能
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LEN = 16;
const KEY_LEN = 64;

// 用户名：3-20 位，字母数字下划线
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const validateUsername = (u) => typeof u === 'string' && USERNAME_RE.test(u);
const validatePassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 128;

/**
 * 哈希密码：返回 "saltHex:hashHex" 格式
 */
async function hashPassword(plain) {
    const salt = crypto.randomBytes(SALT_LEN);
    const hash = await scrypt(plain, salt, KEY_LEN, SCRYPT_PARAMS);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * 校验密码：常量时间比较，防时序攻击
 */
async function verifyPassword(plain, stored) {
    try {
        const [saltHex, hashHex] = stored.split(':');
        if (!saltHex || !hashHex) return false;
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const hash = await scrypt(plain, salt, KEY_LEN, SCRYPT_PARAMS);
        // 长度不一致直接返回 false，避免 timingSafeEqual 抛错
        if (hash.length !== expected.length) return false;
        return crypto.timingSafeEqual(hash, expected);
    } catch (e) {
        return false;
    }
}

/**
 * 创建会话：256-bit 随机 sessionId，存入 Redis 并设 TTL
 */
async function createSession(redis, usernameLower) {
    const sid = crypto.randomBytes(32).toString('hex');
    await redis.set(`session:${sid}`, usernameLower, 'EX', SESSION_TTL);
    return sid;
}

/**
 * 从请求中解析当前用户（读 cookie → 查 session → 滑动续期）
 * 返回 usernameLower 或 null
 *
 * 使用 pipeline 合并 get + expire 两次操作为单次往返，
 * 将每个受保护请求的鉴权延迟减半；session 不存在时跳过 expire。
 */
async function getUserFromRequest(redis, req) {
    const sid = req.cookies && req.cookies.sid;
    if (!sid) return null;
    const key = `session:${sid}`;
    const results = await redis.pipeline()
        .get(key)
        .expire(key, SESSION_TTL)
        .exec();
    // results = [[err1, usernameLower], [err2, expireResult], ...]
    const usernameLower = results && results[0] && results[0][1];
    return usernameLower || null;
}

/**
 * requireAuth 中间件工厂
 * 失败返回 401，Redis 异常返回 503，成功挂 req.user = { usernameLower }
 */
function requireAuth(redis) {
    return async (req, res, next) => {
        try {
            const usernameLower = await getUserFromRequest(redis, req);
            if (!usernameLower) {
                return res.status(401).json({ error: '未登录' });
            }
            req.user = { usernameLower };
            next();
        } catch (e) {
            console.error('auth middleware error:', e);
            res.status(503).json({ error: '服务暂不可用' });
        }
    };
}

/**
 * 登录限流：基于 INCR + EXPIRE，5 次/15 分钟
 * 返回 true 表示未超限，false 表示已超限
 */
async function checkLoginLimit(redis, usernameLower) {
    const key = `login_attempts:${usernameLower}`;
    const n = await redis.incr(key);
    if (n === 1) {
        await redis.expire(key, LOGIN_WINDOW);
    }
    return n <= LOGIN_MAX;
}

/**
 * 重置登录限流（登录成功后调用）
 */
async function resetLoginLimit(redis, usernameLower) {
    await redis.del(`login_attempts:${usernameLower}`);
}

module.exports = {
    hashPassword,
    verifyPassword,
    createSession,
    getUserFromRequest,
    requireAuth,
    checkLoginLimit,
    resetLoginLimit,
    validateUsername,
    validatePassword,
    SESSION_TTL,
};
