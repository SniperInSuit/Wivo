/// <reference types="vite/client" />

// Compile-time constant injected by electron.vite.config.ts (`renderer.define`)
// from package.json. Declared here rather than in a root-level d.ts because
// tsconfig.web.json only includes src/renderer/src/**/*.
declare const __APP_VERSION__: string

// Optional override for the synthetic login domain (see lib/supabase.ts).
interface ImportMetaEnv {
  readonly VITE_USERNAME_DOMAIN?: string
  /** Optional. Without it Sentry is not loaded at all. */
  readonly VITE_SENTRY_DSN?: string
}

// Preload bridge (src/preload/index.ts). Optional: during `dev` the renderer can
// also be opened in a plain browser tab, where no preload has run.
interface Window {
  wivo?: {
    getVersion: () => Promise<string>
    relaunch: () => Promise<void>
    checkRemoteUpdate: () => Promise<boolean>
    gitPull: () => Promise<string | null>
    // The 3D tooth model's bytes, or null when it is not installed. Read in
    // the main process because Chromium refuses fetch() on file:// — see
    // readTeethModel in src/main/index.ts.
    getTeethModel: () => Promise<ArrayBuffer | null>
    // Auto-update. One channel, and every listener hands back its remover —
    // see the note in src/preload/index.ts about the leak this replaced.
    updateState: () => Promise<import('../../types/update').UpdateState>
    onUpdateState: (
      cb: (s: import('../../types/update').UpdateState) => void
    ) => () => void
    installNow: () => Promise<void>
    checkNow: () => Promise<void>
    onSplashState: (
      cb: (s: import('../../types/update').UpdaterSplashState) => void
    ) => () => void
    htmlToPdf?: (html: string) => Promise<Uint8Array>
    // The scanner export folder — src/main/watchFolder.ts.
    watchFolder?: {
      get: () => Promise<string | null>
      choose: () => Promise<string | null>
      list: () => Promise<{ path: string; name: string; size: number; modifiedAt: number; key: string }[]>
      read: (path: string) => Promise<Uint8Array>
      handled: (key: string, jobId: string | null) => Promise<void>
      onChanged: (cb: () => void) => () => void
    }
  }
}
