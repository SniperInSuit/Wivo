import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const exportCsv = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('./exports', () => ({ exportCsv: (...a: unknown[]) => exportCsv(...a) }))
vi.mock('../components/Patients/errors', () => ({ describeError: (e: { message?: string }) => e?.message ?? 'error' }))
const { activeFilters, auditedCsvExport, isSet, recordExport } = await import('./exportAudit')

describe('what an export records', () => {
  beforeEach(() => { rpc.mockReset(); exportCsv.mockReset() })

  it('only the filters in use; free text only as "set"', () => {
    expect(activeFilters({ search: isSet('Mari Maasikas'), stage: 'print', period: 'all', workTypes: [], debtors: 0, archived: false, status: null, from: '' }))
      .toEqual({ search: true, stage: 'print' })
    expect(isSet('  ')).toBe(false)
    expect(activeFilters({ workTypes: Array.from({ length: 30 }, (_, i) => `t${i}`) }).workTypes).toHaveLength(20)
  })

  it('the entry first, then the file; the number of rows, never the rows', async () => {
    const order: string[] = []
    rpc.mockImplementation(async () => { order.push('audit'); return { error: null } })
    exportCsv.mockImplementation(() => order.push('file'))
    const rows = [{ patsient: 'Mari Maasikas' }, { patsient: 'Jaan Tamm' }]
    expect(await auditedCsvExport('jobs', 'tood', rows, [{ header: 'Patsient', value: (r: { patsient: string }) => r.patsient }], { search: isSet('Mari') })).toBe(true)
    expect(order).toEqual(['audit', 'file'])
    expect(rpc).toHaveBeenCalledWith('audit_export', { p_kind: 'jobs', p_rows: 2, p_filters: { search: true } })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('Mari Maasikas')
  })

  it('if the entry cannot be written, no file, and the person is told', async () => {
    rpc.mockResolvedValue({ error: { code: '42501', message: 'Sign in with your second factor first' } })
    const told = vi.fn()
    expect(await auditedCsvExport('invoices', 'arved', [{}], [], {}, told)).toBe(false)
    expect(exportCsv).not.toHaveBeenCalled()
    expect(told).toHaveBeenCalledWith('Sign in with your second factor first')
  })

  it('a database before sql/106 (no such function) does not stop the export', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'not found' } })
    await expect(recordExport('customers', 1)).resolves.toBeUndefined()
  })
})

describe('no export is left out', () => {
  it('no screen makes a CSV without writing the audit entry first', async () => {
    const { execSync } = await import('node:child_process')
    const root = execSync('git rev-parse --show-toplevel').toString().trim()
    const grep = (pattern: string): string[] => {
      try {
        return execSync(`git grep -l "${pattern}" -- 'src/renderer/src/components' 'src/renderer/src/mobile'`, { cwd: root }).toString().trim().split('\n').filter(Boolean)
      } catch { return [] }
    }
    // The plain export is reached only through auditedCsvExport.
    expect(grep('exportCsv(')).toEqual([])
    // The one screen that builds its own file records the export just before.
    expect(grep('downloadCsv(')).toEqual(['src/renderer/src/components/Settings/AuditLogSection.tsx'])
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${root}/src/renderer/src/components/Settings/AuditLogSection.tsx`, 'utf8')
    expect(src.indexOf("await recordExport('audit_log'")).toBeGreaterThan(-1)
    expect(src.indexOf("await recordExport('audit_log'")).toBeLessThan(src.indexOf('downloadCsv(csvFileName'))
  })
})
