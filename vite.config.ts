import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Vite 只负责打包「渲染进程」（Vue 界面）。
// Electron 主进程/预加载脚本用独立的 electron/main.cjs、electron/preload.cjs（CommonJS），
// 由 `electron .` 直接加载，不经过 Vite。
export default defineConfig({
  plugins: [vue()],
  // 打包产物使用相对路径，方便 electron 以 file:// 加载 dist/index.html
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url))
    }
  },
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
