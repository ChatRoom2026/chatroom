/**
 * API 请求工具
 * 支持浏览器和 Capacitor Android 客户端
 * 网络错误 / 服务器不可达：触发全局 'server-offline' 事件，App.tsx 会处理跳转到首页并提示
 */

import { isAndroid, isNativeApp } from './platform'

// 服务器地址：新服务器 IP
const IPV4_BASE = 'http://8.163.85.218:3001/api'
const IPV6_BASE = '' // 暂不使用 IPv6

// Android 原生客户端：连接到本地运行的 Express 服务器（adb reverse 或局域网 IP）
// 浏览器开发：使用 vite proxy 转发 /api
function detectApiBase(): string {
  if (isNativeApp() && isAndroid()) {
    // 优先使用构建时配置的服务器地址（VITE_API_BASE）
    if (import.meta.env.VITE_API_BASE) {
      return import.meta.env.VITE_API_BASE
    }
    const stored = localStorage.getItem('api_base_url')
    if (stored) return stored
    // 默认使用 IPv4 地址
    return IPV4_BASE
  }
  // 生产构建：使用 VITE_API_BASE 环境变量
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE
  }
  return '/api'
}

let API_BASE = detectApiBase()
// 备用地址（主地址失败时尝试 IPv4）
let API_FALLBACK = (API_BASE !== IPV4_BASE && IPV4_BASE) ? IPV4_BASE : ''

export function setApiBaseUrl(url: string) {
  API_BASE = url || '/api'
  API_FALLBACK = ''
  localStorage.setItem('api_base_url', API_BASE)
}

/** 获取完整的后端基础 URL（不含 /api 后缀），用于拼接静态资源路径 */
export function getBackendBase(): string {
  if (isNativeApp() && isAndroid()) {
    const stored = localStorage.getItem('api_base_url')
    if (stored) {
      return stored.replace(/\/api\/?$/, '')
    }
    return 'http://10.0.2.2:3001'
  }
  // 生产构建：使用 VITE_API_BASE 环境变量
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE.replace(/\/api\/?$/, '')
  }
  // 开发/预览环境：使用当前页面 origin 作为后端地址
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return ''
}

/**
 * 拼接静态资源完整 URL
 * @param relativePath 例如 "/uploads/xxx.jpg"
 * @returns 完整 URL
 */
export function resolveStaticUrl(relativePath: string): string {
  if (!relativePath) return ''
  // 如果已经是完整 URL，直接返回
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath
  }
  return getBackendBase() + relativePath
}

export function getApiBaseUrl(): string {
  return API_BASE
}

/** 判断错误是否属于"无法连接到服务器"（网络不可达 / DNS 失败 / 连接拒绝 / 超时） */
function isNetworkError(err: any): boolean {
  if (!err) return false
  const msg = (err.message || String(err)).toLowerCase()
  if (err instanceof TypeError && (msg.includes('fetch') || msg.includes('network') || msg.includes('offline'))) {
    return true
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('net::err_') ||
      msg.includes('connection refused') || msg.includes('timeout') || msg.includes('dns') ||
      msg.includes('unreachable')) {
    return true
  }
  return false
}

