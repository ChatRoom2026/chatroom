/**
 * API 请求工具
 * 支持浏览器和 Capacitor Android 客户端
 */

import { isAndroid, isNativeApp } from './platform'

// Android 原生客户端：连接到本地运行的 Express 服务器（adb reverse 或局域网 IP）
// 浏览器开发：使用 vite proxy 转发 /api
function detectApiBase(): string {
  if (isNativeApp() && isAndroid()) {
    // 优先从 localStorage 读取用户配置的服务器地址
    const stored = localStorage.getItem('api_base_url')
    if (stored) return stored
    // 默认指向本机（需要 adb reverse tcp:3001 tcp:3001）
    return 'http://10.0.2.2:3001/api'
  }
  return '/api'
}

let API_BASE = detectApiBase()

export function setApiBaseUrl(url: string) {
  API_BASE = url || '/api'
  localStorage.setItem('api_base_url', API_BASE)
}

export function getApiBaseUrl(): string {
  return API_BASE
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (options.body instanceof FormData) {
    delete headers['Content-Type']
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  })

  // 检查响应是否为 JSON
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    // 尝试获取文本内容用于调试
    const text = await res.text().catch(() => '')
    throw new Error(text ? `服务器返回了非 JSON 响应 (${res.status})` : '网络错误，请检查服务器是否在运行')
  }

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || '请求失败')
  }

  return data
}

