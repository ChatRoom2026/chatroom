/**
 * 屿岸 AI 助手客户端
 * 通过 HTTP 调用 AI 聊天服务
 */

/**
 * 发送消息给 AI 并获取回复
 */
export async function chatWithAI(message: string): Promise<{ success: boolean; reply?: string; error?: string }> {
  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
    })
    const data = await resp.json()
    if (data.success && data.reply) {
      return { success: true, reply: data.reply }
    }
    return { success: false, error: data.error || 'AI 回复失败' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * 检查 AI 服务状态
 */
export async function checkAIStatus(): Promise<{ online: boolean }> {
  try {
    const resp = await fetch('/api/ai/status')
    const data = await resp.json()
    return { online: data.success }
  } catch {
    return { online: false }
  }
}