export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
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

  // 浏览器无网络：直接提示
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    window.dispatchEvent(new CustomEvent('server-offline', {
      detail: { message: '当前无网络连接，请检查网络后重试' },
    }))
    throw new Error('当前无网络连接，请检查网络后重试')
  }

  // 执行请求，支持自动降级（IPv6 → IPv4）
  const doFetch = async (base: string): Promise<T> => {
    const res = await fetch(`${base}${url}`, { ...options, headers })

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '')
      const errMsg = text ? `服务器返回了非 JSON 响应 (${res.status})` : '网络错误，请检查服务器是否在运行'
      if (res.status === 0 || res.status >= 500 || res.status === 404) {
        window.dispatchEvent(new CustomEvent('server-offline', {
          detail: { message: errMsg, status: res.status },
        }))
      }
      throw new Error(errMsg)
    }

    const data = await res.json()

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.dispatchEvent(new CustomEvent('auth-expired'))
        throw new Error(data.error || '登录已过期，请重新登录')
      }
      if (res.status >= 500) {
        window.dispatchEvent(new CustomEvent('server-offline', {
          detail: { message: `服务器异常 (${res.status})，请稍后重试`, status: res.status },
        }))
      }
      throw new Error(data.error || '请求失败')
    }

    return data
  }

  try {
    return await doFetch(API_BASE)
  } catch (err: any) {
    // 网络错误 → 尝试备用地址
    if (isNetworkError(err) && API_FALLBACK) {
      try {
        return await doFetch(API_FALLBACK)
      } catch (fallbackErr: any) {
        // 备用也失败
        if (isNetworkError(fallbackErr)) {
          window.dispatchEvent(new CustomEvent('server-offline', {
            detail: { message: '无法连接到服务器，请检查网络或服务器地址' },
          }))
          throw new Error('无法连接到服务器，请检查网络或服务器地址')
        }
        throw fallbackErr
      }
    }
    // 没有备用地址，或非网络错误
    if (isNetworkError(err)) {
      window.dispatchEvent(new CustomEvent('server-offline', {
        detail: { message: '无法连接到服务器，请检查网络或服务器地址' },
      }))
      throw new Error('无法连接到服务器，请检查网络或服务器地址')
    }
    throw err
  }
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

  // 人脸登录（用户可选填用户名，不填则全库匹配）
  loginWithFace(faceDescriptor: number[], username?: string) {
    return request<{ success: boolean; score?: number; user: { id: number; username: string; avatar?: string; vip?: number }; token: string }>('/auth/face/login', {
      method: 'POST',
      body: JSON.stringify({ username, faceDescriptor: faceDescriptor.join(',') }),
    })
  },

  // 人脸特征注册（登录后）
  registerFace(faceDescriptor: number[]) {
    return request<{ success: boolean; message: string }>('/auth/face/register', {
      method: 'POST',
      body: JSON.stringify({ faceDescriptor: faceDescriptor.join(',') }),
    })
  },

  // 修改密码
  changePassword(oldPassword: string, newPassword: string) {
    return request<{ success: boolean; message: string }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    })
  },

  // 忘记密码：通过用户名 + 验证码重置密码
  forgotPassword(username: string, newPassword: string, code: string, target: string) {
    return request<{ success: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username, newPassword, code, target }),
    })
  },

  // 获取客户端 IP 归属地（无需登录）
  getLocationByIp() {
    return request<{ success: boolean; ip: string; location: string; isPrivate?: boolean; detail?: any }>('/user/location/ip')
  },

  // 浏览器获取定位后上报（保存为用户 region）
  updateLocation(payload: { latitude?: number; longitude?: number; location?: string }) {
    return request<{ success: boolean; message: string; region: string }>('/user/location', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  // 用户
  getProfile() {
    return request<{
      success: boolean
      user: {
        id: number
        username: string
        phone: string
        email: string
        avatar: string
        bio: string
        gender: string
        region: string
        age: number
        vip: number
      }
    }>('/user/profile')
  },

  updateAvatar(avatarUrl: string) {
    return request<{ success: boolean; avatar: string }>('/user/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatar: avatarUrl }),
    })
  },

  updateProfile(payload: { username?: string; bio?: string; gender?: string; region?: string; age?: number }) {
    return request<{ success: boolean }>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
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

  // 获取好友申请历史
  getFriendRequestHistory() {
    return request<{ success: boolean; requests: Array<{ id: number; senderId: number; receiverId: number; senderUsername: string; senderAvatar: string; receiverUsername: string; receiverAvatar: string; status: string; createdAt: string }> }>('/friends/requests/history')
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

  // 修改密码（支持多种验证方式：旧密码/邮箱验证码/人脸验证）
  changePasswordWithVerification(params: {
    oldPassword?: string
    newPassword: string
    verifyMethod: 'old_password' | 'email_code' | 'face'
    email?: string
    code?: string
    faceDescriptor?: number[]
  }) {
    return request<{ success: boolean; message: string }>('/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        faceDescriptor: params.faceDescriptor?.join(','),
      }),
    })
  },

  // 发送邮箱验证码（用于修改密码）
  sendPasswordResetCode(email: string) {
    return request<{ success: boolean; sent: boolean; message: string; code?: string }>('/auth/password/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
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
  getPosts(tab?: string) {
    const query = tab ? `?tab=${tab}` : ''
    return request<{ success: boolean; posts: Array<Post> }>(`/posts${query}`)
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

  createComment(postId: number, content: string, parentId?: number, replyToUserId?: number) {
    return request<{ success: boolean; comment: Comment; postUserId: number }>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId, replyToUserId }),
    })
  },

  deletePost(postId: number) {
    return request<{ success: boolean }>(`/posts/${postId}`, {
      method: 'DELETE',
    })
  },

  deleteComment(postId: number, commentId: number) {
    return request<{ success: boolean }>(`/posts/${postId}/comments/${commentId}`, {
      method: 'DELETE',
    })
  },

  // 通知
  getNotifications() {
    return request<{ success: boolean; notifications: Array<Notification> }>('/posts/notifications/list')
  },
  getNotificationUnread() {
    return request<{ success: boolean; count: number }>('/posts/notifications/unread')
  },
  markNotificationRead(id?: number) {
    return request<{ success: boolean }>('/posts/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ id }),
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
    return request<{ success: boolean; invited: number; message: string }>(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ newMemberIds }),
    })
  },

  getGroupInvitations() {
    return request<{ success: boolean; invitations: Array<{ id: number; groupId: number; inviterId: number; status: string; createdAt: string; groupName: string; inviterName: string; inviterAvatar: string }> }>('/groups/invitations/pending')
  },

  respondGroupInvitation(invitationId: number, action: 'accept' | 'decline') {
    return request<{ success: boolean; message: string; groupId?: number }>(`/groups/invitations/${invitationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
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
  type: 'text' | 'image' | 'file' | 'video'
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
  bio: string
  gender: string
  region: string
  commentCount: number
  isOfficial?: number
}

export interface Comment {
  id: number
  postId: number
  userId: number
  content: string
  createdAt: string
  username: string
  avatar: string
  bio?: string
  gender?: string
  region?: string
  parentId?: number | null
  replyToUserId?: number | null
  replyToUsername?: string | null
}

export interface Notification {
  id: number
  type: 'comment' | 'reply' | 'system'
  postId: number | null
  commentId: number | null
  fromUserId: number
  fromUsername: string
  fromAvatar: string
  content: string
  isRead: number
  createdAt: string
}

export interface GroupMessage {
  id: number
  groupId: number
  senderId: number
  content: string
  type: 'text' | 'image' | 'file' | 'video'
  fileUrl: string
  timestamp: string
  senderName: string
  senderAvatar: string
  bio?: string
  gender?: string
  region?: string
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