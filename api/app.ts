/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import friendsRoutes from './routes/friends.js'
import messagesRoutes from './routes/messages.js'
import uploadRoutes from './routes/upload.js'
import userRoutes from './routes/user.js'
import verificationRoutes from './routes/verification.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 静态文件服务 - 提供上传的文件
const uploadsPath = path.join(__dirname, '..', 'uploads')
app.use('/uploads', express.static(uploadsPath))

// 生产环境：托管前端构建产物
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(express.static(distPath))
}

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/user', userRoutes)
app.use('/api/verification', verificationRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 生产环境 SPA fallback - 非 API 路由返回前端页面
 */
if (process.env.NODE_ENV === 'production') {
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      res.status(404).json({ success: false, error: 'API not found' })
      return
    }
    const distPath = path.join(__dirname, '..', 'dist', 'index.html')
    res.sendFile(distPath)
  })
} else {
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'API not found',
    })
  })
}

export default app