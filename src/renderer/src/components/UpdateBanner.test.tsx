/**
 * The update notice is never shown in test mode (npm run dev:test): nobody
 * installs a release, or pulls main, over the test setup by mistake. Outside
 * test mode it says what it always said.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { t } from '@/lib/i18n'

let testMode = false
vi.mock('../lib/testCopy', () => ({ get IS_TEST_COPY() { return testMode } }))
vi.mock('../providers/UpdateProvider', () => ({
  useUpdate: () => ({ running: '2.0.4', state: { stage: 'ready', version: '2.0.5' }, installNow: () => {}, checkNow: () => {} }),
}))
vi.mock('../hooks/useDevGitUpdate', () => ({
  useDevGitUpdate: () => ({ diskAvailable: null, remoteAvailable: true, pulling: false, pullDone: false, pullAndRestart: async () => {}, restart: () => {} }),
}))
const { UpdateBanner } = await import('./UpdateBanner')

describe('the update notice', () => {
  beforeEach(() => { testMode = false })

  it('in test mode: nothing, not even with a release staged and main ahead', () => {
    testMode = true
    expect(renderToStaticMarkup(<UpdateBanner />)).toBe('')
  })

  it('outside test mode: the staged release and its restart button, as before', () => {
    const html = renderToStaticMarkup(<UpdateBanner />)
    expect(html).toContain(t('updateBanner.updateReady'))
    expect(html).toContain(t('updateBanner.restartNow'))
  })
})
