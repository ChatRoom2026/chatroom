/**
 * Redis 在线状态存储管理器（0.5GB 内存优化版）
 *
 * 默认使用内存模式（零外部依赖），仅当 REDIS_URL 环境变量显式设置时才连接 Redis。
 * 内存模式内存开销 < 5MB（5000 用户上限）。
 */
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || ''
const ONLINE_TTL = 30
const OFFLINE_GRACE = 20    // 宽限期：掉线后 20s 内重连不算下线
const MAX_MEM_USERS = 5000       // 内存模式在线用户上限（防止内存泄漏）
const RECONNECT_INTERVAL = 30_000  // fallback 后每 30 秒尝试重连 Redis

const NS_ONLINE = 'chatroom:online'
const NS_SESSION = 'chatroom:session'
const NS_PENDING = 'chatroom:offline_pending'

let client: Redis | null = null
let fallback = false
let keyspaceListener: Redis | null = null
let memOnline = new Map<number, { socketId: string; ts: number }>()
let memSessions = new Map<number, string>()
let memPending = new Map<number, { socketId: string; timer: any }>()

/* -------------------- 连接与降级/恢复 -------------------- */

function createClient(opts: any = {}): any {
  const c = new Redis(REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 200,
    connectionName: 'chatroom-server',
    lazyConnect: true,
    enableOfflineQueue: true,
    ...opts,
  })
  return c
}

function redis(): Redis | null {
  if (fallback) return null
  if (!REDIS_URL) return null  // 未配置 Redis，直接使用内存模式
  if (client) return client
  try {
    client = createClient()
    client.on('error', (err) => {
      console.warn('[redis] 错误:', err.message.slice(0, 120))
    })
    client.on('end', () => {
      console.warn('[redis] 连接断开，进入降级模式')
      fallback = true
      tryRecover()
    })
    client.on('ready', () => {
      console.log('[redis] 已就绪')
    })
    return client
  } catch (err: any) {
    console.warn('[redis] 初始化失败，降级为内存模式:', err.message)
    fallback = true
    tryRecover()
    return null
  }
}

/** fallback 后定期尝试恢复 Redis 连接 */
function tryRecover() {
  if (!fallback) return
  const timer = setInterval(async () => {
    if (!fallback) {
      clearInterval(timer)
      return
    }
    console.log('[redis] 尝试恢复连接…')
    let testConn: any = null
    try {
      testConn = new Redis(REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      } as any)
      await testConn.ping()
      client = testConn
      client.on('error', (err) => console.warn('[redis] 恢复后错误:', err.message.slice(0, 80)))
      client.on('end', () => {
        fallback = true
        tryRecover()
      })
      fallback = false
      console.log('[redis] ✅ 连接已恢复')
      clearInterval(timer)
    } catch (err: any) {
      console.log('[redis] 恢复失败，继续降级模式:', err.message)
      if (testConn) try { testConn.disconnect() } catch {}
    }
  }, RECONNECT_INTERVAL)
}

export async function initRedis(): Promise<boolean> {
  const r = redis()
  if (!r) return false
  try {
    await r.ping()
    // 开启 keyspace 通知（用于监听在线用户 key 过期，自动处理下线）
    // CONFIG SET notify-keyspace-events Ex
    // E = keyevent 通知，x = 过期事件通知
    try {
      await r.config('SET', 'notify-keyspace-events', 'Ex')
      console.log('[redis] ✅ 启用 keyspace 过期通知')
    } catch (err: any) {
      console.warn('[redis] 启用 keyspace 通知失败 (Redis < 2.8 或无权限？', err.message)
    }
    return true
  } catch (err: any) {
    console.warn('[redis] ping 失败，降级为内存模式:', err.message)
    fallback = true
    tryRecover()
    return false
  }
}

export function isUsingRedis(): boolean {
  return !fallback && client !== null
}

/* -------------------- 业务 API -------------------- */

/** 用户上线 / 心跳 —— Lua 脚本合并 SETEX + SADD，一次 RTT 取代 3 次命令 */
export async function markOnline(userId: number, socketId: string): Promise<boolean> {
  const r = redis()
  if (r) {
    try {
      // EVAL "redis.call('SETEX',KEYS[1],ARGV[1],ARGV[2]); redis.call('SADD',KEYS[2],ARGV[3]); if redis.call('DEL',KEYS[3])==0 then return 1 end return 0" 3 chatroom:online:<uid> chatroom:online chatroom:offline_pending:<uid> 30 socketId userId
      await r.eval(
        `redis.call('SETEX', KEYS[1], ARGV[1], ARGV[2])
         redis.call('SADD', KEYS[2], ARGV[3])
         redis.call('DEL', KEYS[3])
         return 1`,
        3,
        `${NS_ONLINE}:${userId}`,
        NS_ONLINE,
        `${NS_PENDING}:${userId}`,
        ONLINE_TTL,
        socketId,
        String(userId),
      )
      return true
    } catch (err: any) {
      console.warn('[redis] markOnline 失败，降级处理:', err.message)
      // 降级内存模式兜底
    }
  }

  // 内存模式（Redis 不可用时）
  const prev = memPending.get(userId)
  if (prev) {
    clearTimeout(prev.timer)
    memPending.delete(userId)
  }
  // 防止内存无限增长
  if (memOnline.size >= MAX_MEM_USERS && !memOnline.has(userId)) {
    // 淘汰最老的 10%
    const toRemove = Math.floor(MAX_MEM_USERS * 0.1)
    let removed = 0
    for (const uid of memOnline.keys()) {
      memOnline.delete(uid)
      removed++
      if (removed >= toRemove) break
    }
  }
  memOnline.set(userId, { socketId, ts: Date.now() })
  return true
}

