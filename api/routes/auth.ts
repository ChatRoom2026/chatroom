/**
 * 用户认证路由 —— 单核极限优化版
 *
 * 优化：
 *  - bcrypt cost 8（10 太贵，单核下 8 已足够安全且快 2x）
 *  - 所有 SQL 使用 stmtCache 预编译
 *  - 登录查询只查必要字段，不读冗余列
 *  - 人脸登录：基于感知哈希 (dHash) + 注册时的 faceDescriptor
 *  - 修改密码：需要登录态 + 校验旧密码
 */
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db, { stmtCache } from '../db.js'
import { authMiddleware, JWT_SECRET } from '../middleware/auth.js'

const router = Router()
const JWT_EXPIRES = '7d'
const BCRYPT_COST = 8 // 单核下 cost 10 ~180ms，cost 8 ~50ms，对普通用户足够安全

/**
 * 发送好友请求（验证码发送/校验 —— 简单实现，走 stmtCache）
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' })
      return
    }
    if (username.length < 2 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度需在 2-20 之间' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, error: '密码长度不能少于 6 个字符' })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: '邮箱格式不正确' })
      return
    }

    const userExists = stmtCache.get('SELECT id FROM users WHERE username = ? AND active = 1').get(username) as any
    if (userExists) {
      res.status(400).json({ success: false, error: '用户名已存在' })
      return
    }

    if (email) {
      const emailExists = stmtCache.get('SELECT id FROM users WHERE email = ? AND active = 1').get(email) as any
      if (emailExists) {
        res.status(400).json({ success: false, error: '该邮箱已被注册' })
        return
      }
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

    // 如果存在已注销的同名用户，彻底清除旧记录
    const deactivated = stmtCache.get('SELECT id FROM users WHERE username = ? AND active = 0').get(username) as any
    if (deactivated) {
      const tx = db.transaction((oldId: number) => {
        stmtCache.get('DELETE FROM comments WHERE userId = ?').run(oldId)
        stmtCache.get('DELETE FROM posts WHERE userId = ?').run(oldId)
        stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(oldId, oldId)
        stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(oldId, oldId)
        stmtCache.get('DELETE FROM group_members WHERE userId = ?').run(oldId)
        stmtCache.get('DELETE FROM group_invitations WHERE inviterId = ? OR inviteeId = ?').run(oldId, oldId)
        stmtCache.get('DELETE FROM users WHERE id = ?').run(oldId)
      })
      tx(deactivated.id)
    }

    const insertResult = stmtCache
      .get('INSERT INTO users (username, password, email) VALUES (?, ?, ?)')
      .run(username, hashedPassword, email || '')
    const userId = insertResult.lastInsertRowid as number

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    res.status(201).json({
      success: true,
      user: { id: userId, username, email: email || '', avatar: '', bio: '', gender: '', region: '', vip: 0 },
      token,
    })
  } catch (error: any) {
    console.error('[register]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 用户登录（支持用户名/手机号/邮箱）
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { loginId, password } = req.body
    if (!loginId || !password) {
      res.status(400).json({ success: false, error: '请输入账号和密码' })
      return
    }

    const user = stmtCache
      .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt, isOfficial
           FROM users
           WHERE (username = ? OR phone = ? OR email = ?) AND active = 1`)
      .get(loginId, loginId, loginId) as any

    if (!user) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const token = jwt.sign({ id: user.id, username: user.username, isOfficial: user.isOfficial || 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    const nowIso = new Date().toISOString()
    const vip = user.vip === 1 && user.vipExpiresAt && user.vipExpiresAt > nowIso ? 1 : 0

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone || '',
        email: user.email || '',
        avatar: user.avatar || '',
        bio: user.bio || '',
        gender: user.gender || '',
        region: user.region || '',
        vip,
        isOfficial: user.isOfficial || 0,
      },
      token,
    })
  } catch (error: any) {
    console.error('[login]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 人脸登录 / 注册 ====================
// 策略：由前端采集人脸图像后生成描述符（如 128 维特征向量或简化 dHash）
// 本后端存储 faceDescriptor（字符串形式），比较时用余弦相似度

// 工具：解析描述符字符串 "0.12,0.34,..." 为 number[]
function parseDescriptor(s: string | null | undefined): number[] | null {
  if (!s) return null
  const arr = s
    .split(',')
    .map((x) => parseFloat(x.trim()))
    .filter((x) => Number.isFinite(x))
  return arr.length >= 4 ? arr : null
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  if (d === 0) return 0
  return dot / d
}

/**
 * 根据描述符维度自适应阈值
 * - FaceNet 128 维嵌入：阈值 0.6（深度学习模型，精度高）
 * - 传统 64 维灰度特征：阈值 0.85（手工特征，需更高阈值防误识）
 */
