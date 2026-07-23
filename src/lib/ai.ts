/**
 * 屿岸 AI 问答客户端
 * 简单的聊天 API
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 发送消息，获取 AI 回复
 */
export async function sendChatMessage(
  message: string,
  history: ChatMessage[] = []
): Promise<{ success: boolean; reply?: string; error?: string }> {
  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    })
    const data = await resp.json()
    if (data.success) {
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
export async function checkAIStatus(): Promise<{ online: boolean; model?: string }> {
  try {
    const resp = await fetch('/api/ai/status')
    const data = await resp.json()
    return { online: data.success, model: data.model }
  } catch {
    return { online: false }
  }
}