import { create } from 'zustand'
import { api } from '@/lib/api'

export interface UnreadItem {
  targetType: 'friend' | 'group'
  targetId: number
  count: number
  lastMessage: string
  lastSenderId: number
  lastTimestamp: string
}

interface UnreadState {
  unread: Record<string, UnreadItem> // key = "friend:1" / "group:2"
  totalUnread: number
  loadUnread: () => Promise<void>
  incrementUnread: (targetType: 'friend' | 'group', targetId: number, message: string, senderId: number) => void
  clearUnread: (targetType: 'friend' | 'group', targetId: number) => Promise<void>
  getUnread: (targetType: 'friend' | 'group', targetId: number) => number
}

function keyOf(type: 'friend' | 'group', id: number) {
  return `${type}:${id}`
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  unread: {},
  totalUnread: 0,

  loadUnread: async () => {
    try {
      const res = await api.getUnread()
      if (res.success) {
        const map: Record<string, UnreadItem> = {}
        let total = 0
        for (const item of res.unread) {
          const key = keyOf(item.targetType, item.targetId)
          map[key] = item
          total += item.count
        }
        set({ unread: map, totalUnread: total })
      }
    } catch (err) {
      console.error('加载未读消息失败:', err)
    }
  },

  incrementUnread: (targetType, targetId, message, senderId) => {
    set((state) => {
      const key = keyOf(targetType, targetId)
      const existing = state.unread[key]
      const newItem: UnreadItem = existing
        ? {
            ...existing,
            count: existing.count + 1,
            lastMessage: message.slice(0, 100),
            lastSenderId: senderId,
            lastTimestamp: new Date().toISOString(),
          }
        : {
            targetType,
            targetId,
            count: 1,
            lastMessage: message.slice(0, 100),
            lastSenderId: senderId,
            lastTimestamp: new Date().toISOString(),
          }
      const newUnread = { ...state.unread, [key]: newItem }
      const total = Object.values(newUnread).reduce((sum, item) => sum + item.count, 0)
      return { unread: newUnread, totalUnread: total }
    })
  },

  clearUnread: async (targetType, targetId) => {
    const key = keyOf(targetType, targetId)
    // 先在 store 中清除（乐观更新）
    set((state) => {
      const newUnread = { ...state.unread }
      const oldCount = newUnread[key]?.count || 0
      delete newUnread[key]
      return { unread: newUnread, totalUnread: Math.max(0, state.totalUnread - oldCount) }
    })
    // 同步到后端
    try {
      await api.clearUnread(targetType, targetId)
    } catch (err) {
      console.error('清除未读失败:', err)
    }
  },

  getUnread: (targetType, targetId) => {
    const key = keyOf(targetType, targetId)
    return get().unread[key]?.count || 0
  },
}))
