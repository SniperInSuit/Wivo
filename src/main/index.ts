import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  wireUpdater, registerUpdaterIpc, installPendingAtLaunch,
  setMainWindow, closeSplash, isInstalling,
} from './updater'
import { currentLicence, installLicence, licensingEnforced } from './license'
import { registerWatchFolder } from './watchFolder'
import { initSentryMain } from './sentry'

// Force 24-hour clock in all Chromium form controls (datetime-local, time)
app.commandLine.appendSwitch('lang', 'et-EE')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 750,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F7F9FA',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Chromium's own PDF viewer, so a job's PDF shows in the file viewer
      // (components/Files/FileViewer) instead of downloading.
      plugins: true
    }
  })

  setMainWindow(mainWindow)
  mainWindow.on('closed', () => setMainWindow(null))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Only NOW. `window-all-closed` quits the app, so destroying the splash
    // while it is the only window would exit instead of opening Wivo.
    closeSplash()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * The version on DISK, read fresh every call.
 *
 * `app.getVersion()` is read once at process start, and the renderer's
 * `__APP_VERSION__` is frozen at build time — so during development both go
 * stale the moment package.json is bumped, while HMR keeps delivering new code.
 * That mismatch made the sidebar report a version the app was not running, and
 * it cost real debugging time twice.
 *
 * Reading the file on demand means the answer is always current: in development
 * it is the repo's package.json, in a packaged build it is the one inside the
 * asar, which cannot change without a reinstall.
 */
function readDiskVersion(): string {
  try {
    const raw = readFileSync(join(app.getAppPath(), 'package.json'), 'utf-8')
    return (JSON.parse(raw) as { version?: string }).version ?? app.getVersion()
  } catch {
    return app.getVersion()
  }
}

/**
 * The 3D tooth model's bytes, read HERE rather than by the renderer.
 *
 * The renderer is loaded with `loadFile`, so its origin is `file://`, and
 * Chromium refuses `fetch()` on non-http schemes. `GLTFLoader.load()` is built
 * on fetch — it would work in development, where the renderer is served from
 * http://localhost, and fail in every packaged install. That is the worst shape
 * a bug can have, so the bytes come across IPC and the renderer uses
 * `GLTFLoader.parse()`, which behaves identically in both.
 *
 * A missing file is not an error worth crashing over: the renderer answers
 * `null` by staying on the 2D chart.
 */
function readTeethModel(): Buffer | null {
  const file = is.dev
    ? join(app.getAppPath(), 'resources', 'teeth.glb')
    : join(process.resourcesPath, 'teeth.glb')
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

/**
 * One Wivo at a time.
 *
 * Without this a second instance can be launched while the NSIS installer is
 * replacing Wivo.exe — the file is locked, the install fails, and the update
 * loop burns an attempt for a reason nobody can see from the outside.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.wivo.dental')
  await initSentryMain(app.getVersion())

  ipcMain.handle('wivo:version', () => readDiskVersion())
  registerWatchFolder()

  /**
   * A sound file's bytes, for the installed app (file://, where the renderer
   * cannot fetch). Only names from public/sounds — a flat folder of .wav files —
   * never a path the page made up.
   */
  ipcMain.handle('wivo:read-sound', (_e, file: string) => {
    if (typeof file !== 'string' || !/^[a-z0-9-]+\.wav$/.test(file)) return null
    for (const dir of [join(__dirname, '../renderer/sounds'), join(app.getAppPath(), 'src/renderer/public/sounds')]) {
      try { return readFileSync(join(dir, file)) } catch { /* try the next place */ }
    }
    return null
  })

  /**
   * HTML → PDF for documents made in the renderer (the patient export). A
   * hidden, sandboxed window with JavaScript OFF: the HTML is data, built from
   * patient records, and never gets to run anything.
   */
  ipcMain.handle('wivo:html-to-pdf', async (_e, html: string) => {
    const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      return new Uint8Array(await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true }))
    } finally {
      win.destroy()
    }
  })
  ipcMain.handle('wivo:teeth-model', () => readTeethModel())

  // Licence lives in the main process — see license.ts for why.
  ipcMain.handle('wivo:license-status', () => currentLicence())
  ipcMain.handle('wivo:license-install', (_e, token: string) => installLicence(token))
  ipcMain.handle('wivo:license-enforced', () => licensingEnforced())
  ipcMain.handle('wivo:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  // ── Git auto-update (dev mode only) ──────────────────────────────────────
  // Check if remote has new commits. Returns true if origin/main is ahead.
  ipcMain.handle('wivo:check-remote-update', () => {
    try {
      const cwd = app.getAppPath()
      execSync('git fetch origin main --quiet', { cwd, timeout: 10_000, stdio: 'ignore' })
      // How many commits origin/main has that HEAD does not. NOT `local !==
      // remote`: that was true whenever the two differed AT ALL, so an
      // unpushed commit of your own announced "a newer version is available"
      // — when the newer version was you. Being AHEAD is not an update.
      const behind = execSync('git rev-list --count HEAD..origin/main', {
        cwd, encoding: 'utf-8', timeout: 10_000,
      }).trim()
      return Number(behind) > 0
    } catch {
      // No git, no remote, no network, a detached HEAD — none of these are a
      // finding worth interrupting anybody over.
      return false
    }
  })

  // Pull latest code from origin. Returns the new version or null on failure.
  ipcMain.handle('wivo:git-pull', () => {
    try {
      const cwd = app.getAppPath()
      execSync('git pull origin main --quiet', { cwd, timeout: 30_000, stdio: 'ignore' })
      return readDiskVersion()
    } catch {
      return null
    }
  })

  // ── Auto-update ────────────────────────────────────────────────────────
  // All of it lives in ./updater.ts, including WHY it is shaped this way.
  // Short version: download quietly during the session, install at the next
  // launch behind a small window, and never let any of that stop the app
  // opening.
  registerUpdaterIpc()
  wireUpdater()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // A staged update installs here, before any main window exists. It resolves
  // false for every outcome except "I am installing and the app is going away"
  // — offline, timeout, nothing staged, a real download that would have made
  // the user wait. All of those just open Wivo.
  if (await installPendingAtLaunch()) return

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // quitAndInstall closes every window and then quits by itself. Quitting here
  // as well races the installer it just spawned.
  if (isInstalling()) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
