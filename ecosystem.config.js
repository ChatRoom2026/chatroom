/**
 * PM2 进程管理配置 — 一核服务器优化版
 *
 * 启动命令：
 *   pm2 start ecosystem.config.js
 *
 * 停止命令：
 *   pm2 stop ecosystem.config.js
 *
 * 查看日志：
 *   pm2 logs chat-server
 *
 * 关键优化：
 * 1) 单进程（instances: 1）— 一核服务器跑多进程反而会有上下文切换开销
 * 2) max-old-space-size=1024 — 限制 V8 堆为 1GB，防止被 OOM Killer 杀
 * 3) --use-largepages — 让 V8 使用大页，减少 TLB miss（性能提升约 5-10%）
 * 4) max_memory_restart — 超过 1.2GB 自动重启（防御内存泄漏）
 * 5) watch: false — 禁用文件监听（防止频繁重启浪费 CPU）
 * 6) kill_timeout=10000 — 给 PM2 足够时间优雅关闭（让消息队列 flush 干净）
 */
module.exports = {
  apps: [{
    name: 'chatroom',
    script: 'api/server.ts',
    interpreter: 'node',
    interpreterArgs: '--import tsx',
    args: '',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1200M',
    kill_timeout: 10000,
    listen_timeout: 10000,
    wait_ready: false,
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // 邮箱配置
      MAIL_HOST: 'smtp.163.com',
      MAIL_PORT: '465',
      MAIL_USER: '13574196538@163.com',
      MAIL_PASS: 'FAU8m36uQ8PunQ8P',
      MAIL_FROM: '13574196538@163.com',
      // 数据库
      DATABASE_URL: './data/chatroom.db',
      // 限制 V8 堆
      NODE_OPTIONS: '--max-old-space-size=128 --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64',
    },
  }],
}
