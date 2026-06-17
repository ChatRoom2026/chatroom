/**
 * 群聊路由
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
 * 获取当前用户的所有群聊
 * GET /api/groups
 */
router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const groups = db.prepare(`
      SELECT g.id, g.name, g.avatar, g.ownerId,
             (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount,
             (SELECT content FROM group_messages WHERE groupId = g.id ORDER BY timestamp DESC LIMIT 1) as lastMessage,
             (SELECT timestamp FROM group_messages WHERE groupId = g.id ORDER BY timestamp DESC LIMIT 1) as lastMessageTime
      FROM groups g
      JOIN group_members gm ON g.id = gm.groupId
      WHERE gm.userId = ?
      ORDER BY lastMessageTime DESC
    `).all(userId)

    res.json({ success: true, groups })
  } catch (error) {
    console.error('Get groups error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 创建群聊
 * POST /api/groups
 */
router.post('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { name, memberIds } = req.body

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: '群名称不能为空' })
      return
    }

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ success: false, error: '请选择群成员' })
      return
    }

    // 去重并确保不包含自己
    const uniqueMembers = [...new Set([...memberIds, userId])]

    const result = db.transaction(() => {
      // 创建群
      const groupResult = db.prepare(
        'INSERT INTO groups (name, ownerId) VALUES (?, ?)'
      ).run(name.trim(), userId)

      const groupId = groupResult.lastInsertRowid

      // 添加成员
      const insertMember = db.prepare(
        'INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)'
      )

      for (const mid of uniqueMembers) {
        const role = mid === userId ? 'owner' : 'member'
        insertMember.run(groupId, mid, role)
      }

      return groupId
    })()

    const group = db.prepare(`
      SELECT g.id, g.name, g.avatar, g.ownerId,
             (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
      FROM groups g WHERE g.id = ?
    `).get(result)

    res.json({ success: true, group })
  } catch (error) {
    console.error('Create group error:', error)
    res.status(500).json({ success: false, error: '创建群聊失败' })
  }
})

/**
 * 获取群成员
 * GET /api/groups/:id/members
 */
router.get('/:id/members', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const members = db.prepare(`
      SELECT u.id, u.username, u.avatar, gm.role, gm.joinedAt
      FROM group_members gm
      JOIN users u ON gm.userId = u.id
      WHERE gm.groupId = ? AND u.active = 1
      ORDER BY gm.role = 'owner' DESC, gm.joinedAt ASC
    `).all(groupId)

    res.json({ success: true, members })
  } catch (error) {
    console.error('Get group members error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 获取群消息
 * GET /api/groups/:id/messages
 */
router.get('/:id/messages', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id

    // 检查是否为群成员
    const member = db.prepare(
      'SELECT id FROM group_members WHERE groupId = ? AND userId = ?'
    ).get(groupId, userId)

    if (!member) {
      res.status(403).json({ success: false, error: '你不是该群成员' })
      return
    }

    const messages = db.prepare(`
      SELECT gm.id, gm.groupId, gm.senderId, gm.content, gm.type, gm.fileUrl, gm.timestamp,
             u.username as senderName, u.avatar as senderAvatar
      FROM group_messages gm
      JOIN users u ON gm.senderId = u.id
      WHERE gm.groupId = ?
      ORDER BY gm.timestamp ASC
      LIMIT 100
    `).all(groupId)

    // 统一时间戳格式
    const formatted = (messages as any[]).map((m) => ({
      ...m,
      timestamp: m.timestamp ? (m.timestamp.includes('Z') ? m.timestamp : m.timestamp.replace(' ', 'T') + 'Z') : m.timestamp,
    }))

    res.json({ success: true, messages: formatted })
  } catch (error) {
    console.error('Get group messages error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 添加群成员 - 任何群成员都可以添加好友进群
 * POST /api/groups/:id/members
 */
router.post('/:id/members', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id
    const { newMemberIds } = req.body

    // 检查群是否存在
    const group = db.prepare('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    // 检查是否是群成员
    const isMember = db.prepare(
      'SELECT id FROM group_members WHERE groupId = ? AND userId = ?'
    ).get(groupId, userId)
    if (!isMember) {
      res.status(403).json({ success: false, error: '只有群成员可以添加好友' })
      return
    }

    if (!newMemberIds || !Array.isArray(newMemberIds) || newMemberIds.length === 0) {
      res.status(400).json({ success: false, error: '请选择要添加的成员' })
      return
    }

    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO group_members (groupId, userId, role) VALUES (?, ?, ?)'
    )

    let added = 0
    for (const mid of newMemberIds) {
      const result = insertMember.run(groupId, mid, 'member')
      if (result.changes > 0) added++
    }

    const memberCount = (db.prepare('SELECT COUNT(*) as count FROM group_members WHERE groupId = ?').get(groupId) as any).count

    res.json({ success: true, added, memberCount })
  } catch (error) {
    console.error('Add group member error:', error)
    res.status(500).json({ success: false, error: '添加成员失败' })
  }
})

/**
 * 移除群成员
 * DELETE /api/groups/:id/members/:memberId
 */
router.delete('/:id/members/:memberId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id
    const memberId = parseInt(req.params.memberId)

    const group = db.prepare('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    // 群主可以移除任何人，成员可以退出自己
    if (group.ownerId !== userId && userId !== memberId) {
      res.status(403).json({ success: false, error: '无权操作' })
      return
    }

    // 不能移除群主
    if (memberId === group.ownerId) {
      res.status(400).json({ success: false, error: '不能移除群主' })
      return
    }

    db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, memberId)
    res.json({ success: true })
  } catch (error) {
    console.error('Remove group member error:', error)
    res.status(500).json({ success: false, error: '移除成员失败' })
  }
})

