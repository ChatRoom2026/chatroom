import { create } from 'zustand'
import { api, type Message, type GroupMessage } from '@/lib/api'

interface ChatState {
  messages: Record<number, Message[]>
  groupMessages: Record<number, GroupMessage[]>
  onlineUsers: number[]
  typingUsers: Record<number, boolean>
  loadMessages: (friendId: number) => Promise<void>
  loadGroupMessages: (groupId: number) => Promise<void>
  addMessage: (message: Message) => void
  addGroupMessage: (message: GroupMessage) => void
  clearMessages: (friendId: number) => void
  setOnlineUsers: (users: number[]) => void
  setTypingUser: (userId: number, isTyping: boolean) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  groupMessages: {},
  onlineUsers: [],
  typingUsers: {},

  loadMessages: async (friendId) => {
    const res = await api.getMessages(friendId)
    set((state) => ({
      messages: { ...state.messages, [friendId]: res.messages },
    }))
  },

  loadGroupMessages: async (groupId) => {
    const res = await api.getGroupMessages(groupId)
    set((state) => ({
      groupMessages: { ...state.groupMessages, [groupId]: res.messages },
    }))
  },

  addMessage: (message) => {
    set((state) => {
      const friendId = message.senderId === (JSON.parse(localStorage.getItem('user') || '{}').id)
        ? message.receiverId
        : message.senderId

      const existing = state.messages[friendId] || []
      if (existing.some((m) => m.id === message.id)) {
        return state
      }

      return {
        messages: {
          ...state.messages,
          [friendId]: [...existing, message],
        },
      }
    })
  },

  addGroupMessage: (message) => {
    set((state) => {
      const existing = state.groupMessages[message.groupId] || []
      if (existing.some((m) => m.id === message.id)) {
        return state
      }
      return {
        groupMessages: {
          ...state.groupMessages,
          [message.groupId]: [...existing, message],
        },
      }
    })
  },

  clearMessages: (friendId) => {
    set((state) => {
      const newMessages = { ...state.messages }
      delete newMessages[friendId]
      return { messages: newMessages }
    })
  },

  setOnlineUsers: (users) => {
    set({ onlineUsers: users })
  },

  setTypingUser: (userId, isTyping) => {
    set((state) => ({
      typingUsers: { ...state.typingUsers, [userId]: isTyping },
    }))
  },
}))