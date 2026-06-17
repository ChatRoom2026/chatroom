/**
 * 平台检测工具
 * 判断当前运行环境（Web/Android/iOS）
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform: () => boolean
      getPlatform: () => string
      platform: string
    }
  }
}

export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.Capacitor?.getPlatform?.() === 'android' ||
    /android/i.test(navigator.userAgent)
  )
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.Capacitor?.getPlatform?.() === 'ios' ||
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  )
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.Capacitor?.isNativePlatform?.()
}

export function getPlatform(): string {
  if (typeof window === 'undefined') return 'web'
  if (window.Capacitor?.getPlatform) {
    return window.Capacitor.getPlatform()
  }
  if (/android/i.test(navigator.userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'ios'
  return 'web'
}
