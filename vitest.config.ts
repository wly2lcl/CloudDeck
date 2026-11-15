import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'services/*', 'drivers/*', 'workers/*', 'scripts'],
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
