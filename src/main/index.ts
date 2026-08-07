import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { currentLicence, installLicence, licensingEnforced } from './license'

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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wivo.dental')

  ipcMain.handle('wivo:version', () => readDiskVersion())

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
      const local = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim()
      const remote = execSync('git rev-parse origin/main', { cwd, encoding: 'utf-8' }).trim()
      return local !== remote
    } catch {
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

  // ── Auto-updater (GitHub Releases) ─────────────────────────────────────
  // In dev mode, skip auto-update — use git-based check instead.
  // In production (packaged), check GitHub Releases for new versions.
  if (!is.dev) {
    autoUpdater.autoDownload = false  // ask user first
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('wivo:update-available', info.version)
    })

    autoUpdater.on('update-downloaded', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('wivo:update-downloaded')
    })

    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err.message)
    })

    // Check for updates every 5 minutes
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 5 * 60_000)
    // And on startup (after a short delay)
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
  }

  ipcMain.handle('wivo:download-update', () => {
    autoUpdater.downloadUpdate().catch(() => {})
  })

  ipcMain.handle('wivo:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
