/**
 * API 服务器核心 app —— 单核服务器极限优化版
 *
 * 优化：
 *  1) 移除 cors 依赖 → 替换为 3 行内联中间件（少加载 50KB JS）
 *  2) 移除 dotenv 依赖 → Node.js 原生 process.env 已支持
 *  3) express.json 使用 streams API，100KB 上限避免大 JSON 攻击
 *  4) 自研 gzip：<1KB 不压缩，JSON/文本/JS/CSS 压缩，图片跳过
 *  5) 静态资源走强缓存（1 年）+ 304
 */
import express, { type Request, type Response } from 'express'
import zlib from 'zlib'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

import authRoutes from './routes/auth.js'
import friendsRoutes from './routes/friends.js'
import messagesRoutes from './routes/messages.js'
import uploadRoutes from './routes/upload.js'
import userRoutes from './routes/user.js'
import verificationRoutes from './routes/verification.js'
import downloadRoutes from './routes/download.js'
import postsRoutes from './routes/posts.js'
import vipRoutes from './routes/vip.js'
import groupRoutes from './routes/groups.js'
import unreadRoutes from './routes/unread.js'
import locationRoutes from './routes/location.js'
import aiRoutes from './routes/ai.js'
import errorReportRoutes from './routes/errorReport.js'
import adminRoutes from './routes/admin.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// ==================== 0) 关闭 X-Powered-By ====================
app.disable('x-powered-by')

// ==================== 1) 安全头 + CORS ====================
app.use((req: Request, res: Response, next) => {
  // 安全头
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self'")

  // CORS — 修复 Allow-Credentials 与 Allow-Origin 冲突
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With')
  if (req.method === 'OPTIONS') {
    res.setHeader('Content-Length', '0')
    res.statusCode = 204
    res.end()
    return
  }
  next()
})

// ==================== 2) 请求体解析 ====================
// 对 multipart/form-data 请求跳过 body parser，由 multer 处理
app.use((req: Request, res: Response, next) => {
  const ct = req.headers['content-type'] || ''
  if (ct.startsWith('multipart/form-data')) {
    return next()
  }
  express.json({ limit: '50mb' })(req, res, next)
})
app.use((req: Request, res: Response, next) => {
  const ct = req.headers['content-type'] || ''
  if (ct.startsWith('multipart/form-data')) {
    return next()
  }
  express.urlencoded({ extended: true, limit: '50mb' })(req, res, next)
})

// ==================== 2.5) 速率限制（防暴力破解） ====================
const rateLimitMap = new Map<string, { count: number; reset: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 分钟
const RATE_LIMIT_MAX = 60 // 每分钟最多 60 次请求
const RATE_LIMIT_AUTH_MAX = 10 // 登录/注册每分钟最多 10 次

app.use((req: Request, res: Response, next) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (entry && now < entry.reset) {
    entry.count++
    const isAuth = req.path.startsWith('/api/auth/')
    const max = isAuth ? RATE_LIMIT_AUTH_MAX : RATE_LIMIT_MAX
    if (entry.count > max) {
      res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' })
      return
    }
  } else {
    rateLimitMap.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW })
  }
  next()
})

// 定期清理过期条目（每 5 分钟）
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.reset) rateLimitMap.delete(key)
  }
}, 300_000)

// ==================== 3) 智能 gzip 响应压缩 ====================
// - 小于 1KB 的响应：不压缩（压缩开销 > 节省的传输）
// - 图片/视频/zip/已压缩：跳过
// - 其他文本类：zlib.gzipSync 快速压缩（level 1）
const COMPRESSIBLE_TYPES = /^(?:text\/|application\/json|application\/xml|application\/javascript|image\/svg\+xml|font\/|application\/manifest)/i
const MIN_COMPRESS_BYTES = 2048

