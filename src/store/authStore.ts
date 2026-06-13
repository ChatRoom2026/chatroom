import { create } from 'zustand'
import { api } from '@/lib/api'
import { connectSocket, disconnectSocket } from '@/lib/socket'

interface User {
  id: number
  username: string
  avatar?: string
}

interface AuthState {
  user: User | null
  token: string | null
  isLoggedIn: boolean
  login: (loginId: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string, code?: string) => Promise<void>
  logout: () => void
  deleteAccount: () => Promise<void>
  init: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoggedIn: false,

  init: () => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr)
        set({ user, token, isLoggedIn: true })
        connectSocket(token)
      } catch {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      }
    }
  },

  login: async (loginId, password) => {
    const res = await api.login(loginId, password)
    localStorage.setItem('token', res.token)
    localStorage.setItem('user', JSON.stringify(res.user))
    set({ user: res.user, token: res.token, isLoggedIn: true })
    connectSocket(res.token)
  },

  register: async (username, email, password, code?: string) => {
    const res = await api.register(username, email, password, code || '')
    localStorage.setItem('token', res.token)
    localStorage.setItem('user', JSON.stringify(res.user))
    set({ user: res.user, token: res.token, isLoggedIn: true })
    connectSocket(res.token)
  },

  logout: () => {
    disconnectSocket()
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null, isLoggedIn: false })
  },

  deleteAccount: async () => {
    await api.deactivateAccount()
    disconnectSocket()
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null, isLoggedIn: false })
  },
}))