import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    // e2e/ holds Playwright-for-Electron specs that import from
    // '@playwright/test', not vitest — without this exclude, vitest's
    // default repo-wide include glob picks them up too and `npm run test`
    // breaks trying to load them as vitest tests.
    exclude: [...configDefaults.exclude, 'e2e/**']
  }
})
