/**
 * 群聊路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { getIO, emitToUser } from '../socket.js'

const router = Router()

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const groups = stmtCache
      .get(`SELECT g.id, g.name, g.avatar, g.ownerId, gm.role,
                 (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) AS memberCount,
                 (SELECT content FROM group_messages WHERE groupId = g.id ORDER BY timestamp DESC LIMIT 1) AS lastMessage,
                 (SELECT timestamp FROM group_messages WHERE groupId = g.id ORDER BY timestamp DESC LIMIT 1) AS lastMessageTime
           FROM groups g
           JOIN group_members gm ON g.id = gm.groupId
           WHERE gm.userId = ?
           ORDER BY lastMessageTime DESC`)
      .all(userId) as any[]
    res.json({ success: true, groups })
  } catch (error: any) {
    console.error('[groups]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { name, memberIds } = req.body

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: '群名称不能为空' })
      return
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ success: false, error: '请选择群成员' })
      return
    }

    const uniqueMembers = [...new Set<number>([...(memberIds as number[]), userId])]
    const insertMember = stmtCache.get('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)')

    const tx = db.transaction(() => {
      const groupResult = stmtCache.get('INSERT INTO groups (name, ownerId) VALUES (?, ?)').run(name.trim(), userId)
      const groupId = groupResult.lastInsertRowid
      for (const mid of uniqueMembers) {
        insertMember.run(groupId, mid, mid === userId ? 'owner' : 'member')
      }
      return groupId
    })
    const groupId = tx()

    const group = stmtCache
      .get(`SELECT g.id, g.name, g.avatar, g.ownerId,
                 (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) AS memberCount
           FROM groups g WHERE g.id = ?`)
      .get(groupId)
    res.json({ success: true, group })
  } catch (error: any) {
    console.error('[groups-post]', error?.message || error)
    res.status(500).json({ success: false, error: '创建群聊失败' })
  }
})

router.get('/:id/members', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const members = stmtCache
      .get(`SELECT u.id, u.username, u.avatar, gm.role, gm.joinedAt
           FROM group_members gm
           JOIN users u ON gm.userId = u.id
           WHERE gm.groupId = ? AND u.active = 1
           ORDER BY gm.role = 'owner' DESC, gm.joinedAt ASC`)
      .all(groupId) as any[]
    res.json({ success: true, members })
  } catch (error: any) {
    console.error('[groups-members]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.get('/:id/messages', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id

    const member = stmtCache
      .get('SELECT id FROM group_members WHERE groupId = ? AND userId = ?')
      .get(groupId, userId) as any
    if (!member) {
      res.status(403).json({ success: false, error: '你不是该群成员' })
      return
    }

    const messages = stmtCache
      .get(`SELECT gm.id, gm.groupId, gm.senderId, gm.content, gm.type, gm.fileUrl, gm.timestamp,
                 u.username AS senderName, u.avatar AS senderAvatar, u.bio, u.gender, u.region
           FROM group_messages gm
           JOIN users u ON gm.senderId = u.id
           WHERE gm.groupId = ?
           ORDER BY gm.timestamp DESC
           LIMIT 100`)
      .all(groupId) as any[]

    for (const m of messages) {
      if (m.timestamp && typeof m.timestamp === 'string' && !m.timestamp.endsWith('Z')) {
        if (!m.timestamp.includes('T')) m.timestamp = m.timestamp.replace(' ', 'T')
        if (!m.timestamp.endsWith('Z')) m.timestamp = m.timestamp + 'Z'
      }
    }
    res.json({ success: true, messages: messages.reverse() })
  } catch (error: any) {
    console.error('[groups-messages]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/:id/members', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id
    const inviterName = (req as any).user.username
    const { newMemberIds } = req.body

    const group = stmtCache.get('SELECT id, name FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    const isMember = stmtCache
      .get('SELECT id FROM group_members WHERE groupId = ? AND userId = ?')
      .get(groupId, userId) as any
    if (!isMember) {
      res.status(403).json({ success: false, error: '只有群成员可以邀请好友' })
      return
    }

    if (!Array.isArray(newMemberIds)) {
      res.status(400).json({ success: false, error: '请选择要邀请的成员' })
      return
    }

    const insertInvite = stmtCache.get(
      'INSERT OR IGNORE INTO group_invitations (groupId, inviterId, inviteeId, status) VALUES (?, ?, ?, ?)'
    )
    let invited = 0
    const io = getIO()
    for (const mid of newMemberIds as number[]) {
      // 检查是否已是群成员
      const already = stmtCache
        .get('SELECT id FROM group_members WHERE groupId = ? AND userId = ?')
        .get(groupId, mid) as any
      if (already) continue
      const r = insertInvite.run(groupId, userId, mid, 'pending')
      if (r.changes > 0) {
        invited++
        if (io) {
          emitToUser(mid, 'group_invitation', {
            groupId,
            groupName: group.name,
            inviterId: userId,
            inviterName,
          })
        }
      }
    }

    res.json({ success: true, invited, message: `已向 ${invited} 位好友发送邀请` })
  } catch (error: any) {
    console.error('[groups-invite]', error?.message || error)
    res.status(500).json({ success: false, error: '邀请失败' })
  }
})

router.delete('/:id/members/:memberId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id
    const memberId = parseInt(req.params.memberId as string)

    const group = stmtCache.get('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }
    if (group.ownerId !== userId && userId !== memberId) {
      res.status(403).json({ success: false, error: '无权操作' })
      return
    }
    if (memberId === group.ownerId) {
      res.status(400).json({ success: false, error: '不能移除群主' })
      return
    }

    stmtCache
      .get('DELETE FROM group_members WHERE groupId = ? AND userId = ?')
      .run(groupId, memberId)
    res.json({ success: true })
  } catch (error: any) {
    console.error('[groups-deletemember]', error?.message || error)
    res.status(500).json({ success: false, error: '移除成员失败' })
  }
})

router.put('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id
    const { name } = req.body

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: '群名称不能为空' })
      return
    }

    const group = stmtCache.get('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }
    if (group.ownerId !== userId) {
      res.status(403).json({ success: false, error: '仅群主可修改群名称' })
      return
    }

    stmtCache.get('UPDATE groups SET name = ? WHERE id = ?').run(name.trim(), groupId)
    res.json({ success: true })
  } catch (error: any) {
    console.error('[groups-put]', error?.message || error)
    res.status(500).json({ success: false, error: '更新群名称失败' })
  }
})

router.post('/:id/leave', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id

    const group = stmtCache.get('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }

    const tx = db.transaction(() => {
      if (group.ownerId === userId) {
        const other = stmtCache
          .get('SELECT userId FROM group_members WHERE groupId = ? AND userId != ? ORDER BY joinedAt ASC LIMIT 1')
          .get(groupId, userId) as any
        if (other) stmtCache.get('UPDATE groups SET ownerId = ? WHERE id = ?').run(other.userId, groupId)
      }
      stmtCache.get('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId)
    })
    tx()

    res.json({ success: true })
  } catch (error: any) {
    console.error('[groups-leave]', error?.message || error)
    res.status(500).json({ success: false, error: '退出群聊失败' })
  }
})

router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const userId = (req as any).user.id

    const group = stmtCache.get('SELECT id, ownerId FROM groups WHERE id = ?').get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }
    const isOfficial = (req as any).user.isOfficial === 1
    if (group.ownerId !== userId && !isOfficial) {
      res.status(403).json({ success: false, error: '仅群主可解散群聊' })
      return
    }

    const tx = db.transaction(() => {
      stmtCache.get('DELETE FROM group_messages WHERE groupId = ?').run(groupId)
      stmtCache.get('DELETE FROM group_members WHERE groupId = ?').run(groupId)
      stmtCache.get('DELETE FROM groups WHERE id = ?').run(groupId)
    })
    tx()
    res.json({ success: true })
  } catch (error: any) {
    console.error('[groups-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '解散群聊失败' })
  }
})

// ==================== 群聊邀请（必须在 /:id 之前） ====================

// 获取当前用户的待处理群聊邀请
router.get('/invitations/pending', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const invitations = stmtCache
      .get(`SELECT gi.id, gi.groupId, gi.inviterId, gi.status, gi.createdAt,
                 g.name AS groupName,
                 u.username AS inviterName, u.avatar AS inviterAvatar
           FROM group_invitations gi
           JOIN groups g ON gi.groupId = g.id
           JOIN users u ON gi.inviterId = u.id
           WHERE gi.inviteeId = ? AND gi.status = 'pending'
           ORDER BY gi.createdAt DESC`)
      .all(userId) as any[]
    res.json({ success: true, invitations })
  } catch (error: any) {
    console.error('[groups-invitations]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 接受/拒绝群聊邀请
router.post('/invitations/:id/respond', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const invitationId = parseInt(req.params.id as string)
    const { action } = req.body

    if (!['accept', 'decline'].includes(action)) {
      res.status(400).json({ success: false, error: '参数错误' })
      return
    }

    const invitation = stmtCache
      .get('SELECT * FROM group_invitations WHERE id = ? AND inviteeId = ? AND status = ?')
      .get(invitationId, userId, 'pending') as any
    if (!invitation) {
      res.status(404).json({ success: false, error: '邀请不存在或已处理' })
      return
    }

    if (action === 'accept') {
      const tx = db.transaction(() => {
        stmtCache.get('UPDATE group_invitations SET status = ? WHERE id = ?').run('accepted', invitationId)
        stmtCache.get('INSERT OR IGNORE INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(invitation.groupId, userId, 'member')
      })
      tx()
      const io = getIO()
      if (io) {
        emitToUser(userId, 'group_created', {})
      }
      res.json({ success: true, message: '已加入群聊', groupId: invitation.groupId })
    } else {
      stmtCache.get('UPDATE group_invitations SET status = ? WHERE id = ?').run('declined', invitationId)
      res.json({ success: true, message: '已拒绝邀请' })
    }
  } catch (error: any) {
    console.error('[groups-invitation-respond]', error?.message || error)
    res.status(500).json({ success: false, error: '处理失败' })
  }
})

router.get('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const groupId = parseInt(req.params.id as string)
    const group = stmtCache
      .get(`SELECT g.id, g.name, g.avatar, g.ownerId, g.createdAt,
                 u.username AS ownerName,
                 (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) AS memberCount
           FROM groups g
           JOIN users u ON g.ownerId = u.id
           WHERE g.id = ?`)
      .get(groupId) as any
    if (!group) {
      res.status(404).json({ success: false, error: '群聊不存在' })
      return
    }
    res.json({ success: true, group })
  } catch (error: any) {
    console.error('[groups-get]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
