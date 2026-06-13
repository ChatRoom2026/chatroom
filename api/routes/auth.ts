/**
 * 用户认证路由
 */
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'
const JWT_EXPIRES = '7d'

/**
 * 验证验证码有效性
 */
function verifyCode(target: string, code: string, type: string = 'register'): { valid: boolean; error?: string } {
  const record = db.prepare(`
    SELECT id, code, expiresAt FROM verification_codes
    WHERE target = ? AND type = ? AND used = 0
    ORDER BY createdAt DESC LIMIT 1
  `).get(target, type) as any

  if (!record) {
    return { valid: false, error: '请先获取验证码' }
  }

  if (new Date(record.expiresAt) < new Date()) {
    return { valid: false, error: '验证码已过期，请重新获取' }
  }

  if (record.code !== code) {
    return { valid: false, error: '验证码错误' }
  }

  // 标记为已使用
  db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(record.id)
  return { valid: true }
}

/**
 * 用户注册
 * POST /api/auth/register
 * Body: { username, email, password, code }
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, code } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ success: false, error: '用户名、邮箱和密码不能为空' })
      return
    }

    if (username.length < 2 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度需在2-20个字符之间' })
      return
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: '密码长度不能少于6个字符' })
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: '请输入正确的邮箱格式' })
      return
    }

    // 验证邮箱验证码
    if (!code) {
      res.status(400).json({ success: false, error: '请输入验证码' })
      return
    }

    const verification = verifyCode(email, code)
    if (!verification.valid) {
      res.status(400).json({ success: false, error: verification.error })
      return
    }

    const activeUser = db.prepare('SELECT id FROM users WHERE username = ? AND active = 1').get(username)
    if (activeUser) {
      res.status(400).json({ success: false, error: '用户名已存在' })
      return
    }

    const emailActive = db.prepare('SELECT id FROM users WHERE email = ? AND active = 1').get(email)
    if (emailActive) {
      res.status(400).json({ success: false, error: '该邮箱已被注册' })
      return
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // 如果存在已注销的同名用户，彻底清除旧记录（好友关系、聊天记录）
    const deactivatedUser = db.prepare('SELECT id FROM users WHERE username = ? AND active = 0').get(username) as any

    if (deactivatedUser) {
      const oldId = deactivatedUser.id
      const cleanup = db.transaction(() => {
        db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(oldId, oldId)
        db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(oldId, oldId)
        db.prepare('DELETE FROM users WHERE id = ?').run(oldId)
      })
      cleanup()
    }

    // 创建全新账号
    const result = db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)')
      .run(username, hashedPassword, email)
    const userId = result.lastInsertRowid as number

    const token = jwt.sign(
      { id: userId, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    )

    res.status(201).json({
      success: true,
      user: { id: userId, username, email, avatar: '' },
      token,
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 用户登录（支持用户名/手机号/邮箱）
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { loginId, password } = req.body

    if (!loginId || !password) {
      res.status(400).json({ success: false, error: '请输入账号和密码' })
      return
    }

    const user = db.prepare(`
      SELECT id, username, password, phone, email, avatar FROM users
      WHERE (username = ? OR phone = ? OR email = ?) AND active = 1
    `).get(loginId, loginId, loginId) as any

    if (!user) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    )

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone || '',
        email: user.email || '',
        avatar: user.avatar || '',
      },
      token,
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export { JWT_SECRET }
export default router