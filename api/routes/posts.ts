/**
 * 动态（Posts）路由
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const router = Router()

function authMiddleware(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}

/**
 * 获取所有动态（按最新排序）
 * GET /api/posts
 */
router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const posts = db.prepare(`
      SELECT p.id, p.userId, p.content, p.imageUrl,
             CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END as createdAt,
             u.username, u.avatar,
             (SELECT COUNT(*) FROM comments WHERE postId = p.id) as commentCount
      FROM posts p
      JOIN users u ON p.userId = u.id
      WHERE u.active = 1
      ORDER BY p.createdAt DESC
      LIMIT 50
    `).all()

    res.json({ success: true, posts })
  } catch (error) {
    console.error('Get posts error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 创建动态
 * POST /api/posts
 */
router.post('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { content, imageUrl } = req.body

    if (!content?.trim() && !imageUrl) {
      res.status(400).json({ success: false, error: '内容或图片不能为空' })
      return
    }

    const now = new Date().toISOString()

    const result = db.prepare(
      'INSERT INTO posts (userId, content, imageUrl, createdAt) VALUES (?, ?, ?, ?)'
    ).run(userId, content?.trim() || '', imageUrl || '', now)

    const post = db.prepare(`
      SELECT p.id, p.userId, p.content, p.imageUrl, p.createdAt,
             u.username, u.avatar, 0 as commentCount
      FROM posts p
      JOIN users u ON p.userId = u.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid)

    res.json({ success: true, post })
  } catch (error) {
    console.error('Create post error:', error)
    res.status(500).json({ success: false, error: '发布失败' })
  }
})

/**
 * 获取动态的评论
 * GET /api/posts/:id/comments
 */
router.get('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const postId = parseInt(req.params.id)

    const comments = db.prepare(`
      SELECT c.id, c.postId, c.userId, c.content,
             CASE WHEN instr(c.createdAt, 'T') THEN c.createdAt ELSE c.createdAt || 'Z' END as createdAt,
             u.username, u.avatar
      FROM comments c
      JOIN users u ON c.userId = u.id
      WHERE c.postId = ?
      ORDER BY c.createdAt ASC
    `).all(postId)

    res.json({ success: true, comments })
  } catch (error) {
    console.error('Get comments error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 添加评论
 * POST /api/posts/:id/comments
 */
router.post('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const postId = parseInt(req.params.id)
    const { content } = req.body

    if (!content?.trim()) {
      res.status(400).json({ success: false, error: '评论内容不能为空' })
      return
    }

    // 检查动态是否存在且作者未注销
    const post = db.prepare(`
      SELECT p.id, u.active FROM posts p
      JOIN users u ON p.userId = u.id
      WHERE p.id = ?
    `).get(postId) as any

    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }

    const result = db.prepare(
      'INSERT INTO comments (postId, userId, content, createdAt) VALUES (?, ?, ?, ?)'
    ).run(postId, userId, content.trim(), new Date().toISOString())

    const comment = db.prepare(`
      SELECT c.id, c.postId, c.userId, c.content, c.createdAt,
             u.username, u.avatar
      FROM comments c
      JOIN users u ON c.userId = u.id
      WHERE c.id = ?
    `).get(result.lastInsertRowid)

    // 返回评论和 postUserId（用于 socket 通知）
    res.json({ success: true, comment, postUserId: post.userId })
  } catch (error) {
    console.error('Create comment error:', error)
    res.status(500).json({ success: false, error: '评论失败' })
  }
})

/**
 * 删除动态（仅作者可删除）
 * DELETE /api/posts/:id
 */
router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const postId = parseInt(req.params.id)

    const post = db.prepare('SELECT userId FROM posts WHERE id = ?').get(postId) as any

    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }

    if (post.userId !== userId) {
      res.status(403).json({ success: false, error: '只能删除自己的动态' })
      return
    }

    // 先删除关联的评论，再删除动态
    const del = db.transaction(() => {
      db.prepare('DELETE FROM comments WHERE postId = ?').run(postId)
      db.prepare('DELETE FROM posts WHERE id = ?').run(postId)
    })
    del()

    res.json({ success: true })
  } catch (error) {
    console.error('Delete post error:', error)
    res.status(500).json({ success: false, error: '删除失败' })
  }
})

export default router