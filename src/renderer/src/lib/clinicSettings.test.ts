import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const { mergeSettings, SHARED_COLUMNS } = await import('./clinicSettings')

describe('clinic settings (sql/102)', () => {
  it('reads only the columns every member may select', () => {
    expect([...SHARED_COLUMNS].sort()).toEqual([
      'calendar', 'clinic_id', 'features', 'machines', 'material_prices', 'materials', 'payroll',
      'pipeline_stages', 'pricing', 'updated_at', 'visit_types', 'work_types',
    ])
    for (const c of ['email', 'material_costs', 'broneering', 'public_services', 'vestlus']) expect(SHARED_COLUMNS).not.toContain(c)
  })

  it('adds what this person may read of the rest', () => {
    const row = mergeSettings({ clinic_id: 'c', materials: ['Zirkoon'] }, { email: { host: 'x' }, material_costs: { Zirkoon: { hind: 1 } } })
    expect(row).toMatchObject({ clinic_id: 'c', materials: ['Zirkoon'], email: { host: 'x' }, material_costs: { Zirkoon: { hind: 1 } } })
  })

  it('blanks material costs this person may not read, so a shared computer does not keep the owner\'s', () => {
    const row = mergeSettings({ clinic_id: 'c' }, {})
    expect(row.material_costs).toEqual({})
    expect('email' in row).toBe(false)
  })
})
