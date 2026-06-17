/**
 * 未读消息路由
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const router = Router()

function authMiddleware(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}

/**
 * 获取当前用户的所有未读计数
 * GET /api/unread
 */
router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const rows = db.prepare(`
      SELECT targetType, targetId, count, lastMessage, lastSenderId, lastTimestamp
      FROM unread_counts
      WHERE userId = ? AND count > 0
    `).all(userId)

    res.json({ success: true, unread: rows })
  } catch (error) {
    console.error('Get unread error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 清除指定会话的未读计数
 * POST /api/unread/clear
 * body: { targetType: 'friend' | 'group', targetId: number }
 */
router.post('/clear', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { targetType, targetId } = req.body

    if (!targetType || !targetId) {
      res.status(400).json({ success: false, error: '参数缺失' })
      return
    }

    db.prepare(
      'DELETE FROM unread_counts WHERE userId = ? AND targetType = ? AND targetId = ?'
    ).run(userId, targetType, targetId)

    res.json({ success: true })
  } catch (error) {
    console.error('Clear unread error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
