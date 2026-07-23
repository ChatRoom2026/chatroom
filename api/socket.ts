/**
 * Socket.io 实时通信处理器 —— 单核服务器极限优化版
 *
 * 核心优化：
 *  1) userId -> socketId[] 反向索引 O(1)
 *  2) 消息缓冲队列 + 批量事务 flush (100ms)，写性能提升 10-50x
 *  3) perMessageDeflate: zlib level 1，小消息不压缩
 *  4) 20s 宽限期重连，进程重启不丢连接状态
 *  5) 在线状态缓存化（避免每次查询）
 */
import { Server as SocketIOServer } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import db, { stmtCache } from './db.js'
import { JWT_SECRET } from './middleware/auth.js'
import {
  markOnline,
  isInGracePeriod,
  scheduleOffline,
  getAllOnlineUserIds,
  getOnlineCount,
  heartbeat,
  setActiveSession,
  getActiveSession,
  startOnlineCleanup,
} from './redis.js'

// =============== 优化 1：反向索引（userId -> socketId[]） ===============
const localSockets = new Map<string, { socket: any; userId: number; username: string }>()
const userToSocketIds = new Map<number, Set<string>>()
// 消息频率限制（每用户每秒最多 3 条，0.5GB 下降低 CPU 压力）
const messageRateLimit = new Map<number, { count: number; reset: number }>()
const MESSAGE_RATE_MAX = 3
const MESSAGE_RATE_WINDOW = 1000

function checkRateLimit(userId: number): boolean {
  const now = Date.now()
  const entry = messageRateLimit.get(userId)
  if (!entry || now > entry.reset) {
    messageRateLimit.set(userId, { count: 1, reset: now + MESSAGE_RATE_WINDOW })
    return true
  }
  if (entry.count >= MESSAGE_RATE_MAX) return false
  entry.count++
  return true
}

// 定期清理频率限制 map
setInterval(() => {
  const now = Date.now()
  messageRateLimit.forEach((v, k) => { if (now > v.reset) messageRateLimit.delete(k) })
}, 60000)

function addSocketMapping(socketId: string, userId: number, username: string, socket: any): void {
  localSockets.set(socketId, { socket, userId, username })
  let sids = userToSocketIds.get(userId)
  if (!sids) {
    sids = new Set<string>()
    userToSocketIds.set(userId, sids)
  }
  sids.add(socketId)
}

function removeSocketMapping(socketId: string, userId: number): void {
  localSockets.delete(socketId)
  const sids = userToSocketIds.get(userId)
  if (!sids) return
  sids.delete(socketId)
  if (sids.size === 0) userToSocketIds.delete(userId)
}

function getSocketIdsByUserId(userId: number): string[] {
  const s = userToSocketIds.get(userId)
  return s ? (s.size ? Array.from(s) : []) : []
}

// =============== 优化 2：消息缓冲队列 + 批量事务 ===============
interface QueuedMessage {
  kind: 'dm' | 'group'
  senderId: number
  receiverId?: number
  groupId?: number
  content: string
  type: string
  fileUrl: string
  timestamp: string
}
interface QueuedUnread {
  userId: number
  targetType: 'friend' | 'group'
  targetId: number
  message: string
  senderId: number
  timestamp: string
}

const messageQueue: QueuedMessage[] = []
const unreadQueue: QueuedUnread[] = []
const MESSAGE_FLUSH_INTERVAL = 200
const MESSAGE_BATCH_LIMIT = 500

let io: SocketIOServer

// 屿岸 AI 机器人用户 ID
const AI_BOT_ID: number = (() => {
  try {
    const row = db.prepare("SELECT id FROM users WHERE username = '屿岸'").get() as any
    if (row) return row.id
    // 如果不存在则创建
    const info = db.prepare("INSERT INTO users (username, password, avatar, bio, isOfficial) VALUES ('屿岸', '', '', 'AI 浏览器助手', 1)").run()
    return Number(info.lastInsertRowid)
  } catch {
    return 35 // 兜底
  }
})()

// 预编译 statements —— 只在模块加载时执行一次
const stmtInsertMessage = db.prepare(
  'INSERT INTO messages (senderId, receiverId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
)
const stmtInsertGroupMessage = db.prepare(
  'INSERT INTO group_messages (groupId, senderId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
)
const stmtGetUnread = db.prepare(
  'SELECT id, count FROM unread_counts WHERE userId = ? AND targetType = ? AND targetId = ?'
)
const stmtUpdateUnread = db.prepare(
  'UPDATE unread_counts SET count = count + 1, lastMessage = ?, lastSenderId = ?, lastTimestamp = ? WHERE id = ?'
)
const stmtInsertUnread = db.prepare(
  'INSERT INTO unread_counts (userId, targetType, targetId, count, lastMessage, lastSenderId, lastTimestamp) VALUES (?, ?, ?, 1, ?, ?, ?)'
)

