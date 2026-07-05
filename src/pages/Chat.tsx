import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useUnreadStore } from '@/store/unreadStore'
import { api, resolveStaticUrl, type Message, type GroupMessage, type GroupInfo } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { MediaPreview } from '@/components/MediaPreview'
import UserProfileModal from '@/components/UserProfileModal'
import SafeImg from '@/components/SafeImg'
import { ArrowLeft, Send, Paperclip, Image, FileText, Ban, X, UserPlus, Users, Edit2, LogOut, Crown, VideoIcon, Shield } from 'lucide-react'

export default function Chat() {
  const { friendId, groupId } = useParams<{ friendId: string; groupId: string }>()
  const navigate = useNavigate()
  const [friend, setFriend] = useState<{ id: number; username: string; avatar?: string; active?: number; isOfficial?: number; bio?: string; gender?: string; region?: string } | null>(null)
  const [showFriendInfo, setShowFriendInfo] = useState(false)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null)
  const [groupMembers, setGroupMembers] = useState<Array<{ id: number; username: string; avatar: string; role: string }>>([])
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [friends, setFriends] = useState<Array<{ id: number; username: string; avatar: string; bio?: string; gender?: string; region?: string }>>([])
  const [selectedFriends, setSelectedFriends] = useState<number[]>([])
  const [showEditNameModal, setShowEditNameModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [showGroupMenu, setShowGroupMenu] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [selectedMember, setSelectedMember] = useState<{ id: number; username: string; avatar?: string; bio?: string; gender?: string; region?: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const user = useAuthStore((s) => s.user)
  const messages = useChatStore((s) => s.messages)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const addMessage = useChatStore((s) => s.addMessage)
  const typingUsers = useChatStore((s) => s.typingUsers)
  const setTypingUser = useChatStore((s) => s.setTypingUser)
  const groupMessages = useChatStore((s) => s.groupMessages)
  const loadGroupMessages = useChatStore((s) => s.loadGroupMessages)
  const addGroupMessage = useChatStore((s) => s.addGroupMessage)

  const isGroupMode = !!groupId
  const fid = Number(friendId)
  const currentGroupMessages = isGroupMode ? (groupMessages[Number(groupId)] || []) : []
  const friendMessages = messages[fid] || []
  const isTyping = typingUsers[fid] || false

  // 加载好友信息、群组信息和聊天记录
  useEffect(() => {
    if (isGroupMode) {
      setLoading(true)

      // 加载群消息
      loadGroupMessages(Number(groupId)).finally(() => setLoading(false))

      // 加载群详情
      api.getGroupDetail(Number(groupId)).then((res) => {
        if (res.success && res.group) {
          setGroupInfo({
            id: res.group.id,
            name: res.group.name,
            avatar: res.group.avatar,
            ownerId: res.group.ownerId,
            memberCount: res.group.memberCount,
          })
        }
      }).catch(() => {
        // fallback
        api.getGroups().then((res) => {
          const g = res.groups.find((grp) => grp.id === Number(groupId))
          if (g) setGroupInfo(g)
        })
      })

      // 加载群成员
      api.getGroupMembers(Number(groupId)).then((res) => {
        setGroupMembers(res.members)
      })

      return
    }

    if (!fid) return

    // 文件传输助手（自己和自己聊天）
    if (user && fid === user.id) {
      setFriend({
        id: user.id,
        username: '文件传输助手',
        avatar: user.avatar,
      })
      setLoading(true)
      loadMessages(fid).finally(() => setLoading(false))
      return
    }

    // 加载好友信息
    api.getFriends().then((res) => {
      const f = res.friends.find((fr) => fr.id === fid)
      if (f) setFriend(f)
      setFriends(res.friends)
    })

    // 加载聊天记录
    setLoading(true)
    loadMessages(fid).finally(() => setLoading(false))
  }, [fid, loadMessages, user, isGroupMode, groupId, loadGroupMessages])

  // 通知后端当前正在查看的会话 + 清除未读
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !user) return

    if (isGroupMode && groupId) {
      const gid = Number(groupId)
      socket.emit('active_session', { targetType: 'group', targetId: gid })
      useUnreadStore.getState().clearUnread('group', gid)
    } else if (fid) {
      socket.emit('active_session', { targetType: 'friend', targetId: fid })
      useUnreadStore.getState().clearUnread('friend', fid)
    } else {
      socket.emit('active_session', null)
    }

    return () => {
      socket.emit('active_session', null)
    }
  }, [fid, groupId, isGroupMode, user])

  // Socket 监听
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewMessage = (message: Message) => {
      addMessage(message)
    }

    const handleNewGroupMessage = (message: GroupMessage) => {
      addGroupMessage(message)
    }

    const handleTypingStatus = (data: { userId: number; username: string; isTyping: boolean }) => {
      setTypingUser(data.userId, data.isTyping)
    }

    socket.on('new_message', handleNewMessage)
    socket.on('new_group_message', handleNewGroupMessage)
    socket.on('typing_status', handleTypingStatus)

    return () => {
      socket.off('new_message', handleNewMessage)
      socket.off('new_group_message', handleNewGroupMessage)
      socket.off('typing_status', handleTypingStatus)
    }
  }, [addMessage, addGroupMessage, setTypingUser])

  // 组件卸载时清理 typing 定时器
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [friendMessages, currentGroupMessages])

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending) return

    setSending(true)
    const content = text.trim()
    setText('')

    if (isGroupMode) {
      const socket = getSocket()
      if (socket) {
        socket.emit('send_group_message', {
          groupId: Number(groupId),
          content,
          type: 'text',
        })
      }
      setSending(false)
      return
    }

    const socket = getSocket()
    if (!socket) {
      setSending(false)
      return
    }

    socket.emit('send_message', {
      receiverId: fid,
      content,
      type: 'text',
    })

    setSending(false)
  }, [text, sending, fid, isGroupMode, groupId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 发送正在输入状态（普通聊天模式）
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)

    if (isGroupMode) return // 群聊模式不发送 typing 事件

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
    if (!file || (!fid && !isGroupMode)) return

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }

    setSending(true)
    try {
      const res = await api.uploadFile(file)
      const socket = getSocket()
      if (socket) {
        if (isGroupMode) {
          socket.emit('send_group_message', {
            groupId: Number(groupId),
            content: file.name,
            type: 'image',
            fileUrl: res.url,
          })
        } else {
          socket.emit('send_message', {
            receiverId: fid,
            content: file.name,
            type: 'image',
            fileUrl: res.url,
          })
        }
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
    if (!file || (!fid && !isGroupMode)) return

    setSending(true)
    try {
      const res = await api.uploadFile(file)
      const socket = getSocket()
      if (socket) {
        if (isGroupMode) {
          socket.emit('send_group_message', {
            groupId: Number(groupId),
            content: file.name,
            type: 'file',
            fileUrl: res.url,
          })
        } else {
          socket.emit('send_message', {
            receiverId: fid,
            content: file.name,
            type: 'file',
            fileUrl: res.url,
          })
        }
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 发送视频
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || (!fid && !isGroupMode)) return

    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件')
      return
    }

    if (file.size > 100 * 1024 * 1024) {
      alert('视频大小不能超过 100MB')
      return
    }

    setSending(true)
    try {
      const res = await api.uploadFile(file)
      const socket = getSocket()
      if (socket) {
        if (isGroupMode) {
          socket.emit('send_group_message', {
            groupId: Number(groupId),
            content: file.name,
            type: 'video',
            fileUrl: res.url,
          })
        } else {
          socket.emit('send_message', {
            receiverId: fid,
            content: file.name,
            type: 'video',
            fileUrl: res.url,
          })
        }
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSending(false)
      if (videoInputRef.current) videoInputRef.current.value = ''
    }
  }

  // 下载文件（使用 Authorization header，避免 token 暴露在 URL 中）
  const handleDownloadFile = async (messageId: number) => {
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch(`/api/download/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('下载失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('content-disposition')
      const filename = disposition?.match(/filename="?(.+?)"?$/)?.[1] || `file-${messageId}`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || '下载失败')
    }
  }

  // 格式化时间（24小时制，强制本地时间）
  const formatTime = (timestamp: string) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return ''
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const h = date.getHours().toString().padStart(2, '0')
    const m = date.getMinutes().toString().padStart(2, '0')
    if (isToday) return `${h}:${m}`
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    return `${month}-${day} ${h}:${m}`
  }

  if (!fid && !isGroupMode) return null

  return (
    <div className="h-screen bg-[#0F172A] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(isGroupMode ? '/friends' : '/friends')}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative">
          {isGroupMode ? (
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold">
              {groupInfo?.name?.[0]?.toUpperCase() || 'G'}
            </div>
          ) : (
            <SafeImg
              src={resolveStaticUrl(friend?.avatar || '')}
              fallback={
                <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold">
                  {friend?.username?.[0]?.toUpperCase() || '?'}
                </div>
              }
              className="w-10 h-10 rounded-full object-cover"
            />
          )}
        </div>
        <div className="flex-1">
          {isGroupMode ? (
            <>
              <h2 className="text-white font-semibold">{groupInfo?.name || '群聊'}</h2>
              <p className="text-xs text-gray-400">{groupMembers.length} 位成员</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="text-white font-semibold">{friend?.username || '加载中...'}</h2>
                {friend?.isOfficial === 1 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded text-[10px] font-medium">
                    <Shield className="w-2.5 h-2.5" />
                    官方
                  </span>
                )}
              </div>
              {friend?.active === 0 ? (
                <p className="text-xs text-red-400/80">已注销 · 不可聊天</p>
              ) : (
                <p className="text-xs text-gray-400">
                  {isTyping ? '正在输入...' : useChatStore.getState().onlineUsers.includes(fid) ? '在线' : '离线'}
                </p>
              )}
            </>
          )}
        </div>
        {!isGroupMode && friend && friend.id !== user?.id && (
          <button
            onClick={() => setShowFriendInfo(true)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="查看资料"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        )}
        {isGroupMode && (
          <div className="flex items-center gap-1">
            {groupInfo?.ownerId === user?.id && (
              <button
                onClick={() => {
                  setNewGroupName(groupInfo?.name || '')
                  setShowEditNameModal(true)
                }}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="修改群名称"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => {
                api.getFriends().then((res) => {
                  setFriends(res.friends.filter((f) => !groupMembers.some((m) => m.id === f.id)))
                  setShowAddMemberModal(true)
                })
              }}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="邀请好友"
            >
              <UserPlus className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowGroupMenu(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="更多"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="space-y-4 pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'} animate-pulse`}>
                <div className={`h-10 ${i % 2 === 0 ? 'bg-blue-600/30 w-32' : 'bg-gray-700 w-40'} rounded-2xl`} />
              </div>
            ))}
          </div>
        ) : isGroupMode ? (
          currentGroupMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-sm">暂无群消息</p>
            </div>
          ) : (
            currentGroupMessages.map((msg) => {
              const isMine = msg.senderId === user?.id
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} gap-2`}>
                  {!isMine && (
                    <button
                      onClick={() => setSelectedMember({
                        id: msg.senderId,
                        username: msg.senderName,
                        avatar: msg.senderAvatar,
                        bio: msg.bio,
                        gender: msg.gender,
                        region: msg.region,
                      })}
                      className="flex-shrink-0 mt-1"
                    >
                      {msg.senderAvatar ? (
                        <img src={msg.senderAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold">
                          {msg.senderName[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                    </button>
                  )}
                  <div className={`max-w-[75%] ${isMine ? 'order-1' : 'order-1'}`}>
                    {!isMine && <p className="text-xs text-gray-500 mb-1 ml-1">{msg.senderName}</p>}
                    {msg.type === 'text' && (
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        isMine
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-[#1E293B] text-gray-200 rounded-bl-md'
                      }`}>
                        {msg.content}
                      </div>
                    )}
                    {msg.type === 'image' && (
                      <div>
                        <MediaPreview type="image" url={msg.fileUrl} filename={msg.content} thumbSize={240} />
                        <p className={`text-xs mt-1 ${isMine ? 'text-right' : 'text-left'}`}>{msg.content}</p>
                      </div>
                    )}
                    {msg.type === 'video' && (
                      <div className={`space-y-1`}>
                        <MediaPreview type="video" url={msg.fileUrl} filename={msg.content} thumbSize={240} />
                        <p className={`text-xs text-gray-400 break-all ${isMine ? 'text-right' : 'text-left'}`}>
                          {msg.content}
                        </p>
                      </div>
                    )}
                    {msg.type === 'file' && (
                      <button
                        onClick={() => handleDownloadFile(msg.id)}
                        className={`px-4 py-3 rounded-2xl flex items-center gap-3 hover:opacity-90 transition-opacity ${
                          isMine ? 'flex-row-reverse rounded-br-md' : 'rounded-bl-md'
                        } bg-[#1E293B] text-gray-200`}
                      >
                        <FileText className="w-8 h-8 flex-shrink-0" />
                        <div className={`min-w-0 ${isMine ? 'text-right' : 'text-left'}`}>
                          <p className="text-sm truncate">{msg.content}</p>
                          <p className="text-xs text-blue-400">点击下载</p>
                        </div>
                      </button>
                    )}
                    <p className={`text-xs text-gray-600 mt-1 ${isMine ? 'text-right' : 'text-left'}`}>{formatTime(msg.timestamp)}</p>
                  </div>
                  {isMine && (
                    <div className="flex-shrink-0 w-8 mt-1">
                      {msg.senderAvatar ? (
                        <img src={msg.senderAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold">
                          {msg.senderName[0]?.toUpperCase() || (user?.username?.[0]?.toUpperCase() || '?')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )
        ) : friendMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">开始聊天吧</p>
          </div>
        ) : (
          (friendMessages as Message[]).map((msg) => {
            const isMine = msg.senderId === user?.id
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] min-w-0 overflow-hidden ${isMine ? 'order-1' : 'order-1'}`}>
                  {msg.type === 'text' && (
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words overflow-wrap-anywhere ${
                        isMine
                          ? `bg-blue-600 text-white rounded-br-md ${user?.vip === 1 ? 'border border-yellow-400/50 shadow-sm shadow-yellow-400/20' : ''}`
                          : 'bg-[#1E293B] text-gray-200 rounded-bl-md'
                      }`}
                    >
                      {msg.content}
                    </div>
                  )}
                  {msg.type === 'image' && (
                    <div className={`space-y-1 max-w-full overflow-hidden ${isMine && user?.vip === 1 ? 'border border-yellow-400/50 rounded-2xl p-1' : ''}`}>
                      <MediaPreview type="image" url={msg.fileUrl} filename={msg.content} thumbSize={240} />
                      <p className={`text-xs text-gray-400 break-all ${isMine ? 'text-right' : 'text-left'}`}>
                        {msg.content}
                      </p>
                    </div>
                  )}
                  {msg.type === 'video' && (
                    <div className={`space-y-1 max-w-full overflow-hidden ${isMine && user?.vip === 1 ? 'border border-yellow-400/50 rounded-2xl p-1' : ''}`}>
                      <MediaPreview type="video" url={msg.fileUrl} filename={msg.content} thumbSize={240} />
                      <p className={`text-xs text-gray-400 break-all ${isMine ? 'text-right' : 'text-left'}`}>
                        {msg.content}
                      </p>
                    </div>
                  )}
                  {msg.type === 'file' && (
                    <button
                      onClick={() => handleDownloadFile(msg.id)}
                      className={`px-4 py-3 rounded-2xl flex items-center gap-3 hover:opacity-90 transition-opacity text-left w-full max-w-full overflow-hidden ${
                        isMine
                          ? `bg-blue-600 text-white ${user?.vip === 1 ? 'border border-yellow-400/50' : ''}`
                          : 'bg-[#1E293B] text-gray-200'
                      }`}
                    >
                      <FileText className="w-8 h-8 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{msg.content}</p>
                        <p className={`text-xs ${isMine ? 'text-blue-200' : 'text-blue-400'}`}>点击下载</p>
                      </div>
                    </button>
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
        {friend?.active === 0 && !isGroupMode ? (
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
              onClick={() => videoInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="发送视频"
            >
              <VideoIcon className="w-5 h-5" />
            </button>
            <input ref={videoInputRef} type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="发送文件"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z,.txt,.csv,.ppt,.pptx,.mp3,.json,.xml" onChange={handleFileUpload} className="hidden" />

            <input
              type="text"
              value={text}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder={isGroupMode ? '发送群消息...' : '输入消息...'}
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

      {/* 邀请好友模态框 */}
      {showAddMemberModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-white font-semibold text-lg">邀请好友加入群聊</h3>
              <button
                onClick={() => {
                  setShowAddMemberModal(false)
                  setSelectedFriends([])
                }}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {friends.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">没有可邀请的好友</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {friends.map((friend) => (
                    <label
                      key={friend.id}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                        selectedFriends.includes(friend.id)
                          ? 'bg-blue-600/20 border border-blue-500/30'
                          : 'hover:bg-gray-700/50 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(friend.id)}
                        onChange={() => {
                          setSelectedFriends((prev) =>
                            prev.includes(friend.id)
                              ? prev.filter((id) => id !== friend.id)
                              : [...prev, friend.id]
                          )
                        }}
                        className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 bg-gray-700"
                      />
                      <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold">
                        <SafeImg
                          src={resolveStaticUrl(friend.avatar || '')}
                          fallback={<>{friend.username[0]?.toUpperCase() || '?'}</>}
                          className="w-full h-full rounded-full object-cover"
                        />
                      </div>
                      <span className="text-white text-sm">{friend.username}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-700">
              <p className="text-xs text-gray-500 mb-3">好友将收到邀请通知，需要同意后才能加入群聊</p>
              <button
                onClick={async () => {
                  if (selectedFriends.length === 0) return
                  try {
                    await api.addGroupMembers(Number(groupId), selectedFriends)
                    setShowAddMemberModal(false)
                    setSelectedFriends([])
                    alert('邀请已发送，等待好友同意')
                  } catch (err) {
                    console.error('邀请失败:', err)
                  }
                }}
                disabled={selectedFriends.length === 0}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium"
              >
                发送邀请 {selectedFriends.length > 0 ? `(${selectedFriends.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改群名称模态框 */}
      {showEditNameModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-lg">修改群名称</h3>
              <button
                onClick={() => setShowEditNameModal(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors mb-4"
              placeholder="输入新的群名称"
              maxLength={30}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowEditNameModal(false)}
                className="flex-1 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (!newGroupName.trim()) return
                  try {
                    await api.updateGroupName(Number(groupId), newGroupName.trim())
                    setGroupInfo(groupInfo ? { ...groupInfo, name: newGroupName.trim() } : null)
                    setShowEditNameModal(false)
                  } catch (err) {
                    console.error('修改群名称失败:', err)
                  }
                }}
                disabled={!newGroupName.trim()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 群管理菜单 */}
      {showGroupMenu && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setShowGroupMenu(false)}>
          <div
            className="bg-[#1E293B] rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-4 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold text-center mb-3">群聊管理</h3>
            <button
              onClick={async () => {
                setShowGroupMenu(false)
                const res = await api.getGroupMembers(Number(groupId))
                setGroupMembers(res.members)
                setShowMembersModal(true)
              }}
              className="w-full p-3 bg-[#0F172A] hover:bg-gray-700 rounded-xl text-white text-left flex items-center gap-3"
            >
              <Users className="w-5 h-5 text-blue-400" />
              <div>
                <p className="text-sm font-medium">查看群成员</p>
                <p className="text-xs text-gray-500">共 {groupMembers.length} 位成员</p>
              </div>
            </button>
            <button
              onClick={async () => {
                if (!confirm('确定要退出该群聊吗？\n\n' + (groupInfo?.ownerId === user?.id ? '你是群主，退出后群主将自动转让给最早加入的成员。' : ''))) {
                  return
                }
                try {
                  await api.leaveGroup(Number(groupId))
                  alert('已退出群聊')
                  navigate('/friends')
                } catch (err) {
                  console.error('退出群聊失败:', err)
                  alert('退出失败')
                }
              }}
              className="w-full p-3 bg-[#0F172A] hover:bg-gray-700 rounded-xl text-white text-left flex items-center gap-3"
            >
              <LogOut className="w-5 h-5 text-orange-400" />
              <div>
                <p className="text-sm font-medium">退出群聊</p>
                <p className="text-xs text-gray-500">{groupInfo?.ownerId === user?.id ? '退出后自动转让群主' : '不再接收群消息'}</p>
              </div>
            </button>
            {groupInfo?.ownerId === user?.id && (
              <button
                onClick={async () => {
                  if (!confirm('确定要解散该群聊吗？\n\n此操作将删除所有群消息，无法恢复！')) {
                    return
                  }
                  try {
                    await api.deleteGroup(Number(groupId))
                    alert('已解散群聊')
                    navigate('/friends')
                  } catch (err) {
                    console.error('解散群聊失败:', err)
                    alert('解散失败')
                  }
                }}
                className="w-full p-3 bg-[#0F172A] hover:bg-red-900/30 rounded-xl text-red-400 text-left flex items-center gap-3"
              >
                <Ban className="w-5 h-5" />
                <div>
                  <p className="text-sm font-medium">解散群聊</p>
                  <p className="text-xs text-red-400/60">仅群主可操作，删除所有消息</p>
                </div>
              </button>
            )}
            <button
              onClick={() => setShowGroupMenu(false)}
              className="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-white text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 群成员列表模态框 */}
      {showMembersModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowMembersModal(false)}>
          <div
            className="bg-[#1E293B] rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-white font-semibold text-lg">群成员 ({groupMembers.length})</h3>
              <button
                onClick={() => setShowMembersModal(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {groupMembers.map((member) => {
                const isOwner = member.id === groupInfo?.ownerId
                const isAdmin = member.role === 'admin' || member.role === 'owner'
                const isMe = member.id === user?.id
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-700/50 rounded-xl cursor-pointer"
                    onClick={() => {
                      if (!isMe) {
                        setSelectedMember({
                          id: member.id,
                          username: member.username,
                          avatar: member.avatar,
                        })
                      }
                    }}
                  >
                    <div className="relative">
                      <SafeImg
                        src={resolveStaticUrl(member.avatar || '')}
                        fallback={
                          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold">
                            {member.username[0]?.toUpperCase() || '?'}
                          </div>
                        }
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium truncate">{member.username}</span>
                        {isMe && <span className="text-xs text-blue-400">(我)</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {isOwner ? (
                          <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
                            <Crown className="w-3 h-3" />群主
                          </span>
                        ) : isAdmin ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
                            <Crown className="w-3 h-3" />管理员
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!isOwner && isOwner === false && groupInfo?.ownerId === user?.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!confirm(`确定将群主转让给 ${member.username} 吗？`)) return
                          alert('转让群主功能待后端支持')
                        }}
                        className="text-xs text-gray-400 hover:text-white"
                      >
                        转让
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* 用户资料卡弹窗 */}
      {selectedMember && (
        <UserProfileModal
          user={{
            id: selectedMember.id,
            username: selectedMember.username,
            avatar: selectedMember.avatar,
            bio: selectedMember.bio,
            gender: selectedMember.gender,
            region: selectedMember.region,
          }}
          currentUserId={user?.id || 0}
          isFriend={friends.some((f) => f.id === selectedMember.id)}
          onClose={() => setSelectedMember(null)}
          onAddFriend={async (userId: number, username: string) => {
            const res = await api.sendFriendRequest(username)
            try {
              const fr = await api.getFriends()
              setFriends(fr.friends)
            } catch {}
            return res
          }}
        />
      )}

      {/* 好友资料弹窗（私聊 header 三点菜单） */}
      {showFriendInfo && friend && (
        <UserProfileModal
          user={{
            id: friend.id,
            username: friend.username,
            avatar: friend.avatar,
            bio: friend.bio,
            gender: friend.gender,
            region: friend.region,
          }}
          currentUserId={user?.id || 0}
          isFriend={true}
          onClose={() => setShowFriendInfo(false)}
          onAddFriend={async () => ({ success: true })}
        />
      )}
    </div>
  )
}