function getThreshold(descriptor: number[]): number {
  return descriptor.length >= 100 ? 0.6 : 0.85
}

// 1) 为人脸注册或更新描述符（需要已登录）
router.post('/face/register', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { faceDescriptor } = req.body
    const parsed = parseDescriptor(faceDescriptor)
    if (!parsed) {
      res.status(400).json({ success: false, error: '无效的人脸特征数据' })
      return
    }
    const descriptor = parsed.map((x) => Math.round(x * 10000) / 10000).join(',')
    stmtCache
      .get('UPDATE users SET faceDescriptor = ? WHERE id = ?')
      .run(descriptor, userId)
    res.json({ success: true, message: '人脸信息已保存，可用于登录' })
  } catch (error: any) {
    console.error('[face-register]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 2) 人脸登录：用户提供描述符 + 用户名（可选）
//    - 有用户名：只在该用户的描述符上匹配，相似度 > 阈值即通过
//    - 无用户名：在全部用户描述符上匹配（N 个用户线性扫描，用户量 > 1000 请使用向量数据库）
//    - 阈值默认 0.85（余弦相似度），可以调
router.post('/face/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, faceDescriptor } = req.body
    const parsed = parseDescriptor(faceDescriptor)
    if (!parsed) {
      res.status(400).json({ success: false, error: '无效的人脸特征数据' })
      return
    }

    const threshold = getThreshold(parsed)
    let matchedUser: any = null
    let bestScore = threshold

    if (username) {
      const row = stmtCache
        .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt, faceDescriptor
             FROM users WHERE username = ? AND active = 1`)
        .get(username) as any
      if (row && row.faceDescriptor) {
        const stored = parseDescriptor(row.faceDescriptor)
        if (stored) {
          const score = cosineSimilarity(parsed, stored)
          if (score > bestScore) {
            bestScore = score
            matchedUser = row
          }
        }
      }
    } else {
      // 全表扫描，取最匹配者
      const rows = stmtCache
        .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt, faceDescriptor
             FROM users WHERE active = 1 AND faceDescriptor IS NOT NULL AND faceDescriptor != ''`)
        .all() as any[]
      for (let i = 0; i < rows.length; i++) {
        const stored = parseDescriptor(rows[i].faceDescriptor)
        if (!stored) continue
        const score = cosineSimilarity(parsed, stored)
        if (score > bestScore) {
          bestScore = score
          matchedUser = rows[i]
        }
      }
    }

    if (!matchedUser) {
      res.status(401).json({ success: false, error: '未找到匹配的人脸，请先注册或重试' })
      return
    }

    const token = jwt.sign({ id: matchedUser.id, username: matchedUser.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    const nowIso = new Date().toISOString()
    const vip = matchedUser.vip === 1 && matchedUser.vipExpiresAt && matchedUser.vipExpiresAt > nowIso ? 1 : 0

    res.json({
      success: true,
      score: Math.round(bestScore * 10000) / 10000,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        phone: matchedUser.phone || '',
        email: matchedUser.email || '',
        avatar: matchedUser.avatar || '',
        bio: matchedUser.bio || '',
        gender: matchedUser.gender || '',
        region: matchedUser.region || '',
        vip,
      },
      token,
    })
  } catch (error: any) {
    console.error('[face-login]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 修改密码（支持多因素验证） ====================
// 验证方式：
//  1. old_password - 旧密码验证
//  2. email_code - 邮箱验证码（需先绑定邮箱）
//  3. face - 人脸识别验证（需已注册人脸）
interface VerificationCode {
  code: string
  email: string
  expiresAt: number
}
const codeStore = new Map<string, VerificationCode>()

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// 发送邮箱验证码（用于修改密码）
router.post('/password/send-code', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { email } = req.body

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: '请输入有效的邮箱地址' })
      return
    }

    // 检查邮箱是否已绑定到当前用户或需要更新邮箱
    const user = stmtCache.get('SELECT id, email FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const code = generateCode()
    const codeKey = `pwd_${userId}`
    codeStore.set(codeKey, {
      code,
      email: email.trim(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5分钟有效期
    })

    // 清理过期验证码
    for (const [k, v] of codeStore.entries()) {
      if (v.expiresAt < Date.now()) codeStore.delete(k)
    }

    console.log(`[password-code] 用户 ${userId} 邮箱 ${email} 验证码: ${code}`)
    // 生产环境不返回验证码明文
    res.json({
      success: true,
      sent: true,
      message: `验证码已发送到 ${email}`,
      ...(process.env.NODE_ENV !== 'production' ? { code } : {}),
    })
  } catch (error: any) {
    console.error('[password-send-code]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 修改密码（支持多种验证方式）
router.post('/password/change', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { oldPassword, newPassword, verifyMethod, email, code, faceDescriptor } = req.body

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ success: false, error: '新密码长度不能少于 6 个字符' })
      return
    }

    const user = stmtCache.get('SELECT id, password, email, faceDescriptor FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    let verified = false

    switch (verifyMethod) {
      case 'old_password': {
        if (!oldPassword) {
          res.status(400).json({ success: false, error: '请输入旧密码' })
          return
        }
        const isMatch = await bcrypt.compare(oldPassword, user.password)
        if (!isMatch) {
          res.status(401).json({ success: false, error: '旧密码不正确' })
          return
        }
        verified = true
        break
      }

      case 'email_code': {
        if (!email || !code) {
          res.status(400).json({ success: false, error: '请提供邮箱和验证码' })
          return
        }
        const codeKey = `pwd_${userId}`
        const stored = codeStore.get(codeKey)
        if (!stored || stored.expiresAt < Date.now()) {
          codeStore.delete(codeKey)
          res.status(400).json({ success: false, error: '验证码已过期，请重新获取' })
          return
        }
        if (stored.email !== email.trim() || stored.code !== code.trim()) {
          res.status(401).json({ success: false, error: '验证码不正确' })
          return
        }
        // 验证成功，同时更新用户邮箱
        if (email.trim() !== user.email) {
          stmtCache.get('UPDATE users SET email = ? WHERE id = ?').run(email.trim(), userId)
        }
        codeStore.delete(codeKey)
        verified = true
        break
      }

      case 'face': {
        const parsed = parseDescriptor(faceDescriptor)
        if (!parsed) {
          res.status(400).json({ success: false, error: '无效的人脸特征数据' })
          return
        }
        const storedFace = parseDescriptor(user.faceDescriptor)
        if (!storedFace) {
          res.status(400).json({ success: false, error: '您尚未注册人脸信息，请使用其他验证方式' })
          return
        }
        const score = cosineSimilarity(parsed, storedFace)
        const faceThreshold = getThreshold(parsed)
        if (score < faceThreshold) {
          res.status(401).json({ success: false, error: '人脸验证失败，请重试' })
          return
        }
        verified = true
        break
      }

      default:
        res.status(400).json({ success: false, error: '请选择验证方式' })
        return
    }

    if (!verified) {
      res.status(401).json({ success: false, error: '验证失败' })
      return
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    stmtCache.get('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId)

    res.json({ success: true, message: '密码修改成功，请使用新密码登录' })
  } catch (error: any) {
    console.error('[password-change]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 旧接口兼容 - 保持向后兼容
router.post('/password', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  req.body.verifyMethod = 'old_password'
  // 直接调用密码修改逻辑
  try {
    const userId = (req as any).user.id as number
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword) {
      res.status(400).json({ success: false, error: '请提供旧密码和新密码' })
      return
    }
    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: '新密码长度不能少于 6 个字符' })
      return
    }
    const user = stmtCache.get('SELECT id, password FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }
    const isMatch = await bcrypt.compare(oldPassword, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '旧密码不正确' })
      return
    }
    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    stmtCache.get('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId)
    res.json({ success: true, message: '密码修改成功，请使用新密码登录' })
  } catch (error: any) {
    console.error('[password-update]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 忘记密码 ====================
// 需要提供验证码（通过 /api/verification/send 获取）
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, newPassword, code, target } = req.body
    if (!username || !newPassword || !code || !target) {
      res.status(400).json({ success: false, error: '请提供用户名、新密码、验证码和验证目标' })
      return
    }
    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: '新密码长度不能少于 6 个字符' })
      return
    }

    const user = stmtCache.get('SELECT id, username FROM users WHERE username = ?').get(username.trim()) as any
    if (!user) {
      res.status(404).json({ success: false, error: '未找到该用户，请检查用户名是否正确' })
      return
    }

    // 校验验证码
    const vc = stmtCache
      .get('SELECT code, expiresAt, used FROM verification_codes WHERE target = ? AND type = ? AND code = ? ORDER BY id DESC LIMIT 1')
      .get(target, 'reset_password', code) as any
    if (!vc) {
      res.status(400).json({ success: false, error: '验证码错误' })
      return
    }
    if (vc.used) {
      res.status(400).json({ success: false, error: '验证码已使用' })
      return
    }
    if (new Date(vc.expiresAt) < new Date()) {
      res.status(400).json({ success: false, error: '验证码已过期' })
      return
    }

    // 标记验证码已使用
    stmtCache.get('UPDATE verification_codes SET used = 1 WHERE target = ? AND code = ?').run(target, code)

    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    stmtCache.get('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id)

    res.json({ success: true, message: '密码已重置成功，请使用新密码登录' })
  } catch (error: any) {
    console.error('[forgot-password]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
