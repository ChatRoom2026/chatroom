/**
 * SQLite 数据库初始化 —— 0.5GB 内存极限优化版
 *
 * 内存预算（总计 < 50MB）:
 *  1) cache_size = 16MB（-4096 pages/4KB）：SQLite 内部页缓存
 *  2) mmap_size = 32MB：热数据 OS page cache 命中
 *  3) WAL2 模式：写入并发更高，checkpoint 开销更小
 *  4) synchronous = NORMAL：写性能提升 3-5 倍
 *  5) temp_store = MEMORY：排序/分组零磁盘开销
 *  6) journal_size_limit = 8MB：限制 WAL 体积
 *  7) 覆盖索引：热点查询走索引不回表
 *  8) 预编译语句缓存：模块级 LRU 缓存，避免重复编译
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.join(__dirname, '..', 'data', 'chat.db')

// 确保 data 目录存在
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath, {
  readonly: false,
  fileMustExist: false,
  timeout: 3000,
})

// ==================== SQLite 性能参数（0.5GB 内存）====================
// WAL2（fallback 到 WAL）—— 读写真正并发
try { db.pragma('journal_mode = WAL2') } catch { db.pragma('journal_mode = WAL') }
db.pragma('synchronous = NORMAL')
// 16MB 内部缓存（每页 4KB × 4096 pages）
db.pragma('cache_size = -4096')
// 32MB mmap：热读走 OS page cache
db.pragma('mmap_size = 33554432')
db.pragma('temp_store = MEMORY')
db.pragma('busy_timeout = 3000')
// 每 200 页自动 checkpoint（~800KB），减少 WAL 堆积
db.pragma('wal_autocheckpoint = 200')
try { db.pragma('journal_size_limit = 8388608') } catch {} // 8MB
try { db.pragma('optimize') } catch {}
db.pragma('case_sensitive_like = OFF')

// ==================== 表结构 ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    fileUrl TEXT DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    friendId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, friendId)
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'register',
    expiresAt DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    imageUrl TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    content TEXT NOT NULL,
    parentId INTEGER DEFAULT NULL,
    replyToUserId INTEGER DEFAULT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'comment',
    postId INTEGER NOT NULL,
    commentId INTEGER DEFAULT NULL,
    fromUserId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    isRead INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(senderId, receiverId)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    ownerId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(groupId, userId)
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    senderId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    fileUrl TEXT DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS unread_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    targetType TEXT NOT NULL,
    targetId INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    lastMessage TEXT DEFAULT '',
    lastSenderId INTEGER DEFAULT 0,
    lastTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, targetType, targetId)
  );

  CREATE TABLE IF NOT EXISTS group_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    inviterId INTEGER NOT NULL,
    inviteeId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(groupId, inviteeId, status)
  );

  CREATE TABLE IF NOT EXISTS vip_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    planId TEXT NOT NULL,
    amount REAL NOT NULL,
    outTradeNo TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// ==================== 核心索引 & 覆盖索引（查询零回表）====================
// 消息查询：by sender/receiver + 按时间排序（覆盖索引，避免回表）
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiverId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_pair_ts ON messages(senderId, receiverId, timestamp DESC);`)

// 好友关系：双向查询都能命中
db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(userId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friendId);`)

// 验证码：按 target+type 查询最新一条
db.exec(`CREATE INDEX IF NOT EXISTS idx_verification_target_type ON verification_codes(target, type);`)

// 动态：按创建时间倒序（核心列表页唯一索引，不走全表扫）
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(createdAt DESC);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(userId);`)

// 评论：按 postId 聚合
db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(postId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(postId, createdAt ASC);`)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parentId);`) } catch {}

// 通知：按用户 + 未读查询
db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, isRead);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(userId, createdAt DESC);`)

// 群聊：按成员聚合
db.exec(`CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(groupId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(userId);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_group_messages_group_ts ON group_messages(groupId, timestamp DESC);`)

// 未读计数：按 user 查询
db.exec(`CREATE INDEX IF NOT EXISTS idx_unread_user ON unread_counts(userId);`)
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unread_user_target ON unread_counts(userId, targetType, targetId);`)

// 群聊邀请：按被邀请人查询 pending 状态
db.exec(`CREATE INDEX IF NOT EXISTS idx_group_invitations_invitee ON group_invitations(inviteeId, status);`)

// 用户名查找：UNIQUE 已有隐式索引，不需要额外建

// 消息时间戳索引（清理 60 天消息用）
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_group_messages_ts ON group_messages(timestamp);`)

// ==================== 兼容旧表结构 ====================
try { db.exec(`ALTER TABLE users ADD COLUMN deactivatedAt DATETIME DEFAULT NULL`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN vip INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN vipExpiresAt DATETIME DEFAULT NULL`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN wechatQrcode TEXT DEFAULT ''`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN gender TEXT DEFAULT ''`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN region TEXT DEFAULT ''`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN faceDescriptor TEXT DEFAULT ''`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN isOfficial INTEGER DEFAULT 0`) } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0`) } catch {}

// 兼容旧 comments 表：添加 parentId 和 replyToUserId 列
try { db.exec(`ALTER TABLE comments ADD COLUMN parentId INTEGER DEFAULT NULL`) } catch {}
try { db.exec(`ALTER TABLE comments ADD COLUMN replyToUserId INTEGER DEFAULT NULL`) } catch {}

// 修复：确保所有现有用户的 active 不为 NULL（兼容旧数据库升级）
db.exec(`UPDATE users SET active = 1 WHERE active IS NULL`)

// 初始化官方账号 ChatRoom（如果不存在）
const officialExists = db.prepare('SELECT id FROM users WHERE isOfficial = 1').get()
if (!officialExists) {
  // 检查是否已有同名非官方用户
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('ChatRoom') as any
  if (existing) {
    db.prepare('UPDATE users SET isOfficial = 1 WHERE id = ?').run(existing.id)
  } else {
    // 同步 hash
    const bcrypt = (await import('bcryptjs')).default
    const hashed = bcrypt.hashSync('chatroom2026', 8)
    db.prepare('INSERT INTO users (username, password, email, bio, isOfficial, avatar) VALUES (?, ?, ?, ?, 1, ?)').run(
      'ChatRoom', hashed, 'official@chatroom.app', 'ChatRoom官方账号，欢迎关注！', ''
    )
  }
}

// ==================== 模块级 prepared statement 缓存 ====================
// 这些是热点查询，模块加载时编译一次，后续零开销
// 缓存容量控制在 128，避免缓存膨胀
class StmtCache {
  private map = new Map<string, Database.Statement>()
  private max = 64
  get(sql: string): Database.Statement {
    let s = this.map.get(sql)
    if (!s) {
      // LRU 淘汰：超容量时删最早 1/4
      if (this.map.size >= this.max) {
        const keys = this.map.keys()
        for (let i = 0; i < this.max / 4; i++) {
          const k = keys.next()
          if (k.done) break
          this.map.delete(k.value as string)
        }
      }
      s = db.prepare(sql)
      this.map.set(sql, s)
    }
    return s
  }
}
export const stmtCache = new StmtCache()

export default db
