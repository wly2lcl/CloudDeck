import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'services/*', 'drivers/*', 'workers/*', 'scripts'],
    testTimeout: 15_000,
    hookTimeout: 20_000,
    // PGlite 首次迁移对并发敏感，串行跑测试文件更稳定。
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'packages/*/src/**/*.ts',
        'services/*/src/**/*.ts',
        'drivers/*/src/**/*.ts',
        'workers/*/src/**/*.ts',
      ],
      exclude: ['**/*.d.ts', '**/testing.ts', '**/test/**'],
      thresholds: {
        lines: 75,
        functions: 70,
        branches: 45,
        statements: 70,
      },
    },
  },
})
