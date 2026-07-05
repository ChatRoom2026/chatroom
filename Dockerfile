# ChatRoom Fly.io 部署 - 0.5GB 内存优化版
FROM node:22-alpine

WORKDIR /app

# 安装构建依赖（better-sqlite3 需要编译工具）
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# 清理编译工具（减小镜像体积）
RUN apk del python3 make g++

COPY . .

# 构建前端
RUN npm run build

# 确保数据目录存在
RUN mkdir -p /app/data

# 256MB V8 heap，留内存给 SQLite 和 OS
ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "--max-old-space-size=128", "--optimize-for-size", "--import", "tsx", "api/server.ts"]