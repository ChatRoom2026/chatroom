/**
 * SQLite 数据库初始化
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
  timeout: 5000,
})

// ==================== SQLite 性能优化（一核服务器极限调优） ====================
// WAL 模式：读写并发从 0 提升到 "写不阻塞读"，写性能 3-10 倍
db.pragma('journal_mode = WAL')
// NORMAL：写性能提升 3-5 倍，但断电可能丢最后一次事务（聊天消息可接受）
// FULL 是最安全但最慢；我们做单机低成本部署，NORMAL 是最佳平衡点
db.pragma('synchronous = NORMAL')
// 内存缓存：~40MB（每页 4KB，10000 页），命中内存查询快 100 倍
db.pragma('cache_size = 10000')
// 内存映射读：大表查询时直接通过 mmap 读磁盘，读性能 2-5 倍
db.pragma('mmap_size = 2147483648')
// 临时表/临时索引放内存（排序、GROUP BY 大幅加速）
db.pragma('temp_store = MEMORY')
// 忙等待超时：并发写入时多等 5 秒而不是立即报错
db.pragma('busy_timeout = 5000')
// WAL 检查点阈值：超过 8MB 自动截断，防止 WAL 文件无限增长
db.pragma('wal_autocheckpoint = 2000')
// 限制 WAL 日志最大体积（SQLite 3.15+），防止异常增长
try { db.pragma('journal_size_limit = 67108864') } catch {} // 64MB
// 分析表统计信息：让查询优化器选更好的索引
try { db.pragma('optimize') } catch {}

// 创建表（兼容旧表结构，使用 IF NOT EXISTS 和 ALTER TABLE）
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
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (friendId) REFERENCES users(id),
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

  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiverId);
  CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(userId);
  CREATE INDEX IF NOT EXISTS idx_verification_target ON verification_codes(target);

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    imageUrl TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (postId) REFERENCES posts(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(postId);

  CREATE TABLE IF NOT EXISTS vip_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    planId TEXT NOT NULL,
    amount REAL NOT NULL,
    outTradeNo TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id),
    UNIQUE(senderId, receiverId)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    ownerId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (groupId) REFERENCES groups(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(groupId, userId)
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    senderId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    fileUrl TEXT DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (groupId) REFERENCES groups(id),
    FOREIGN KEY (senderId) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(groupId);
  CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(groupId);

  -- 未读消息计数表（单聊和群聊）
  CREATE TABLE IF NOT EXISTS unread_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    targetType TEXT NOT NULL,
    targetId INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    lastMessage TEXT DEFAULT '',
    lastSenderId INTEGER DEFAULT 0,
    lastTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(userId, targetType, targetId)
  );

  CREATE INDEX IF NOT EXISTS idx_unread_user ON unread_counts(userId);
`)

// 兼容旧表：添加 phone/email/active 列（如果不存在）
try {
  db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN deactivatedAt DATETIME DEFAULT NULL`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN vip INTEGER DEFAULT 0`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN vipExpiresAt DATETIME DEFAULT NULL`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN wechatQrcode TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN gender TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN region TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }

// 修复：确保所有现有用户的 active 不为 NULL（兼容旧数据库升级）
db.exec(`UPDATE users SET active = 1 WHERE active IS NULL`)

export default db