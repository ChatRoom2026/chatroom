/**
 * Socket.io 客户端
 * 支持浏览器（相对路径 + vite proxy）和 Capacitor Android 客户端（绝对地址）
 */
import { io, Socket } from 'socket.io-client'
import { getApiBaseUrl } from './api'
import { isAndroid, isNativeApp } from './platform'

let socket: Socket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function getSocketUrl(): string {
  if (isNativeApp() && isAndroid()) {
    // 从 API base 推导 socket 地址（去掉 /api 后缀）
    const base = getApiBaseUrl()
    return base.replace(/\/api$/, '')
  }
  return '/'
}

export function connectSocket(token: string) {
  if (socket?.connected) {
    return socket
  }

  const url = getSocketUrl()

  // 使用 polling 传输，避免 Android WebView 下的 WebSocket 兼容性问题
  socket = io(url, {
    auth: { token },
    transports: ['polling'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  })

  socket.on('connect_error', (error) => {
    console.error('Socket 连接失败，使用轮询模式:', error.message)
  })

  socket.on('connect', () => {
    console.log('Socket 已连接:', url)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  })

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