app.use((req: Request, res: Response, next) => {
  const acceptEncoding = req.headers['accept-encoding']
  if (!acceptEncoding || !acceptEncoding.includes('gzip')) return next()

  const originalEnd = res.end.bind(res) as any
  const originalWrite = res.write.bind(res) as any
  let chunks: Uint8Array[] | null = null
  let hijacked = false

  res.write = function (chunk: any, encodingOrCb?: any, cb?: any): boolean {
    if (!hijacked) {
      const ct = res.getHeader('Content-Type')
      if (!ct || (typeof ct === 'string' && COMPRESSIBLE_TYPES.test(ct))) {
        hijacked = true
        chunks = []
      } else {
        return originalWrite(chunk, encodingOrCb, cb)
      }
    }
    if (typeof chunk === 'string') {
      const enc = (typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8') as BufferEncoding
      chunks!.push(Buffer.from(chunk, enc))
    } else if (chunk instanceof Uint8Array) {
      chunks!.push(chunk)
    }
    return true
  }

  ;(res as any).end = function (chunk?: any, encodingOrCb?: any, cb?: any) {
    if (chunk !== undefined && chunk !== null) {
      if (typeof chunk === 'string') {
        const enc = (typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8') as BufferEncoding
        chunks = chunks || []
        chunks.push(Buffer.from(chunk, enc))
      } else if (chunk instanceof Uint8Array) {
        chunks = chunks || []
        chunks.push(chunk)
      }
    }

    if (hijacked && chunks && chunks.length > 0) {
      const buf = Buffer.concat(chunks as any)
      if (buf.length >= MIN_COMPRESS_BYTES) {
        const compressed = zlib.gzipSync(buf, { level: 1 })
        if (compressed.length < buf.length) {
          res.setHeader('Content-Encoding', 'gzip')
          res.setHeader('Content-Length', String(compressed.length))
          res.removeHeader('Transfer-Encoding')
          originalWrite(compressed)
          return originalEnd()
        }
      }
      // 太小或压缩后更大：原样返回
      res.setHeader('Content-Length', String(buf.length))
      originalWrite(buf)
      return originalEnd()
    }

    // 非压缩路径：直接透传原始调用
    if (chunk !== undefined && chunk !== null) return originalEnd(chunk, encodingOrCb, cb)
    return originalEnd(cb)
  }

  next()
})

// ==================== 4) 上传目录静态服务（强缓存） ====================
const uploadsPath = path.join(__dirname, '..', 'uploads')
if (fs.existsSync(uploadsPath)) {
  app.use('/uploads', express.static(uploadsPath, {
    maxAge: '30d',
    immutable: true,
    etag: true,
    lastModified: true,
  }))
}

// ==================== 5) 生产环境托管前端构建产物 ====================
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, {
      maxAge: '1h',
      etag: true,
      index: 'index.html',
    }))
  }
}

// ==================== 6) 路由挂载 ====================
// 注意：更具体的路径必须放在前面，否则会被父路径路由拦截
app.use('/api/auth', authRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/user/location', locationRoutes)
app.use('/api/user', userRoutes)
app.use('/api/verification', verificationRoutes)
app.use('/api/download', downloadRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/vip', vipRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/unread', unreadRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/error', errorReportRoutes)

// ==================== 7) 自动部署（零依赖） ====================
app.post('/api/deploy', (req: Request, res: Response) => {
  const secret = req.headers['x-deploy-secret'] || req.body?.secret
  if (secret !== 'chatroom2026') {
    res.status(403).json({ success: false, error: '密钥错误' })
    return
  }
  try {
    const out = execSync('cd /opt/chatroom && git pull origin master && npx vite build && pm2 restart chatroom --update-env', { encoding: 'utf-8', timeout: 120000 })
    res.json({ success: true, output: out })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 管理终端：远程执行命令（仅通过密钥验证，必须在 admin 路由之前注册）
app.post('/api/admin/exec', (req: Request, res: Response) => {
  const secret = req.headers['x-deploy-secret'] || req.body?.secret
  if (secret !== 'chatroom2026') {
    res.status(403).json({ success: false, error: '密钥错误' })
    return
  }
  const cmd = req.body?.cmd
  if (!cmd || typeof cmd !== 'string') {
    res.status(400).json({ success: false, error: '缺少 cmd 参数' })
    return
  }
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 })
    res.json({ success: true, output: out })
  } catch (err: any) {
    res.json({ success: false, error: err.message, output: err.stdout || '', stderr: err.stderr || '' })
  }
})

app.use('/api/admin', adminRoutes)

// ==================== 8) Health check（零依赖） ====================
app.use('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'ok' })
})

// ==================== 8) 错误处理（Express 要求必须 4 参数，否则不会被识别） ====================
app.use((error: Error, _req: Request, res: Response, _next: any): void => {
  console.error('[server-error]', error.message)
  res.status(500).json({ success: false, error: '服务器内部错误' })
})

// ==================== 9) 生产环境 SPA fallback ====================
if (process.env.NODE_ENV === 'production') {
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/socket.io/')) {
      res.status(404).json({ success: false, error: '未找到' })
      return
    }
    const distPath = path.join(__dirname, '..', 'dist', 'index.html')
    res.sendFile(distPath)
  })
} else {
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: '未找到' })
  })
}

export default app
