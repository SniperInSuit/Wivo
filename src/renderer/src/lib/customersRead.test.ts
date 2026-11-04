/**
 * sql/118 in the app: without View jobs or View payments, clients are read as
 * id, name and archived only — what a job shows; the whole client comes from
 * customers_full(). Nothing else in the app reads a client's details from
 * the table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const rpc = vi.fn()
const select = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: (...a: unknown[]) => select(...a) }) },
}))
const { fetchCustomers, CUSTOMER_BASIC_COLUMNS } = await import('./customersRead')

const ordered = (data: unknown) => ({ order: async () => ({ data, error: null }) })

describe('which clients, and how much of them', () => {
  beforeEach(() => { rpc.mockReset(); select.mockReset() })

  it('without View jobs or View payments: id, name and archived from the table', async () => {
    select.mockReturnValue(ordered([{ id: 'c1', name: 'Hambakliinik OÜ', archived_at: null }]))
    expect(await fetchCustomers(false)).toEqual([{ id: 'c1', name: 'Hambakliinik OÜ', archived_at: null }])
    expect(select).toHaveBeenCalledWith(CUSTOMER_BASIC_COLUMNS)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('with them: the whole client, from customers_full()', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1', name: 'Hambakliinik OÜ', email: 'mari@kliinik.ee' }], error: null })
    expect(await fetchCustomers(true)).toEqual([{ id: 'c1', name: 'Hambakliinik OÜ', email: 'mari@kliinik.ee' }])
    expect(rpc).toHaveBeenCalledWith('customers_full')
    expect(select).not.toHaveBeenCalled()
  })

  it('a database without sql/118: the table, whole, as before', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    select.mockReturnValue(ordered([{ id: 'c1', email: 'x@y.ee' }]))
    expect(await fetchCustomers(true)).toEqual([{ id: 'c1', email: 'x@y.ee' }])
    expect(select).toHaveBeenCalledWith('*')
  })

  it('any other failure is an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(fetchCustomers(true)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('no screen reads a client\'s details from the table', () => {
  const DETAILS = ['contact_name', 'email', 'cc_emails', 'phone', 'address', 'reg_code', 'vat_number', 'note', 'price_overrides', 'payment_terms_days', 'billing_mode']
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : files(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
  const root = join(__dirname, '..', '..', '..', '..')

  it('every .from(\'customers\') .select(...) names only what a job shows', () => {
    const found: string[] = []
    for (const f of files(join(root, 'src/renderer/src'))) {
      const name = relative(root, f)
      // The one exception: a database without sql/118 (fetchCustomers).
      if (name.endsWith('lib/customersRead.ts')) continue
      for (const m of readFileSync(f, 'utf8').matchAll(/\.from\('customers'\)([\s\S]{0,300}?)\.select\(([^)]*)\)/g)) {
        if (/\.from\(/.test(m[1])) continue
        const arg = m[2].trim()
        if (arg === '' || arg.includes('*') || DETAILS.some(c => new RegExp(`\\b${c}\\b`).test(arg))) found.push(`${name}: select(${arg})`)
      }
    }
    expect(found).toEqual([])
  })
})
