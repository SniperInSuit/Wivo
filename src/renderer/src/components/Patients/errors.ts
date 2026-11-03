// Turn a Supabase/PostgREST error into something actionable in Estonian.
// 42501 = RLS denial, which otherwise just looks like "the button does nothing".
import { t } from '@/lib/i18n'
import { isUpdateRequired } from '../../lib/appVersion'


export function describeError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null
  const msg = e?.message ?? ''

  // sql/104: this build is below the minimum version; saves are refused.
  if (isUpdateRequired(err)) {
    return t('app.updateRequired')
  }
  // sql/092: text a partner reads named the patient. The database never says
  // which word: the message would end up in logs.
  if (e?.code === 'WV001') {
    return t('privacy.removePatientIdentity')
  }
  // sql/093: expired goods on a job; only the owner overrides, with a reason.
  if (e?.code === 'WV002') {
    return t('stock.expiredCannotUse')
  }
  // Refused by the database's rules: since sql/102 that is what a missing
  // permission looks like. Never "run this SQL": nobody using Wivo should.
  if (e?.code === '42501' || /row-level security/i.test(msg)) {
    return t('app.noPermission')
  }
  // A column, table, function or relationship this database does not have
  // (yet): a neutral message; the technical one stays for support.
  if (['PGRST204', '42703', '42P01', 'PGRST200', 'PGRST202', '42883'].includes(e?.code ?? '')
      || /does not exist|could not find .* in the schema cache/i.test(msg)) {
    return `${t('app.notAvailableYet')}`
  }
  return msg || t('patients.unknownError')
}
