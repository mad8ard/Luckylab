import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 把图表库与表格库切独立 chunk，避免主 bundle 膨胀
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('lightweight-charts')) return 'vendor-charts-lw'
          if (id.includes('/vue/') || id.includes('@vue/') || id.includes('/pinia/')) return 'vendor-vue'
        },
      },
    },
    // 单 chunk 提升到 800KB，避免无用警告
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupLocalStorage.js'],
    include: ['src/**/*.{test,spec}.{js,mjs}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      // 仅守 src/domain/，因为它是业务/公式核心
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/domain/**/*.{js,mjs}'],
      exclude: ['src/domain/**/__tests__/**', 'src/domain/**/*.{test,spec}.{js,mjs}'],
      // 阈值锁在略低于当前 baseline 的位置，防止退化但不阻塞日常开发
      // 当前 baseline（2026-05）：lines 82.21% / statements 76.44% / functions 89.11% / branches 64.2%
      thresholds: {
        lines: 80,
        statements: 75,
        functions: 85,
        branches: 60,
      },
    },
  },
})
