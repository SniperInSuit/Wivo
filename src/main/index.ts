import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Force 24-hour clock in all Chromium form controls (datetime-local, time)
app.commandLine.appendSwitch('lang', 'et-EE')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
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
  ipcMain.handle('wivo:relaunch', () => {
    app.relaunch()
    app.exit(0)
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
