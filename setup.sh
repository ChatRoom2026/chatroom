#!/bin/bash
# ChatRoom 环境恢复脚本
# 每次进入项目后运行：bash setup.sh
# 作用：自动安装 node_modules 并启动前后端服务

set -e
cd "$(dirname "$0")"

echo "📦 正在安装依赖..."
npm install

echo ""
echo "✅ 依赖安装完成"
echo "🚀 启动后端..."
node --env-file=.env --import tsx api/server.ts &
sleep 2

echo "🚀 启动前端..."
node_modules/.bin/vite --port 5173 &
sleep 2

echo ""
echo "========================================"
echo "  前端: http://localhost:5173"
echo "  后端: http://localhost:3001"
echo "========================================"
echo "  Ctrl+C 可停止所有服务"
echo ""
wait
