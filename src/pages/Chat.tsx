import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { api, type Message } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, Send, Paperclip, Image, FileText, Ban, X } from 'lucide-react'

export default function Chat() {
  const { friendId } = useParams<{ friendId: string }>()
  const navigate = useNavigate()
  const [friend, setFriend] = useState<{ id: number; username: string; avatar?: string; active?: number } | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const user = useAuthStore((s) => s.user)
  const messages = useChatStore((s) => s.messages)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const addMessage = useChatStore((s) => s.addMessage)
  const typingUsers = useChatStore((s) => s.typingUsers)
  const setTypingUser = useChatStore((s) => s.setTypingUser)

  const fid = Number(friendId)
  const friendMessages = messages[fid] || []
  const isTyping = typingUsers[fid] || false

  // 加载好友信息和聊天记录
  useEffect(() => {
    if (!fid) return

    // 加载好友信息
    api.getFriends().then((res) => {
      const f = res.friends.find((fr) => fr.id === fid)
      if (f) setFriend(f)
    })

    // 加载聊天记录
    setLoading(true)
    loadMessages(fid).finally(() => setLoading(false))
  }, [fid, loadMessages])

  // Socket 监听
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewMessage = (message: Message) => {
      addMessage(message)
    }

    const handleTypingStatus = (data: { userId: number; username: string; isTyping: boolean }) => {
      setTypingUser(data.userId, data.isTyping)
    }

    socket.on('new_message', handleNewMessage)
    socket.on('typing_status', handleTypingStatus)

    return () => {
      socket.off('new_message', handleNewMessage)
      socket.off('typing_status', handleTypingStatus)
    }
  }, [addMessage, setTypingUser])

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [friendMessages])

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending || !fid) return

    const socket = getSocket()
    if (!socket) return

    setSending(true)
    const content = text.trim()
    setText('')

    socket.emit('send_message', {
      receiverId: fid,
      content,
      type: 'text',
    })

    setSending(false)
  }, [text, sending, fid])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 发送正在输入状态
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)

    const socket = getSocket()
    if (!socket || !fid) return

    socket.emit('typing', { receiverId: fid, isTyping: true })

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      socket.emit('typing', { receiverId: fid, isTyping: false })
    }, 2000)
  }

  // 发送图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !fid) return

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }

    setSending(true)
    try {
      const res = await api.uploadFile(file)
      const socket = getSocket()
      if (socket) {
        socket.emit('send_message', {
          receiverId: fid,
          content: file.name,
          type: 'image',
          fileUrl: res.url,
        })
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  // 发送文档
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !fid) return

    setSending(true)
    try {
      const res = await api.uploadFile(file)
      const socket = getSocket()
      if (socket) {
        socket.emit('send_message', {
          receiverId: fid,
          content: res.originalName || file.name,
          type: 'file',
          fileUrl: res.url,
        })
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 格式化时间
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (!fid) return null

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/friends')}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative">
          {friend?.avatar ? (
            <img src={friend.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold">
              {friend?.username?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>
        <div>
          <h2 className="text-white font-semibold">{friend?.username || '加载中...'}</h2>
          {friend?.active === 0 ? (
            <p className="text-xs text-red-400/80">已注销 · 不可聊天</p>
          ) : (
            <p className="text-xs text-gray-400">
              {isTyping ? '正在输入...' : useChatStore.getState().onlineUsers.includes(fid) ? '在线' : '离线'}
            </p>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="space-y-4 pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'} animate-pulse`}>
                <div className={`h-10 ${i % 2 === 0 ? 'bg-blue-600/30 w-32' : 'bg-gray-700 w-40'} rounded-2xl`} />
              </div>
            ))}
          </div>
        ) : friendMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">开始聊天吧</p>
          </div>
        ) : (
          friendMessages.map((msg) => {
            const isMine = msg.senderId === user?.id
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] ${isMine ? 'order-1' : 'order-1'}`}>
                  {msg.type === 'text' && (
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        isMine
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-[#1E293B] text-gray-200 rounded-bl-md'
                      }`}
                    >
                      {msg.content}
                    </div>
                  )}
                  {msg.type === 'image' && (
                    <div className="space-y-1">
                      <button onClick={() => setPreviewImage(msg.fileUrl)} className="block w-full text-left">
                        <img
                          src={msg.fileUrl}
                          alt={msg.content}
                          className="max-w-60 rounded-2xl hover:opacity-90 transition-opacity cursor-pointer"
                          loading="lazy"
                        />
                      </button>
                      <p className={`text-xs text-gray-400 ${isMine ? 'text-right' : 'text-left'}`}>
                        {msg.content}
                      </p>
                    </div>
                  )}
                  {msg.type === 'file' && (
                    <div
                      className={`px-4 py-3 rounded-2xl flex items-center gap-3 ${
                        isMine ? 'bg-blue-600 text-white' : 'bg-[#1E293B] text-gray-200'
                      }`}
                    >
                      <FileText className="w-8 h-8 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{msg.content}</p>
                        <a
                          href={msg.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-xs underline ${isMine ? 'text-blue-200' : 'text-blue-400'}`}
                        >
                          下载文件
                        </a>
                      </div>
                    </div>
                  )}
                  <p className={`text-xs text-gray-600 mt-1 ${isMine ? 'text-right' : 'text-left'}`}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            )
          })
        )}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-[#1E293B] px-4 py-2.5 rounded-2xl rounded-bl-md">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-[#1E293B] border-t border-gray-800 px-4 py-3">
        {friend?.active === 0 ? (
          <div className="flex items-center gap-2 justify-center py-2">
            <Ban className="w-4 h-4 text-red-400/60" />
            <p className="text-sm text-red-400/60">该用户已注销，无法发送消息</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => imageInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="发送图片"
            >
              <Image className="w-5 h-5" />
            </button>
            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="发送文件"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />

            <input
              type="text"
              value={text}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="输入消息..."
              disabled={sending}
            />

            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-xl transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 text-white hover:text-gray-300 bg-black/50 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt="预览"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}