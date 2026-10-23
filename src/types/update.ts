/**
 * The auto-updater's state, as the main process reports it.
 *
 * ── Why this file is here and not in `shared/` ───────────────────────────────
 * `shared/README.md` forbids main and preload from importing out of `shared/`:
 * that code is aliased for the renderer and the web portal, and electron-vite
 * marks aliased packages external while electron-builder ships `out/**` with no
 * `node_modules`. A type both sides need therefore cannot live there.
 *
 * It is TYPES ONLY on purpose. A type-only import disappears at compile time,
 * so nothing actually crosses the main/renderer boundary at runtime — only the
 * agreement about what crosses it.
 *
 * One channel carries all of this rather than five. The old bridge had a
 * separate `onUpdateAvailable` and `onUpdateDownloaded`, each registering an
 * `ipcRenderer.on` that nothing could ever remove, and neither of them could
 * say "this failed" — so a download that errored left the spinner turning.
 */

/** Where the updater is right now. `idle` is also the pre-check state. */
export type UpdateState =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'available'; version: string }
  | { stage: 'downloading'; version: string; percent: number }
  /** Downloaded and staged. Installs at the NEXT launch, not on quit. */
  | { stage: 'ready'; version: string }
  | { stage: 'installing'; version: string }
  /** Never fatal to the app: the user keeps working on the version they have. */
  | { stage: 'failed'; message: string }

/** What the splash window needs. A subset, so it cannot grow a dependency. */
export interface UpdaterSplashState {
  stage: UpdateState['stage']
  /** 0–100 when known. Null means "running, but no measurable progress". */
  percent: number | null
  from: string
  to: string
}
