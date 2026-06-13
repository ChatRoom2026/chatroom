/**
 * 文件下载路由 - 支持原始文件名下载
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

function authMiddleware(req: Request, res: Response, next: any) {
  // 支持 Authorization header 和 query token
  let token = ''
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  } else if (req.query.token) {
    token = req.query.token as string
  }
  if (!token) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}

/**
 * 下载文件
 * GET /api/download/:messageId
 */
router.get('/:messageId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const messageId = parseInt(req.params.messageId)

    const message = db.prepare(
      'SELECT id, senderId, receiverId, content, fileUrl, type FROM messages WHERE id = ?'
    ).get(messageId) as any

    if (!message) {
      res.status(404).json({ success: false, error: '消息不存在' })
      return
    }

    // 验证权限：必须是发送者或接收者
    if (message.senderId !== userId && message.receiverId !== userId) {
      res.status(403).json({ success: false, error: '无权访问此文件' })
      return
    }

    if (!message.fileUrl) {
      res.status(404).json({ success: false, error: '文件不存在' })
      return
    }

    // 解析文件路径
    const fileName = path.basename(message.fileUrl)
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads')
    const filePath = path.join(uploadsDir, fileName)

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: '文件已丢失' })
      return
    }

    // 用原始文件名下载
    const originalName = encodeURIComponent(message.content || fileName)
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"; filename*=UTF-8''${originalName}`)
    res.sendFile(filePath)
  } catch (error) {
    console.error('Download error:', error)
    res.status(500).json({ success: false, error: '下载失败' })
  }
})

export default router