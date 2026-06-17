/**
 * Socket.io 实时通信处理器
 */
import { Server as SocketIOServer } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import db from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'

// 在线用户映射 userId -> socketId
const onlineUsers = new Map<number, string>()

// 当前正在查看的会话 userId -> targetType:targetId
const activeSessions = new Map<number, string>()

/**
 * 增加未读计数（如果不是当前正在查看的会话）
 */
function incrementUnreadCount(userId: number, targetType: 'friend' | 'group', targetId: number, message: string, senderId: number) {
  // 如果用户正在查看这个会话，不增加未读
  const sessionKey = `${targetType}:${targetId}`
  if (activeSessions.get(userId) === sessionKey) {
    return
  }

  // 尝试更新现有记录
  const existing = db.prepare(
    'SELECT id FROM unread_counts WHERE userId = ? AND targetType = ? AND targetId = ?'
  ).get(userId, targetType, targetId) as any

  if (existing) {
    db.prepare(
      'UPDATE unread_counts SET count = count + 1, lastMessage = ?, lastSenderId = ?, lastTimestamp = ? WHERE id = ?'
    ).run(message.slice(0, 100), senderId, new Date().toISOString(), existing.id)
  } else {
    db.prepare(
      'INSERT INTO unread_counts (userId, targetType, targetId, count, lastMessage, lastSenderId, lastTimestamp) VALUES (?, ?, ?, 1, ?, ?, ?)'
    ).run(userId, targetType, targetId, message.slice(0, 100), senderId, new Date().toISOString())
  }
}

let io: SocketIOServer

export function initSocket(server: HTTPServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  // Socket auth 中间件
  io.use((socket, next) => {
    const token = socket.handshake.auth.token
    if (!token) {
      return next(new Error('未提供认证令牌'))
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any
      socket.data.user = decoded
      next()
    } catch {
      next(new Error('令牌无效或已过期'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: number; username: string }
    console.log(`用户上线: ${user.username} (${user.id})`)

    // 记录在线状态
    onlineUsers.set(user.id, socket.id)

    // 通知好友该用户上线
    const friends = db.prepare(`
      SELECT friendId FROM friendships WHERE userId = ?
      UNION SELECT userId FROM friendships WHERE friendId = ?
    `).all(user.id, user.id) as any[]

    friends.forEach((f: any) => {
      const friendSocketId = onlineUsers.get(f.friendId)
      if (friendSocketId) {
        io.to(friendSocketId).emit('user_online', { userId: user.id, username: user.username })
      }
    })

    // 发送自己的在线状态给客户端
    socket.emit('online_users', Array.from(onlineUsers.keys()))

    // 处理发送消息
    socket.on('send_message', (data: { receiverId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''

        // 检查接收者是否已注销（跳过自己给自己发消息）
        if (data.receiverId !== user.id) {
          const receiver = db.prepare('SELECT active FROM users WHERE id = ?').get(data.receiverId) as any
          if (!receiver || receiver.active === 0) {
            socket.emit('error', { message: '该用户已注销，无法发送消息' })
            return
          }
        }

        // 保存消息到数据库（显式传入 ISO 时间戳）
        const now = new Date().toISOString()
        const result = db.prepare(
          'INSERT INTO messages (senderId, receiverId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(user.id, data.receiverId, data.content, messageType, fileUrl, now)

        const message = {
          id: result.lastInsertRowid,
          senderId: user.id,
          receiverId: data.receiverId,
          content: data.content,
          type: messageType,
          fileUrl,
          timestamp: new Date().toISOString(),
        }

        // 发送给接收者（如果在线，跳过自己）
        const receiverSocketId = onlineUsers.get(data.receiverId)
        if (receiverSocketId && data.receiverId !== user.id) {
          io.to(receiverSocketId).emit('new_message', message)
        }

        // 增加接收者的未读计数（跳过自己）
        if (data.receiverId !== user.id) {
          incrementUnreadCount(data.receiverId, 'friend', user.id, data.content, user.id)
          // 通知接收者更新未读
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('unread_updated', {
              targetType: 'friend',
              targetId: user.id,
            })
          }
        }

        // 发送回发送者确认
        socket.emit('new_message', message)
      } catch (error) {
        console.error('发送消息错误:', error)
        socket.emit('error', { message: '消息发送失败' })
      }
    })

    // 处理正在输入状态（跳过自己）
    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
      if (data.receiverId === user.id) return // 自己不用通知自己
      const receiverSocketId = onlineUsers.get(data.receiverId)
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing_status', {
          userId: user.id,
          username: user.username,
          isTyping: data.isTyping,
        })
      }
    })

    // 转发新动态到所有在线用户
    socket.on('new_post', (post: any) => {
      socket.broadcast.emit('new_post', post)
    })

    // 转发新评论到所有在线用户
    socket.on('new_comment', (data: { comment: any; postId: number }) => {
      socket.broadcast.emit('new_comment', data)
    })

    // 转发删除动态到所有在线用户
    socket.on('post_deleted', (postId: number) => {
      socket.broadcast.emit('post_deleted', postId)
    })

    // 用户切换会话 - 用于未读计数
    socket.on('active_session', (data: { targetType: 'friend' | 'group'; targetId: number } | null) => {
      if (data) {
        activeSessions.set(user.id, `${data.targetType}:${data.targetId}`)
      } else {
        activeSessions.delete(user.id)
      }
    })

    // 处理群消息
    socket.on('send_group_message', (data: { groupId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''
        const now = new Date().toISOString()

        // 检查是否为群成员
        const member = db.prepare(
          'SELECT id FROM group_members WHERE groupId = ? AND userId = ?'
        ).get(data.groupId, user.id)
        if (!member) {
          socket.emit('error', { message: '你不是该群成员' })
          return
        }

        const result = db.prepare(
          'INSERT INTO group_messages (groupId, senderId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(data.groupId, user.id, data.content, messageType, fileUrl, now)

        const message = {
          id: result.lastInsertRowid,
          groupId: data.groupId,
          senderId: user.id,
          senderName: user.username,
          senderAvatar: '',
          content: data.content,
          type: messageType,
          fileUrl,
          timestamp: now,
        }

        // 获取所有群成员的在线 socket
        const members = db.prepare(
          'SELECT userId FROM group_members WHERE groupId = ? AND userId != ?'
        ).all(data.groupId, user.id) as any[]

        members.forEach((m: any) => {
          const memberSocketId = onlineUsers.get(m.userId)
          // 增加该成员的未读计数
          const preview = `${user.username}: ${data.content}`
          incrementUnreadCount(m.userId, 'group', data.groupId, preview, user.id)
          if (memberSocketId) {
            io.to(memberSocketId).emit('new_group_message', message)
            io.to(memberSocketId).emit('unread_updated', {
              targetType: 'group',
              targetId: data.groupId,
            })
          }
        })

        // 发回给发送者确认
        socket.emit('new_group_message', message)
      } catch (error) {
        console.error('发送群消息错误:', error)
        socket.emit('error', { message: '群消息发送失败' })
      }
    })

    // 处理断开连接
    socket.on('disconnect', () => {
      console.log(`用户下线: ${user.username} (${user.id})`)
      onlineUsers.delete(user.id)

      // 通知好友该用户下线
      friends.forEach((f: any) => {
        const friendSocketId = onlineUsers.get(f.friendId)
        if (friendSocketId) {
          io.to(friendSocketId).emit('user_offline', { userId: user.id, username: user.username })
        }
      })
    })
  })

  return io
}

export function getIO() {
  return io
}

export { onlineUsers }