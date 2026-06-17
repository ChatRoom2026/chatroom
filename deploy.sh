#!/bin/bash
# ChatRoom 服务端一键部署脚本
# 使用方法: bash deploy.sh
# 或自行修改 SERVER_IP 为你的服务器 IP 后运行

set -e

# ========== 配置项（按需修改）==========
SERVER_IP="YOUR_SERVER_IP"    # ← 改成你的服务器 IP 或域名
SSH_PORT=22                   # SSH 端口
SSH_USER="root"               # SSH 用户名

# ========== 服务器端部署命令 ==========
ssh -p $SSH_PORT $SSH_USER@$SERVER_IP << 'REMOTE_SCRIPT'
  # 1. 安装 Node.js 20 LTS
  if ! command -v node &> /dev/null; then
    echo ">>> 安装 Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  echo "Node.js 版本: $(node -v)"

  # 2. 创建项目目录
  mkdir -p /opt/chatroom
  cd /opt/chatroom

  # 3. 创建 PM2 进程管理配置文件
  cat > ecosystem.config.cjs << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'chatroom-api',
    script: 'api/server.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    cwd: '/opt/chatroom',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    error_file: '/opt/chatroom/logs/err.log',
    out_file: '/opt/chatroom/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 10
  }]
};
PM2CONFIG

  # 4. 安装 PM2
  if ! command -v pm2 &> /dev/null; then
    echo ">>> 安装 PM2..."
    npm install -g pm2
  fi

  # 5. 初始化目录结构
  mkdir -p logs uploads

  echo "=========================================="
  echo "  服务器环境已准备就绪！"
  echo ""
  echo "  下一步：将项目文件上传到 /opt/chatroom"
  echo "  然后运行: cd /opt/chatroom && npm install && pm2 start ecosystem.config.cjs"
  echo "=========================================="
REMOTE_SCRIPT

echo ""
echo "✅ 环境部署完成"
echo "接下来需要把项目文件传到服务器："
echo "  scp -r -P $SSH_PORT ./{api,package.json,package-lock.json,tsconfig.json} $SSH_USER@$SERVER_IP:/opt/chatroom/"
echo ""
echo "然后 SSH 到服务器执行："
echo "  cd /opt/chatroom && npm install && pm2 start ecosystem.config.cjs"