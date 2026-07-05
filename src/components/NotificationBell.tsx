import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Notification } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { Bell } from 'lucide-react'

export default function NotificationBell() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

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

  return (
    <div className="relative">
      <button
        onClick={() => navigate('/notifications')}
        className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  )
}