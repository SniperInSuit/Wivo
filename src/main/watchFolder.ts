/**
 * The scanner export folder (spec, Phase 1 Files: "folder watcher in Electron:
 * scanner export folder → Unsorted → attached to a job").
 *
 * The user picks the folder once. Files that appear in it are listed as
 * "Unsorted" until someone attaches each to a job (it then goes through the
 * same cleaning and upload queue as any other file) or dismisses it. The
 * originals are never moved or deleted: the scanner software owns that folder.
 *
 * Which files were handled is remembered per computer in `watch-folder.json`
 * in userData, keyed by path + size + modification time, so a re-exported
 * file shows up again.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { existsSync, readFileSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { fileKey, isInside, isWatchedFile, MAX_DEPTH, unsorted, type UnsortedFile } from './watchFolderCore'

interface Config {
  folder: string | null
  handled: Record<string, { jobId?: string; at: string; dismissed?: boolean }>
}

const configPath = () => join(app.getPath('userData'), 'watch-folder.json')

function loadConfig(): Config {
  try {
    if (existsSync(configPath())) return { folder: null, handled: {}, ...JSON.parse(readFileSync(configPath(), 'utf8')) }
  } catch { /* a broken file means starting over, not crashing */ }
  return { folder: null, handled: {} }
}

let config: Config = { folder: null, handled: {} }
let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

const save = () => writeFile(configPath(), JSON.stringify(config, null, 1)).catch(() => {})

function notify(): void {
  if (debounce) clearTimeout(debounce)
  // Scanners write a file in pieces; wait for it to settle before telling anyone.
  debounce = setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('wivo:watch-folder-changed')
  }, 1500)
}

function startWatching(): void {
  watcher?.close()
  watcher = null
  if (!config.folder || !existsSync(config.folder)) return
  try {
    watcher = watch(config.folder, { recursive: true }, notify)
  } catch {
    watcher = watch(config.folder, notify) // Linux has no recursive watch
  }
}

async function scan(dir: string, depth: number, out: UnsortedFile[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await scan(p, depth + 1, out)
    else if (entry.isFile() && isWatchedFile(entry.name)) {
      const s = await stat(p).catch(() => null)
      if (s) out.push({ path: p, name: entry.name, size: s.size, modifiedAt: s.mtimeMs, key: fileKey(p, s.size, s.mtimeMs) })
    }
  }
}

export function registerWatchFolder(): void {
  config = loadConfig()
  startWatching()

  ipcMain.handle('wivo:watch-folder-get', () => config.folder)

  ipcMain.handle('wivo:watch-folder-choose', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return config.folder
    config.folder = res.filePaths[0]
    await save()
    startWatching()
    return config.folder
  })

  ipcMain.handle('wivo:watch-folder-list', async () => {
    if (!config.folder) return []
    const found: UnsortedFile[] = []
    await scan(config.folder, 0, found)
    return unsorted(found, config.handled)
  })

  // Only files inside the chosen folder, whatever path the page asks for.
  ipcMain.handle('wivo:watch-folder-read', async (_e, path: string) => {
    if (!config.folder || !isInside(config.folder, path)) throw new Error('Not in the watched folder')
    return new Uint8Array(await readFile(path))
  })

  ipcMain.handle('wivo:watch-folder-handled', async (_e, key: string, jobId: string | null) => {
    config.handled[key] = jobId ? { jobId, at: new Date().toISOString() } : { at: new Date().toISOString(), dismissed: true }
    await save()
    notify()
  })
}
