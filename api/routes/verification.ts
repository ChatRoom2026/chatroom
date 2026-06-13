/**
 * 验证码路由
 * 提供发送和验证邮箱验证码的 API
 */
import { Router, type Request, type Response } from 'express'
import db from '../db.js'
import { sendVerificationEmail } from '../services/email.js'

const router = Router()

// 验证码有效期（分钟）
const CODE_EXPIRY_MINUTES = 10

// 发送间隔限制（秒）
const SEND_COOLDOWN_SECONDS = 60

/**
 * 生成 6 位数字验证码
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * 发送验证码
 * POST /api/verification/send
 * Body: { target: string, type?: string }
 */
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { target, type = 'register' } = req.body

    if (!target) {
      res.status(400).json({ success: false, error: '请输入邮箱地址' })
      return
    }

    // 验证邮箱格式
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      res.status(400).json({ success: false, error: '请输入正确的邮箱格式' })
      return
    }

    // 检查发送频率限制
    const recent = db.prepare(`
      SELECT createdAt FROM verification_codes
      WHERE target = ? AND type = ?
      ORDER BY createdAt DESC LIMIT 1
    `).get(target, type) as any

    if (recent) {
      const lastTime = new Date(recent.createdAt).getTime()
      const now = Date.now()
      const diff = (now - lastTime) / 1000
      if (diff < SEND_COOLDOWN_SECONDS) {
        const remaining = Math.ceil(SEND_COOLDOWN_SECONDS - diff)
        res.status(429).json({
          success: false,
          error: `请求过于频繁，请 ${remaining} 秒后重试`,
        })
        return
      }
    }

    // 生成验证码并保存
    const code = generateCode()
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString()

    db.prepare(`
      INSERT INTO verification_codes (target, code, type, expiresAt)
      VALUES (?, ?, ?, ?)
    `).run(target, code, type, expiresAt)

    // 发送邮件（带超时）
    let sent = false
    try {
      sent = await Promise.race([
        sendVerificationEmail(target, code),
        new Promise<false>((_, reject) =>
          setTimeout(() => reject(new Error('发送超时')), 8000)
        ),
      ])
    } catch (e) {
      console.log(`邮件发送失败（环境限制），验证码 ${code} 用于 ${target}`)
    }

    res.json({
      success: true,
      sent,
      code: sent ? undefined : code, // 发送失败时返回验证码方便调试
      message: sent ? '验证码已发送到邮箱' : `验证码已生成（邮件服务暂不可用，调试验证码：${code}）`,
    })
  } catch (error) {
    console.error('Send verification code error:', error)
    res.status(500).json({ success: false, error: '发送验证码失败' })
  }
})

/**
 * 验证验证码
 * POST /api/verification/verify
 * Body: { target: string, code: string, type?: string }
 */
router.post('/verify', (req: Request, res: Response): void => {
  try {
    const { target, code, type = 'register' } = req.body

    if (!target || !code) {
      res.status(400).json({ success: false, error: '缺少邮箱或验证码' })
      return
    }

    // 查找未使用的有效验证码
    const record = db.prepare(`
      SELECT id, code, expiresAt FROM verification_codes
      WHERE target = ? AND type = ? AND used = 0
      ORDER BY createdAt DESC LIMIT 1
    `).get(target, type) as any

    if (!record) {
      res.status(400).json({ success: false, error: '请先获取验证码' })
      return
    }

    // 检查是否过期
    if (new Date(record.expiresAt) < new Date()) {
      res.status(400).json({ success: false, error: '验证码已过期，请重新获取' })
      return
    }

    // 检查验证码是否匹配
    if (record.code !== code) {
      res.status(400).json({ success: false, error: '验证码错误' })
      return
    }

    // 标记为已使用
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(record.id)

    res.json({ success: true, message: '验证成功' })
  } catch (error) {
    console.error('Verify code error:', error)
    res.status(500).json({ success: false, error: '验证失败' })
  }
})

export default router