import { useState, useEffect } from 'react'
import { Users, UserPlus, Shield, Loader2, Trash2, Check, Lock, Copy } from 'lucide-react'
import { supabase, displayIdentity } from '../../lib/supabase'
import { AddMemberDialog } from './AddMemberDialog'
import { teamAccounts, accountBadges, resendInvite, teamErrorMessage, type TeamAccount } from '../../lib/teamAccount'
import { TECHNICIAN_PRESET } from '@shared/permissions'
import { useAuth } from '../../context/AuthContext'
import { DebugConsole } from './DebugConsole'
import { ResetMfaPanel } from './ResetMfaPanel'
import type { Profile } from '../../lib/supabase'
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, type PermissionKey
} from '../../hooks/usePermissions'
import { t, lang } from '@/lib/i18n'

interface WorkerWithPerms extends Profile {
  permissions: Map<string, boolean>
}

// Whether the invite was accepted and whether they have an authenticator
// (sql/100, 112). Nothing is shown for what is not known.
function AccountBadges({ account }: { account: TeamAccount | undefined }) {
  const badges = accountBadges(account)
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-1 ml-auto">
      {badges.map(b => (
        <span key={b.label} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${
          b.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          {b.ok && <Check size={10} aria-hidden="true" />}
          {t(b.label)}
        </span>
      ))}
    </div>
  )
}

// Permanent, so it says so and asks twice. The database is the real guard —
// it refuses outright if the person has any history.
function DeleteWorkerButton({ name, busy, onDelete }: {
  name: string; busy: boolean; onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-600 transition-colors"
      >
        <Trash2 size={12} /> {t('workers.deleteAccountPermanently')}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-red-600 font-medium">
        {t('workers.deletePermanentlyTheUsernameBecomesAvailable', { name })}
      </span>
      <button
        onClick={() => { onDelete(); setConfirm(false) }}
        disabled={busy}
        className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? t('workers.deleting') : t('workers.yesDelete')}
      </button>
      <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">{t('workers.cancel')}</button>
    </div>
  )
}

// Two clicks, because losing a colleague's access mid-shift is worse than one
// extra click when it was deliberate.
function RemoveWorkerButton({ name, busy, onRemove }: {
  name: string; busy: boolean; onRemove: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
      >
        <Trash2 size={12} /> {t('workers.removeFromTeam')}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-red-600 font-medium">{t('workers.remove', { name })}</span>
      <button
        onClick={() => { onRemove(); setConfirm(false) }}
        disabled={busy}
        className="text-xs bg-red-500 text-white px-2.5 py-1 rounded-lg hover:bg-red-600 disabled:opacity-50"
      >
        {busy ? t('workers.removing') : t('workers.yesRemove')}
      </button>
      <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">{t('workers.cancel')}</button>
    </div>
  )
}

