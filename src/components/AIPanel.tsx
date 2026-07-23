import { useState, useEffect, useRef } from 'react'
import { sendChatMessage, checkAIStatus, type ChatMessage } from '../lib/ai'

interface Props {
  onClose: () => void
}

export default function AIPanel({ onClose }: Props) {
  const [input, setInput] = useState('')
  const [aiOnline, setAiOnline] = useState<boolean | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    checkAIStatus().then((r) => setAiOnline(r.online))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError('')

    const userMsg: ChatMessage = { role: 'user', content: text }
    setHistory((prev) => [...prev, userMsg])
    setLoading(true)

    const result = await sendChatMessage(text, history)
    setLoading(false)

    if (result.success && result.reply) {
      setHistory((prev) => [...prev, { role: 'assistant', content: result.reply }])
    } else {
      setError(result.error || '回复失败')
    }
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
        {history.length === 0 && (
          <div className="ai-empty">
            <p>你好，我是屿岸</p>
            <p className="ai-examples">有什么想问的，尽管问我</p>
          </div>
        )}
        {history.map((msg, i) => (
          <div key={i} className={`ai-chat-msg ${msg.role}`}>
            <div className="ai-chat-bubble">
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="ai-chat-msg assistant">
            <div className="ai-chat-bubble thinking">
              <span className="ai-dot" />
              <span className="ai-dot" />
              <span className="ai-dot" />
            </div>
          </div>
        )}
        {error && <div className="ai-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-panel-input">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="输入消息..."
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? '...' : '发送'}
        </button>
      </div>
    </div>
  )
}