/**
 * The freeze warning (docs/ARCHITECTURE-INSTANCES.md 5g): approvers see it
 * while the list of updates has expired by the database's clock; nobody
 * else, and not while the list is fresh.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UpdateStatus } from '../lib/updateStatus'
import { t } from '@/lib/i18n'

let status: UpdateStatus | null = null
vi.mock('../hooks/useUpdateStatus', () => ({ useUpdateStatus: () => status }))
const { UpdateStaleBanner } = await import('./UpdateStaleBanner')

const base: UpdateStatus = {
  channel: 'stable', installed: { version: '2.3.0', at: '2026-11-01T10:00:00Z' }, stale: false, last_check: null, installs: [], keys: [],
  list: { key_id: 'signing-1', serial: 7, expires: '2026-11-19T10:00:00Z', checked_at: '2026-11-05T10:00:00Z', content: null },
}

describe('the warning when the list of updates can\'t be refreshed', () => {
  it('not an approver, or not a clinic\'s own project: nothing', () => {
    status = null
    expect(renderToStaticMarkup(<UpdateStaleBanner />)).toBe('')
  })

  it('a fresh list: nothing', () => {
    status = base
    expect(renderToStaticMarkup(<UpdateStaleBanner />)).toBe('')
  })

  it('stale: what it means, since when, and what to do', () => {
    status = { ...base, stale: true }
    const html = renderToStaticMarkup(<UpdateStaleBanner />)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('updates.staleTitle').replace(/'/g, '&#x27;'))
    expect(html).toContain('19')
    expect(html).toContain(t('updates.staleWhatToDo').split(';')[0])
  })

  it('no list has ever arrived: says so', () => {
    status = { ...base, stale: true, list: null }
    expect(renderToStaticMarkup(<UpdateStaleBanner />)).toContain(t('updates.staleNever'))
  })
})
