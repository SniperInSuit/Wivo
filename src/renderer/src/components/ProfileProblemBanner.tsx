/**
 * "Your profile could not be read", with the reason.
 *
 * ── Why this is a banner and not a console line ─────────────────────────────
 * When the database refused the profile, the app said nothing. The name was
 * blank, Settings said "Role: —" and the menu quietly lost every item that
 * needs a profile. Nothing was broken on screen — there was simply less of it,
 * and no way to tell that from "this account has few permissions".
 *
 * The failure that caused it (sql/117 revoking table-wide SELECT, an older
 * build still asking for `select *`) took reading four migrations to find. A
 * sentence on screen would have made it minutes.
 *
 * ── What it does NOT say ────────────────────────────────────────────────────
 * Nothing about SQL, migrations or the database's own words. CLAUDE.md is
 * explicit: no screen names a migration file or a database command. "Update
 * Wivo" and "contact support" are the two things a person can act on.
 *
 * The `schema` case never reaches here as its own message: AuthContext raises
 * the ordinary "Update Wivo" for it, which already has the restart button.
 * This covers the rest — `database` among them, which is the same mismatch
 * the other way round: the build names something this database does not have,
 * and updating the app would only widen the gap. Neutral words, no migration
 * and no database command (CLAUDE.md).
 */
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { worthShowing } from '../lib/profileLoad'
import { t } from '@/lib/i18n'

export function ProfileProblemBanner() {
  const { profileFailure } = useAuth()
  if (!profileFailure || !worthShowing(profileFailure)) return null
  // Handled by the "Update Wivo" banner, which can also do something about it.
  if (profileFailure === 'schema') return null

  const text =
    profileFailure === 'missing' ? t('profileProblem.noProfile')
      : profileFailure === 'offline' ? t('profileProblem.offline')
        : profileFailure === 'database' ? t('profileProblem.databaseBehind')
          : t('profileProblem.unknown')

  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
      <div>
        <p className="text-xs font-semibold text-ink">{t('profileProblem.title')}</p>
        <p className="text-[11px] leading-relaxed text-ink-muted">{text}</p>
      </div>
    </div>
  )
}
