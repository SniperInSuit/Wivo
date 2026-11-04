import { describe, it, expect } from 'vitest'
import { toCsv } from '@shared/export/csv'
import {
  AUDIT_ACTIONS, NO_FILTERS, actionLabel, auditCsvColumns, chartSummary, cursorAfter, describeEntry, entryPatient, entryWhat,
  entryWho, filterArgs, filtersText, groupRows, type AuditEntry,
} from './auditSearch'
import { t } from '@/lib/i18n'

const entry = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1, at: '2026-03-05T10:00:00Z', user_name: 'Mari', action: 'stage_move', object: 'job:x', job_code: 'TAL-26-0042',
  detail: { from: 'disain', to: 'print' }, ...p,
})

describe('the filters as the database takes them', () => {
  it('nothing set: nothing filtered', () => {
    expect(filterArgs(NO_FILTERS)).toEqual({ p_user: null, p_action: null, p_job_code: null, p_from: null, p_to: null })
  })

  it('dates are this computer\'s days, both ends included: from the start of the first to the start of the day after the last', () => {
    const a = filterArgs({ ...NO_FILTERS, from: '2026-03-01', to: '2026-03-31' })
    expect(new Date(a.p_from!).getTime()).toBe(new Date(2026, 2, 1).getTime())
    expect(new Date(a.p_to!).getTime()).toBe(new Date(2026, 3, 1).getTime())
  })

  it('a job code is trimmed; person and action pass as they are; a broken date is ignored', () => {
    expect(filterArgs({ ...NO_FILTERS, jobCode: '  tal 26 0042 ', userId: 'u1', action: 'view', from: 'yesterday' }))
      .toEqual({ p_user: 'u1', p_action: 'view', p_job_code: 'tal 26 0042', p_from: null, p_to: null })
  })
})

describe('paging', () => {
  it('the next page starts after this page\'s last row', () => {
    expect(cursorAfter([entry({ id: 9, at: 'b' }), entry({ id: 3, at: 'a' })])).toEqual({ at: 'a', id: 3 })
    expect(cursorAfter([])).toBeNull()
  })
})

describe('what is shown, and exported', () => {
  it('every kind of entry the log holds has a name', () => {
    for (const a of AUDIT_ACTIONS) expect(actionLabel(a)).not.toBe(a)
    expect(AUDIT_ACTIONS).toContain('delete')
    expect(AUDIT_ACTIONS).toContain('stock_override')
  })

  it('the job code where there is one, otherwise the object', () => {
    expect(entryWhat(entry())).toBe('TAL-26-0042')
    expect(entryWhat(entry({ job_code: null, object: 'partnership:1' }))).toBe('partnership:1')
    expect(describeEntry(entry())).toBe('disain → print')
  })

  it('the CSV has exactly the screen\'s columns — nothing the log does not show (no ids, no raw detail)', () => {
    expect(auditCsvColumns()).toHaveLength(5)
    const csv = toCsv([entry({ detail: { from: 'disain', to: 'print', secret: 'x' } })], auditCsvColumns())
    expect(csv).toContain('TAL-26-0042')
    expect(csv).toContain('Mari')
    expect(csv).not.toContain('secret')
    expect(csv).not.toContain('job:x')
  })
})

describe('a recorded CSV export, as the log shows it (sql/106)', () => {
  it('which export, how many rows and the filters', () => {
    const e = entry({ action: 'export', object: 'csv:jobs', job_code: null,
      detail: { kind: 'jobs', rows: 120, filters: { stage: 'print', search: true, workTypes: ['Kroon', 'Sild'] } } })
    expect(entryWhat(e)).toMatch(/^CSV: /)
    expect(entryWhat(e)).not.toContain('csv:')
    const d = describeEntry(e)
    expect(d).toContain('120')
    expect(d).toContain('print')
    expect(d).toContain('Kroon, Sild')
  })

  it('the patient export\'s entry still reads as before (files)', () => {
    expect(describeEntry(entry({ action: 'export', object: 'patient:x', job_code: null, detail: { files: 3 } }))).toMatch(/3/)
  })

  it('no filters: nothing after the rows', () => {
    expect(filtersText({})).toBe('')
    expect(filtersText(null)).toBe('')
  })
})

