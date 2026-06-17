/**
 * VIP 路由 - 模拟支付
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

// VIP 套餐
const VIP_PLANS = [
  { id: 'hourly', name: '1小时体验', price: 0.01, days: 1 / 24, badge: '尝鲜' },
  { id: 'weekly', name: '7天会员', price: 2.9, days: 7, badge: '体验' },
  { id: 'monthly', name: '月度会员', price: 6.9, days: 30, badge: '推荐' },
  { id: 'quarterly', name: '季度会员', price: 15.9, days: 90, badge: '热销' },
  { id: 'yearly', name: '年度会员', price: 29.9, days: 365, badge: '最划算' },
]

/**
 * 获取套餐列表
 * GET /api/vip/plans
 */
router.get('/plans', (_req: Request, res: Response): void => {
  res.json({ success: true, plans: VIP_PLANS })
})

/**
 * 获取 VIP 状态
 * GET /api/vip/status
 */
router.get('/status', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const user = db.prepare('SELECT vip, vipExpiresAt FROM users WHERE id = ?').get(userId) as any

    const now = new Date().toISOString()
    const isVip = user.vip === 1 && user.vipExpiresAt && user.vipExpiresAt > now

    if (user.vip === 1 && (!user.vipExpiresAt || user.vipExpiresAt <= now)) {
      db.prepare('UPDATE users SET vip = 0, vipExpiresAt = NULL WHERE id = ?').run(userId)
    }

    res.json({
      success: true,
      vip: isVip ? 1 : 0,
      expiresAt: isVip ? user.vipExpiresAt : null,
    })
  } catch (error) {
    console.error('VIP status error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 创建支付订单（模拟支付）
 * POST /api/vip/pay
 */
router.post('/pay', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { planId } = req.body

    const plan = VIP_PLANS.find((p) => p.id === planId)
    if (!plan) {
      res.status(400).json({ success: false, error: '无效的套餐' })
      return
    }

    // 生成唯一订单号
    const outTradeNo = `VIP${Date.now()}${userId}`

    // 保存订单到数据库
    db.prepare(
      'INSERT INTO vip_orders (userId, planId, amount, outTradeNo, status) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, planId, plan.price, outTradeNo, 'pending')

    // 模拟支付，直接返回成功
    res.json({
      success: true,
      mock: true,
      outTradeNo,
      plan,
    })
  } catch (error) {
    console.error('Pay error:', error)
    res.status(500).json({ success: false, error: '支付失败' })
  }
})

/**
 * 查询订单状态
 * POST /api/vip/check
 */
router.post('/check', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { outTradeNo } = req.body

    const order = db.prepare(
      'SELECT * FROM vip_orders WHERE outTradeNo = ? AND userId = ?'
    ).get(outTradeNo, userId) as any

    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' })
      return
    }

    res.json({
      success: true,
      status: order.status,
      paid: order.status === 'paid',
    })
  } catch (error) {
    console.error('Check order error:', error)
    res.status(500).json({ success: false, error: '查询失败' })
  }
})

/**
 * 手动确认支付（模拟支付）
 * POST /api/vip/confirm
 */
router.post('/confirm', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { outTradeNo } = req.body

    const order = db.prepare(
      'SELECT * FROM vip_orders WHERE outTradeNo = ? AND userId = ?'
    ).get(outTradeNo, userId) as any

    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' })
      return
    }

    if (order.status === 'paid') {
      const user = db.prepare('SELECT vipExpiresAt FROM users WHERE id = ?').get(userId) as any
      res.json({
        success: true,
        message: 'VIP 已开通',
        vip: 1,
        expiresAt: user.vipExpiresAt,
      })
      return
    }

    // 激活 VIP
    const plan = VIP_PLANS.find((p) => p.id === order.planId)
    if (!plan) {
      res.status(400).json({ success: false, error: '订单数据异常' })
      return
    }

    const existing = db.prepare('SELECT vipExpiresAt FROM users WHERE id = ?').get(userId) as any
    const now = new Date()
    const startDate = existing.vipExpiresAt && new Date(existing.vipExpiresAt) > now
      ? new Date(existing.vipExpiresAt) : now

    const expiresAt = new Date(startDate.getTime() + plan.days * 24 * 60 * 60 * 1000)

    const activate = db.transaction(() => {
      db.prepare('UPDATE users SET vip = 1, vipExpiresAt = ? WHERE id = ?').run(expiresAt.toISOString(), userId)
      db.prepare('UPDATE vip_orders SET status = ? WHERE outTradeNo = ?').run('paid', outTradeNo)
    })
    activate()

    res.json({
      success: true,
      message: 'VIP 开通成功！',
      vip: 1,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Confirm payment error:', error)
    res.status(500).json({ success: false, error: '开通失败' })
  }
})

export default router