export const api = {
  // 认证
  register(username: string, password: string, email?: string, code?: string) {
    return request<{ success: boolean; user: { id: number; username: string; email?: string; avatar?: string }; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email: email || '', password, code: code || '' }),
    })
  },

  login(loginId: string, password: string) {
    return request<{ success: boolean; user: { id: number; username: string; avatar?: string; vip?: number }; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginId, password }),
    })
  },

  // 用户
  updateAvatar(avatarUrl: string) {
    return request<{ success: boolean; avatar: string }>('/user/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatar: avatarUrl }),
    })
  },

  updateProfile(username: string) {
    return request<{ success: boolean; username: string }>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    })
  },

  deactivateAccount() {
    return request<{ success: boolean; message: string }>('/user/deactivate', {
      method: 'POST',
    })
  },

  // 好友
  getFriends() {
    return request<{ success: boolean; friends: Array<{ id: number; username: string; avatar: string }> }>('/friends')
  },

  searchUsers(q: string) {
    return request<{ success: boolean; users: Array<{ id: number; username: string }> }>(`/friends/search?q=${encodeURIComponent(q)}`)
  },

  // 发送好友请求
  sendFriendRequest(username: string) {
    return request<{ success: boolean; message: string; friend?: { id: number; username: string } }>('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ username }),
    })
  },

  // 获取待处理的好友请求
  getFriendRequests() {
    return request<{ success: boolean; requests: Array<{ id: number; senderId: number; senderUsername: string; senderAvatar: string; status: string; createdAt: string }> }>('/friends/requests')
  },

  // 处理好友请求（同意/拒绝）
  respondFriendRequest(requestId: number, action: 'accept' | 'reject') {
    return request<{ success: boolean; message: string }>('/friends/respond', {
      method: 'POST',
      body: JSON.stringify({ requestId, action }),
    })
  },

  deleteFriend(friendId: number) {
    return request<{ success: boolean }>(`/friends/${friendId}`, {
      method: 'DELETE',
    })
  },

  // 消息
  getMessages(friendId: number) {
    return request<{ success: boolean; messages: Array<Message> }>(`/messages/${friendId}`)
  },

  // 文件上传
  uploadFile(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return request<{ success: boolean; url: string; type: string; originalName: string }>('/upload', {
      method: 'POST',
      body: formData,
    })
  },

  // 验证码
  sendVerificationCode(target: string) {
    return request<{ success: boolean; sent: boolean; message: string; code?: string }>('/verification/send', {
      method: 'POST',
      body: JSON.stringify({ target }),
    })
  },

  verifyCode(target: string, code: string) {
    return request<{ success: boolean; message: string }>('/verification/verify', {
      method: 'POST',
      body: JSON.stringify({ target, code }),
    })
  },

  // 动态
  getPosts() {
    return request<{ success: boolean; posts: Array<Post> }>('/posts')
  },

  createPost(content: string, imageUrl?: string) {
    return request<{ success: boolean; post: Post }>('/posts', {
      method: 'POST',
      body: JSON.stringify({ content, imageUrl: imageUrl || '' }),
    })
  },

  getComments(postId: number) {
    return request<{ success: boolean; comments: Array<Comment> }>(`/posts/${postId}/comments`)
  },

  createComment(postId: number, content: string) {
    return request<{ success: boolean; comment: Comment; postUserId: number }>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  },

  deletePost(postId: number) {
    return request<{ success: boolean }>(`/posts/${postId}`, {
      method: 'DELETE',
    })
  },

  // VIP
  getVipPlans() {
    return request<{ success: boolean; plans: Array<{ id: string; name: string; price: number; days: number; badge: string }> }>('/vip/plans')
  },

  getVipStatus() {
    return request<{ success: boolean; vip: number; expiresAt: string | null; wechatQrcode: string }>('/vip/status')
  },

  payVip(planId: string) {
    return request<{ success: boolean; qrcode: string; outTradeNo: string; mock?: boolean; plan?: any; message?: string; payjsUrl?: string }>('/vip/pay', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    })
  },

  checkVipOrder(outTradeNo: string) {
    return request<{ success: boolean; status: string; paid: boolean }>('/vip/check', {
      method: 'POST',
      body: JSON.stringify({ outTradeNo }),
    })
  },

  confirmVipPayment(outTradeNo: string) {
    return request<{ success: boolean; message: string; vip: number; expiresAt: string }>('/vip/confirm', {
      method: 'POST',
      body: JSON.stringify({ outTradeNo }),
    })
  },

  // AI 聊天
  sendAiMessage(message: string) {
    return request<{ success: boolean; reply: string }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
  },

  // 群聊
  getGroups() {
    return request<{ success: boolean; groups: GroupInfo[] }>('/groups')
  },

  createGroup(name: string, memberIds: number[]) {
    return request<{ success: boolean; group: GroupInfo }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    })
  },

  getGroupMembers(groupId: number) {
    return request<{ success: boolean; members: Array<{ id: number; username: string; avatar: string; role: string }> }>(`/groups/${groupId}/members`)
  },

  getGroupMessages(groupId: number) {
    return request<{ success: boolean; messages: GroupMessage[] }>(`/groups/${groupId}/messages`)
  },

  addGroupMembers(groupId: number, newMemberIds: number[]) {
    return request<{ success: boolean; added: number; memberCount: number }>(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ newMemberIds }),
    })
  },

  removeGroupMember(groupId: number, memberId: number) {
    return request<{ success: boolean }>(`/groups/${groupId}/members/${memberId}`, {
      method: 'DELETE',
    })
  },

  updateGroupName(groupId: number, name: string) {
    return request<{ success: boolean }>(`/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
  },

  leaveGroup(groupId: number) {
    return request<{ success: boolean }>(`/groups/${groupId}/leave`, {
      method: 'POST',
    })
  },

  deleteGroup(groupId: number) {
    return request<{ success: boolean }>(`/groups/${groupId}`, {
      method: 'DELETE',
    })
  },

  getGroupDetail(groupId: number) {
    return request<{ success: boolean; group: { id: number; name: string; avatar: string; ownerId: number; memberCount: number; ownerName: string; createdAt: string } }>(`/groups/${groupId}`)
  },

  // 未读消息
  getUnread() {
    return request<{ success: boolean; unread: Array<{ targetType: 'friend' | 'group'; targetId: number; count: number; lastMessage: string; lastSenderId: number; lastTimestamp: string }> }>('/unread')
  },

  clearUnread(targetType: 'friend' | 'group', targetId: number) {
    return request<{ success: boolean }>('/unread/clear', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId }),
    })
  },
}

export interface Message {
  id: number
  senderId: number
  receiverId: number
  content: string
  type: 'text' | 'image' | 'file'
  fileUrl: string
  timestamp: string
}

export interface Post {
  id: number
  userId: number
  content: string
  imageUrl: string
  createdAt: string
  username: string
  avatar: string
  commentCount: number
}

export interface Comment {
  id: number
  postId: number
  userId: number
  content: string
  createdAt: string
  username: string
  avatar: string
}

export interface GroupMessage {
  id: number
  groupId: number
  senderId: number
  content: string
  type: 'text' | 'image' | 'file'
  fileUrl: string
  timestamp: string
  senderName: string
  senderAvatar: string
}

export interface GroupInfo {
  id: number
  name: string
  avatar: string
  ownerId: number
  memberCount: number
  lastMessage?: string
  lastMessageTime?: string
}