describe('an edit (sql/114), as the log shows it', () => {
  const MARI = '11111111-1111-4111-8111-111111111111'
  const JAAN = '22222222-2222-4222-8222-222222222222'
  const names = new Map([[MARI, 'Mari Tamm']])
  const edit = (detail: Record<string, unknown>, p: Partial<AuditEntry> = {}) =>
    entry({ action: 'edit', detail: { job_code: 'TAL-26-0042', ...detail }, ...p })

  it('a job: each field old → new, free text only "changed", work items by name, in one line', () => {
    const d = describeEntry(edit({
      changes: { hambad: { old: '11,21', new: '11,21,22' }, materjal: { old: 'Zirkoon', new: 'E.max' }, kirjeldus: 'changed' },
      work_items: [{ item: 'Kroon 22', change: 'added' }, { item: 'Sild 14,15,16', changes: { materjal: { old: 'PMMA', new: 'Zirkoon' } } }],
    }))
    expect(d).toBe([
      `${t('auditField.teeth')} 11,21 → 11,21,22`,
      `${t('auditField.material')} Zirkoon → E.max`,
      t('audit.fieldChanged', { field: t('auditField.description') }),
      t('audit.added', { item: 'Kroon 22' }),
      `Sild 14,15,16: ${t('auditField.material')} PMMA → Zirkoon`,
    ].join(' · '))
  })

  it('people by name; someone who left, "nobody" and "as on the job" said so; yes and no', () => {
    const d = describeEntry(edit({ changes: {
      assigned_to: { old: JAAN, new: MARI }, designed_by: { old: 'job', new: null }, makstud: { old: 'false', new: 'true' } } }), names)
    expect(d).toContain(`${t('auditField.technician')} ${t('audit.formerMember')} → Mari Tamm`)
    expect(d).toContain(`${t('auditField.designer')} ${t('audit.asOnJob')} → ${t('audit.nobody')}`)
    expect(d).toContain(`${t('auditField.paid')} ${t('audit.no')} → ${t('audit.yes')}`)
    expect(d).not.toContain(JAAN)
  })

  it('a remake by its number, with its own work items', () => {
    const d = describeEntry(edit({ remakes: [{ remake: 2, changes: { hambad: { old: '11', new: '11,12' }, note: 'changed',
      work_items: [{ item: 'Kroon 12', change: 'added' }] } }, { remake: 3, change: 'added' }] }))
    expect(d).toContain(`${t('audit.remake', { n: 2 })}: ${t('auditField.teeth')} 11 → 11,12`)
    expect(d).toContain(t('audit.added', { item: 'Kroon 12' }))
    expect(d).toContain(t('audit.added', { item: t('audit.remake', { n: 3 }) }))
  })

  it('a patient: by id with a way to the card, never a name; consent in words', () => {
    const e = edit({ changes: { nimi: 'changed', turundusnousolek: { old: 'kysimata', new: 'jah' } } },
      { object: `patient:${MARI}`, job_code: null })
    expect(entryWhat(e)).toBe(t('audit.patientShort', { id: MARI.slice(0, 8) }))
    expect(entryPatient(e)).toBe(MARI)
    expect(describeEntry(e)).toBe(`${t('audit.fieldChanged', { field: t('auditField.name') })} · ${t('auditField.marketingConsent')} ${t('patient.notAsked')} → ${t('patient.allowed')}`)
  })

  it('the tooth chart: the tooth, its status in words', () => {
    const e = edit({ tooth: 16, changes: { staatus: { old: null, new: 'ravi' }, markus: 'changed' } }, { object: `patient:${MARI}`, job_code: null })
    expect(describeEntry(e)).toBe(`${t('audit.tooth', { n: 16 })}: ${t('auditField.toothStatus')} ${t('audit.toothUnmarked')} → ${t('audit.toothTreatment')}, ${t('audit.fieldChanged', { field: t('auditField.note') })}`)
  })

  it('details that could not be read are said so', () => {
    expect(describeEntry(edit({ unreadable: true }))).toBe(t('audit.unreadable'))
  })
})

