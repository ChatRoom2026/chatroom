/**
 * 服务端入口 —— 500 用户极限优化版
 *
 * 启动命令（1GB 内存服务器）:
 *   node \
 *     --max-old-space-size=384 \         # V8 heap 384MB，留 640MB 给 OS + 连接
 *     --optimize-for-size \              # 优先内存而非速度
 *     --max-semi-space-size=2 \          # 新生代 2MB，减少 GC 停顿
 *     --initial-old-space-size=128 \     # 老生代初始 128MB
 *     api/server.ts
 *
 * 优化：
 *   - SQLite WAL2 + 64MB cache + 128MB mmap（1GB 内存下平衡）
 *   - Socket.IO 500 连接：心跳 25s + 仅 >2KB 压缩 + 5MB 消息上限
 *   - 自动清理：图片 30 天 / 视频 15 天 / 聊天文字 60 天
 *   - 批量写入缓冲 100ms，减少事务锁竞争
 *   - 优雅退出 + 未捕获异常兜底
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import app from './app.js'
import { initSocket } from './socket.js'
import db, { stmtCache } from './db.js'
import { initRedis, closeRedis, isUsingRedis } from './redis.js'

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
  if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.trim() === '') {
    warnings.push('⚠  DEEPSEEK_API_KEY 未设置：AI 聊天功能将不可用')
  }
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

// ============ 未捕获异常（防止服务因偶发错误退出） ============
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err.message)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason: any) => {
  console.error('[server] 未处理的 Promise 拒绝:', reason?.message || String(reason))
})

// ============ 定时清理已注销账号 ============
const CLEANUP_INTERVAL = 60 * 60 * 1000  // 1 小时
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
  console.log('[server] 退出完成')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
