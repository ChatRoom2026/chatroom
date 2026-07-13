#!/bin/bash
# ChatRoom 服务器一键部署脚本（Ubuntu 22.04）
# 使用方法：在服务器上以 root 运行
# curl -sL https://raw.githubusercontent.com/yaoyao5296/chatroom/master/server-setup.sh | bash

set -e

echo "========================================="
echo "  ChatRoom 服务器环境安装与部署"
echo "========================================="

# ========== 1. 系统更新 ==========
echo ">>> [1/10] 更新系统..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get upgrade -y -qq

# ========== 2. 安装基础工具 ==========
echo ">>> [2/10] 安装基础工具..."
apt-get install -y -qq curl wget git build-essential nginx sqlite3 redis-server certbot python3-certbot-nginx

# ========== 3. 安装 Node.js 20 LTS ==========
echo ">>> [3/10] 安装 Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

# ========== 4. 安装 PM2 ==========
echo ">>> [4/10] 安装 PM2..."
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi
pm2 --version

# ========== 5. 克隆项目 ==========
echo ">>> [5/10] 克隆项目代码..."
mkdir -p /opt/chatroom
cd /opt/chatroom
if [ -d ".git" ]; then
  git pull origin master
else
  git clone https://github.com/yaoyao5296/chatroom.git .
fi

# ========== 6. 安装项目依赖 ==========
echo ">>> [6/10] 安装项目依赖..."
npm install --production

# ========== 7. 构建前端 ==========
echo ">>> [7/10] 构建前端..."
npx vite build

# ========== 8. 创建日志目录和环境变量 ==========
echo ">>> [8/10] 创建目录和配置..."
mkdir -p /opt/chatroom/logs /opt/chatroom/uploads /opt/chatroom/data

# 生成 .env 文件（如果不存在）
if [ ! -f "/opt/chatroom/.env" ]; then
  cat > /opt/chatroom/.env << 'ENVFILE'
PORT=3001
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=./data/chatroom.db
ENVFILE
fi

# ========== 9. 配置 PM2 ==========
echo ">>> [9/10] 配置 PM2..."
cat > /opt/chatroom/ecosystem.config.cjs << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'chatroom-api',
    script: 'api/server.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    cwd: '/opt/chatroom',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      HOST: '0.0.0.0',
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
    max_restarts: 10,
    autorestart: true,
  }]
};
PM2CONFIG

# ========== 10. 配置 Nginx 反向代理 ==========
echo ">>> [10/10] 配置 Nginx..."
cat > /etc/nginx/sites-available/chatroom << 'NGINXCONF'
server {
    listen 80;
    server_name _;

    # 前端静态文件
    root /opt/chatroom/dist;
    index index.html;

    # 下载页面
    location = /download {
        alias /opt/chatroom/dist/download.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }

    # Socket.IO
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }

    # 静态文件
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXCONF

# 启用站点
ln -sf /etc/nginx/sites-available/chatroom /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
nginx -t

# 重启 Nginx
systemctl restart nginx
systemctl enable nginx

# ========== 启动服务 ==========
echo ">>> 启动 ChatRoom 服务..."
cd /opt/chatroom
pm2 delete chatroom-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ========== 开放防火墙 ==========
echo ">>> 配置防火墙..."
ufw allow 22/tcp 2>/dev/null || true
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw allow 3001/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

echo ""
echo "========================================="
echo "  ChatRoom 部署完成！"
echo "========================================="
echo ""
echo "  访问地址: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "  下载页面: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')/download"
echo ""
echo "  常用命令："
echo "    pm2 status          - 查看服务状态"
echo "    pm2 logs chatroom-api - 查看日志"
echo "    pm2 restart chatroom-api - 重启服务"
echo "    systemctl restart nginx  - 重启 Nginx"
echo ""