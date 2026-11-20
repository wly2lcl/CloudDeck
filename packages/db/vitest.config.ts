import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // PGlite 在 CI 上首轮迁移较慢，放宽超时避免抖动。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
