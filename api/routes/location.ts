/**
 * IP 归属地 & 地理定位路由
 *
 * 策略：
 *  1) GET /api/user/location/ip  —— 从后端视角解析客户端公网 IP，并查询归属地
 *     - 本地开发：使用 req.ip / x-forwarded-for
 *     - 线上：x-forwarded-for 第一位
 *     - 使用 ip-api.com JSON 接口（免费，无 key）
 *  2) POST /api/user/location  —— 浏览器调用 navigator.geolocation 后上报，
 *     存储到该用户的 region 字段（覆盖模式，可在资料页手动编辑覆盖）
 *
 * 所有 SQL 走 stmtCache
 */
import { Router, type Request, type Response } from 'express'
import http from 'http'
import { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

// ---------- IP -> 归属地（http 调用 ip-api.com，失败回落到空） ----------
function lookupIpLocation(ip: string): Promise<{ country?: string; regionName?: string; city?: string; district?: string; isp?: string } | null> {
  return new Promise((resolve) => {
    try {
      const req = http.get(
        {
          host: 'ip-api.com',
          path: `/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,district,isp,lat,lon&lang=zh-CN`,
          timeout: 3000,
        },
        (res) => {
          let buf = ''
          res.on('data', (d) => (buf += d))
          res.on('end', () => {
            try {
              const data = JSON.parse(buf)
              if (data.status === 'success') {
                resolve({ country: data.country, regionName: data.regionName, city: data.city, district: data.district, isp: data.isp })
              } else {
                resolve(null)
              }
            } catch {
              resolve(null)
            }
          })
        }
      )
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
}

// 从请求解析真实 IP
function extractClientIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined) || ''
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim())
    if (parts[0]) return parts[0]
  }
  const real = (req.headers['x-real-ip'] as string | undefined) || ''
  if (real) return real
  const sock = (req.socket?.remoteAddress || req.ip || '').toString()
  return sock
}

// 工具：把 (country, regionName, city, district) 拼成简短的定位字符串
// 优先展示最精确的区县级别，如 "宁乡"、"桂东"、"郴州"
function formatLocation(info: { country?: string; regionName?: string; city?: string; district?: string }): string {
  const parts: string[] = []
  if (info.country) parts.push(info.country)
  if (info.regionName && info.regionName !== info.country) parts.push(info.regionName.replace(/省|市|自治区|特别行政区/g, ''))
  // 优先展示 district（区县级），如果 district 和 city 同名则只展示一个
  if (info.district && info.district !== info.city) {
    parts.push(info.district)
  } else if (info.city && info.city !== info.regionName) {
    parts.push(info.city)
  }
  return parts.join(' · ')
}

// 1) 获取客户端 IP 归属地（无需登录）
router.get('/ip', async (req: Request, res: Response): Promise<void> => {
  try {
    const ip = extractClientIp(req)
    // 内网/环回：本地调试返回示例
    const isPrivate = !ip || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.1')
    if (isPrivate) {
      res.json({
        success: true,
        ip: ip || '127.0.0.1',
        location: '本机 / 内网 IP，无法定位',
        isPrivate: true,
      })
      return
    }
    const info = await lookupIpLocation(ip)
    res.json({
      success: !!info,
      ip,
      location: info ? formatLocation(info) : '未知',
      detail: info || undefined,
    })
  } catch (error: any) {
    console.error('[location-ip]', error?.message || error)
    res.status(500).json({ success: false, error: '查询失败' })
  }
})

// 2) 浏览器端拿到经纬度后上报，直接存 region 字段
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { latitude, longitude, location } = req.body

    // 优先使用前端传的 location 文本（如 "中国 · 广东 · 深圳"）
    let regionToSave = (location as string) || ''
    if (!regionToSave && typeof latitude === 'number' && typeof longitude === 'number') {
      // 后端不内置逆地理编码，直接用 "经纬度" 简单表示
      regionToSave = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
    }
    if (regionToSave) {
      // 限长 50，避免污染
      const trimmed = regionToSave.slice(0, 50)
      stmtCache.get('UPDATE users SET region = ? WHERE id = ?').run(trimmed, userId)
      res.json({ success: true, message: '位置信息已保存', region: trimmed })
      return
    }
    res.status(400).json({ success: false, error: '未提供有效的位置信息' })
  } catch (error: any) {
    console.error('[location-save]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
