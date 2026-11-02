/**
 * The phone app (Phase 1b): a PWA built from the SAME renderer code as the
 * desktop app — same components, same Supabase client, same i18n, same sound
 * files (public/) — with its own entry (src/renderer/mobile.html) and only the
 * screens the spec allows on a phone. Hosted on Cloudflare Pages:
 *
 *   npm run mobile:build   → dist-mobile/   (build command / output directory)
 *   npm run mobile:dev     → http://localhost:5174
 *
 * The files only the phone needs (manifest, service worker, Cloudflare's
 * _headers/_redirects, the icon) live in src/renderer/mobile-static/ and are
 * added here, so the desktop build does not carry them.
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }
const STATIC_DIR = resolve('src/renderer/mobile-static')
const ICON = resolve('src/renderer/src/assets/Wivo Logo.png')

const TYPES: Record<string, string> = {
  '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.png': 'image/png',
}

/** Serve (dev) and emit (build) the phone-only files; name the page index.html. */
function mobileStatic(): Plugin {
  const files = (): [string, Buffer][] => [
    ...readdirSync(STATIC_DIR).map(f => [f, readFileSync(join(STATIC_DIR, f))] as [string, Buffer]),
    ['icon-256.png', readFileSync(ICON)],
  ]
  return {
    name: 'wivo-mobile-static',
    enforce: 'post', // after Vite's own HTML step, so the page exists to rename
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = files().find(([name]) => req.url === `/${name}`)
        if (!hit) return next()
        res.setHeader('Content-Type', TYPES[hit[0].slice(hit[0].lastIndexOf('.'))] ?? 'text/plain')
        res.end(hit[1])
      })
    },
    generateBundle(_options, bundle) {
      for (const [name, source] of files()) this.emitFile({ type: 'asset', fileName: name, source })
      const page = bundle['mobile.html']
      if (page) page.fileName = 'index.html'
    },
  }
}

export default defineConfig({
  root: resolve('src/renderer'),
  base: '/',
  envDir: resolve('.'),
  publicDir: resolve('src/renderer/public'),
  plugins: [react(), mobileStatic()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      '@shared': resolve('shared'),
    },
  },
  css: { postcss: resolve('postcss.config.cjs') },
  build: {
    outDir: resolve('dist-mobile'),
    emptyOutDir: true,
    rollupOptions: { input: { mobile: resolve('src/renderer/mobile.html') } },
  },
  server: { port: 5174 },
})
