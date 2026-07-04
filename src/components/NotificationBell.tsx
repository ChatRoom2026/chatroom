import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Notification } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { Bell, MessageCircle, Reply } from 'lucide-react'

export default function NotificationBell() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)

  const loadNotifications = useCallback(async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        api.getNotifications(),
        api.getNotificationUnread(),
      ])
      setNotifications(listRes.notifications)
      setUnreadCount(countRes.count)
    } catch {}
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // Socket 实时通知
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewNotification = (data: Notification & { fromUsername: string }) => {
      setNotifications((prev) => [
        {
          id: data.id || Date.now(),
          type: data.type,
          postId: data.postId,
          commentId: data.commentId,
          fromUserId: data.fromUserId,
          fromUsername: data.fromUsername,
          fromAvatar: '',
          content: data.content,
          isRead: 0,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ])
      setUnreadCount((prev) => prev + 1)
    }

    socket.on('new_notification', handleNewNotification)
    return () => {
      socket.off('new_notification', handleNewNotification)
    }
  }, [])

  const handleClick = async (n: Notification) => {
    // 标记为已读
    if (!n.isRead) {
      try { await api.markNotificationRead(n.id) } catch {}
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, isRead: 1 } : item))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }
    setShowDropdown(false)
    // 跳转到动态页并高亮
    navigate(`/moments?highlightPost=${n.postId}&highlightComment=${n.commentId || ''}`)
  }

  const handleMarkAllRead = async () => {
    try { await api.markNotificationRead() } catch {}
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })))
    setUnreadCount(0)
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
    return `${d.getMonth() + 1}-${d.getDate()}`
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-80 bg-[#1E293B] border border-gray-700 rounded-xl shadow-2xl z-50 max-h-96 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <h3 className="text-white font-medium text-sm">通知</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  全部已读
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  暂无通知
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-700/50 transition-colors border-b border-gray-800/50 ${
                      !n.isRead ? 'bg-blue-500/5' : ''
                    }`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {n.type === 'reply' ? (
                        <Reply className="w-4 h-4 text-green-400" />
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
                        {n.type === 'reply' ? '回复了你' : '评论了你的动态'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {n.content}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600 flex-shrink-0">
                      {formatTime(n.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}