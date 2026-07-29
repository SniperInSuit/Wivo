// Turn a Supabase/PostgREST error into something actionable in Estonian.
// 42501 = RLS denial, which otherwise just looks like "the button does nothing".
export function describeError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null
  if (e?.code === '42501' || /row-level security/i.test(e?.message ?? '')) {
    return 'Andmebaas keeldus kirjutamast (RLS). Käivita sql/002_patients_rls.sql Supabase SQL-redaktoris.'
  }
  // Checked before 42P01: a missing column also says "does not exist", and the
  // fix is a different migration. Happens when 003 has not been run yet and the
  // app writes patients.markused / patients.varvi_eelistus.
  if (e?.code === 'PGRST204' || e?.code === '42703' || /column .* does not exist/i.test(e?.message ?? '')) {
    return 'Andmebaasis puudub veerg. Käivita sql/003_patient_teeth.sql Supabase SQL-redaktoris.'
  }
  if (e?.code === '42P01' || /does not exist/i.test(e?.message ?? '')) {
    return 'Patsientide tabelit pole. Käivita sql/001_patients.sql, sql/002_patients_rls.sql ja sql/003_patient_teeth.sql.'
  }
  return e?.message ?? 'Tundmatu viga'
}
