/**
 * 管理后台路由 —— 仅官方账号可访问
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db, { stmtCache } from '../db.js'
import { authMiddleware, JWT_SECRET } from '../middleware/auth.js'

const router = Router()

// 所有管理接口都需要登录 + 官方账号
router.use(authMiddleware, (req: Request, res: Response, next) => {
  const isOfficial = (req as any).user?.isOfficial
  if (isOfficial !== 1) {
    res.status(403).json({ success: false, error: '仅官方账号可访问管理后台' })
    return
  }
  next()
})

// 获取所有用户列表
router.get('/users', (req: Request, res: Response): void => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100)
    const offset = (page - 1) * limit
    const search = (req.query.search as string) || ''

    let users: any[]
    let total: number

    if (search) {
      users = stmtCache
        .get('SELECT id, username, email, avatar, bio, gender, region, age, active, vip, vipExpiresAt, isOfficial, phone, createdAt FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(`%${search}%`, `%${search}%`, limit, offset) as any[]
      total = (stmtCache
        .get('SELECT COUNT(*) as count FROM users WHERE username LIKE ? OR email LIKE ?')
        .get(`%${search}%`, `%${search}%`) as any).count
    } else {
      users = stmtCache
        .get('SELECT id, username, email, avatar, bio, gender, region, age, active, vip, vipExpiresAt, isOfficial, phone, createdAt FROM users ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as any[]
      total = (stmtCache.get('SELECT COUNT(*) as count FROM users').get() as any).count
    }

    res.json({ success: true, users, total, page, totalPages: Math.ceil(total / limit) })
  } catch (error: any) {
    console.error('[admin-users]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 删除用户（彻底删除所有数据）
router.delete('/users/:id', (req: Request, res: Response): void => {
  try {
    const targetId = parseInt(req.params.id as string)
    const adminId = (req as any).user.id

    if (targetId === adminId) {
      res.status(400).json({ success: false, error: '不能删除自己' })
      return
    }

    const user = stmtCache.get('SELECT id, username FROM users WHERE id = ?').get(targetId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const cleanup = db.transaction(() => {
      stmtCache.get('DELETE FROM comments WHERE userId = ?').run(targetId)
      stmtCache.get('DELETE FROM posts WHERE userId = ?').run(targetId)
      stmtCache.get('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(targetId, targetId)
      stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(targetId, targetId)
      stmtCache.get('DELETE FROM group_messages WHERE senderId = ?').run(targetId)
      stmtCache.get('DELETE FROM group_members WHERE userId = ?').run(targetId)
      stmtCache.get('DELETE FROM group_invitations WHERE inviterId = ? OR inviteeId = ?').run(targetId, targetId)
      stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(targetId, targetId)
      stmtCache.get('DELETE FROM unread_counts WHERE userId = ?').run(targetId)
      stmtCache.get('DELETE FROM verification_codes WHERE target = (SELECT email FROM users WHERE id = ?)').run(targetId)
      stmtCache.get('DELETE FROM users WHERE id = ?').run(targetId)
    })
    cleanup()

    console.log(`[admin] 管理员 ${adminId} 删除了用户 ${targetId} (${user.username})`)
    res.json({ success: true, message: `用户 ${user.username} 已被删除` })
  } catch (error: any) {
    console.error('[admin-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 管理员登录为其他用户（无需密码）
router.post('/impersonate', (req: Request, res: Response): void => {
  try {
    const adminId = (req as any).user.id
    const targetId = parseInt(req.body.targetId as string)

    if (!targetId) {
      res.status(400).json({ success: false, error: '请指定目标用户ID' })
      return
    }

    if (targetId === adminId) {
      res.status(400).json({ success: false, error: '不能登录为自己的账号' })
      return
    }

    const user = stmtCache
      .get('SELECT id, username, avatar, bio, gender, region, vip, vipExpiresAt, isOfficial, email, phone FROM users WHERE id = ? AND active = 1')
      .get(targetId) as any

    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在或已注销' })
      return
    }

    const token = jwt.sign({ id: user.id, username: user.username, isOfficial: user.isOfficial || 0 }, JWT_SECRET, { expiresIn: '7d' })

    const nowIso = new Date().toISOString()
    const vip = user.vip === 1 && user.vipExpiresAt && user.vipExpiresAt > nowIso ? 1 : 0

    console.log(`[admin] 管理员 ${adminId} 登录为用户 ${targetId} (${user.username})`)

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar || '',
        bio: user.bio || '',
        gender: user.gender || '',
        region: user.region || '',
        vip,
        isOfficial: user.isOfficial || 0,
        email: user.email || '',
        phone: user.phone || '',
      },
      token,
    })
  } catch (error: any) {
    console.error('[admin-impersonate]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router