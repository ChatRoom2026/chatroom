import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Notification } from '@/lib/api'
import { ArrowLeft, MessageCircle, Reply, Bell, Shield } from 'lucide-react'

export default function Notifications() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getNotifications()
      setNotifications(res.notifications)
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  const handleClick = async (n: Notification) => {
    if (!n.isRead) {
      try { await api.markNotificationRead(n.id) } catch {}
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, isRead: 1 } : item))
      )
    }
    if (n.type === 'system') return
    navigate(`/moments?highlightPost=${n.postId}&highlightComment=${n.commentId || ''}`)
  }

  const handleMarkAllRead = async () => {
    try { await api.markNotificationRead() } catch {}
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })))
  }

  const formatTime = (t: string) => {
    if (!t) return ''
    const d = new Date(t)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    const mo = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${mo}-${day} ${h}:${m}`
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <div className="h-screen bg-[#0F172A] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/friends')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">通知</h1>
          {unreadCount > 0 && (
            <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
              {unreadCount} 条未读
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            全部已读
          </button>
        )}
      </header>

      {/* Notification List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500">加载中...</div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center pt-20">
            <Bell className="w-16 h-16 text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg">暂无通知</p>
            <p className="text-gray-500 text-sm mt-1">当有人评论或回复你时会显示在这里</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-700/30 transition-colors ${
                  !n.isRead ? 'bg-blue-500/5' : ''
                }`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {n.type === 'reply' ? (
                    <Reply className="w-4 h-4 text-green-400" />
                  ) : n.type === 'system' ? (
                    <Shield className="w-4 h-4 text-red-400" />
                  ) : (
                    <MessageCircle className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-blue-400 font-medium">
                      {n.fromUsername}
                    </span>
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {n.type === 'reply' ? '回复了你' : n.type === 'system' ? '系统通知' : '评论了你的动态'}
                  </p>
                  <p className="text-sm text-gray-300 mt-1">{n.content}</p>
                </div>
                <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">
                  {formatTime(n.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}