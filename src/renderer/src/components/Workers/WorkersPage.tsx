import { useState, useEffect } from 'react'
import { Users, UserPlus, Shield, Loader2, Trash2, Mail, Check, Lock, Copy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Profile } from '../../lib/supabase'
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, type PermissionKey
} from '../../hooks/usePermissions'

interface WorkerWithPerms extends Profile {
  permissions: Map<string, boolean>
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
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadWorkers() }, [clinicId])

  const selected = workers.find(w => w.id === selectedId)

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
      const email = inviteEmail.trim()
      const password = invitePassword.trim()

      // Create the account — email confirmation is disabled, so it works immediately
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: inviteName.trim() || email.split('@')[0] }
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
            .update({ clinic_id: clinicId, updated_at: new Date().toISOString() })
            .eq('id', newUserId)
          if (!linkErr) break
        }
      }

      setCreatedCredentials({ email, password })
      setInvited(true)
      await loadWorkers()
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Konto loomine ebaõnnestus'
      if (msg.includes('already registered')) setInviteError('See e-post on juba registreeritud')
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
                          <p className="text-[10px] text-ink-faint uppercase font-semibold">E-post</p>
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
                        <label className="label">E-post *</label>
                        <div className="relative">
                          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="tootaja@kliinik.ee"
                            className="input pl-9"
                            required
                          />
                        </div>
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