describe('permissions and a deleted file (sql/114)', () => {
  const WORKER = '33333333-3333-4333-8333-333333333333'

  it('who got or lost which permission: the member by name, permissions in words', () => {
    const e = entry({ action: 'permission', object: `user:${WORKER}`, job_code: null,
      detail: { granted: ['patients.read'], removed: ['jobs.delete'] } })
    expect(entryWhat(e, new Map([[WORKER, 'Jaan Kask']]))).toBe('Jaan Kask')
    expect(entryWhat(e)).toBe(t('audit.formerMember'))
    expect(describeEntry(e)).toBe(`${t('audit.granted', { list: t('usePermissions.viewPatients') })} · ${t('audit.revoked', { list: t('usePermissions.deleteJobs') })}`)
  })

  it('a role', () => {
    expect(describeEntry(entry({ action: 'permission', object: `user:${WORKER}`, detail: { role: { old: 'technician', new: 'admin' } } })))
      .toBe(t('audit.roleChange', { old: t('audit.roleTechnician'), new: t('audit.roleAdmin') }))
  })

  it('a file: its kind and version, under its job', () => {
    const e = entry({ action: 'file_deleted', detail: { file: 'f1', type: 'design', version: 2 } })
    expect(entryWhat(e)).toBe('TAL-26-0042')
    expect(describeEntry(e)).toBe(t('audit.fileDeletedDetail', { type: t('files.typeDesign'), version: 2 }))
  })

  it('every new kind is in the filter, and the CSV never shows a raw id', () => {
    for (const a of ['create', 'edit', 'permission', 'file_deleted']) expect(AUDIT_ACTIONS).toContain(a)
    const csv = toCsv([entry({ action: 'permission', object: `user:${WORKER}`, job_code: null, detail: { granted: ['jobs.read'] } }),
                       entry({ action: 'create', object: `patient:${WORKER}`, job_code: null, detail: {} })], auditCsvColumns())
    expect(csv).not.toContain(WORKER)
  })
})

describe('the tooth chart: one entry per click, one row on screen', () => {
  const P = 'patient:p1'
  const click = (id: number, tooth: number, p: Partial<AuditEntry> = {}) =>
    entry({ id, action: 'edit', object: P, job_code: null, detail: { tooth, changes: { staatus: { old: null, new: 'ravi' } } }, ...p })

  it('consecutive clicks by one person on one patient: one row, every entry kept', () => {
    const rows = [click(5, 16), click(4, 21), click(3, 16), entry({ id: 2 }), click(1, 11)]
    const g = groupRows(rows)
    expect(g.map(r => r.kind)).toEqual(['chart', 'entry', 'entry'])
    expect(g[0].kind === 'chart' && g[0].entries.map(e => e.id)).toEqual([5, 4, 3])
    expect(g[0].kind === 'chart' && chartSummary(g[0].entries)).toBe(t('audit.chartChanges', { n: 3, teeth: '16, 21' }))
  })

  it('another person, another patient or one click alone: not grouped', () => {
    expect(groupRows([click(3, 16), click(2, 21, { user_name: 'Jaan' })]).map(r => r.kind)).toEqual(['entry', 'entry'])
    expect(groupRows([click(3, 16), click(2, 21, { object: 'patient:p2' })]).map(r => r.kind)).toEqual(['entry', 'entry'])
    expect(groupRows([click(1, 16)]).map(r => r.kind)).toEqual(['entry'])
  })

  it('a patient\'s other edits are not chart clicks', () => {
    const fields = entry({ id: 2, action: 'edit', object: P, job_code: null, detail: { changes: { nimi: 'changed' } } })
    expect(groupRows([click(3, 16), fields, click(1, 21)]).map(r => r.kind)).toEqual(['entry', 'entry', 'entry'])
  })
})

describe('who made it, after their account is gone (sql/115)', () => {
  const LIIS = '44444444-4444-4444-8444-444444444444'

  it('the name the entry kept; an id with no name left, a former member; nobody signed in, the system', () => {
    expect(entryWho(entry({ user_name: 'Liis Lahkuja', user_id: LIIS }))).toBe('Liis Lahkuja')
    expect(entryWho(entry({ user_name: null, user_id: LIIS }))).toBe(t('audit.formerMemberWho'))
    expect(entryWho(entry({ user_name: null, user_id: null }))).toBe(t('audit.system'))
    expect(entryWho(entry({ user_name: null }))).toBe(t('audit.system'))
  })

  it('the people an entry names: as stored then, even when today\'s list has them otherwise or not at all', () => {
    const e = entry({ action: 'edit', detail: { changes: { assigned_to: { old: null, new: LIIS } }, names: { [LIIS]: 'Liis Lahkuja' } } })
    expect(describeEntry(e)).toBe(`${t('auditField.technician')} ${t('audit.nobody')} → Liis Lahkuja`)
    expect(describeEntry(e, new Map([[LIIS, 'Liis Kask']]))).toContain('Liis Lahkuja')
    const p = entry({ action: 'permission', object: `user:${LIIS}`, job_code: null, detail: { granted: ['jobs.read'], names: { [LIIS]: 'Liis Lahkuja' } } })
    expect(entryWhat(p)).toBe('Liis Lahkuja')
  })

  it('the stored names never show as a field of their own', () => {
    const e = entry({ action: 'edit', detail: { changes: { varv: { old: 'A1', new: 'A2' } }, names: { [LIIS]: 'Liis' } } })
    expect(describeEntry(e)).toBe(`${t('auditField.shade')} A1 → A2`)
  })
})
