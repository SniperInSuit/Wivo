/**
 * sql/117 in the app: profiles are read by named columns, never `*`, and the
 * pay and tax fields come only from pay_settings() — the database's answer to
 * whose the caller may see. So the desktop no longer loads a colleague's
 * pension percentage or tax-free income unless the person does payroll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }))
const { fetchPaySettings, withPaySettings, PAY_FIELDS } = await import('./paySettings')

const mari = { id: 'm', full_name: 'Mari' }
const jaan = { id: 'j', full_name: 'Jaan' }

describe('pay settings, merged where the database gives them', () => {
  it('a member: their own row has its pay fields; a colleague only their name', () => {
    const merged = withPaySettings([mari, jaan], [{ profile_id: 'm', tasu_arvestus: 'neto', maksuvaba_tulu: 700 }])
    expect(merged).toEqual([{ id: 'm', full_name: 'Mari', tasu_arvestus: 'neto', maksuvaba_tulu: 700 }, jaan])
    expect(Object.keys(merged[1])).toEqual(['id', 'full_name'])
  })

  it('payroll: everyone\'s', () => {
    const merged = withPaySettings([mari, jaan], [
      { profile_id: 'm', kiirtoo_kordaja: 1.5 }, { profile_id: 'j', kogumispension_protsent: 6 }])
    expect(merged.map(p => ('kiirtoo_kordaja' in p ? 'k' : '') + ('kogumispension_protsent' in p ? 'p' : ''))).toEqual(['k', 'p'])
  })
})

describe('where they come from', () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset() })

  it('pay_settings(), and nothing read from the table', async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: 'm', tasu_arvestus: 'neto' }], error: null })
    expect(await fetchPaySettings('c1')).toEqual([{ profile_id: 'm', tasu_arvestus: 'neto' }])
    expect(rpc).toHaveBeenCalledWith('pay_settings')
    expect(from).not.toHaveBeenCalled()
  })

  it('a database without sql/117: read from the table as before, so payroll keeps its numbers', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    const eq = vi.fn().mockResolvedValue({ data: [{ id: 'm', tasu_arvestus: 'neto' }], error: null })
    from.mockReturnValue({ select: () => ({ eq }) })
    expect(await fetchPaySettings('c1')).toEqual([{ profile_id: 'm', tasu_arvestus: 'neto' }])
  })

  it('any other failure is an error, not an empty answer', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(fetchPaySettings('c1')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('no screen reads whole profiles or the pay fields from the table', () => {
  const ROOTS = ['src/renderer/src', 'supabase/functions']
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : files(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
  const root = join(__dirname, '..', '..', '..', '..')

  it('every .from(\'profiles\') .select(...) names its columns, none of them pay or tax', () => {
    const found: string[] = []
    for (const f of ROOTS.flatMap(r => files(join(root, r)))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\.from\('profiles'\)([\s\S]{0,300}?)\.select\(([^)]*)\)/g)) {
        const between = m[1]
        if (/\.from\(/.test(between)) continue
        const arg = m[2].trim()
        const name = relative(root, f)
        // The one exception: a database without sql/117 (lib/paySettings fetchPaySettings).
        if (name.endsWith('lib/paySettings.ts')) continue
        if (arg === '' || arg.includes('*') || PAY_FIELDS.some(c => arg.includes(c))) found.push(`${name}: select(${arg})`)
      }
    }
    expect(found).toEqual([])
  })
})
