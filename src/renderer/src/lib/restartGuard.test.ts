import { describe, it, expect, vi, beforeEach } from 'vitest'

let uploads = 0
vi.mock('./uploadQueue', () => ({ activeUploads: () => uploads }))
const { holdRestart, restartBlocked, restartHolds } = await import('./restartGuard')

describe('what an update restart waits for', () => {
  beforeEach(() => {
    uploads = 0
    ;(globalThis as { window?: unknown }).window = {}
  })

  it('nothing open: not blocked', async () => {
    expect(await restartBlocked()).toBe(false)
  })

  it('a form holding it (unsaved input, a camera): blocked until released', async () => {
    const release = holdRestart()
    expect(restartHolds()).toBe(1)
    expect(await restartBlocked()).toBe(true)
    release()
    expect(await restartBlocked()).toBe(false)
  })

  it('an upload on its way: blocked', async () => {
    uploads = 1
    expect(await restartBlocked()).toBe(true)
  })

  it('a download, a print or a PDF in the desktop app: blocked', async () => {
    const busy = vi.fn(async () => ({ downloads: 0, otherWindows: 0 }))
    ;(globalThis as { window?: unknown }).window = { wivo: { busy } }
    expect(await restartBlocked()).toBe(false)
    busy.mockResolvedValueOnce({ downloads: 1, otherWindows: 0 })
    expect(await restartBlocked()).toBe(true)
    busy.mockResolvedValueOnce({ downloads: 0, otherWindows: 1 })
    expect(await restartBlocked()).toBe(true)
  })

  it('an app without the bridge (the phone), or a bridge that fails: only forms and uploads count', async () => {
    ;(globalThis as { window?: unknown }).window = { wivo: { busy: async () => { throw new Error('old preload') } } }
    expect(await restartBlocked()).toBe(false)
  })
})
