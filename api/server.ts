/**
 * local server entry file, for local development
 */
import http from 'http'
import app from './app.js'
import { initSocket } from './socket.js'
import db from './db.js'

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001

const server = http.createServer(app)
initSocket(server)

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`)
})

// 定时清理已注销账号（每小时执行一次）
const CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 小时
const CLEANUP_DELAY = 10 * 1000 // 启动后延迟 10 秒再执行首次

function cleanupDeactivatedUsers() {
  try {
    const deactivatedUsers = db.prepare('SELECT id, username FROM users WHERE active = 0').all() as any[]

    if (deactivatedUsers.length === 0) {
      return
    }

    console.log(`[清理] 发现 ${deactivatedUsers.length} 个已注销账号，正在清理...`)

    const cleanup = db.transaction(() => {
      for (const user of deactivatedUsers) {
        db.prepare('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
        console.log(`[清理] 已清除账号: ${user.username} (ID: ${user.id})`)
      }
    })

    cleanup()
    console.log(`[清理] 完成，共清理 ${deactivatedUsers.length} 个账号`)
  } catch (error) {
    console.error('[清理] 执行失败:', error)
  }
}

// 启动后延迟执行首次，然后每小时执行
setTimeout(() => {
  cleanupDeactivatedUsers()
  setInterval(cleanupDeactivatedUsers, CLEANUP_INTERVAL)
}, CLEANUP_DELAY)

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})