/** 用户是否在待下线宽限期内 */
export async function isInGracePeriod(userId: number): Promise<boolean> {
  const r = redis()
  if (r) {
    try {
      const exists = await r.exists(`${NS_PENDING}:${userId}`)
      return exists === 1
    } catch { /* ignore */ }
  }
  return memPending.has(userId)
}

/**
 * 延迟下线 —— Redis 模式：写 pending key（20s TTL），不再依赖本地 setTimeout（进程重启后由 keyspace 通知自动下线。
 * 内存模式：保留本地 setTimeout
 */
export function scheduleOffline(
  userId: number,
  socketId: string,
  username: string,
  doOffline: (userId: number, username: string) => void,
): void {
  const r = redis()
  if (r) {
    // Redis 模式：立即删除 online key（让 keyspace 通知触发自动下线）
    // 同时写入 pending key（20s 宽限期内重连视为上线）
    r.pipeline()
      .setex(`${NS_PENDING}:${userId}`, OFFLINE_GRACE, socketId)
      .del(`${NS_ONLINE}:${userId}`)
      .exec()
      .catch(() => {})

    // 本地 setTimeout 做低延迟兜底（进程重启丢失，Redis keyspace 通知兜底）
    setTimeout(async () => {
      try {
        const cur = redis()
        if (!cur) return
        const stillPending = await cur.exists(`${NS_PENDING}:${userId}`)
        if (stillPending === 1) {
          cur.pipeline()
            .del(`${NS_PENDING}:${userId}`)
            .srem(NS_ONLINE, String(userId))
            .exec()
            .catch(() => {})
          doOffline(userId, username)
        }
      } catch {
        // 忽略
      }
    }, OFFLINE_GRACE * 1000 + 500)
    return
  }

  // 内存模式
  memOnline.delete(userId)
  const prevTimer = memPending.get(userId)?.timer
  if (prevTimer) clearTimeout(prevTimer)
  const timer = setTimeout(() => {
    if (memPending.has(userId)) {
      memPending.delete(userId)
      doOffline(userId, username)
    }
  }, OFFLINE_GRACE * 1000)
  memPending.set(userId, { socketId, timer })
}

/** 获取用户 socketId（用于发送定向消息） */
export async function getUserSocketId(userId: number): Promise<string | null> {
  const r = redis()
  if (r) {
    try {
      return await r.get(`${NS_ONLINE}:${userId}`)
    } catch {
      return null
    }
  }
  return memOnline.get(userId)?.socketId || null
}

/**
 * 获取所有在线用户 ID —— 使用 SCAN 迭代 online:* key
 * 优势：
 *   1) 避免 SMEMBERS 对大集合一次性拉取
 *   2) 天然就是真实存在的 key（无需 EXISTS 验证）
 *   3) 对大 N 时内存占用更低，也减少一次 RTT
 *   4) 每 100 条一次迭代，对单线程 1 核友好
 */
