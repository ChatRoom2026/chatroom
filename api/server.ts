/**
 * 服务端入口 —— 0.5GB 内存极限优化版
 *
 * 启动命令:
 *   node --max-old-space-size=128 --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64 --import tsx api/server.ts
 *
 * 内存预算（总计 < 200MB）:
 *   - V8 heap: 128MB
 *   - SQLite: 16MB cache + 32MB mmap = 48MB
 *   - OS + 其他: ~300MB 预留
 *   - 适合 512MB 内存 / 1 核 CPU（¥10-15/月）
 */
import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import { decryptDatabase, encryptDatabase } from './encrypt.js'

// 第一步：解密数据库（在加载任何数据库模块之前）
decryptDatabase()

// 第二步：动态加载数据库相关模块
const [{ default: app }, { initSocket }, dbMod, { initRedis, closeRedis, isUsingRedis }, { triggerEmergencyShutdown }] = await Promise.all([
  import('./app.js'),
  import('./socket.js'),
  import('./db.js'),
  import('./redis.js'),
  import('./routes/errorReport.js'),
])
const db = dbMod.default
const { stmtCache } = dbMod

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = process.env.PORT || 3001

// ============ 启动流程 ============
const server = http.createServer(app)
initSocket(server)

async function start(): Promise<void> {
  const redisOk = await initRedis()
  console.log(
    redisOk
      ? `[redis] 已连接，在线状态将持久化到 Redis`
      : `[redis] 未启用，使用内存模式存储在线状态`
  )

  // 启动时检查关键环境变量
  const warnings: string[] = []
  if (!process.env.JWT_SECRET) {
    warnings.push('⚠  JWT_SECRET 未设置：将自动生成随机密钥（每次重启会变化，用户需重新登录）')
  }
  if (warnings.length > 0) {
    console.log('[server] === 启动检查 ===')
    warnings.forEach((w) => console.log(w))
    console.log('[server] ==================')
  }

  server.listen(PORT, () => {
    console.log(`[server] 就绪，端口: ${PORT}`)
    console.log(`[server] V8 heap 上限: ${process.resourceUsage ? '由 --max-old-space-size 控制' : 'default'}`)
  })
}
start()

// Browser Agent 由 PM2 独立管理（端口 3002），避免端口冲突

// ============ 未捕获异常（严重时自动停服） ============

process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err.message)
  console.error(err.stack)
  // 严重错误（内存溢出、数据库连接丢失等）直接触发停服
  const fatalPatterns = ['ENOSPC', 'ECONNREFUSED', 'ETIMEDOUT', 'Out of memory', 'SQLITE']
  const message = (err.message || '').toLowerCase()
  const isFatal = fatalPatterns.some(p => message.includes(p.toLowerCase()))
  if (isFatal) {
    triggerEmergencyShutdown(`服务端未捕获异常: ${err.message.slice(0, 80)}`)
  }
})
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason)
  console.error('[server] 未处理的 Promise 拒绝:', msg)
})

// ============ 定时清理已注销账号 ============
const CLEANUP_INTERVAL = 2 * 60 * 60 * 1000  // 2 小时
const CLEANUP_DELAY = 10 * 1000

function cleanupDeactivatedUsers(): void {
  try {
    const deactivatedUsers = stmtCache
      .get('SELECT id, username FROM users WHERE active = 0')
      .all() as any[]
    if (deactivatedUsers.length === 0) return

    console.log(`[清理账号] 发现 ${deactivatedUsers.length} 个已注销账号，正在清理...`)
    const cleanup = db.transaction(() => {
      for (let i = 0; i < deactivatedUsers.length; i++) {
        const user = deactivatedUsers[i]
        stmtCache.get('DELETE FROM comments WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM posts WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM group_messages WHERE senderId = ?').run(user.id)
        stmtCache.get('DELETE FROM group_members WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM group_invitations WHERE inviterId = ? OR inviteeId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM unread_counts WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM users WHERE id = ?').run(user.id)
        console.log(`[清理账号] 已清除: ${user.username} (ID: ${user.id})`)
      }
    })
    cleanup()
    console.log(`[清理账号] 完成，共清理 ${deactivatedUsers.length} 个账号`)
  } catch (error) {
    console.error('[清理账号] 执行失败:', error)
  }
}

