/**
 * Electron 主进程
 * 启动 Express 后端 → 打开桌面窗口
 * 支持 Windows / macOS / Linux
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let serverProcess = null;
let mainWindow = null;

const PORT = process.env.PORT || 3001;
const SERVER_URL = `http://localhost:${PORT}`;

// ============ 启动 Express 后端 ============
function startServer() {
  return new Promise((resolve) => {
    // 打包后用 Electron 自带的 Node 运行（ELECTRON_RUN_AS_NODE=1）
    const nodeBin = process.execPath;
    const child = spawn(nodeBin, [
      '--max-old-space-size=128',
      '--optimize-for-size',
      '--import', 'tsx',
      'api/server.ts'
    ], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess = child;

    child.stdout.on('data', (d) => {
      const text = d.toString();
      console.log('[server]', text.trim());
      if (text.includes('listening') || text.includes('http') || text.includes('启动')) {
        resolve();
      }
    });

    child.stderr.on('data', (d) => {
      console.error('[server]', d.toString().trim());
    });

    child.on('error', (err) => {
      console.error('[server] 启动失败:', err.message);
      resolve();
    });

    child.on('exit', (code) => {
      console.log('[server] 进程退出, code:', code);
      serverProcess = null;
    });

    // 兜底：3 秒后不管怎样都继续
    setTimeout(resolve, 3000);
  });
}

// ============ 等待服务器就绪 ============
function waitForServer(url, retries = 30) {
  return new Promise((resolve) => {
    let count = 0;
    const check = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (++count < retries) {
          setTimeout(check, 500);
        } else {
          console.warn('[electron] 服务器未就绪，继续启动窗口');
          resolve();
        }
      });
    };
    check();
  });
}

// ============ 创建窗口 ============
async function createWindow() {
  // 1. 启动后端
  await startServer();
  await waitForServer(`${SERVER_URL}/api/health`);

  // 2. 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    title: 'ChatRoom',
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 3. 加载页面
  mainWindow.loadURL(SERVER_URL);

  // 4. 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 5. 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ 应用生命周期 ============
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});