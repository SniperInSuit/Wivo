/// <reference types="vite/client" />

// Build-time variables electron-vite exposes to the main process (MAIN_VITE_*).
interface ImportMetaEnv {
  /** Optional. Without it Sentry is not loaded in the main process. */
  readonly MAIN_VITE_SENTRY_DSN?: string
}
