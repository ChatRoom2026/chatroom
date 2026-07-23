import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"
import { getSocket } from "@/lib/socket"
import { useChatStore } from "@/store/chatStore"
import { useUnreadStore } from "@/store/unreadStore"
import type { Message, GroupMessage } from "@/lib/api"
import { requestNotificationPermission, showNotification } from "@/lib/notification"
import { disconnectSocket } from "@/lib/socket"
import AIPanel from "@/components/AIPanel"
import Login from "@/pages/Login"
import Register from "@/pages/Register"
import Friends from "@/pages/Friends"
import Chat from "@/pages/Chat"
import Settings from "@/pages/Settings"
import About from "@/pages/About"
import Moments from "@/pages/Moments"
import CreatePost from "@/pages/CreatePost"
import VipPlans from "@/pages/VipPlans"
import Notifications from "@/pages/Notifications"
import AdminPanel from "@/pages/AdminPanel"

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/" replace />
  return <>{children}</>
}

function SocketListener() {
  const addMessage = useChatStore((s) => s.addMessage)
  const addGroupMessage = useChatStore((s) => s.addGroupMessage)
  const setOnlineUsers = useChatStore((s) => s.setOnlineUsers)
  const user = useAuthStore((s) => s.user)
  const incrementUnread = useUnreadStore((s) => s.incrementUnread)
  const loadUnread = useUnreadStore((s) => s.loadUnread)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    // 登录后请求通知权限
    if (user) {
      requestNotificationPermission()
      loadUnread()
    }

    const handleNewMessage = (message: Message) => {
      addMessage(message)
      if (message.senderId !== user?.id) {
        const friendId = message.senderId
        const onChat = location.pathname === `/chat/${friendId}`
        if (!onChat) {
          incrementUnread('friend', friendId, message.content, message.senderId)
          showNotification('新消息', {
            body: message.content || `[${message.type === 'image' ? '图片' : message.type === 'file' ? '文件' : '消息'}]`,
            onClick: () => {
              window.location.href = `/chat/${friendId}`
            },
          })
        }
      }
    }

    const handleNewGroupMessage = (message: GroupMessage) => {
      addGroupMessage(message)
      if (message.senderId !== user?.id) {
        const groupId = message.groupId
        const onChat = location.pathname === `/group/${groupId}`
        if (!onChat) {
          incrementUnread('group', groupId, `${message.senderName}: ${message.content}`, message.senderId)
          showNotification('群消息', {
            body: `${message.senderName}: ${message.content}`,
            onClick: () => {
              window.location.href = `/group/${groupId}`
            },
          })
        }
      }
    }

    const handleOnlineUsers = (users: number[]) => {
      setOnlineUsers(users)
    }

    const handleUnreadUpdated = () => {
      loadUnread()
    }

    socket.on('new_message', handleNewMessage)
    socket.on('new_group_message', handleNewGroupMessage)
    socket.on('online_users', handleOnlineUsers)
    socket.on('unread_updated', handleUnreadUpdated)

    // Socket.io 连接失败 → 视为服务器不可达
    const handleConnectError = (err: Error) => {
      console.warn('[socket] 连接失败:', err.message)
      window.dispatchEvent(new CustomEvent('server-offline', {
        detail: { message: '无法连接到服务器，请检查网络或服务器地址' },
      }))
    }
    ;(socket.io as any).on('connect_error', handleConnectError)

    // 重连成功后：静默拉取
    const handleReconnect = () => {
      loadUnread()
    }
    ;(socket.io as any).on('reconnect', handleReconnect)

    return () => {
      socket.off('new_message', handleNewMessage)
      socket.off('new_group_message', handleNewGroupMessage)
      socket.off('online_users', handleOnlineUsers)
      socket.off('unread_updated', handleUnreadUpdated)
      ;(socket.io as any).off('connect_error', handleConnectError)
      ;(socket.io as any).off('reconnect', handleReconnect)
    }
  }, [addMessage, addGroupMessage, setOnlineUsers, user, incrementUnread, loadUnread, location.pathname, navigate])

  return null
}

/** 全局"无法连接到服务器"提示条 + 登录过期处理 */
function ServerOfflineBanner() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('无法连接到服务器，请检查网络或服务器地址')
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    // 节流：5 秒内只提示一次，避免大量请求反复弹
    let lastShown = 0
    const onOffline = (e: Event) => {
      const now = Date.now()
      if (now - lastShown < 5000) return
      lastShown = now
      const detail = (e as CustomEvent).detail
      if (detail?.message) setMessage(detail.message)
      setVisible(true)
    }
    window.addEventListener('server-offline', onOffline)
    return () => window.removeEventListener('server-offline', onOffline)
  }, [])

  // 登录过期：清除状态并跳转登录页
  useEffect(() => {
    const onAuthExpired = () => {
      logout()
      navigate('/', { replace: true })
    }
    window.addEventListener('auth-expired', onAuthExpired)
    return () => window.removeEventListener('auth-expired', onAuthExpired)
  }, [logout, navigate])

  // 浏览器真正的 offline/online 事件
  useEffect(() => {
    const onBrowserOffline = () => {
      setMessage('当前无网络连接，请检查网络后重试')
      setVisible(true)
    }
    window.addEventListener('offline', onBrowserOffline)
    return () => window.removeEventListener('offline', onBrowserOffline)
  }, [])

  if (!visible) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white shadow-lg"
      onClick={() => setVisible(false)}
    >
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="flex-1 break-words">{message}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setVisible(false)
            }}
            className="px-3 py-1 text-sm bg-white/20 hover:bg-white/30 rounded-md transition-colors"
          >
            关闭
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setVisible(false)
              navigate('/', { replace: true })
              window.location.href = '/'
            }}
            className="px-3 py-1 text-sm bg-white text-red-600 font-medium hover:bg-red-50 rounded-md transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const init = useAuthStore((s) => s.init)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const [showAIPanel, setShowAIPanel] = useState(false)

  useEffect(() => {
    init()
  }, [init])

  return (
    <Router>
      <ServerOfflineBanner />
      {isLoggedIn && <SocketListener />}
      <Routes>
        <Route path="/" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Login />} />
        <Route path="/register" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Register />} />
        <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="/chat/:friendId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/group/:groupId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/about" element={<ProtectedRoute><About /></ProtectedRoute>} />
        <Route path="/moments" element={<ProtectedRoute><Moments /></ProtectedRoute>} />
        <Route path="/moments/create" element={<ProtectedRoute><CreatePost /></ProtectedRoute>} />
        <Route path="/vip" element={<ProtectedRoute><VipPlans /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {isLoggedIn && (
        <>
          <button
            className="ai-toggle-btn"
            onClick={() => setShowAIPanel(!showAIPanel)}
            title="屿岸"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ai-toggle-icon">
              <path d="M8 19c-2-1-4-4-4-8 0-3 1.5-5.5 3-7" />
              <path d="M16 19c2-1 4-4 4-8 0-3-1.5-5.5-3-7" />
              <path d="M12 22V10" />
              <path d="M5 12h14" />
              <path d="M7 15c1.5 1 3.5 1 5 0s3.5-1 5 0" />
            </svg>
            <span className="ai-toggle-label">AI</span>
          </button>
          {showAIPanel && <AIPanel onClose={() => setShowAIPanel(false)} />}
        </>
      )}
    </Router>
  )
}