export async function getAllOnlineUserIds(): Promise<number[]> {
  const r = redis()
  if (r) {
    try {
      const ids: number[] = []
      const pattern = `${NS_ONLINE}:*`
      let cursor = '0'
      do {
        const [nextCursor, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = nextCursor
        for (const k of keys) {
          const uidStr = k.slice(NS_ONLINE.length + 1)
          if (uidStr) {
            const num = Number(uidStr)
            if (Number.isNaN(num)) continue
            ids.push(num)
          }
        }
        // 控制每次迭代最多 100 条，避免 CPU 被占太久
      } while (cursor !== '0' && ids.length < 20000)
      return ids
    } catch (err: any) {
      console.warn('[redis] getAllOnlineUserIds 失败:', err.message)
      return []
    }
  }
  return Array.from(memOnline.keys())
}

/** 在线人数 —— Redis 模式下用 `SCAN + 计数`；也可以用 `SCAN`。
 *  注意：scard(NS_ONLINE) 快但依赖 SADD 后没清理，所以要清理后再用 scard。
 *  这里做一个折衷：直接调用 scard，定时清理过期 set 成员
 */
export async function getOnlineCount(): Promise<number> {
  const r = redis()
  if (r) {
    try {
      // 快速估计在线人数
      const count = await r.scard(NS_ONLINE)
      return count
    } catch {
      return 0
    }
  }
  return memOnline.size
}

/** 刷新用户 TTL（收到前端心跳） */
export async function heartbeat(userId: number, socketId: string): Promise<void> {
  const r = redis()
  if (r) {
    try {
      // 直接 SETEX + SADD（合并 EVAL 可省一次 RTT 但 pipeline 已很省，这里用 pipeline）
      const pipe = r.pipeline()
      pipe.setex(`${NS_ONLINE}:${userId}`, ONLINE_TTL, socketId)
      pipe.sadd(NS_ONLINE, String(userId))
      pipe.del(`${NS_PENDING}:${userId}`)
      await pipe.exec()
      return
    } catch {}
  }
  memOnline.set(userId, { socketId, ts: Date.now() })
}

/** 活跃会话 */
export async function setActiveSession(userId: number, sessionKey: string | null): Promise<void> {
  const r = redis()
  if (r) {
    try {
      if (sessionKey) {
        await r.setex(`${NS_SESSION}:${userId}`, 600, sessionKey)
      } else {
        await r.del(`${NS_SESSION}:${userId}`)
      }
      return
    } catch {}
  }
  if (sessionKey) memSessions.set(userId, sessionKey)
  else memSessions.delete(userId)
}

export async function getActiveSession(userId: number): Promise<string | null> {
  const r = redis()
  if (r) {
    try {
      return await r.get(`${NS_SESSION}:${userId}`)
    } catch {
      return null
    }
  }
  return memSessions.get(userId) || null
}

/* -------------------- 后台扫描 & 自动下线 -------------------- */

/**
 * 启动 keyspace 监听 —— 监听 `chatroom:online:*` key 过期时自动下线
 *
 * 通过订阅 "__keyevent@0__:expired" 频道，任何在线用户 key 过期后触发自动下线处理
 * 注意：需要 Redis 2.8+ 且已在 initRedis 中通过 config set 启用
 */
export function startKeyspaceListener(
  onUserOffline: (userId: number) => void,
): void {
  const r = redis()
  if (!r) return

  try {
    if (keyspaceListener) {
    // 已有监听器
    return
  }
  // keyspace 监听器需要单独的连接（订阅模式下不能发普通命令
    keyspaceListener = createClient()
    keyspaceListener.on('message', (channel, message) => {
      // message = 过期的 key 名，如 "chatroom:online:12345"
      if (message.startsWith(`${NS_ONLINE}:`)) {
        const uidStr = message.slice(NS_ONLINE.length + 1)
        const userId = Number(uidStr)
        if (Number.isNaN(userId)) return
        // 从 online set 里移除该用户
        onUserOffline(userId)
        // 同时清理 pending key
        const cur = redis()
        if (cur) cur.srem(NS_ONLINE, String(userId)).catch(() => {})
      }
    })
    keyspaceListener.on('error', (err) => {
      console.warn('[redis] keyspace 监听器错误:', err.message)
    })
    // 订阅 keyevent@0:expired 频道
    keyspaceListener.subscribe('__keyevent@0__:expired', (err) => {
      if (err) {
        console.warn('[redis] 订阅 keyspace 失败，改用定时扫描:', err.message)
      } else {
        console.log('[redis] ✅ 监听 keyspace 过期事件（自动下线）已启用')
      }
    })
  } catch (err: any) {
    console.warn('[redis] keyspace 监听器启动失败:', err.message)
  }
}

/**
 * 后台扫描任务：清理 set 中已过期成员（对 1 核下 30 秒执行一次）
 * - 不依赖 keyspace 通知时也能正常工作（作为降级方案）
 */
export function startOnlineCleanup(
  onUserOffline?: (userId: number) => void,
): void {
  setInterval(async () => {
    const r = redis()
    if (r && !fallback) {
      try {
        // 用 SCAN 而不是 SMEMBERS 拉取 online set（对大集合友好）
        const expired: string[] = []
        let cursor = '0'
        do {
          const [nextCursor, members] = await r.sscan(NS_ONLINE, cursor, 'COUNT', 200)
          cursor = nextCursor
          if (members.length === 0) continue
          const pipe = r.pipeline()
          for (const m of members) pipe.exists(`${NS_ONLINE}:${m}`)
          const results = await pipe.exec()
          members.forEach((m, i) => {
            const [err, res] = results[i]
            if (err || res !== 1) {
              expired.push(m)
              if (onUserOffline) {
                const num = Number(m)
                if (!Number.isNaN(num)) onUserOffline(num)
              }
            }
          })
        } while (cursor !== '0')
        if (expired.length > 0) {
          await r.srem(NS_ONLINE, ...expired)
          console.log(`[redis] 清理 ${expired.length} 个过期在线用户`)
        }
      } catch (e: any) {
        console.warn('[redis] 清理失败:', e.message)
      }
    } else {
      // 内存模式：清理过期用户
      const now = Date.now()
      const ttlMs = ONLINE_TTL * 1000
      const expiredUids: number[] = []
      for (const [uid, info] of memOnline.entries()) {
        if (now - info.ts > ttlMs) expiredUids.push(uid)
      }
      for (const uid of expiredUids) memOnline.delete(uid)
    }
  }, 60 * 1000)
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit()
    } catch {}
    client = null
  }
  if (keyspaceListener) {
    try {
      await keyspaceListener.quit()
    } catch {}
    keyspaceListener = null
  }
}
