import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CI 上首次数据库/沙箱初始化较慢，放宽超时避免抖动。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
