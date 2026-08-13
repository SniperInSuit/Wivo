// Turn a Supabase/PostgREST error into something actionable in Estonian.
// 42501 = RLS denial, which otherwise just looks like "the button does nothing".

/**
 * Which migration adds a given column.
 *
 * Every insert in this app is a raw spread, so a column the schema does not
 * have yet rejects the WHOLE row — one un-run migration and nothing saves at
 * all. Naming the exact file turns that from "Loo töö ei tööta" into a fix the
 * owner can carry out without opening the repo.
 */
const COLUMN_MIGRATION: Record<string, string> = {
  kirjeldus:       'sql/010_job_kirjeldus.sql',
  disain_id:       'sql/011_job_disain_id.sql',
  valmis_kuupaev:  'sql/025_job_completed_date.sql',
  work_items:      'sql/032_work_items.sql',
  extras:          'sql/033_job_extras.sql',
  // NOT 033 — that adds `extras`, a different column for the priced services
  // picked from settings. `extra_costs` is the free-text cost list and got its
  // own migration late, which is how this map was wrong the first time.
  extra_costs:     'sql/043_job_extra_costs.sql',
  customer_id:     'sql/035_customers.sql',
  customer_ref:    'sql/035_customers.sql',
  delivery_status: 'sql/035_customers.sql',
  delivered_at:    'sql/035_customers.sql',
  mudel:           'sql/038_job_mudel.sql',
  mudel_id:        'sql/041_job_mudel_id.sql',
  kondivarv:       'sql/042_job_kondivarv.sql',
}

/** PostgREST says: Could not find the 'mudel_id' column of 'jobs' in the schema cache */
function missingColumn(message: string): string | null {
  return message.match(/'([a-z0-9_]+)' column/i)?.[1]
    ?? message.match(/column "?([a-z0-9_]+)"? does not exist/i)?.[1]
    ?? null
}

export function describeError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null
  const msg = e?.message ?? ''

  if (e?.code === '42501' || /row-level security/i.test(msg)) {
    return 'Andmebaas keeldus kirjutamast (RLS). Käivita sql/002_patients_rls.sql Supabase SQL-redaktoris.'
  }
  // Checked before 42P01: a missing column also says "does not exist", and the
  // fix is a different migration.
  if (e?.code === 'PGRST204' || e?.code === '42703' || /column .* does not exist/i.test(msg)) {
    const col = missingColumn(msg)
    const file = col ? COLUMN_MIGRATION[col] : undefined
    if (col && file) {
      return `Andmebaasis puudub veerg „${col}". Käivita ${file} Supabase SQL-redaktoris (Wivo kinni) ja proovi uuesti.`
    }
    if (col) {
      return `Andmebaasis puudub veerg „${col}". Käivita puuduv migratsioon sql/ kaustast Supabase SQL-redaktoris.`
    }
    return 'Andmebaasis puudub veerg. Käivita käivitamata migratsioonid sql/ kaustast Supabase SQL-redaktoris.'
  }
  if (e?.code === '42P01' || /does not exist/i.test(msg)) {
    return 'Tabelit ei ole. Käivita käivitamata migratsioonid sql/ kaustast Supabase SQL-redaktoris.'
  }
  return msg || 'Tundmatu viga'
}
