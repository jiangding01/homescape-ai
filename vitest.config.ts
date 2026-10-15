import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tools/**/*.test.mjs',
    ],
    passWithNoTests: true,
    // node:sqlite 仍会发出 ExperimentalWarning，不让它污染测试输出。
    poolOptions: {
      forks: { execArgv: ['--no-warnings=ExperimentalWarning'] },
      threads: { execArgv: ['--no-warnings=ExperimentalWarning'] },
    },
  },
})