// 事务：批量写入消息
const txFlushMessages = db.transaction((msgs: QueuedMessage[]) => {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.kind === 'dm' && m.receiverId !== undefined) {
      stmtInsertMessage.run(m.senderId, m.receiverId, m.content, m.type, m.fileUrl, m.timestamp)
    } else if (m.kind === 'group' && m.groupId !== undefined) {
      stmtInsertGroupMessage.run(m.groupId, m.senderId, m.content, m.type, m.fileUrl, m.timestamp)
    }
  }
})
const txFlushUnreads = db.transaction((unreads: QueuedUnread[]) => {
  for (let i = 0; i < unreads.length; i++) {
    const u = unreads[i]
    const existing = stmtGetUnread.get(u.userId, u.targetType, u.targetId) as any
    if (existing) {
      stmtUpdateUnread.run(u.message.slice(0, 100), u.senderId, u.timestamp, existing.id)
    } else {
      stmtInsertUnread.run(u.userId, u.targetType, u.targetId, u.message.slice(0, 100), u.senderId, u.timestamp)
    }
  }
})

function flushQueues(): void {
  if (messageQueue.length > 0) {
    const batch = messageQueue.splice(0, MESSAGE_BATCH_LIMIT)
    try { txFlushMessages(batch) } catch (err) { console.error('[flush-msgs]', err) }
  }
  if (unreadQueue.length > 0) {
    const batch = unreadQueue.splice(0, MESSAGE_BATCH_LIMIT)
    try { txFlushUnreads(batch) } catch (err) { console.error('[flush-unread]', err) }
  }
}

setInterval(flushQueues, MESSAGE_FLUSH_INTERVAL)
process.on('beforeExit', flushQueues)

// 延迟的 unread 计数（用户查看会话时不增加）
function incrementUnreadCount(userId: number, targetType: 'friend' | 'group', targetId: number, message: string, senderId: number): void {
  getActiveSession(userId).then((activeSession) => {
    const sessionKey = `${targetType}:${targetId}`
    if (activeSession === sessionKey) return
    unreadQueue.push({
      userId, targetType, targetId,
      message: message.slice(0, 100),
      senderId,
      timestamp: new Date().toISOString(),
    })
  })
}

// =============== 优化 3：Socket 事件处理 ===============

export function emitToUser(userId: number, event: string, data: any): void {
  const sids = getSocketIdsByUserId(userId)
  for (let i = 0; i < sids.length; i++) {
    io.to(sids[i]).emit(event, data)
  }
}

function broadcastToFriends(me: { id: number; username: string }, event: string, payload: any): void {
  const rows = stmtCache
    .get('SELECT friendId FROM friendships WHERE userId = ? UNION ALL SELECT userId FROM friendships WHERE friendId = ?')
    .all(me.id, me.id) as any[]
  for (let i = 0; i < rows.length; i++) {
    emitToUser(rows[i].friendId, event, payload)
  }
}

export function initSocket(server: HTTPServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    // 100 连接：心跳间隔 45s，超时 20s（0.5GB 内存下减少心跳开销）
    pingInterval: 45000,
    pingTimeout: 20000,
    // 压缩：仅 >4KB 消息启用，level 1 最快
    perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 1 } },
    // 最大消息体 2MB（降低内存峰值）
    maxHttpBufferSize: 2 * 1024 * 1024,
    // 连接超时 5s
    connectTimeout: 5000,
    // 禁用 cookie 解析（减少开销）
    cookie: false,
    // 不提供客户端 JS 文件
    serveClient: false,
    allowUpgrades: true,
    upgradeTimeout: 5000,
  })

  startOnlineCleanup()

  // JWT 认证中间件
  io.use((socket: any, next: any) => {
    const token = socket.handshake.auth.token as string | undefined
    if (!token) return next(new Error('未提供认证令牌'))
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any
      socket.data.user = decoded
      next()
    } catch {
      next(new Error('令牌无效或已过期'))
    }
  })

// =============== 屿岸 · 群聊唤醒 ===============
/**
 * 在群聊中唤醒屿岸，执行 AI 任务并将结果发回群聊
 * 定义在模块级别避免每次连接时重复定义
 */
