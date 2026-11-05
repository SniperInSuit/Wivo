/**
 * update_status() (sql/119) in the app: an approver's answer as it comes; a
 * database without sql/119, or anyone who isn't an approver, gets null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
const { fetchUpdateStatus } = await import('./updateStatus')

describe('fetchUpdateStatus', () => {
  beforeEach(() => rpc.mockReset())

  it('an approver: the status as the database gives it', async () => {
    rpc.mockResolvedValue({ data: { channel: 'stable', stale: true, list: null, installs: [], keys: [] }, error: null })
    expect(await fetchUpdateStatus()).toMatchObject({ channel: 'stable', stale: true })
    expect(rpc).toHaveBeenCalledWith('update_status')
  })

  it('not an approver, or not a clinic\'s own project: null', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await fetchUpdateStatus()).toBeNull()
  })

  it('a database without sql/119: null; any other failure is an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect(await fetchUpdateStatus()).toBeNull()
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(fetchUpdateStatus()).rejects.toMatchObject({ code: '42501' })
  })
})
