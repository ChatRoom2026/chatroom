/**
 * AI 问答路由
 * Node.js <-> Python AI 服务通信
 */
import { Router, type Request, type Response } from 'express'
import fetch from 'node-fetch'

const router = Router()

const AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://localhost:3002'

/**
 * 检查服务状态
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${AGENT_URL}/health`)
    const data = await resp.json()
    res.json({ success: true, ...data })
  } catch (err: any) {
    res.json({ success: false, error: 'AI 服务未启动', details: err.message })
  }
})

/**
 * 发送消息，获取 AI 回复
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body

    if (!message || !message.trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    const response = await fetch(`${AGENT_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.trim(),
        history: history || [],
      }),
    })

    const data = await response.json()

    if (response.ok && data.reply) {
      res.json({ success: true, reply: data.reply })
    } else {
      res.status(500).json({ success: false, error: data.error || 'AI 回复失败' })
    }
  } catch (err: any) {
    console.error('[ai/chat]', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router