/**
 * 更新群名称 - 仅群主（创建者）可修改
 * PUT /api/groups/:id
 */
router.put('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id
    const { name } = req.body

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: '群名称不能为空' })
      return
    }

    const group = db.prepare('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    if (group.ownerId !== userId) {
      res.status(403).json({ success: false, error: '仅群主可修改群名称' })
      return
    }

    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name.trim(), groupId)
    res.json({ success: true })
  } catch (error) {
    console.error('Update group name error:', error)
    res.status(500).json({ success: false, error: '更新群名称失败' })
  }
})

/**
 * 退出群聊 - 任何群成员都可以退出（群主退出则自动转让）
 * POST /api/groups/:id/leave
 */
router.post('/:id/leave', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id

    const group = db.prepare('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    const isMember = db.prepare(
      'SELECT id, role FROM group_members WHERE groupId = ? AND userId = ?'
    ).get(groupId, userId) as any
    if (!isMember) {
      res.status(400).json({ success: false, error: '你不在该群中' })
      return
    }

    // 使用事务处理
    const transaction = db.transaction(() => {
      // 如果是群主退出，先找到第一个加入的成员作为新群主
      if (group.ownerId === userId) {
        const otherMembers = db.prepare(
          'SELECT userId FROM group_members WHERE groupId = ? AND userId != ? ORDER BY joinedAt ASC LIMIT 1'
        ).get(groupId, userId) as any

        if (otherMembers) {
          // 转让群主
          db.prepare('UPDATE groups SET ownerId = ? WHERE id = ?').run(otherMembers.userId, groupId)
        }
      }

      // 移除成员
      db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId)
    })

    transaction()

    res.json({ success: true })
  } catch (error) {
    console.error('Leave group error:', error)
    res.status(500).json({ success: false, error: '退出群聊失败' })
  }
})

/**
 * 解散群聊 - 仅群主可解散
 * DELETE /api/groups/:id
 */
router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const userId = (req as any).user.id

    const group = db.prepare('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    if (group.ownerId !== userId) {
      res.status(403).json({ success: false, error: '仅群主可解散群聊' })
      return
    }

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM group_messages WHERE groupId = ?').run(groupId)
      db.prepare('DELETE FROM group_members WHERE groupId = ?').run(groupId)
      db.prepare('DELETE FROM groups WHERE id = ?').run(groupId)
    })

    transaction()
    res.json({ success: true })
  } catch (error) {
    console.error('Delete group error:', error)
    res.status(500).json({ success: false, error: '解散群聊失败' })
  }
})

/**
 * 获取群详情（包含创建者信息）
 * GET /api/groups/:id
 */
router.get('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id)
    const group = db.prepare(`
      SELECT g.id, g.name, g.avatar, g.ownerId, g.createdAt,
             u.username as ownerName,
             (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
      FROM groups g
      JOIN users u ON g.ownerId = u.id
      WHERE g.id = ?
    `).get(groupId) as any

    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    res.json({ success: true, group })
  } catch (error) {
    console.error('Get group error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router