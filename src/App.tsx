import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"
import { getSocket } from "@/lib/socket"
import { useChatStore } from "@/store/chatStore"
import { useUnreadStore } from "@/store/unreadStore"
import type { Message, GroupMessage } from "@/lib/api"
import { requestNotificationPermission, showNotification } from "@/lib/notification"
import Login from "@/pages/Login"
import Register from "@/pages/Register"
import Friends from "@/pages/Friends"
import Chat from "@/pages/Chat"
import Settings from "@/pages/Settings"
import Moments from "@/pages/Moments"
import CreatePost from "@/pages/CreatePost"
import VipPlans from "@/pages/VipPlans"

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
      // 增加未读计数（仅当不是当前聊天对象时）
      if (message.senderId !== user?.id) {
        const friendId = message.senderId
        const onChat = location.pathname === `/chat/${friendId}`
        if (!onChat) {
          incrementUnread('friend', friendId, message.content, message.senderId)
          // 浏览器原生通知
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
      // 增加群未读计数
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

    return () => {
      socket.off('new_message', handleNewMessage)
      socket.off('new_group_message', handleNewGroupMessage)
      socket.off('online_users', handleOnlineUsers)
      socket.off('unread_updated', handleUnreadUpdated)
    }
  }, [addMessage, addGroupMessage, setOnlineUsers, user, incrementUnread, loadUnread, location.pathname])

  return null
}

export default function App() {
  const init = useAuthStore((s) => s.init)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)

  useEffect(() => {
    init()
  }, [init])

  return (
    <Router>
      {isLoggedIn && <SocketListener />}
      <Routes>
        <Route path="/" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Login />} />
        <Route path="/register" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Register />} />
        <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="/chat/:friendId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/group/:groupId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/moments" element={<ProtectedRoute><Moments /></ProtectedRoute>} />
        <Route path="/moments/create" element={<ProtectedRoute><CreatePost /></ProtectedRoute>} />
        <Route path="/vip" element={<ProtectedRoute><VipPlans /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}