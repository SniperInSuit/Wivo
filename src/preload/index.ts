import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Minimal bridge for the update prompt. Absence is handled by the renderer —
 * it falls back to the build-time constant and simply never offers a restart,
 * rather than failing silently in a way that looks like a dead feature.
 */
const wivoAPI = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('wivo:version'),
  relaunch: (): Promise<void> => ipcRenderer.invoke('wivo:relaunch'),
  checkRemoteUpdate: (): Promise<boolean> => ipcRenderer.invoke('wivo:check-remote-update'),
  gitPull: (): Promise<string | null> => ipcRenderer.invoke('wivo:git-pull'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('wivo:download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('wivo:install-update'),
  onUpdateAvailable: (cb: (version: string) => void) => {
    ipcRenderer.on('wivo:update-available', (_e, version) => cb(version))
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on('wivo:update-downloaded', () => cb())
  },
}

// Expose minimal electron API to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('wivo', wivoAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.wivo = wivoAPI
}
