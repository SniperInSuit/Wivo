import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Read the version straight off package.json rather than
// process.env.npm_package_version, which is only set when the build runs
// through an npm script and is undefined under a direct `electron-vite dev`.
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Lets the renderer show the app version (sidebar footer) in both dev and
    // a packaged build — nothing else exposes it to the UI.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve('postcss.config.cjs')
    }
  }
})
