import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Tests run outside electron-vite, so they do not inherit its resolver.
 *
 * Without these aliases only `shared/` could be tested — anything under
 * `src/renderer` that reaches for `@shared/…` failed to resolve, which is why
 * the pay engine, the single most consequential pure module in the app, had no
 * tests at all. Keep in step with the `renderer.resolve.alias` block in
 * electron.vite.config.ts: two resolvers that disagree would let a test pass
 * against a file the app never loads.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      '@shared': resolve('shared'),
    },
  },
})
