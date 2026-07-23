import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

/**
 * Separate from `vite.config.ts` on purpose: the app config's
 * `tanstackStart()` plugin is about SSR/route-tree generation, not relevant
 * (and not needed) for component/unit tests. Shares the same `~/*` alias so
 * imports don't need to differ between app code and tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
