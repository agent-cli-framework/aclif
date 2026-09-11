import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // oclif captures stdout/stderr itself; vitest's interception breaks that.
    disableConsoleIntercept: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/cli/**'],
      exclude: ['src/core/contract/aci.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        'src/core/**': {lines: 80},
        'src/cli/**': {lines: 80},
      },
    },
  },
})