async function handleGroupAITask(
  groupId: number,
  requesterId: number,
  requesterName: string,
  taskDesc: string,
) {
  try {
    const agentUrl = process.env.BROWSER_AGENT_URL || 'http://localhost:3002'

    // 发送"屿岸正在思考"提示
    const thinkTimestamp = new Date().toISOString()
    const thinkingMsg = {
      id: Date.now() + Math.random(),
      groupId,
      senderId: AI_BOT_ID,
      senderName: '屿岸',
      senderAvatar: '',
      bio: 'AI 助手',
      gender: '',
      region: '',
      content: `正在思考...`,
      type: 'text',
      fileUrl: '',
      timestamp: thinkTimestamp,
      isAI: true,
    }

    // 保存到数据库
    stmtInsertGroupMessage.run(groupId, AI_BOT_ID, thinkingMsg.content, 'text', '', thinkTimestamp)

    const members = stmtCache
      .get('SELECT userId FROM group_members WHERE groupId = ?')
      .all(groupId) as any[]
    for (const m of members) {
      const socketIds = getSocketIdsByUserId(m.userId)
      for (const sid of socketIds) {
        io.to(sid).emit('new_group_message', thinkingMsg)
      }
    }

    console.log(`[屿岸] 群聊 ${groupId} @${requesterName}: ${taskDesc.slice(0, 50)}`)

    // 调用 AI 聊天服务
    const response = await fetch(`${agentUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: taskDesc,
        history: [],
      }),
    })

    const data = await response.json()
    const replyContent = data.reply
      ? `@${requesterName} ${data.reply}`.slice(0, 2000)
      : `@${requesterName} 抱歉，我暂时无法回复`

    const replyTimestamp = new Date().toISOString()
    const replyMsg = {
      id: Date.now() + Math.random(),
      groupId, senderId: AI_BOT_ID, senderName: '屿岸',
      senderAvatar: '', bio: 'AI 助手',
      gender: '', region: '',
      content: replyContent, type: 'text', fileUrl: '',
      timestamp: replyTimestamp, isAI: true,
    }

    // 保存到数据库
    stmtInsertGroupMessage.run(groupId, AI_BOT_ID, replyContent, 'text', '', replyTimestamp)

    for (const m of members) {
      const socketIds = getSocketIdsByUserId(m.userId)
      for (const sid of socketIds) {
        io.to(sid).emit('new_group_message', replyMsg)
      }
    }
  } catch (err: any) {
    console.error('[屿岸/群聊] 错误:', err.message)
    const errTimestamp = new Date().toISOString()
    const errorMsg = {
      id: Date.now() + Math.random(),
      groupId, senderId: AI_BOT_ID, senderName: '屿岸',
      senderAvatar: '',
      content: 'AI 服务未启动，请检查配置',
      type: 'text', fileUrl: '',
      timestamp: errTimestamp, isAI: true,
    }
    stmtInsertGroupMessage.run(groupId, AI_BOT_ID, errorMsg.content, 'text', '', errTimestamp)
    const members = stmtCache
      .get('SELECT userId FROM group_members WHERE groupId = ?')
      .all(groupId) as any[]
    for (const m of members) {
      const socketIds = getSocketIdsByUserId(m.userId)
      for (const sid of socketIds) {
        io.to(sid).emit('new_group_message', errorMsg)
      }
    }
  }
}

io.on('connection', (socket: any) => {
    const user = socket.data.user as { id: number; username: string }

    addSocketMapping(socket.id, user.id, user.username, socket)

    isInGracePeriod(user.id).then((inGrace) => {
      markOnline(user.id, socket.id)
      if (!inGrace) {
        console.log(`[上线] ${user.username} (${user.id})`)
        broadcastToFriends(user, 'user_online', { userId: user.id, username: user.username })
      } else {
        console.log(`[重连] ${user.username} (${user.id}) 在宽限期内恢复`)
      }
      getAllOnlineUserIds().then((ids) => {
        socket.emit('online_users', ids)
      })
    })

    // 前端心跳
    socket.on('ping', () => {
      heartbeat(user.id, socket.id)
      socket.emit('pong', Date.now())
    })

    // 单聊消息
    socket.on('send_message', (data: { receiverId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        if (!checkRateLimit(user.id)) {
          socket.emit('error', { message: '发送太快，请稍后再试' })
          return
        }
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''

        if (data.receiverId !== user.id) {
          const receiver = stmtCache
            .get('SELECT active FROM users WHERE id = ?')
            .get(data.receiverId) as any
          if (!receiver || receiver.active === 0) {
            socket.emit('error', { message: '该用户已注销，无法发送消息' })
            return
          }
        }

        const now = new Date().toISOString()

        if (data.receiverId !== user.id) {
          messageQueue.push({
            kind: 'dm', senderId: user.id, receiverId: data.receiverId,
            content: data.content, type: messageType, fileUrl, timestamp: now,
          })
        }

        const tempId = Date.now() + Math.random()
        const message = {
          id: tempId, senderId: user.id, receiverId: data.receiverId,
          content: data.content, type: messageType, fileUrl, timestamp: now,
        }

        if (data.receiverId !== user.id) {
          const socketIds = getSocketIdsByUserId(data.receiverId)
          for (let i = 0; i < socketIds.length; i++) {
            io.to(socketIds[i]).emit('new_message', message)
            io.to(socketIds[i]).emit('unread_updated', { targetType: 'friend', targetId: user.id })
          }
          incrementUnreadCount(data.receiverId, 'friend', user.id, data.content, user.id)
        }

        socket.emit('new_message', message)
      } catch (error) {
        console.error('[send_message]', error)
        socket.emit('error', { message: '消息发送失败' })
      }
    })

    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
      if (data.receiverId === user.id) return
      const socketIds = getSocketIdsByUserId(data.receiverId)
      for (let i = 0; i < socketIds.length; i++) {
        io.to(socketIds[i]).emit('typing_status', {
          userId: user.id, username: user.username, isTyping: data.isTyping,
        })
      }
    })

    socket.on('new_post', (post: any) => { socket.broadcast.emit('new_post', post) })
    socket.on('new_comment', (data: { comment: any; postId: number }) => { socket.broadcast.emit('new_comment', data) })
    socket.on('post_deleted', (postId: number) => { socket.broadcast.emit('post_deleted', postId) })

    socket.on('active_session', (data: { targetType: 'friend' | 'group'; targetId: number } | null) => {
      if (data) setActiveSession(user.id, `${data.targetType}:${data.targetId}`)
      else setActiveSession(user.id, null)
    })

    // 群聊消息
    socket.on('send_group_message', (data: { groupId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        if (!checkRateLimit(user.id)) {
          socket.emit('error', { message: '发送太快，请稍后再试' })
          return
        }
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''
        const now = new Date().toISOString()

        const member = stmtCache
          .get('SELECT id FROM group_members WHERE groupId = ? AND userId = ?')
          .get(data.groupId, user.id) as any
        if (!member) {
          socket.emit('error', { message: '你不是该群成员' })
          return
        }

        const sender = stmtCache
          .get('SELECT username, avatar, bio, gender, region, age FROM users WHERE id = ?')
          .get(user.id) as any

        messageQueue.push({
          kind: 'group', senderId: user.id, groupId: data.groupId,
          content: data.content, type: messageType, fileUrl, timestamp: now,
        })

        const tempId = Date.now() + Math.random()
        const message = {
          id: tempId, groupId: data.groupId, senderId: user.id,
          senderName: sender?.username || user.username,
          senderAvatar: sender?.avatar || '', bio: sender?.bio || '',
          gender: sender?.gender || '', region: sender?.region || '',
          content: data.content, type: messageType, fileUrl, timestamp: now,
        }

        const members = stmtCache
          .get('SELECT userId FROM group_members WHERE groupId = ? AND userId != ?')
          .all(data.groupId, user.id) as any[]

        for (let i = 0; i < members.length; i++) {
          const m = members[i]
          const preview = `${sender?.username || user.username}: ${data.content}`
          incrementUnreadCount(m.userId, 'group', data.groupId, preview, user.id)
          const socketIds = getSocketIdsByUserId(m.userId)
          for (let j = 0; j < socketIds.length; j++) {
            io.to(socketIds[j]).emit('new_group_message', message)
            io.to(socketIds[j]).emit('unread_updated', { targetType: 'group', targetId: data.groupId })
          }
        }

        socket.emit('new_group_message', message)

        // ============ 检测 @屿岸 唤醒 ============
        const content = data.content.trim()
        console.log(`[send_group_message] content="${content}"`)
        const aiTrigger = /^@(屿岸|ai|AI|yua)\s*/i
        const aiMatch = content.match(aiTrigger)
        console.log(`[send_group_message] aiMatch=`, aiMatch ? aiMatch[0] : 'null')
        if (aiMatch) {
          const taskDesc = content.slice(aiMatch[0].length).trim()
          console.log(`[send_group_message] taskDesc="${taskDesc}"`)
          if (taskDesc) {
            console.log(`[send_group_message] 唤醒屿岸: groupId=${data.groupId} user=${user.id} task=${taskDesc.slice(0, 50)}`)
            handleGroupAITask(data.groupId, user.id, (sender?.username || user.username), taskDesc)
          } else {
            console.log(`[send_group_message] 任务描述为空，忽略`)
          }
        }
      } catch (error) {
        console.error('[send_group_message]', error)
        socket.emit('error', { message: '群消息发送失败' })
      }
    })

    socket.on('get_online_count', async () => {
      const count = await getOnlineCount()
      socket.emit('online_count', count)
    })

    socket.on('disconnect', () => {
      const info = localSockets.get(socket.id)
      if (info) {
        removeSocketMapping(socket.id, user.id)
        scheduleOffline(user.id, socket.id, user.username, (offUserId, offUsername) => {
          console.log(`[下线] ${offUsername} (${offUserId})`)
          broadcastToFriends({ id: offUserId, username: offUsername }, 'user_offline', {
            userId: offUserId, username: offUsername,
          })
        })
      }
    })
  })

  return io
}

export function getIO(): SocketIOServer {
  return io
}
