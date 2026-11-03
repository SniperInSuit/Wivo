/**
 * Is the desktop app in the middle of something an update restart must not
 * cut off? (docs/MIN-VERSION.md §4: a required update restarts by itself,
 * "never while … a download or print is running".)
 *
 * - downloads: a file being saved from a job (the browser's download, which
 *   Electron reports through `will-download`);
 * - other windows: a print preview (the job sheet prints from its own
 *   window), the hidden window that renders a PDF, the updater's splash.
 *
 * The renderer adds what only it knows (unsaved forms, uploads):
 * src/renderer/src/lib/restartGuard.ts.
 */
import { BrowserWindow, session } from 'electron'

let downloads = 0

export function trackDownloads(): void {
  session.defaultSession.on('will-download', (_e, item) => {
    downloads++
    item.once('done', () => { downloads = Math.max(0, downloads - 1) })
  })
}

export interface MainBusy { downloads: number; otherWindows: number }

export function mainBusy(main: BrowserWindow | null): MainBusy {
  const others = BrowserWindow.getAllWindows().filter(w => w !== main && !w.isDestroyed()).length
  return { downloads, otherWindows: others }
}