setTimeout(() => {
  cleanupDeactivatedUsers()
  setInterval(cleanupDeactivatedUsers, CLEANUP_INTERVAL)
}, CLEANUP_DELAY)

// ============ 定时清理上传目录（按文件类型分策略） ============
// 图片保留 30 天，视频保留 15 天
const UPLOAD_CLEANUP_INTERVAL = 60 * 60 * 1000 // 每小时

function cleanupExpiredUploads(): void {
  try {
    const uploadDir = path.join(__dirname, '..', 'uploads')
    if (!fs.existsSync(uploadDir)) return
    const now = Date.now()
    const files = fs.readdirSync(uploadDir)
    let removed = 0, totalFreed = 0
    for (let i = 0; i < files.length; i++) {
      const fullPath = path.join(uploadDir, files[i])
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        const ext = path.extname(files[i]).toLowerCase()
        const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.3gp'].includes(ext)
        const expireDays = isVideo ? 15 : 30
        if (stat.mtimeMs < now - expireDays * 24 * 60 * 60 * 1000) {
          totalFreed += stat.size
          fs.unlinkSync(fullPath)
          removed++
        }
      } catch (err: any) { /* skip */ }
    }
    if (removed > 0) {
      console.log(`[清理上传] 删除 ${removed} 个过期文件，释放 ${(totalFreed / 1024 / 1024).toFixed(2)} MB`)
    }
  } catch (error) { /* skip */ }
}

// ============ 定时清理聊天记录（文字 60 天） ============
const CHAT_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000 // 6 小时

function cleanupExpiredMessages(): void {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const dmDeleted = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff)
    const groupDeleted = db.prepare('DELETE FROM group_messages WHERE timestamp < ?').run(cutoff)
    if (dmDeleted.changes > 0 || groupDeleted.changes > 0) {
      console.log(`[清理消息] 私聊 ${dmDeleted.changes} 条 + 群聊 ${groupDeleted.changes} 条`)
    }
    // 清理期间执行 WAL checkpoint 回收磁盘
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
  } catch (error) { /* skip */ }
}

// ============ 定时清理过期验证码（30 分钟） ============
function cleanupExpiredCodes(): void {
  try {
    const r = db.prepare('DELETE FROM verification_codes WHERE expiresAt < ?').run(new Date().toISOString())
    if (r.changes > 0) console.log(`[清理验证码] ${r.changes} 条`)
  } catch {}
}

// ============ 定时清理过期通知（60 天） ============
function cleanupExpiredNotifications(): void {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const r = db.prepare('DELETE FROM notifications WHERE createdAt < ?').run(cutoff)
    if (r.changes > 0) console.log(`[清理通知] ${r.changes} 条`)
  } catch {}
}

setTimeout(() => {
  cleanupExpiredUploads()
  setInterval(cleanupExpiredUploads, UPLOAD_CLEANUP_INTERVAL)
}, 5 * 1000)

setTimeout(() => {
  cleanupExpiredMessages()
  setInterval(cleanupExpiredMessages, CHAT_CLEANUP_INTERVAL)
}, 10 * 1000)

setTimeout(() => {
  cleanupExpiredNotifications()
  setInterval(cleanupExpiredNotifications, CHAT_CLEANUP_INTERVAL)
}, 15 * 1000)

setTimeout(() => {
  cleanupExpiredCodes()
  setInterval(cleanupExpiredCodes, 30 * 60 * 1000)
}, 15 * 1000)

// ============ 优雅退出 ============
let shuttingDown = false

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，开始优雅退出...`)
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 5000)
    })
    console.log('[server] HTTP 服务已关闭')
  } catch (e: any) {
    console.error('[server] 关闭 HTTP 时出错:', e.message)
  }
  if (isUsingRedis()) {
    await closeRedis()
    console.log('[server] Redis 连接已关闭')
  }
  // 关闭数据库并加密
  try {
    db.close()
    console.log('[server] 数据库已关闭')
  } catch (e: any) {
    console.error('[server] 关闭数据库时出错:', e.message)
  }
  encryptDatabase()
  console.log('[server] 退出完成')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
