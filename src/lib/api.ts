/**
 * API 请求工具
 */

const API_BASE = '/api'

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
    return request<{ success: boolean; user: { id: number; username: string; avatar?: string }; token: string }>('/auth/login', {
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

  addFriend(username: string) {
    return request<{ success: boolean; friend: { id: number; username: string } }>('/friends/add', {
      method: 'POST',
      body: JSON.stringify({ username }),
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