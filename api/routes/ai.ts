/**
 * AI 聊天路由（DeepSeek）
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './auth.js'

const router = Router()

// JWT 验证中间件
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

const AI_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-7d368b78d1d241c1afbc7a6fdbac55d9'
const AI_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/**
 * 与 AI 对话
 * POST /api/ai/chat
 */
router.post('/chat', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body

    if (!message || !message.trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: message },
        ],
        stream: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('DeepSeek API error:', response.status, errorText)
      res.status(502).json({ success: false, error: 'AI 服务暂不可用，请稍后再试' })
      return
    }

    const data = await response.json() as any
    const reply = data.choices?.[0]?.message?.content || '抱歉，我没有理解你的问题。'

    res.json({ success: true, reply })
  } catch (error) {
    console.error('AI chat error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router