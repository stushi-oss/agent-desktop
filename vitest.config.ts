import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 20000 }
})
