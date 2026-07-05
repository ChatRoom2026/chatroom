import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths"
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }),
    tsconfigPaths(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        proxyTimeout: 30000,
        timeout: 30000,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 300,
    // 减少 CSS 文件大小
    cssCodeSplit: true,
    // 关闭 brotli 大小报告（减少构建时间）
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // 更细粒度的代码分割
        manualChunks: {
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          'state': ['zustand'],
          'icons': ['lucide-react'],
          'utils': ['clsx', 'tailwind-merge'],
          'socket': ['socket.io-client'],
        },
      },
    },
  },
  // 预构建依赖，减少运行时开销
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand', 'lucide-react', 'socket.io-client'],
  },
})
