/**
 * 好友请求/列表路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { getIO, emitToUser } from '../socket.js'

const router = Router()

/**
 * 获取好友列表（含用户资料）
 */
router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const friends = stmtCache
      .get(`SELECT u.id, u.username, u.avatar, u.bio, u.gender, u.region, u.age, u.active, u.isOfficial
           FROM friendships f
           JOIN users u ON (u.id = f.friendId AND f.userId = ?)
           UNION ALL
           SELECT u.id, u.username, u.avatar, u.bio, u.gender, u.region, u.age, u.active, u.isOfficial
           FROM friendships f
           JOIN users u ON (u.id = f.userId AND f.friendId = ?)`)
      .all(userId, userId) as any[]
    res.json({ success: true, friends })
  } catch (error: any) {
    console.error('[friends]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 发送好友请求
 */
router.post('/request', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username } = req.body

    if (!username) {
      res.status(400).json({ success: false, error: '请输入用户名' })
      return
    }
    if (username === (req as any).user.username) {
      res.status(400).json({ success: false, error: '不能添加自己为好友' })
      return
    }

    const friend = stmtCache
      .get('SELECT id, username FROM users WHERE username = ? AND active = 1')
      .get(username) as any
    if (!friend) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const existing = stmtCache
      .get(`SELECT id FROM friendships
           WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)`)
      .get(userId, friend.id, friend.id, userId) as any

    if (existing) {
      res.status(400).json({ success: false, error: '已经是好友了' })
      return
    }

    const existingRequest = stmtCache
      .get(`SELECT id, senderId, receiverId, status FROM friend_requests
           WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)`)
      .get(userId, friend.id, friend.id, userId) as any

    if (existingRequest) {
      // 对方向我发过 pending 的请求 → 自动同意
      if (existingRequest.senderId === friend.id && existingRequest.status === 'pending') {
        stmtCache.get('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', existingRequest.id)
        stmtCache.get('INSERT OR IGNORE INTO friendships (userId, friendId) VALUES (?, ?)').run(userId, friend.id)

        const io = getIO()
        if (io) {
          emitToUser(userId, 'friend_added', {})
          emitToUser(friend.id, 'friend_added', {})
        }
        res.json({ success: true, message: '对方已向你发送过好友请求，已自动添加为好友', friend: { id: friend.id, username: friend.username } })
        return
      }

      // 我之前发过 pending 状态请求
      if (existingRequest.senderId === userId && existingRequest.status === 'pending') {
        res.status(400).json({ success: false, error: '已发送过好友请求，请等待对方同意' })
        return
      }

      // 其他情况（rejected / accepted 已失效 / 对方发过但非 pending）→ 重置并发送新请求
      stmtCache
        .get('UPDATE friend_requests SET senderId = ?, receiverId = ?, status = ?, createdAt = CURRENT_TIMESTAMP WHERE id = ?')
        .run(userId, friend.id, 'pending', existingRequest.id)

      const io = getIO()
      if (io) {
        emitToUser(friend.id, 'friend_request', {
          id: existingRequest.id,
          senderId: userId,
          senderUsername: (req as any).user.username,
        })
      }
      res.json({ success: true, message: '好友请求已发送' })
      return
    }

    // 全新的好友请求
    const newRequest = stmtCache
      .get('INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)')
      .run(userId, friend.id)
    const newRequestId = newRequest.lastInsertRowid

    const io = getIO()
    if (io) {
      emitToUser(friend.id, 'friend_request', {
        id: newRequestId,
        senderId: userId,
        senderUsername: (req as any).user.username,
      })
    }
    res.json({ success: true, message: '好友请求已发送' })
  } catch (error: any) {
    console.error('[friends-request]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 处理好友请求（同意/拒绝）
 */
router.post('/respond', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { requestId, action } = req.body

    if (!requestId || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ success: false, error: '参数错误' })
      return
    }

    const request = stmtCache
      .get('SELECT * FROM friend_requests WHERE id = ? AND receiverId = ? AND status = ?')
      .get(requestId, userId, 'pending') as any

    if (!request) {
      res.status(404).json({ success: false, error: '请求不存在或已处理' })
      return
    }

    if (action === 'accept') {
      const tx = db.transaction(() => {
        stmtCache.get('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', requestId)
        stmtCache.get('INSERT INTO friendships (userId, friendId) VALUES (?, ?)').run(userId, request.senderId)
      })
      tx()

      const io = getIO()
      if (io) {
        emitToUser(userId, 'friend_added', {})
        emitToUser(request.senderId, 'friend_request_responded', { accepted: true })
        emitToUser(request.senderId, 'friend_added', {})
      }
      res.json({ success: true, message: '已同意好友请求' })
    } else {
      stmtCache.get('UPDATE friend_requests SET status = ? WHERE id = ?').run('rejected', requestId)
      const io = getIO()
      if (io) {
        emitToUser(request.senderId, 'friend_request_responded', { accepted: false })
      }
      res.json({ success: true, message: '已拒绝好友请求' })
    }
  } catch (error: any) {
    console.error('[friends-respond]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 获取待处理的好友请求
 */
router.get('/requests', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const requests = stmtCache
      .get(`SELECT fr.id, fr.senderId, fr.status, fr.createdAt,
                 u.username AS senderUsername, u.avatar AS senderAvatar,
                 u.bio AS senderBio, u.gender AS senderGender, u.region AS senderRegion
           FROM friend_requests fr
           JOIN users u ON u.id = fr.senderId
           WHERE fr.receiverId = ? AND fr.status = 'pending'
           ORDER BY fr.createdAt DESC`)
      .all(userId) as any[]
    res.json({ success: true, requests })
  } catch (error: any) {
    console.error('[friends-requests]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 获取好友申请历史（全部状态：发送/收到/已同意/已拒绝）
 */
router.get('/requests/history', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const requests = stmtCache
      .get(`SELECT fr.id, fr.senderId, fr.receiverId, fr.status, fr.createdAt,
                 su.username AS senderUsername, su.avatar AS senderAvatar,
                 ru.username AS receiverUsername, ru.avatar AS receiverAvatar
           FROM friend_requests fr
           LEFT JOIN users su ON su.id = fr.senderId
           LEFT JOIN users ru ON ru.id = fr.receiverId
           WHERE fr.senderId = ? OR fr.receiverId = ?
           ORDER BY fr.createdAt DESC
           LIMIT 100`)
      .all(userId, userId) as any[]
    res.json({ success: true, requests })
  } catch (error: any) {
    console.error('[friends-requests-history]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 删除好友
 */
router.delete('/:friendId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const friendId = parseInt(req.params.friendId as string)

    const del = db.transaction(() => {
      stmtCache
        .get('DELETE FROM friendships WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)')
        .run(userId, friendId, friendId, userId)
      stmtCache
        .get('DELETE FROM messages WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)')
        .run(userId, friendId, friendId, userId)
    })
    del()

    res.json({ success: true })
  } catch (error: any) {
    console.error('[friends-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 搜索用户
 */
router.get('/search', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const q = (req.query.q as string) || ''

    if (!q) {
      res.json({ success: true, users: [] })
      return
    }

    const users = stmtCache
      .get('SELECT id, username FROM users WHERE username LIKE ? AND id != ? AND active = 1 LIMIT 10')
      .all(`%${q}%`, userId) as any[]

    res.json({ success: true, users })
  } catch (error: any) {
    console.error('[friends-search]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
