import { useState, useEffect, useRef } from 'react'
import { chatWithAI, checkAIStatus } from '../lib/ai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  time: string
}

interface Props {
  onClose: () => void
}

export default function AIPanel({ onClose }: Props) {
  const [input, setInput] = useState('')
  const [aiOnline, setAiOnline] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    checkAIStatus().then((r) => setAiOnline(r.online))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setError('')
    setLoading(true)

    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    setMessages((prev) => [...prev, { role: 'user', content: msg, time: now }])

    const result = await chatWithAI(msg)
    if (result.success && result.reply) {
      const replyTime = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply!, time: replyTime }])
    } else {
      setError(result.error || '回复失败')
    }
    setLoading(false)
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <h3>屿岸</h3>
        <div className="ai-panel-header-right">
          <span className={`ai-status-dot ${aiOnline ? 'online' : aiOnline === false ? 'offline' : 'checking'}`} />
          <span className="ai-status-text">
            {aiOnline === null ? '检测中...' : aiOnline ? '在线' : '离线'}
          </span>
          <button className="ai-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="ai-panel-tasks">
        {messages.length === 0 && (
          <div className="ai-empty">
            <p>和屿岸聊聊天吧</p>
            <p className="ai-examples">
              你可以问我任何问题，比如新闻、知识、建议等
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-chat-msg ${m.role}`}>
            <div className="ai-chat-bubble">{m.content}</div>
            <div className="ai-chat-time">{m.time}</div>
          </div>
        ))}
        {loading && (
          <div className="ai-chat-msg assistant">
            <div className="ai-chat-bubble">
              <span className="ai-typing-dots">
                <span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          </div>
        )}
        {error && <div className="ai-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-panel-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="和屿岸说点什么..."
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? '...' : '发送'}
        </button>
      </div>
    </div>
  )
}