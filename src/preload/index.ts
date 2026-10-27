import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { UpdateState, UpdaterSplashState } from '../types/update'

/**
 * Minimal bridge for the update prompt. Absence is handled by the renderer —
 * it falls back to the build-time constant and simply never offers a restart,
 * rather than failing silently in a way that looks like a dead feature.
 *
 * ── Every listener returns its own unsubscribe ───────────────────────────────
 * This used to expose `onUpdateAvailable` / `onUpdateDownloaded` as bare
 * `ipcRenderer.on` calls with no way to take them off again. The hook that used
 * them was mounted in two places, so every mount added handlers that outlived
 * the component forever. Returning the remover is the whole fix, and it needs
 * the SAME function reference — hence the hoisted `handler` below rather than
 * an inline arrow.
 */
const subscribe = <T,>(channel: string, cb: (value: T) => void): (() => void) => {
  const handler = (_e: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const wivoAPI = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('wivo:version'),
  /**
   * The 3D tooth model's bytes, or null when it is not installed.
   *
   * IPC hands back a Uint8Array that VIEWS a larger pooled buffer, so passing
   * `.buffer` straight to GLTFLoader would hand it megabytes of unrelated
   * memory starting at the wrong offset. The slice is the whole reason this
   * wrapper exists rather than a bare `invoke`.
   */
  getTeethModel: async (): Promise<ArrayBuffer | null> => {
    const bytes = (await ipcRenderer.invoke('wivo:teeth-model')) as Uint8Array | null
    if (!bytes) return null
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },
  relaunch: (): Promise<void> => ipcRenderer.invoke('wivo:relaunch'),
  // Development only: compares the repo against origin/main and pulls. Nothing
  // to do with the real updater — see HANDOFF.md.
  checkRemoteUpdate: (): Promise<boolean> => ipcRenderer.invoke('wivo:check-remote-update'),
  gitPull: (): Promise<string | null> => ipcRenderer.invoke('wivo:git-pull'),

  // ── Auto-update ───────────────────────────────────────────────────────────
  /**
   * The LAST state, for a renderer that mounted after the fact.
   *
   * Without this a window opened after the download finished would never learn
   * that an update is staged: the push already happened and pushes are not
   * replayed.
   */
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke('wivo:update-state'),
  onUpdateState: (cb: (s: UpdateState) => void): (() => void) =>
    subscribe<UpdateState>('wivo:update-state', cb),
  /** Install the staged update now instead of at the next launch. */
  installNow: (): Promise<void> => ipcRenderer.invoke('wivo:install-now'),
  /** Force a check. For Seaded, and for "press this and tell me what it says". */
  checkNow: (): Promise<void> => ipcRenderer.invoke('wivo:check-now'),

  // ── Updater splash window only ────────────────────────────────────────────
  onSplashState: (cb: (s: UpdaterSplashState) => void): (() => void) =>
    subscribe<UpdaterSplashState>('wivo:splash-state', cb),

  licenseStatus: (): Promise<unknown> => ipcRenderer.invoke('wivo:license-status'),
  licenseInstall: (token: string): Promise<unknown> =>
    ipcRenderer.invoke('wivo:license-install', token),
  licenseEnforced: (): Promise<boolean> => ipcRenderer.invoke('wivo:license-enforced'),
}

export type WivoAPI = typeof wivoAPI

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
