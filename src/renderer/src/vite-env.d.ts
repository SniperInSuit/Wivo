/// <reference types="vite/client" />

// Compile-time constant injected by electron.vite.config.ts (`renderer.define`)
// from package.json. Declared here rather than in a root-level d.ts because
// tsconfig.web.json only includes src/renderer/src/**/*.
declare const __APP_VERSION__: string

// Optional override for the synthetic login domain (see lib/supabase.ts).
interface ImportMetaEnv {
  readonly VITE_USERNAME_DOMAIN?: string
}

// Preload bridge (src/preload/index.ts). Optional: during `dev` the renderer can
// also be opened in a plain browser tab, where no preload has run.
interface Window {
  wivo?: {
    getVersion: () => Promise<string>
    relaunch: () => Promise<void>
    checkRemoteUpdate: () => Promise<boolean>
    gitPull: () => Promise<string | null>
    downloadUpdate: () => Promise<void>
    installUpdate: () => Promise<void>
    onUpdateAvailable: (cb: (version: string) => void) => void
    onUpdateDownloaded: (cb: () => void) => void
  }
}
