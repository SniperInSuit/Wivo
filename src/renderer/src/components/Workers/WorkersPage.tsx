import { useState, useEffect } from 'react'
import { Users, UserPlus, Shield, Loader2, Trash2, Mail, Check, Lock, Copy } from 'lucide-react'
import { supabase, createSignupClient, isEmailAddress, usernameToEmail, displayIdentity } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Profile } from '../../lib/supabase'
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, type PermissionKey
} from '../../hooks/usePermissions'

interface WorkerWithPerms extends Profile {
  permissions: Map<string, boolean>
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
        <Trash2 size={12} /> Kustuta konto jäädavalt
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-red-600 font-medium">
        Kustutada {name} jäädavalt? Kasutajanimi vabaneb.
      </span>
      <button
        onClick={() => { onDelete(); setConfirm(false) }}
        disabled={busy}
        className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? 'Kustutab…' : 'Jah, kustuta'}
      </button>
      <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">Loobu</button>
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
        <Trash2 size={12} /> Eemalda meeskonnast
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-red-600 font-medium">Eemaldada {name}?</span>
      <button
        onClick={() => { onRemove(); setConfirm(false) }}
        disabled={busy}
        className="text-xs bg-red-500 text-white px-2.5 py-1 rounded-lg hover:bg-red-600 disabled:opacity-50"
      >
        {busy ? 'Eemaldab…' : 'Jah, eemalda'}
      </button>
      <button onClick={() => setConfirm(false)} className="btn-ghost text-xs">Loobu</button>
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

  // Invite state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [invited, setInvited] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)
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
    const t = r.updated_at ? new Date(r.updated_at).getTime() : 0
    return Date.now() - t < RESTORE_WINDOW_MS
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
      setRemoveError((err as Error)?.message ?? 'Eemaldamine ebaõnnestus')
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
      setRemoveError('Parool peab olema vähemalt 6 tähemärki')
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
      setRemoveError((err as Error)?.message ?? 'Parooli määramine ebaõnnestus')
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
      setRemoveError((err as Error)?.message ?? 'Kustutamine ebaõnnestus')
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
      setRemoveError((err as Error)?.message ?? 'Taastamine ebaõnnestus')
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

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim() || !invitePassword.trim()) return
    if (invitePassword.length < 6) { setInviteError('Parool peab olema vähemalt 6 tähemärki'); return }
    setInviteError(null)
    setInviting(true)
    try {
      const identifier = inviteEmail.trim()
      const password = invitePassword.trim()
      // A username is the normal case here: a technician has no company mailbox,
      // and inventing one for them is a lie that becomes a support problem the
      // first time someone tries a password reset. A real address still works.
      const usesEmail = isEmailAddress(identifier)
      const username = usesEmail ? null : identifier.toLowerCase().replace(/\s+/g, '')
      const email = usesEmail ? identifier : usernameToEmail(identifier)

      // Created on an isolated client so the owner stays logged in as themselves
      // — see createSignupClient().
      const { data: signUpData, error } = await createSignupClient().auth.signUp({
        email,
        password,
        options: {
          data: { full_name: inviteName.trim() || identifier.split('@')[0] }
        }
      })
      if (error) throw error

      // Link the new profile to this clinic (trigger creates profile with 'worker' role)
      // Retry a few times since the trigger may not have fired yet
      const newUserId = signUpData.user?.id
      if (newUserId && clinicId) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 500))
          const { error: linkErr } = await supabase
            .from('profiles')
            .update({
              clinic_id: clinicId,
              ...(username ? { username } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', newUserId)
          if (!linkErr) break
        }
      }

      setCreatedCredentials({ email: username ?? email, password })
      setInvited(true)
      await loadWorkers()
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Konto loomine ebaõnnestus'
      if (msg.includes('already registered')) setInviteError(
        'See kasutajanimi on juba võetud. Kontot ei saa üle luua — kui see on '
        + 'varem eemaldatud liige, lisa ta allpool tagasi ja määra talle uus parool.'
      )
      else if (msg.toLowerCase().includes('rate limit')) {
        // Supabase's built-in SMTP allows only a couple of messages an hour, and
        // a signup only sends one at all when confirmation is switched on —
        // which it does not need to be for in-house accounts.
        setInviteError(
          'Supabase e-kirjade piirang sai täis. Lülita Supabase → Authentication → '
          + 'Providers → Email alt "Confirm email" välja — majasiseseid kontosid ei ole '
          + 'vaja kinnitada ja siis ei saadeta kirju üldse. Seejärel proovi uuesti.'
        )
      }
      else setInviteError(msg)
    } finally {
      setInviting(false)
    }
  }

  if (!isOwner) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-ink-muted">Ainult kliiniku omanik saab meeskonda hallata.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-5 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Users size={20} /> Meeskond
          </h1>
          <p className="text-sm text-ink-muted">
            Halda töötajaid ja nende õigusi.
          </p>
        </div>

        <div className="flex gap-5">
          {/* Worker list */}
          <div className="w-64 flex-shrink-0 space-y-2">
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
                <p className="text-sm font-semibold truncate">{w.full_name || '—'}</p>
                <p className="text-[11px] text-ink-faint truncate">
                  {displayIdentity(null, w.username)}
                </p>
                <p className="text-[11px] text-ink-faint flex items-center gap-1.5">
                  <Shield size={10} />
                  {w.role === 'owner' ? 'Omanik' : 'Töötaja'}
                </p>
              </button>
            ))}

            {/* Invite button */}
            <button
              onClick={() => setShowInvite(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-ink-faint/30 text-ink-muted hover:border-accent hover:text-accent transition-colors text-sm"
            >
              <UserPlus size={14} />
              Lisa töötaja
            </button>
          </div>

          {/* Permission panel */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <Shield size={28} className="text-ink-faint" />
                <p className="text-sm text-ink-muted">Vali töötaja, et näha ja muuta tema õigusi</p>
              </div>
            ) : selected.role === 'owner' ? (
              <div className="card p-5">
                <h2 className="text-base font-semibold text-ink mb-1">{selected.full_name}</h2>
                <p className="text-sm text-ink-muted">
                  Omanikul on kõik õigused. Neid ei saa piirata.
                </p>
              </div>
            ) : (
              <div className="card p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">{selected.full_name || '—'}</h2>
                  <p className="text-xs text-ink-muted">Töötaja õigused</p>
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
                    Määra uus parool
                  </p>
                  {pwDone ? (
                    <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <Check size={13} className="text-emerald-600 flex-shrink-0" />
                      <span className="text-emerald-800">Uus parool:</span>
                      <span className="font-mono font-semibold text-ink">{pwDone}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(pwDone)}
                        className="ml-auto text-ink-faint hover:text-ink"
                        title="Kopeeri"
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
                          placeholder="Vähemalt 6 tähemärki"
                          className="input pl-8 py-1.5 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => setWorkerPassword(selected)}
                        disabled={pwSaving || newPassword.trim().length < 6}
                        className="btn-ghost border border-ink-faint/25 disabled:opacity-50"
                      >
                        {pwSaving ? 'Salvestab…' : 'Määra'}
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                    Kasutajanimega kontol ei ole postkasti, kuhu lähtestuskirja saata —
                    parooli määrad sina ja annad selle töötajale edasi.
                  </p>
                </div>

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
                    name={selected.full_name || 'see töötaja'}
                    busy={removing === selected.id}
                    onRemove={() => removeFromClinic(selected)}
                  />
                  <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                    Eemaldab kliinikust ja võtab kõik õigused. Kontot ennast ei kustutata
                    ja tehtud tööd jäävad alles — nende juures on tema nimi endiselt näha.
                    Vajadusel saab ta allpool tagasi lisada.
                  </p>

                  {/* Permanent delete, for the mistyped duplicate. The database
                      refuses it for anyone with work, hours or payouts. */}
                  <div className="mt-2">
                    <DeleteWorkerButton
                      name={selected.full_name || 'see konto'}
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
                    ? `Kliinikust eemaldatud (${removed.length})`
                    : `Äsja eemaldatud (${recentlyRemoved.length})`}
                </h3>
                {!showAllRemoved && recentlyRemoved.length === 0 && (
                  <p className="text-xs text-ink-faint mb-2">Viimase minuti jooksul ei ole kedagi eemaldatud.</p>
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
                        Lisa tagasi
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
                      ? 'Näita ainult äsja eemaldatuid'
                      : `Näita kõiki eemaldatuid (${removed.length})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Invite modal */}
        {showInvite && (
          <>
            <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowInvite(false)} />
            <div className="fixed inset-0 flex items-center justify-center z-50" onClick={() => setShowInvite(false)}>
              <div className="bg-bg-card rounded-2xl shadow-panel p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                {invited && createdCredentials ? (
                  <>
                    <h3 className="text-base font-semibold text-ink flex items-center gap-2">
                      <Check size={16} className="text-emerald-500" /> Konto loodud!
                    </h3>
                    <p className="text-sm text-ink-muted">
                      Anna need andmed töötajale sisselogimiseks:
                    </p>
                    <div className="bg-bg-sidebar rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-ink-faint uppercase font-semibold">Kasutajanimi</p>
                          <p className="text-sm font-mono text-ink">{createdCredentials.email}</p>
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(createdCredentials.email)}
                          className="p-1.5 text-ink-faint hover:text-accent transition-colors"
                          title="Kopeeri"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-ink-faint uppercase font-semibold">Parool</p>
                          <p className="text-sm font-mono text-ink">{createdCredentials.password}</p>
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(createdCredentials.password)}
                          className="p-1.5 text-ink-faint hover:text-accent transition-colors"
                          title="Kopeeri"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      Töötaja saab parooli hiljem Seadetest muuta.
                    </p>
                    <button
                      onClick={() => {
                        setShowInvite(false)
                        setInvited(false)
                        setCreatedCredentials(null)
                        setInviteEmail('')
                        setInviteName('')
                        setInvitePassword('')
                      }}
                      className="btn-primary w-full justify-center"
                    >
                      Sulge
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-base font-semibold text-ink flex items-center gap-2">
                      <UserPlus size={16} /> Lisa töötaja
                    </h3>
                    <form onSubmit={handleInvite} className="space-y-3">
                      <div>
                        <label className="label">Nimi</label>
                        <input
                          type="text"
                          value={inviteName}
                          onChange={e => setInviteName(e.target.value)}
                          placeholder="Töötaja nimi"
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Kasutajanimi *</label>
                        <div className="relative">
                          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                          <input
                            type="text"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="tehnik"
                            className="input pl-9"
                            autoCapitalize="none"
                            autoCorrect="off"
                            required
                          />
                        </div>
                        <p className="text-[10px] text-ink-faint mt-1 leading-relaxed">
                          E-posti ei ole vaja. Kui soovid, võid sisestada päris e-posti
                          aadressi — siis saab see inimene ise parooli lähtestada.
                          Kasutajanimega konto parooli lähtestab omanik.
                        </p>
                      </div>
                      <div>
                        <label className="label">Parool *</label>
                        <div className="relative">
                          <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                          <input
                            type="text"
                            value={invitePassword}
                            onChange={e => setInvitePassword(e.target.value)}
                            placeholder="Vähemalt 6 tähemärki"
                            className="input pl-9"
                            required
                            minLength={6}
                          />
                        </div>
                        <p className="text-[11px] text-ink-faint mt-1">Sina määrad parooli. Anna see töötajale.</p>
                      </div>
                      {inviteError && (
                        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={inviting}
                          className="btn-primary disabled:opacity-50"
                        >
                          {inviting ? <Loader2 size={14} className="animate-spin" /> : 'Loo konto'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowInvite(false); setInviteError(null) }}
                          className="btn-ghost"
                        >
                          Tühista
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
