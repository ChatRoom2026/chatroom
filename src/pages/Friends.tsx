import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useUnreadStore } from '@/store/unreadStore'
import { api, resolveStaticUrl, type GroupInfo } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import SafeImg from '@/components/SafeImg'
import { MessageCircle, LogOut, UserPlus, Search, Users, Camera, Trash2, X, Settings as SettingsIcon, Newspaper, Crown, Bell, Check, Plus, Shield, Clock, Info } from 'lucide-react'
import NotificationBell from '@/components/NotificationBell'

interface Friend {
  id: number
  username: string
  avatar: string
  bio?: string
  gender?: string
  region?: string
  active?: number
  isOfficial?: number
}

export default function Friends() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ id: number; username: string }>>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addUsername, setAddUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Friend | null>(null)
  const [friendRequests, setFriendRequests] = useState<Array<{ id: number; senderId: number; senderUsername: string; senderAvatar: string }>>([])
  const [showRequests, setShowRequests] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [requestHistory, setRequestHistory] = useState<Array<{ id: number; senderId: number; receiverId: number; senderUsername: string; senderAvatar: string; receiverUsername: string; receiverAvatar: string; status: string; createdAt: string }>>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const longPressTriggered = useRef(false)
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<number[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupInvitations, setGroupInvitations] = useState<Array<{ id: number; groupId: number; inviterId: number; status: string; createdAt: string; groupName: string; inviterName: string; inviterAvatar: string }>>([])

  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const onlineUsers = useChatStore((s) => s.onlineUsers)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const unread = useUnreadStore((s) => s.unread)
  const loadUnread = useUnreadStore((s) => s.loadUnread)
  const navigate = useNavigate()

  const updateUserInfo = useCallback(() => {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch {}
    }
    return user
  }, [user])

  const loadFriends = useCallback(async () => {
    try {
      const res = await api.getFriends()
      setFriends(res.friends)
    } catch (err: any) {
      console.error('加载好友列表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFriendRequests = useCallback(async () => {
    try {
      const res = await api.getFriendRequests()
      setFriendRequests(res.requests)
    } catch (err: any) {
      console.error('加载好友请求失败:', err)
    }
  }, [])

  const loadRequestHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await api.getFriendRequestHistory()
      setRequestHistory(res.requests)
    } catch (err: any) {
      console.error('加载好友申请历史失败:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.getGroups()
      setGroups(res.groups)
    } catch (err: any) {
      console.error('加载群聊列表失败:', err)
    }
  }, [])

  const loadGroupInvitations = useCallback(async () => {
    try {
      const res = await api.getGroupInvitations()
      setGroupInvitations(res.invitations)
    } catch (err: any) {
      console.error('加载群聊邀请失败:', err)
    }
  }, [])

  const checkVipStatus = useCallback(async () => {
    try {
      const res = await api.getVipStatus()
      // 更新 VIP 状态到 localStorage
      const userInfo = updateUserInfo()
      if (userInfo) {
        userInfo.vip = res.vip
        localStorage.setItem('user', JSON.stringify(userInfo))
      }
      // 同步更新 Zustand store 触发重渲染
      const currentStoreUser = useAuthStore.getState().user
      if (currentStoreUser) {
        useAuthStore.setState({ user: { ...currentStoreUser, vip: res.vip } })
      }
    } catch {}
  }, [updateUserInfo])

  useEffect(() => {
    loadFriends()
    loadFriendRequests()
    loadGroups()
    loadGroupInvitations()
    checkVipStatus()
    loadUnread()
  }, [loadFriends, loadFriendRequests, loadGroups, checkVipStatus, loadUnread])

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.on('friend_added', () => loadFriends())
    socket.on('friend_request', () => { loadFriendRequests() })
    socket.on('friend_request_responded', () => {
      loadFriends()
      loadFriendRequests()
    })
    socket.on('group_created', () => loadGroups())
    socket.on('group_invitation', () => loadGroupInvitations())
    socket.on('unread_updated', () => loadUnread())
    return () => {
      socket.off('friend_added')
      socket.off('friend_request')
      socket.off('friend_request_responded')
      socket.off('group_created')
      socket.off('group_invitation')
      socket.off('unread_updated')
    }
  }, [loadFriends, loadFriendRequests, loadGroups, loadUnread])

  const handleSearch = async (q: string) => {
    setSearchQuery(q)
    if (!q.trim()) { setSearchResults([]); return }
    try {
      const res = await api.searchUsers(q)
      setSearchResults(res.users)
    } catch { setSearchResults([]) }
  }

  const handleAddFriend = async () => {
    if (!addUsername.trim()) return
    setError('')
    try {
      const res = await api.sendFriendRequest(addUsername)
      setShowAdd(false)
      setAddUsername('')
      if (res.friend) {
        loadFriends()
      } else {
        alert(res.message || '好友请求已发送')
      }
    } catch (err: any) { setError(err.message) }
  }

  // 长按删除
  const handleTouchStart = (friend: Friend) => {
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      setDeleteTarget(friend)
    }, 600)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleMouseDown = (friend: Friend) => {
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      setDeleteTarget(friend)
    }, 600)
  }

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleDeleteFriend = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteFriend(deleteTarget.id)
      clearMessages(deleteTarget.id)
      setDeleteTarget(null)
      loadFriends()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // 头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('图片大小不能超过5MB')
      return
    }

    try {
      const res = await api.uploadFile(file)
      const avatarUrl = res.url
      await api.updateAvatar(avatarUrl)

      // 更新 localStorage
      const userInfo = updateUserInfo()
      userInfo.avatar = avatarUrl
      localStorage.setItem('user', JSON.stringify(userInfo))

      // 同步更新 store
      useAuthStore.setState({ user: { ...user, avatar: avatarUrl } })

      setShowAvatarModal(false)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const currentUser = updateUserInfo()
  const userAvatar = resolveStaticUrl(currentUser?.avatar || '')

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="h-screen bg-[#0F172A] flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-full bg-[#1E293B] border-r border-gray-800 overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div
              className="flex items-center gap-3 cursor-pointer group relative"
              onClick={() => setShowAvatarModal(true)}
            >
              <div className="relative">
                <div className="w-10 h-10 rounded-full overflow-hidden">
                  <SafeImg
                    src={userAvatar}
                    fallback={
                      <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                        {user?.username?.[0]?.toUpperCase()}
                      </div>
                    }
                    className="w-10 h-10 object-cover"
                  />
                </div>
                <div className="absolute inset-0 rounded-full overflow-hidden bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                  <Camera className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {user?.vip === 1 && (
                  <div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center border-2 border-[#1E293B]">
                    <Crown className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-white font-semibold truncate max-w-[160px]">{user?.username}</h2>
                  {user?.vip === 1 && (
                    <Crown className="w-4 h-4 text-yellow-400" />
                  )}
                </div>
                <p className="text-xs text-gray-400">{user?.vip === 1 ? 'VIP 会员' : '在线'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <button
                onClick={() => navigate('/settings')}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="设置"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
              {user?.isOfficial === 1 && (
                <button
                  onClick={() => navigate('/admin')}
                  className="p-2 text-yellow-400 hover:text-yellow-300 hover:bg-gray-700 rounded-lg transition-colors"
                  title="管理后台"
                >
                  <Shield className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => navigate('/about')}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="软件说明"
              >
                <Info className="w-5 h-5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="退出登录"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 文件传输助手 */}
          <button
            onClick={() => navigate(`/chat/${user?.id}`)}
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 transition-colors text-left mb-3"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">文件传输助手</p>
              <p className="text-xs text-blue-400">给自己发消息和文件</p>
            </div>
          </button>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="搜索用户..."
            />
            {searchQuery && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E293B] border border-gray-700 rounded-lg shadow-xl z-10">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setAddUsername(u.username)
                      setShowAdd(true)
                      setSearchQuery('')
                      setSearchResults([])
                    }}
                    className="w-full px-4 py-2.5 text-left text-white hover:bg-gray-700/50 first:rounded-t-lg last:rounded-b-lg transition-colors"
                  >
                    {u.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Friends List */}
        <div className="overflow-y-auto">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Users className="w-4 h-4" />
                <span>好友列表 ({friends.length})</span>
              </div>
              <div className="flex items-center gap-1">
                {friendRequests.length > 0 && (
                  <button
                    onClick={() => setShowRequests(!showRequests)}
                    className="relative p-1.5 text-yellow-400 hover:text-yellow-300 hover:bg-gray-700 rounded-lg transition-colors"
                    title="好友请求"
                  >
                    <Bell className="w-4 h-4" />
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                      {friendRequests.length > 9 ? '9+' : friendRequests.length}
                    </span>
                  </button>
                )}
                <button
                  onClick={() => setShowAdd(true)}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  title="添加好友"
                >
                  <UserPlus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setShowHistory(true); loadRequestHistory() }}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  title="好友申请历史"
                >
                  <Clock className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 好友请求列表 */}
            {showRequests && friendRequests.length > 0 && (
              <div className="mb-3 bg-[#0F172A] rounded-xl border border-yellow-500/20 overflow-hidden">
                <div className="px-3 py-2 text-xs text-yellow-400 font-medium border-b border-yellow-500/10">
                  好友请求 ({friendRequests.length})
                </div>
                {friendRequests.map((req) => (
                  <div key={req.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-800 last:border-b-0">
                    <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {req.senderUsername[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{req.senderUsername}</p>
                      <p className="text-xs text-gray-500">请求添加你为好友</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            await api.respondFriendRequest(req.id, 'accept')
                            loadFriendRequests()
                            loadFriends()
                          } catch {}
                        }}
                        className="p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                        title="同意"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.respondFriendRequest(req.id, 'reject')
                            loadFriendRequests()
                          } catch {}
                        }}
                        className="p-1.5 bg-red-600/50 hover:bg-red-600 text-red-200 hover:text-white rounded-lg transition-colors"
                        title="拒绝"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 群聊邀请列表 */}
            {groupInvitations.length > 0 && (
              <div className="mb-3 bg-[#0F172A] rounded-xl border border-blue-500/20 overflow-hidden">
                <div className="px-3 py-2 text-xs text-blue-400 font-medium border-b border-blue-500/10">
                  群聊邀请 ({groupInvitations.length})
                </div>
                {groupInvitations.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-800 last:border-b-0">
                    <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {inv.inviterName[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">
                        <span className="text-blue-400">{inv.inviterName}</span>
                        <span className="text-gray-400"> 邀请你加入 </span>
                        <span className="text-blue-400">{inv.groupName}</span>
                      </p>
                      <p className="text-xs text-gray-500">群聊邀请</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            await api.respondGroupInvitation(inv.id, 'accept')
                            loadGroupInvitations()
                            loadGroups()
                          } catch {}
                        }}
                        className="p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                        title="同意"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.respondGroupInvitation(inv.id, 'decline')
                            loadGroupInvitations()
                          } catch {}
                        }}
                        className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                        title="拒绝"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-gray-700" />
                    <div className="flex-1"><div className="h-4 bg-gray-700 rounded w-24" /></div>
                  </div>
                ))}
              </div>
            ) : friends.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">还没有好友</p>
                <p className="text-gray-600 text-xs mt-1">点击右上角 + 添加好友</p>
              </div>
            ) : (
              <div className="space-y-1">
                {friends.map((friend) => (
                  <div
                    key={friend.id}
                    onTouchStart={() => handleTouchStart(friend)}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={() => handleMouseDown(friend)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={() => {
                      if (!longPressTriggered.current && friend.active === 1) {
                        navigate(`/chat/${friend.id}`)
                      }
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors group cursor-pointer select-none ${
                      friend.active === 1
                        ? 'hover:bg-gray-700/50'
                        : 'opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="relative">
                      <SafeImg
                        src={resolveStaticUrl(friend.avatar || '')}
                        fallback={
                          <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold text-sm">
                            {friend.username[0]?.toUpperCase()}
                          </div>
                        }
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      {friend.active === 1 && onlineUsers.includes(friend.id) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-[#1E293B]" />
                      )}
                      {unread[`friend:${friend.id}`]?.count > 0 && (
                        <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#1E293B]">
                          {unread[`friend:${friend.id}`].count > 99 ? '99+' : unread[`friend:${friend.id}`].count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      {friend.active === 1 ? (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-white text-sm font-medium truncate">{friend.username}</p>
                            {friend.isOfficial === 1 && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded text-[10px] font-medium flex-shrink-0">
                                <Shield className="w-2.5 h-2.5" />
                                官方
                              </span>
                            )}
                            {friend.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
                            {friend.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
                            {friend.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
                          </div>
                          <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                            <span>{onlineUsers.includes(friend.id) ? '在线' : '离线'}</span>
                            {(friend.region || friend.bio) && (
                              <>
                                <span className="text-gray-700">·</span>
                                {friend.region && (
                                  <span className="flex items-center gap-0.5 truncate">
                                    <span>📍</span>
                                    <span className="truncate max-w-[80px]">{friend.region}</span>
                                    {friend.gender === 'male' && <span className="text-blue-400">♂</span>}
                                    {friend.gender === 'female' && <span className="text-pink-400">♀</span>}
                                    {friend.gender === 'other' && <span className="text-gray-400">⚧</span>}
                                  </span>
                                )}
                                {friend.bio && (
                                  <span className="truncate italic max-w-[200px]">"{friend.bio}"</span>
                                )}
                              </>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-gray-400 text-sm font-medium">{friend.username}</p>
                            {friend.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
                            {friend.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
                            {friend.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
                          </div>
                          <p className="text-xs text-red-400/80">已注销 · 不可聊天</p>
                        </>
                      )}
                    </div>
                    {friend.active === 1 && (
                      <Trash2 className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Groups */}
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Users className="w-4 h-4" />
              <span>群聊 ({groups.length})</span>
            </div>
            <button
              onClick={() => setShowCreateGroup(true)}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="创建群聊"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {groups.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-2">暂无群聊</p>
          ) : (
            <div className="space-y-1">
              {groups.map((group) => {
                const groupUnread = unread[`group:${group.id}`]
                return (
                  <div
                    key={group.id}
                    onClick={() => navigate(`/group/${group.id}`)}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-700/50 transition-colors cursor-pointer"
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                        <Users className="w-5 h-5 text-white" />
                      </div>
                      {groupUnread?.count > 0 && (
                        <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#1E293B]">
                          {groupUnread.count > 99 ? '99+' : groupUnread.count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-white text-sm font-medium truncate">{group.name}</p>
                        <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">{group.memberCount} 人</span>
                      </div>
                      <p className={`text-xs truncate ${groupUnread ? 'text-white font-medium' : 'text-gray-500'}`}>
                        {groupUnread?.lastMessage || group.lastMessage || '暂无消息'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Features */}
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
            <span>功能</span>
          </div>
          <button
            onClick={() => navigate('/moments')}
            className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-gray-700/50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Newspaper className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-medium">发动态</p>
              <p className="text-xs text-gray-500">分享生活瞬间</p>
            </div>
          </button>
        </div>

        {/* VIP Entry - Bottom */}
        <div className="border-t border-gray-800 px-4 py-3">
          <button
            onClick={() => navigate('/vip')}
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-gradient-to-r from-yellow-500/10 to-yellow-600/5 hover:from-yellow-500/20 hover:to-yellow-600/10 border border-yellow-500/20 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-yellow-400 text-sm font-medium">{user?.vip === 1 ? '续费VIP' : '开通VIP'}</p>
              <p className="text-xs text-yellow-500/60">{user?.vip === 1 ? '延长会员期限' : '解锁全部功能'}</p>
            </div>
          </button>
        </div>
      </div>

      {/* Add friend modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-4">添加好友</h3>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}
            <input
              type="text"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors mb-4"
              placeholder="输入好友用户名"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowAdd(false); setError(''); setAddUsername('') }}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">取消</button>
              <button onClick={handleAddFriend}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">删除好友</h3>
                <p className="text-sm text-gray-400">确定要删除 {deleteTarget.username} 吗？</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">取消</button>
              <button onClick={handleDeleteFriend}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar upload modal */}
      {showAvatarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">更换头像</h3>
              <button onClick={() => setShowAvatarModal(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}

            {/* Current avatar */}
            <div className="flex justify-center mb-6">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-gray-700" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-semibold border-4 border-gray-700">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>

            <label className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
              <Camera className="w-5 h-5" />
              选择图片
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>

            <p className="text-xs text-gray-500 text-center mt-3">支持 JPG、PNG，最大 5MB</p>
          </div>
        </div>
      )}

      {/* Create group modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">创建群聊</h3>
              <button onClick={() => { setShowCreateGroup(false); setGroupName(''); setSelectedMembers([]); setError('') }}
                className="p-1 text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}

            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors mb-4"
              placeholder="输入群聊名称"
            />

            <div className="text-sm text-gray-400 mb-2">选择好友加入群聊</div>
            <div className="flex-1 overflow-y-auto mb-4 space-y-1 max-h-60">
              {friends.length === 0 ? (
                <p className="text-gray-500 text-xs text-center py-4">暂无好友可添加</p>
              ) : (
                friends.map((friend) => (
                  <label
                    key={friend.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                      selectedMembers.includes(friend.id)
                        ? 'bg-blue-600/20 border border-blue-500/30'
                        : 'hover:bg-gray-700/50 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(friend.id)}
                      onChange={() => {
                        setSelectedMembers((prev) =>
                          prev.includes(friend.id)
                            ? prev.filter((id) => id !== friend.id)
                            : [...prev, friend.id]
                        )
                      }}
                      className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 bg-gray-700"
                    />
                    <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {friend.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-white text-sm">{friend.username}</span>
                  </label>
                ))
              )}
            </div>

            <button
              onClick={async () => {
                if (!groupName.trim()) return
                setCreatingGroup(true)
                setError('')
                try {
                  await api.createGroup(groupName.trim(), selectedMembers)
                  setShowCreateGroup(false)
                  setGroupName('')
                  setSelectedMembers([])
                  loadGroups()
                } catch (err: any) {
                  setError(err.message)
                } finally {
                  setCreatingGroup(false)
                }
              }}
              disabled={creatingGroup || !groupName.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {creatingGroup ? '创建中...' : '创建群聊'}
            </button>
          </div>
        </div>
      )}
    {/* 好友申请历史弹窗 */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">好友申请历史</h3>
              <button onClick={() => setShowHistory(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="text-center text-gray-400 py-8">加载中...</div>
              ) : requestHistory.length === 0 ? (
                <div className="text-center text-gray-500 py-8">暂无好友申请记录</div>
              ) : (
                <div className="space-y-2">
                  {requestHistory.map((req) => {
                    const isSender = req.senderId === user?.id
                    const statusColors: Record<string, string> = {
                      pending: 'text-yellow-400 bg-yellow-500/10',
                      accepted: 'text-green-400 bg-green-500/10',
                      rejected: 'text-red-400 bg-red-500/10',
                    }
                    const statusLabels: Record<string, string> = {
                      pending: '待处理',
                      accepted: '已同意',
                      rejected: '已拒绝',
                    }
                    return (
                      <div key={req.id} className="flex items-center gap-3 p-3 bg-[#0F172A] rounded-xl">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-semibold">
                            {(isSender ? req.receiverUsername : req.senderUsername)?.[0]?.toUpperCase()}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">
                            {isSender ? (
                              <>你向 <span className="text-blue-400">{req.receiverUsername}</span> 发送了好友申请</>
                            ) : (
                              <><span className="text-blue-400">{req.senderUsername}</span> 向你发送了好友申请</>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(req.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusColors[req.status] || 'text-gray-400 bg-gray-500/10'}`}>
                          {statusLabels[req.status] || req.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}