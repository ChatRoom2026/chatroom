#!/bin/bash
# ==========================================
#   ChatRoom 服务器启动脚本 (Linux/Ubuntu)
# ==========================================
set -e

echo "========================================"
echo "  ChatRoom 服务器"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
    echo "安装命令: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "[信息] Node.js 版本: $(node -v)"

echo "[1/3] 安装依赖..."
npm install
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败"
    exit 1
fi

echo ""
echo "[2/3] 构建前端..."
export NODE_OPTIONS="--max-old-space-size=512"
npx vite build
if [ $? -ne 0 ]; then
    echo "[错误] 前端构建失败"
    exit 1
fi

echo ""
echo "[3/3] 启动服务器..."
echo ""
echo "========================================"
echo "  服务器启动中..."
echo "  本机访问: http://localhost:3001"
echo "  按 Ctrl+C 停止服务器"
echo "========================================"
echo ""

# 获取本机 IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LOCAL_IP" ]; then
    echo "  局域网地址: http://$LOCAL_IP:3001"
    echo "  公网访问: http://$(curl -s ifconfig.me 2>/dev/null || echo '你的公网IP'):3001"
fi
echo ""

export NODE_ENV=production
node --env-file=.env --max-old-space-size=128 --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64 --import tsx api/server.ts