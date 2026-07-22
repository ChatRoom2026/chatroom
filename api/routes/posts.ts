/**
 * 动态（Posts）路由 —— 支持嵌套评论 + 通知
 */
import { Router, type Request, type Response } from 'express'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { emitToUser } from '../socket.js'

const router = Router()

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const tab = (req.query.tab as string) || 'all'

    let posts: any[]
    if (tab === 'official') {
      posts = stmtCache
        .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                   CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                   u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                   (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
             FROM posts p
             JOIN users u ON p.userId = u.id
             WHERE u.active = 1 AND u.isOfficial = 1
             ORDER BY p.createdAt DESC
             LIMIT 50`)
        .all() as any[]
    } else if (tab === 'friends') {
      const friendIds = stmtCache
        .get(`SELECT friendId AS id FROM friendships WHERE userId = ?
              UNION
              SELECT userId AS id FROM friendships WHERE friendId = ?`)
        .all(userId, userId) as Array<{ id: number }>
      if (friendIds.length === 0) {
        posts = []
      } else {
        const placeholders = friendIds.map(() => '?').join(',')
        posts = stmtCache
          .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                     CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                     u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                     (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
               FROM posts p
               JOIN users u ON p.userId = u.id
               WHERE u.active = 1 AND p.userId IN (${placeholders})
               ORDER BY p.createdAt DESC
               LIMIT 50`)
          .all(...friendIds.map(f => f.id)) as any[]
      }
    } else {
      posts = stmtCache
        .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                   CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                   u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                   (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
             FROM posts p
             JOIN users u ON p.userId = u.id
             WHERE u.active = 1 AND (u.isOfficial IS NULL OR u.isOfficial = 0)
             ORDER BY p.createdAt DESC
             LIMIT 50`)
        .all() as any[]
    }
    res.json({ success: true, posts })
  } catch (error: any) {
    console.error('[posts]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { content, imageUrl } = req.body
    if (!content?.trim() && !imageUrl) {
      res.status(400).json({ success: false, error: '内容或图片不能为空' })
      return
    }
    const now = new Date().toISOString()
    const result = stmtCache
      .get('INSERT INTO posts (userId, content, imageUrl, createdAt) VALUES (?, ?, ?, ?)')
      .run(userId, content?.trim() || '', imageUrl || '', now)

    const post = stmtCache
      .get(`SELECT p.id, p.userId, p.content, p.imageUrl, p.createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region, 0 AS commentCount
           FROM posts p
           JOIN users u ON p.userId = u.id
           WHERE p.id = ?`)
      .get(result.lastInsertRowid)
    res.json({ success: true, post })
  } catch (error: any) {
    console.error('[posts-post]', error?.message || error)
    res.status(500).json({ success: false, error: '发布失败' })
  }
})

// 获取评论列表（含嵌套回复）
router.get('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const postId = parseInt(req.params.id as string)
    const comments = stmtCache
      .get(`SELECT c.id, c.postId, c.userId, c.content, c.parentId, c.replyToUserId,
                 CASE WHEN instr(c.createdAt, 'T') THEN c.createdAt ELSE c.createdAt || 'Z' END AS createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region,
                 ru.username AS replyToUsername
           FROM comments c
           JOIN users u ON c.userId = u.id
           LEFT JOIN users ru ON c.replyToUserId = ru.id
           WHERE c.postId = ?
           ORDER BY c.createdAt ASC`)
      .all(postId) as any[]
    res.json({ success: true, comments })
  } catch (error: any) {
    console.error('[posts-comments]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 创建评论（支持嵌套回复 parentId）
router.post('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const userUsername = (req as any).user.username
    const postId = parseInt(req.params.id as string)
    const { content, parentId, replyToUserId } = req.body

    if (!content?.trim()) {
      res.status(400).json({ success: false, error: '评论内容不能为空' })
      return
    }

    const post = stmtCache
      .get('SELECT p.id, p.userId, u.active FROM posts p JOIN users u ON p.userId = u.id WHERE p.id = ?')
      .get(postId) as any
    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }

    const now = new Date().toISOString()
    const result = stmtCache
      .get('INSERT INTO comments (postId, userId, content, parentId, replyToUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(postId, userId, content.trim(), parentId || null, replyToUserId || null, now)

    const comment = stmtCache
      .get(`SELECT c.id, c.postId, c.userId, c.content, c.parentId, c.replyToUserId,
                 c.createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region,
                 ru.username AS replyToUsername
           FROM comments c
           JOIN users u ON c.userId = u.id
           LEFT JOIN users ru ON c.replyToUserId = ru.id
           WHERE c.id = ?`)
      .get(result.lastInsertRowid)
    res.json({ success: true, comment, postUserId: post.userId })

    // ============ 通知逻辑（异步，不阻塞响应）============
    setImmediate(() => {
      try {
        const now = new Date().toISOString()
        const preview = content.trim().slice(0, 50) + (content.trim().length > 50 ? '...' : '')

        // 每个用户仅保留最近 20 条通知
        const cleanupNotif = (targetUserId: number) => {
          try {
            const rows = stmtCache
              .get('SELECT id FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 20 OFFSET 20')
              .all(targetUserId) as any[]
            if (rows.length > 0) {
              const ids = rows.map((r) => r.id).join(',')
              stmtCache.get(`DELETE FROM notifications WHERE id IN (${ids})`).run()
            }
          } catch {}
        }

        if (parentId && replyToUserId && replyToUserId !== userId) {
          // 回复评论：通知被回复的人
          stmtCache
            .get('INSERT INTO notifications (userId, type, postId, commentId, fromUserId, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(replyToUserId, 'reply', postId, result.lastInsertRowid, userId, preview, now)
          cleanupNotif(replyToUserId)
          emitToUser(replyToUserId, 'new_notification', {
            id: result.lastInsertRowid,
            commentId: Number(result.lastInsertRowid),
            postId,
            fromUserId: userId,
            fromUsername: userUsername,
            type: 'reply',
            content: preview,
          })
        } else if (post.userId !== userId) {
          // 评论动态：通知动态作者
          stmtCache
            .get('INSERT INTO notifications (userId, type, postId, commentId, fromUserId, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(post.userId, 'comment', postId, result.lastInsertRowid, userId, preview, now)
          cleanupNotif(post.userId)
          emitToUser(post.userId, 'new_notification', {
            id: result.lastInsertRowid,
            commentId: Number(result.lastInsertRowid),
            postId,
            fromUserId: userId,
            fromUsername: userUsername,
            type: 'comment',
            content: preview,
          })
        }
      } catch (err: any) {
        console.error('[notify]', err?.message || err)
      }
    })
  } catch (error: any) {
    console.error('[posts-comments-post]', error?.message || error)
    res.status(500).json({ success: false, error: '评论失败' })
  }
})

// 删除评论（仅本人可删除）
router.delete('/:postId/comments/:commentId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const commentId = parseInt(req.params.commentId as string)

    const comment = stmtCache
      .get('SELECT id, userId, postId, parentId FROM comments WHERE id = ?')
      .get(commentId) as any
    if (!comment) {
      res.status(404).json({ success: false, error: '评论不存在' })
      return
    }
    const isOfficial = (req as any).user.isOfficial === 1
    if (comment.userId !== userId && !isOfficial) {
      res.status(403).json({ success: false, error: '只能删除自己的评论' })
      return
    }

    // 官方号删除他人评论时，先获取评论内容用于通知
    let commentContent = ''
    const isOfficialDelete = isOfficial && comment.userId !== userId
    if (isOfficialDelete) {
      const c = stmtCache.get('SELECT content FROM comments WHERE id = ?').get(commentId) as any
      commentContent = c?.content || ''
    }

    // 删除该评论及其所有回复
    const del = db.transaction(() => {
      stmtCache.get('DELETE FROM comments WHERE parentId = ?').run(commentId)
      stmtCache.get('DELETE FROM comments WHERE id = ?').run(commentId)
    })
    del()

    // 官方号删除他人评论后发送通知
    if (isOfficialDelete) {
      const now = new Date().toISOString()
      const preview = commentContent.slice(0, 50) + (commentContent.length > 50 ? '...' : '')
      const officialName = (req as any).user.username || '官方'
      stmtCache
        .get('INSERT INTO notifications (userId, type, postId, commentId, fromUserId, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(comment.userId, 'system', comment.postId, null, userId, `你的评论「${preview}」被${officialName}删除`, now)
      emitToUser(comment.userId, 'new_notification', {
        postId: comment.postId,
        fromUserId: userId,
        fromUsername: officialName,
        type: 'system',
        content: `你的评论「${preview}」被${officialName}删除`,
      })
    }

    res.json({ success: true })
  } catch (error: any) {
    console.error('[posts-comments-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '删除失败' })
  }
})

router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const postId = parseInt(req.params.id as string)

    const post = stmtCache.get('SELECT id, userId, content FROM posts WHERE id = ?').get(postId) as any
    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }
    const isOfficial = (req as any).user.isOfficial === 1
    if (post.userId !== userId && !isOfficial) {
      res.status(403).json({ success: false, error: '只能删除自己的动态' })
      return
    }

    const isOfficialDelete = isOfficial && post.userId !== userId

    const del = db.transaction(() => {
      stmtCache.get('DELETE FROM comments WHERE postId = ?').run(postId)
      stmtCache.get('DELETE FROM posts WHERE id = ?').run(postId)
    })
    del()

    // 官方号删除他人动态后发送通知
    if (isOfficialDelete) {
      const now = new Date().toISOString()
      const preview = (post.content || '').slice(0, 50) + ((post.content || '').length > 50 ? '...' : '')
      const officialName = (req as any).user.username || '官方'
      stmtCache
        .get('INSERT INTO notifications (userId, type, postId, commentId, fromUserId, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(post.userId, 'system', 0, null, userId, `你的动态「${preview}」被${officialName}删除`, now)
      emitToUser(post.userId, 'new_notification', {
        postId: null,
        fromUserId: userId,
        fromUsername: officialName,
        type: 'system',
        content: `你的动态「${preview}」被${officialName}删除`,
      })
    }

    res.json({ success: true })
  } catch (error: any) {
    console.error('[posts-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '删除失败' })
  }
})

// ==================== 通知 API ====================

// 获取通知列表
router.get('/notifications/list', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const notifications = stmtCache
      .get(`SELECT n.id, n.type, n.postId, n.commentId, n.fromUserId, n.content, n.isRead,
                 CASE WHEN instr(n.createdAt, 'T') THEN n.createdAt ELSE n.createdAt || 'Z' END AS createdAt,
                 u.username AS fromUsername, u.avatar AS fromAvatar
           FROM notifications n
           JOIN users u ON n.fromUserId = u.id
           WHERE n.userId = ?
           ORDER BY n.createdAt DESC
           LIMIT 20`)
      .all(userId) as any[]
    res.json({ success: true, notifications })
  } catch (error: any) {
    console.error('[notifications]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 获取未读通知数
router.get('/notifications/unread', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const row = stmtCache
      .get('SELECT COUNT(*) AS count FROM notifications WHERE userId = ? AND isRead = 0')
      .get(userId) as any
    res.json({ success: true, count: row?.count || 0 })
  } catch (error: any) {
    console.error('[notifications-unread]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 标记通知为已读
router.post('/notifications/read', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { id } = req.body
    if (id) {
      stmtCache.get('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?').run(id, userId)
    } else {
      stmtCache.get('UPDATE notifications SET isRead = 1 WHERE userId = ?').run(userId)
    }
    res.json({ success: true })
  } catch (error: any) {
    console.error('[notifications-read]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router