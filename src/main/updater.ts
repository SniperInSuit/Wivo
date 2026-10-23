/**
 * Silent auto-update. Stage during the session, install at the next launch.
 *
 * ── The shape, and why ───────────────────────────────────────────────────────
 *   session N    check → download in the background → write a marker → quiet toast
 *   quit         nothing happens
 *   session N+1  marker present → splash → install silently → relaunch as new
 *
 * The owner's words were "like Discord": every launch checks, does it itself,
 * and comes up as the new version. Manual reinstall was the thing to kill — the
 * designer works in another building and nobody can walk a .exe over to them.
 *
 * ── Facts this file depends on, read out of electron-updater 6.8.9 ───────────
 * 1. `quitAndInstall(isSilent, isForceRunAfter)` calls
 *    `install(isSilent, isSilent ? isForceRunAfter : autoRunAppAfterInstall)`.
 *    `isForceRunAfter` is HONOURED ONLY WHEN `isSilent` IS TRUE. The old call
 *    was `(false, true)` — it showed the installer wizard and threw the `true`
 *    away, which is exactly the "unprofessional" part being removed.
 * 2. A staged file CANNOT be installed without `downloadUpdate()` running in
 *    this process. `install()` needs both `downloadedUpdateHelper.file` and
 *    `.downloadedFileInfo`; the cache path sets only the first. So the launch
 *    flow always calls `downloadUpdate()` — on a cache hit it costs ~nothing,
 *    because the helper re-verifies the sha512 on disk and returns at once.
 * 3. `download-progress` is only emitted when something is already listening
 *    (`listenerCount > 0`), so handlers are registered before any call.
 * 4. `autoInstallOnAppQuit` only arms itself after a download completes IN THIS
 *    process — a file staged in an earlier session is not installed on quit.
 *    It is therefore off, and the launch path owns installing.
 *
 * ── The one rule that outranks everything here ───────────────────────────────
 * AN UPDATE MUST NEVER STOP SOMEBODY WORKING. Every failure path in this file
 * ends the same way: open the app on the version already installed, quietly.
 * This is a dental lab; the app opening is worth more than the app being new.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { UpdateState, UpdaterSplashState } from '../types/update'

/** How long the launch-time feed check may take before we give up and open. */
const CHECK_MS = 6_000
/** Belt and braces around the whole launch flow. */
const TOTAL_MS = 20_000
/** First background check, once the window is up and auth has settled. */
const FIRST_CHECK_MS = 30_000
/**
 * 30 minutes, not 5. CI publishes a release on every version bump, and at five
 * minutes a busy afternoon would have every machine re-fetching repeatedly.
 */
const EVERY_MS = 30 * 60_000

// ── Logging ──────────────────────────────────────────────────────────────────
// `console.error` in a packaged Windows app goes nowhere, which is why "the
// update just didn't happen" has no answer without this. electron-updater logs
// every decision it makes, including "Update has already been downloaded to…"
// and the exact install flags — that file IS the diagnosis.
const logPath = (): string => join(app.getPath('userData'), 'updater.log')