export function WorkersPage() {
  const { clinicId, role } = useAuth()
  const isOwner = role === 'owner'
  const [workers, setWorkers] = useState<WorkerWithPerms[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [showInvite, setShowInvite] = useState(false)
  // How each member signs in, and whether an invite still waits (sql/100).
  const [accounts, setAccounts] = useState<Map<string, TeamAccount>>(new Map())
  // team_accounts failed: nobody's sign-in is known, so the page says so.
  const [accountsFailed, setAccountsFailed] = useState(false)
  const [resend, setResend] = useState<{ id: string; state: 'busy' | 'sent' | string } | null>(null)
  const [presetConfirm, setPresetConfirm] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Profile[]>([])
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwDone, setPwDone] = useState<string | null>(null)
  const [showAllRemoved, setShowAllRemoved] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadWorkers() {
    if (!clinicId) return
    setLoading(true)
    try {
      // Fetch all profiles in this clinic (excluding patients)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .eq('clinic_id', clinicId)
        .in('role', ['owner', 'worker'])
        .order('created_at')

      // Fetch all permissions for this clinic
      const { data: perms } = await supabase
        .from('worker_permissions')
        .select('profile_id, permission, granted')
        .eq('clinic_id', clinicId)

      const permMap = new Map<string, Map<string, boolean>>()
      ;(perms ?? []).forEach(p => {
        if (!permMap.has(p.profile_id)) permMap.set(p.profile_id, new Map())
        permMap.get(p.profile_id)!.set(p.permission, p.granted)
      })

      setWorkers((profiles ?? []).map(p => ({
        ...p,
        permissions: permMap.get(p.id) ?? new Map()
      })))
      const known = await teamAccounts()
      setAccounts(known ?? new Map())
      setAccountsFailed(known === null)

      // People removed from the clinic. The account itself cannot be deleted
      // from here — that needs the service_role key, which has no business
      // living in a desktop app — so removal unlinks them instead, and they
      // stay listed here so the owner can put someone back after a mistake.
      const { data: orphans } = await supabase
        .from('profiles')
        .select('*')
        .is('clinic_id', null)
        .in('role', ['owner', 'worker'])
        .order('created_at')
      setRemoved((orphans ?? []) as Profile[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadWorkers() }, [clinicId])

  const selected = workers.find(w => w.id === selectedId)

  // "Just removed" = updated in the last minute. An unlinked profile's last
  // write is its removal, so no extra column is needed to date it.
  const RESTORE_WINDOW_MS = 60_000
  const recentlyRemoved = removed.filter(r => {
    const removedAt = r.updated_at ? new Date(r.updated_at).getTime() : 0
    return Date.now() - removedAt < RESTORE_WINDOW_MS
  })

  // Never carry a typed password or a shown one across to another person.
  useEffect(() => { setNewPassword(''); setPwDone(null); setRemoveError(null) }, [selectedId])

  /**
   * Remove someone from the clinic.
   *
   * Not a delete: their work history has to survive, and the auth account can
   * only be destroyed with a service_role key. Unlinking the profile from the
   * clinic is what actually revokes access — every RLS policy is written against
   * my_clinic_id(), which becomes null for them.
   */
  async function removeFromClinic(worker: WorkerWithPerms) {
    setRemoveError(null)
    setRemoving(worker.id)
    try {
      // Permissions first: a stale grant left behind would come back with them
      // if they were ever re-added.
      await supabase.from('worker_permissions').delete().eq('profile_id', worker.id)
      const { error } = await supabase
        .from('profiles')
        .update({ clinic_id: null, updated_at: new Date().toISOString() })
        .eq('id', worker.id)
      if (error) throw error
      if (selectedId === worker.id) setSelectedId(null)
      await loadWorkers()
    } catch (err) {
      setRemoveError((err as Error)?.message ?? t('workers.removalFailed'))
    } finally {
      setRemoving(null)
    }
  }

  /**
   * Set a worker's password.
   *
   * The only route available: the account cannot be deleted or recreated from
   * here, and its synthetic address can never receive a reset email. Goes
   * through a SECURITY DEFINER function that checks the caller owns the clinic
   * (migration 030) — the client is never trusted with that decision.
   */
  async function setWorkerPassword(worker: WorkerWithPerms) {
    setRemoveError(null); setPwDone(null)
    if (newPassword.trim().length < 6) {
      setRemoveError(t('workers.passwordMustBeAtLeast6'))
      return
    }
    setPwSaving(true)
    try {
      const { error } = await supabase.rpc('admin_set_worker_password', {
        p_profile: worker.id,
        p_password: newPassword.trim(),
      })
      if (error) throw error
      setPwDone(newPassword.trim())
      setNewPassword('')
    } catch (err) {
      setRemoveError((err as Error)?.message ?? t('workers.settingThePasswordFailed'))
    } finally {
      setPwSaving(false)
    }
  }

  /**
   * Destroy the account for good. Refused by the database if the person has any
   * work, hours or payouts attached — see migration 031. Meant for the mistyped
   * duplicate, not for someone who has actually worked here.
   */
  async function deleteWorkerAccount(worker: WorkerWithPerms) {
    setRemoveError(null)
    setDeleting(worker.id)
    try {
      const { error } = await supabase.rpc('admin_delete_worker', { p_profile: worker.id })
      if (error) throw error
      if (selectedId === worker.id) setSelectedId(null)
      await loadWorkers()
    } catch (err) {
      setRemoveError((err as Error)?.message ?? t('workers.deletionFailed'))
    } finally {
      setDeleting(null)
    }
  }

  async function restoreToClinic(profile: Profile) {
    if (!clinicId) return
    setRemoveError(null)
    setRemoving(profile.id)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ clinic_id: clinicId, updated_at: new Date().toISOString() })
        .eq('id', profile.id)
      if (error) throw error
      await loadWorkers()
    } catch (err) {
      setRemoveError((err as Error)?.message ?? t('workers.restoringFailed'))
    } finally {
      setRemoving(null)
    }
  }

  async function togglePermission(profileId: string, perm: PermissionKey, current: boolean) {
    if (!clinicId) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('worker_permissions')
        .upsert({
          profile_id: profileId,
          clinic_id: clinicId,
          permission: perm,
          granted: !current
        }, { onConflict: 'profile_id,permission' })
      if (error) throw error
      // Update local state
      setWorkers(prev => prev.map(w => {
        if (w.id !== profileId) return w
        const next = new Map(w.permissions)
        next.set(perm, !current)
        return { ...w, permissions: next }
      }))
    } finally {
      setSaving(false)
    }
  }

  /** Every permission set to the technician's defaults: the preset on, the rest off. */
  async function applyTechnicianPreset(profileId: string) {
    if (!clinicId) return
    setSaving(true)
    setPresetConfirm(null)
    try {
      const rows = ALL_PERMISSIONS.map(perm => ({
        profile_id: profileId, clinic_id: clinicId, permission: perm, granted: TECHNICIAN_PRESET.includes(perm),
      }))
      const { error } = await supabase.from('worker_permissions').upsert(rows, { onConflict: 'profile_id,permission' })
      if (error) throw error
      setWorkers(prev => prev.map(w => w.id !== profileId ? w
        : { ...w, permissions: new Map(rows.map(r => [r.permission, r.granted])) }))
    } catch (err) {
      setRemoveError(teamErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function sendInviteAgain(profile: Profile) {
    setResend({ id: profile.id, state: 'busy' })
    try {
      await resendInvite(profile.id, profile.language ?? lang)
      setResend({ id: profile.id, state: 'sent' })
    } catch (err) {
      setResend({ id: profile.id, state: teamErrorMessage(err) })
    }
  }

  if (!isOwner) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-ink-muted">{t('workers.onlyTheClinicOwnerCanManage')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-5 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-page-ink flex items-center gap-2">
            <Users size={20} /> {t('workers.team')}
          </h1>
          <p className="text-sm text-page-muted">
            {t('workers.manageStaffAndTheirPermissions')}
          </p>
        </div>

        <div className="flex gap-5">
          {/* Worker list */}
          <div className="w-64 flex-shrink-0 space-y-2">
            {accountsFailed && (
              <p role="status" className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('team.accountsUnavailable')}
              </p>
            )}
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="text-accent animate-spin" />
              </div>
            ) : workers.map(w => (
              <button
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  selectedId === w.id
                    ? 'bg-accent/10 border-accent/30 text-ink'
                    : 'bg-bg-card border-ink-faint/15 text-ink-muted hover:border-ink-faint/30'
                }`}
              >
                <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold truncate min-w-0 flex-1 basis-20">{w.full_name || '—'}</p>
                  <AccountBadges account={accounts.get(w.id)} />
                </div>
                <p className="text-[11px] text-ink-faint truncate">
                  {accounts.get(w.id)?.login ?? displayIdentity(null, w.username)}
                </p>
                <p className="text-[11px] text-ink-faint flex items-center gap-1.5">
                  <Shield size={10} />
                  {w.role === 'owner' ? t('workers.owner2') : t('workers.staffMember')}
                </p>
              </button>
            ))}

            {/* Invite button */}
            <button
              onClick={() => setShowInvite(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-ink-faint/30 text-ink-muted hover:border-accent hover:text-accent transition-colors text-sm"
            >
              <UserPlus size={14} />
              {t('workers.addStaffMember')}
            </button>
          </div>

          {/* Permission panel */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <Shield size={28} className="text-ink-faint" />
                <p className="text-sm text-ink-muted">{t('workers.pickAStaffMemberToView')}</p>
              </div>
            ) : selected.role === 'owner' ? (
              <div className="card p-5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1 mb-1">
                  <h2 className="text-base font-semibold text-ink min-w-0">{selected.full_name}</h2>
                  <AccountBadges account={accounts.get(selected.id)} />
                </div>
                <p className="text-sm text-ink-muted">
                  {t('workers.theOwnerHasAllPermissionsThey')}
                </p>
              </div>
            ) : (
              <div className="card p-5 space-y-4">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{selected.full_name || '—'}</h2>
                    <p className="text-xs text-ink-muted">{t('workers.staffPermissions')}</p>
                  </div>
                  <AccountBadges account={accounts.get(selected.id)} />
                </div>

                {accounts.get(selected.id)?.invite_pending && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-1.5">
                    <p className="text-amber-800">{t('team.invitePendingHelp', { email: accounts.get(selected.id)!.login })}</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void sendInviteAgain(selected)} disabled={resend?.id === selected.id && resend.state === 'busy'}
                        className="btn-ghost border border-amber-300 text-xs disabled:opacity-50">
                        {resend?.id === selected.id && resend.state === 'busy' ? <Loader2 size={12} className="animate-spin" /> : t('team.sendAgain')}
                      </button>
                      {resend?.id === selected.id && resend.state === 'sent' && <span className="text-emerald-700">{t('team.sentAgain')}</span>}
                      {resend?.id === selected.id && resend.state !== 'sent' && resend.state !== 'busy' && <span className="text-red-700">{resend.state}</span>}
                    </div>
                  </div>
                )}

                {/* The defaults a new technician gets (sql/102), for anyone made before. */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {presetConfirm === selected.id ? (
                    <>
                      <span className="text-ink-muted">{t('team.technicianPresetConfirm')}</span>
                      <button onClick={() => void applyTechnicianPreset(selected.id)} disabled={saving}
                        className="btn-primary text-xs px-2.5 py-1 disabled:opacity-50">{t('team.technicianPresetYes')}</button>
                      <button onClick={() => setPresetConfirm(null)} className="btn-ghost text-xs">{t('workers.cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setPresetConfirm(selected.id)} disabled={saving}
                        className="btn-ghost border border-ink-faint/25 text-xs disabled:opacity-50">{t('team.technicianPreset')}</button>
                      <span className="text-ink-faint">{t('team.technicianPresetHelp')}</span>
                    </>
                  )}
                </div>

                <div className="space-y-1">
                  {ALL_PERMISSIONS.map(perm => {
                    const info = PERMISSION_LABELS[perm]
                    const granted = selected.permissions.get(perm) ?? false
                    return (
                      <button
                        key={perm}
                        onClick={() => togglePermission(selected.id, perm, granted)}
                        disabled={saving}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                          granted
                            ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                            : 'bg-bg-card border-ink-faint/15 hover:border-ink-faint/30'
                        }`}
                      >
                        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          granted ? 'bg-emerald-500 border-emerald-500' : 'border-ink-faint'
                        }`}>
                          {granted && <Check size={11} className="text-white" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{info.label}</p>
                          <p className="text-[11px] text-ink-faint">{info.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Password. The account cannot be recreated and cannot receive
                    a reset email, so this is the only way to fix a mistyped one. */}
                <div className="pt-3 border-t border-ink-faint/15">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                    {t('workers.setANewPassword')}
                  </p>
                  {pwDone ? (
                    <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <Check size={13} className="text-emerald-600 flex-shrink-0" />
                      <span className="text-emerald-800">{t('workers.newPassword')}</span>
                      <span className="font-mono font-semibold text-ink">{pwDone}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(pwDone)}
                        className="ml-auto text-ink-faint hover:text-ink"
                        title={t('workers.copy')}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                        <input
                          type="text"
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          placeholder={t('workers.atLeast6Characters')}
                          className="input pl-8 py-1.5 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => setWorkerPassword(selected)}
                        disabled={pwSaving || newPassword.trim().length < 6}
                        className="btn-ghost border border-ink-faint/25 disabled:opacity-50"
                      >
                        {pwSaving ? t('workers.saving') : t('workers.set')}
                      </button>
                    </div>
                  )}
                  {/* Only when it is known how they sign in: an e-mail account can reset its own. */}
                  {accounts.get(selected.id) && (
                    <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                      {accounts.get(selected.id)!.has_email
                        ? t('team.emailAccountPassword', { email: accounts.get(selected.id)!.login })
                        : t('workers.aUsernameAccountHasNoMailbox')}
                    </p>
                  )}
                </div>

                {/* Two-factor reset: the owner only (the database refuses anyone else). */}
                {isOwner && <ResetMfaPanel memberId={selected.id} name={selected.full_name || t('workers.thisStaffMember')} />}

                {/* Removal. Not a delete: the account cannot be destroyed from
                    here (that needs a service_role key), and their work history
                    has to survive regardless. Unlinking is what revokes access —
                    every policy is written against my_clinic_id(). */}
                <div className="pt-3 border-t border-ink-faint/15">
                  {removeError && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
                      {removeError}
                    </p>
                  )}
                  <RemoveWorkerButton
                    name={selected.full_name || t('workers.thisStaffMember')}
                    busy={removing === selected.id}
                    onRemove={() => removeFromClinic(selected)}
                  />
                  <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                    {t('workers.removesThemFromTheClinicAnd')}
                  </p>

                  {/* Permanent delete, for the mistyped duplicate. The database
                      refuses it for anyone with work, hours or payouts. */}
                  <div className="mt-2">
                    <DeleteWorkerButton
                      name={selected.full_name || t('workers.thisAccount')}
                      busy={deleting === selected.id}
                      onDelete={() => deleteWorkerAccount(selected)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Only just-removed people by default: the list is an undo for a
                misclick, not a permanent graveyard. The rest stay reachable
                behind a toggle rather than becoming unrecoverable — the account
                still exists either way, and an orphan nobody can find is a worse
                outcome than one extra click. */}
            {recentlyRemoved.length + removed.length > 0 && (
              <div className="card p-4 mt-4">
                <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                  {showAllRemoved
                    ? t('workers.removedFromClinic', { removedCount: removed.length })
                    : t('workers.justRemoved', { recentlyRemovedCount: recentlyRemoved.length })}
                </h3>
                {!showAllRemoved && recentlyRemoved.length === 0 && (
                  <p className="text-xs text-ink-faint mb-2">{t('workers.nobodyHasBeenRemovedInThe')}</p>
                )}
                <div className="space-y-1">
                  {(showAllRemoved ? removed : recentlyRemoved).map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg border border-ink-faint/15">
                      <div className="min-w-0 flex-1">
                        <p className="text-ink truncate">{r.full_name || '—'}</p>
                        <p className="text-[11px] text-ink-faint truncate">
                          {displayIdentity(null, r.username)}
                        </p>
                      </div>
                      <button
                        onClick={() => restoreToClinic(r)}
                        disabled={removing === r.id}
                        className="btn-ghost text-xs border border-ink-faint/25 disabled:opacity-50"
                      >
                        {t('workers.addBack')}
                      </button>
                    </div>
                  ))}
                </div>
                {removed.length > recentlyRemoved.length && (
                  <button
                    onClick={() => setShowAllRemoved(v => !v)}
                    className="text-[11px] text-ink-faint hover:text-accent transition-colors mt-2"
                  >
                    {showAllRemoved
                      ? t('workers.showOnlyJustRemoved')
                      : t('workers.showAllRemoved', { removedCount: removed.length })}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {showInvite && (
          <AddMemberDialog onClose={() => setShowInvite(false)} onCreated={() => void loadWorkers()} />
        )}
        <DebugConsole />
      </div>
    </div>
  )
}
