/**
 * 用户相关路由（头像、资料、注销等）
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
 * 获取当前用户的完整资料
 * GET /api/user/profile
 */
router.get('/profile', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const user = db.prepare(`
      SELECT id, username, phone, email, avatar, bio, gender, region, vip, vipExpiresAt, active
      FROM users WHERE id = ?
    `).get(userId) as any

    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    res.json({ success: true, user })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 更新用户头像
 * POST /api/user/avatar
 */
router.post('/avatar', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { avatar } = req.body

    if (!avatar) {
      res.status(400).json({ success: false, error: '请提供头像地址' })
      return
    }

    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId)

    res.json({ success: true, avatar })
  } catch (error) {
    console.error('Update avatar error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 更新用户资料（用户名、性别、地区、简介）
 * PUT /api/user/profile
 */
router.put('/profile', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username, bio, gender, region } = req.body

    // 验证字段
    if (username !== undefined) {
      if (!username) {
        res.status(400).json({ success: false, error: '用户名不能为空' })
        return
      }
      if (username.length < 2 || username.length > 20) {
        res.status(400).json({ success: false, error: '用户名长度需在2-20个字符之间' })
        return
      }
      // 检查新用户名是否已被其他活跃用户使用
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND active = 1 AND id != ?').get(username, userId)
      if (existing) {
        res.status(400).json({ success: false, error: '该用户名已被使用' })
        return
      }
    }

    if (bio !== undefined && bio.length > 200) {
      res.status(400).json({ success: false, error: '简介不能超过 200 个字符' })
      return
    }

    if (gender !== undefined && !['male', 'female', '', 'other'].includes(gender)) {
      res.status(400).json({ success: false, error: '性别参数无效' })
      return
    }

    if (region !== undefined && region.length > 30) {
      res.status(400).json({ success: false, error: '地区不能超过 30 个字符' })
      return
    }

    // 构建动态 UPDATE
    const fields: string[] = []
    const values: any[] = []
    if (username !== undefined) { fields.push('username = ?'); values.push(username) }
    if (bio !== undefined)      { fields.push('bio = ?');      values.push(bio) }
    if (gender !== undefined)   { fields.push('gender = ?');   values.push(gender) }
    if (region !== undefined)   { fields.push('region = ?');   values.push(region) }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: '没有要更新的字段' })
      return
    }

    values.push(userId)
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    res.json({ success: true })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 注销账号（软删除）
 * POST /api/user/deactivate
 */
router.post('/deactivate', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id

    // 删除所有数据（好友关系、聊天记录），再软删除用户
    const deactivate = db.transaction(() => {
      db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(userId, userId)
      db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(userId, userId)
      const result = db.prepare('UPDATE users SET active = 0 WHERE id = ? AND active = 1').run(userId)
      return result.changes > 0
    })

    const success = deactivate()
    if (!success) {
      res.status(404).json({ success: false, error: '账号不存在或已被注销' })
      return
    }

    res.json({ success: true, message: '账号已注销，所有聊天记录已清除' })
  } catch (error) {
    console.error('Deactivate account error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