function log(level: string, ...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${args
    .map(a => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`
  try {
    appendFileSync(logPath(), line)
  } catch {
    // A log that cannot be written must not take the app down with it.
  }
}

// ── The marker ───────────────────────────────────────────────────────────────
/**
 * Our own file, not electron-updater's `pending/update-info.json`.
 *
 * That one is marked `@private`, carries no version (only a filename and a
 * hash), and survives a completed install — so it cannot tell "staged" from
 * "already applied". This one can, and it carries the attempt counter that
 * stops a broken release relaunching forever.
 */
interface StagedUpdate {
  version: string
  stagedAt: string
  attempts: number
}

const markerPath = (): string => join(app.getPath('userData'), 'update-state.json')

function readMarker(): StagedUpdate | null {
  try {
    const raw = JSON.parse(readFileSync(markerPath(), 'utf-8')) as Partial<StagedUpdate>
    if (typeof raw.version !== 'string' || !raw.version) return null
    return {
      version: raw.version,
      stagedAt: typeof raw.stagedAt === 'string' ? raw.stagedAt : '',
      attempts: Number.isFinite(raw.attempts) ? Number(raw.attempts) : 0,
    }
  } catch {
    return null
  }
}

function writeMarker(m: StagedUpdate): void {
  try {
    writeFileSync(markerPath(), JSON.stringify(m, null, 2))
  } catch (err) {
    log('WARN', 'marker write failed', err)
  }
}

function clearMarker(): void {
  try {
    rmSync(markerPath(), { force: true })
  } catch {
    // Nothing to do: a stale marker costs at most three wasted launch checks.
  }
}

/**
 * Is `a` newer than `b`? Major.minor.patch only.
 *
 * Hand-rolled because `semver` is NOT shipped: it reaches node_modules only as
 * a Babel devDependency, and the packaged asar does not contain it. A
 * pre-release suffix is ignored, which is safe here — the worst case is a
 * marker that fails to clear, and the attempt counter already bounds that.
 */
function isNewer(a: string, b: string): boolean {
  const parts = (v: string): number[] =>
    v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    if (xi !== yi) return xi > yi
  }
  return false
}

// ── State, pushed to whoever is listening ────────────────────────────────────
let lastState: UpdateState = { stage: 'idle' }
let mainWindow: BrowserWindow | null = null
let splash: BrowserWindow | null = null
/** True from the moment quitAndInstall is called, so window-all-closed stands down. */
let installing = false

export const isInstalling = (): boolean => installing
export const setMainWindow = (w: BrowserWindow | null): void => { mainWindow = w }

function pushState(s: UpdateState): void {
  lastState = s
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wivo:update-state', s)
  }
}

function pushSplash(s: UpdaterSplashState): void {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send('wivo:splash-state', s)
  }
}

// ── The splash ───────────────────────────────────────────────────────────────
/**
 * Small, frameless, centred — and MOVABLE. A frameless always-on-top window
 * that cannot be dragged is a support call waiting to happen.
 *
 * Its own renderer entry (`updater.html`) rather than a route in the app: this
 * has to paint in a fraction of a second, and mounting React, framer-motion and
 * recharts to draw a progress bar defeats the point.
 */
function createSplash(from: string, to: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 170,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#F7F9FA',
    title: 'Wivo',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })

  win.once('ready-to-show', () => {
    win.show()
    pushSplash({ stage: 'checking', percent: null, from, to })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/updater.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/updater.html'))
  }
  return win
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.destroy()
  splash = null
}

// ── Shared wiring ────────────────────────────────────────────────────────────
function configure(): void {
  autoUpdater.autoDownload = true
  // OFF on purpose: a file staged in an earlier session is not installed at
  // quit anyway (see fact 4), and the owner asked to SEE the update happen.
  autoUpdater.autoInstallOnAppQuit = false
  // We never build a web installer; without this electron-updater warns on
  // every single download.
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = {
    info: (...a: unknown[]) => log('INFO', ...a),
    warn: (...a: unknown[]) => log('WARN', ...a),
    error: (...a: unknown[]) => log('ERROR', ...a),
    debug: (...a: unknown[]) => log('DEBUG', ...a),
  } as never
  // Lets a non-packaged run talk to a feed, for testing. Off unless asked.
  if (process.env['WIVO_UPDATER_DEV'] === '1') {
    autoUpdater.forceDevUpdateConfig = true
    log('INFO', 'forceDevUpdateConfig enabled by WIVO_UPDATER_DEV')
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ])

// ── Launch-time install ──────────────────────────────────────────────────────
/**
 * Returns true when it has started an install and the app is going away.
 *
 * Every other outcome returns false and the caller opens the app normally. The
 * caller must NOT close the splash itself — `bail()` below closes it only once
 * the main window is painted, because `window-all-closed` quits the app and
 * destroying the last window before the main one exists would exit outright.
 */
export async function installPendingAtLaunch(): Promise<boolean> {
  configure()

  if (!autoUpdater.isUpdaterActive()) return false

  const marker = readMarker()
  if (!marker) return false

  const running = app.getVersion()
  if (!isNewer(marker.version, running)) {
    log('INFO', `marker ${marker.version} <= running ${running}, already applied`)
    clearMarker()
    return false
  }

  // Written BEFORE the attempt, which is what makes a crash-looping release
  // limit itself: three launches and the marker is abandoned.
  if (marker.attempts >= 3) {
    log('ERROR', `giving up on ${marker.version} after ${marker.attempts} attempts`)
    clearMarker()
    lastState = { stage: 'failed', message: `Uuendus ${marker.version} ei paigaldunud.` }
    return false
  }
  writeMarker({ ...marker, attempts: marker.attempts + 1 })

  splash = createSplash(running, marker.version)

  try {
    return await withTimeout(runInstall(running, marker.version), TOTAL_MS, 'launch update')
  } catch (err) {
    log('ERROR', 'launch update failed', err)
    return false
  }
}

function runInstall(from: string, to: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const onProgress = (): void => {
      // A real transfer, not a cache hit. Abandon the launch install and let it
      // finish in the background — the next launch is then instant. This is
      // what guarantees a launch is never stuck behind 90 MB.
      log('INFO', 'real download at launch, deferring to next start')
      autoUpdater.removeListener('download-progress', onProgress)
      finish(false)
    }
    const onDownloaded = (): void => {
      // WIVO_UPDATER_DEV makes the updater run unpackaged so the whole flow can
      // be exercised — but quitAndInstall would then run a real NSIS installer
      // against a developer's machine. Stop one step short and say so.
      if (!app.isPackaged) {
        log('INFO', `would install ${to} here (unpackaged run, stopping)`)
        finish(false)
        return
      }
      log('INFO', `installing ${to}, isSilent=true isForceRunAfter=true`)
      pushSplash({ stage: 'installing', percent: null, from, to })
      installing = true
      // Give the splash one frame to repaint before the process goes away.
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (err) {
          log('ERROR', 'quitAndInstall threw', err)
          installing = false
          finish(false)
        }
      }, 300)
      finish(true)
    }
    const onError = (err: Error): void => {
      log('ERROR', 'updater error at launch', err)
      finish(false)
    }

    // Registered BEFORE any call — see fact 3.
    autoUpdater.once('update-downloaded', onDownloaded)
    autoUpdater.on('download-progress', onProgress)
    autoUpdater.once('error', onError)

    // autoDownload off for THIS path: we want to drive the download ourselves
    // so the progress guard above can abandon it.
    autoUpdater.autoDownload = false
    withTimeout(autoUpdater.checkForUpdates(), CHECK_MS, 'check')
      .then(result => {
        if (!result || !result.isUpdateAvailable) {
          log('INFO', 'nothing to install at launch')
          clearMarker()
          finish(false)
          return
        }
        pushSplash({ stage: 'downloading', percent: null, from, to })
        return autoUpdater.downloadUpdate()
      })
      .catch(err => {
        log('WARN', 'launch check/download gave up', err)
        finish(false)
      })
  })
}

// ── Background checking during the session ───────────────────────────────────
export function wireUpdater(): void {
  configure()
  if (!autoUpdater.isUpdaterActive()) {
    log('INFO', 'updater inactive (not packaged) — background checks skipped')
    return
  }

  autoUpdater.on('checking-for-update', () => pushState({ stage: 'checking' }))
  autoUpdater.on('update-not-available', () => pushState({ stage: 'idle' }))
  autoUpdater.on('update-available', info => pushState({ stage: 'available', version: info.version }))
  autoUpdater.on('download-progress', p =>
    pushState({
      stage: 'downloading',
      version: lastState.stage === 'available' ? lastState.version : app.getVersion(),
      percent: Math.round(p.percent),
    })
  )
  autoUpdater.on('update-downloaded', info => {
    log('INFO', `staged ${info.version}`)
    // attempts resets to 0: a NEWER update replacing an older staged one gets
    // its own three tries, and electron-updater has already wiped the old file.
    writeMarker({ version: info.version, stagedAt: new Date().toISOString(), attempts: 0 })
    pushState({ stage: 'ready', version: info.version })
  })
  autoUpdater.on('error', err => {
    log('ERROR', 'updater error', err)
    const nospace = (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
    pushState({
      stage: 'failed',
      message: nospace ? 'Kettal pole uuenduse jaoks ruumi.' : 'Uuendust ei õnnestunud laadida.',
    })
  })

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_MS)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), EVERY_MS)
}

// ── IPC ──────────────────────────────────────────────────────────────────────
export function registerUpdaterIpc(): void {
  // Answers a renderer that mounted AFTER the push happened — pushes are not
  // replayed, so without this a reopened window never learns about a staged
  // update.
  ipcMain.handle('wivo:update-state', () => lastState)

  ipcMain.handle('wivo:install-now', () => {
    if (!autoUpdater.isUpdaterActive() || lastState.stage !== 'ready') return
    installing = true
    try {
      autoUpdater.quitAndInstall(true, true)
    } catch (err) {
      installing = false
      log('ERROR', 'install-now failed', err)
    }
  })

  ipcMain.handle('wivo:check-now', async () => {
    if (!autoUpdater.isUpdaterActive()) {
      pushState({ stage: 'failed', message: 'Uuendused on saadaval ainult paigaldatud versioonis.' })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      log('WARN', 'manual check failed', err)
      pushState({ stage: 'failed', message: 'Uuenduste kontroll ebaõnnestus.' })
    }
  })
}

export { closeSplash }
