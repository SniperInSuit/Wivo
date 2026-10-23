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
    // TWO entries. `updater.html` is the splash shown while the app is being
    // replaced on disk — see its own comment for why it is not a route in the
    // main bundle. After changing this, confirm `out/renderer/updater.html`
    // actually exists; a splash that 404s is a frozen white box at the one
    // moment it must not be.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          updater: resolve('src/renderer/updater.html')
        }
      }
    },
    // Lets the renderer show the app version (sidebar footer) in both dev and
    // a packaged build — nothing else exposes it to the UI.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        // Dependency-free code the web portal will also import — see
        // shared/README.md. A source alias rather than a workspace package on
        // purpose: externalizeDepsPlugin() above would mark a package external
        // and electron-builder ships out/**/* with no node_modules.
        // For the same reason, main and preload must never import from here.
        '@shared': resolve('shared')
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve('postcss.config.cjs')
    }
  }
})
