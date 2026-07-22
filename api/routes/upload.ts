/**
 * 文件上传路由 —— 单核极限优化版
 * 优先使用 Cloudinary CDN，不可用时降级为本地存储
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import multerLib from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { v2 as cloudinary } from 'cloudinary'
import { authMiddleware } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')

if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }) } catch {}
}

// Cloudinary 配置（从环境变量 CLOUDINARY_URL 读取）
const cloudinaryEnabled = !!process.env.CLOUDINARY_URL
if (cloudinaryEnabled) {
  console.log('[upload] Cloudinary 已启用')
}

const router = Router()

// ESM 兼容：multer 是 CJS 模块，需要取 .default
const multer = (multerLib as any).default || multerLib

// multer 配置：磁盘存储直接写文件，内存存储也可以
const storage = multer.diskStorage({
  destination: function (_req: any, _file: any, cb: any) {
    cb(null, UPLOAD_DIR)
  },
  filename: function (_req: any, file: any, cb: any) {
    // 生成唯一文件名：随机16字符 + 时间戳 + 扩展名
    const random = crypto.randomBytes(8).toString('hex')
    const ext = path.extname(file.originalname) || (file.mimetype ? '.' + file.mimetype.split('/')[1] : '.png')
    cb(null, `${random}-${Date.now()}${ext}`)
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB（支持大视频上传）
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowedTypes = [
      'image/', 'video/', 'audio/',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/zip', 'application/x-rar-compressed',
      'application/x-7z-compressed', 'text/',
      'application/json', 'application/xml',
    ]
    const ok = allowedTypes.some((t) => file.mimetype.startsWith(t))
    if (ok) {
      cb(null, true)
    } else {
      cb(new Error('不支持的文件类型'))
    }
  },
})

// multer 错误处理中间件
function uploadErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err) {
    console.error('[upload error]', err.message || err)
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: '文件大小不能超过500MB' })
    }
    return res.status(400).json({ success: false, error: err.message || '上传失败' })
  }
  next()
}

// FormData 上传 (multipart/form-data)
// 优先使用 Cloudinary，不可用时降级为本地存储
router.post('/', authMiddleware, upload.single('file'), uploadErrorHandler, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '缺少文件' })
      return
    }

    const filePath = (req.file as any).path
    const mimetype = req.file.mimetype
    const isImage = mimetype.startsWith('image/')

    // 尝试 Cloudinary 上传（仅图片和视频）
    if (cloudinaryEnabled && (isImage || mimetype.startsWith('video/'))) {
      try {
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: isImage ? 'image' : 'video',
          transformation: isImage
            ? [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
            : undefined,
        })
        res.json({
          success: true,
          url: result.secure_url,
          type: mimetype,
          contentType: mimetype,
          originalName: req.file.originalname,
          cloudinary: true,
        })
        return
      } catch (cloudErr: any) {
        console.warn('[upload] Cloudinary 上传失败，降级为本地存储:', cloudErr?.message)
      }
    }

    // 降级：本地存储
    const filename = (req.file as any).filename
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http'
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001').replace(/:3001$/, '')
    const fullUrl = `${protocol}://${host}/uploads/${filename}`
    res.json({
      success: true,
      url: fullUrl,
      type: mimetype,
      contentType: mimetype,
      originalName: req.file.originalname,
    })
  } catch (error: any) {
    console.error('[upload]', error?.message || error)
    res.status(500).json({ success: false, error: '上传失败' })
  }
})

export default router
