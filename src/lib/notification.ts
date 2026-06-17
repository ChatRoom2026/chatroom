/**
 * 浏览器/Capacitor 通知工具
 * 在 Android 原生应用中使用系统通知通道
 */

import { isAndroid, isNativeApp } from './platform'

let permissionRequested = false
let permissionGranted = false

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  // Android 原生应用：通过 MainActivity 的 POST_NOTIFICATIONS 权限保证通知正常
  if (isNativeApp() && isAndroid()) {
    permissionGranted = true
    return true
  }

  if (!('Notification' in window)) {
    console.log('当前环境不支持 Notification API')
    return false
  }

  if (Notification.permission === 'granted') {
    permissionGranted = true
    return true
  }

  if (Notification.permission === 'denied') {
    return false
  }

  if (permissionRequested) {
    return false
  }

  permissionRequested = true
  try {
    const result = await Notification.requestPermission()
    permissionGranted = result === 'granted'
    return permissionGranted
  } catch (err) {
    console.error('请求通知权限失败:', err)
    return false
  }
}

export function showNotification(title: string, options?: NotificationOptions & { onClick?: () => void }) {
  if (typeof window === 'undefined') return

  // Android 原生环境：Capacitor 模式下由 WebView 触发，效果等同系统通知
  // 这里调用浏览器的 Notification API 即可显示在系统任务栏
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    const { onClick, ...notificationOptions } = options || {}
    const n = new Notification(title, {
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: 'chat-message',
      ...(notificationOptions as any),
    })
    if (onClick) {
      n.onclick = () => {
        window.focus()
        onClick()
        n.close()
      }
    }
    // 5 秒后自动关闭
    setTimeout(() => n.close(), 5000)
    return n
  } catch (err) {
    console.error('显示通知失败:', err)
  }
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function isNotificationGranted(): boolean {
  if (isNativeApp() && isAndroid()) return true
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
}
