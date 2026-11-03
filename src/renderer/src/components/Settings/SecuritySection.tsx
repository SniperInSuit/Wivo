/**
 * Settings → Security, each person's own (desktop and phone): their
 * authenticators and the phones that get their notifications (sql/097).
 *
 * - Adding an authenticator is the same three steps as the first time
 *   (MfaGate), recommended as a backup for a lost phone.
 * - Removing one needs a session signed in with the second factor and, just
 *   now, a code from THAT authenticator or the account password. The
 *   database checks both; the Edge Function `account-security` removes it.
 * - The last one: a clear warning, then the person is signed out everywhere
 *   and adds a new one at the next sign-in.
 * - Phones: "Remove this phone" stops that phone's notifications; "Sign out
 *   on all other devices" ends every other session.
 */
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { KeyRound, Plus, Smartphone, Trash2, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import {
  listAuthenticators, backupName, recordAuthenticators, removeAuthenticator, securityErrorText,
  listPhones, removePhone, type Authenticator, type Phone, type DeviceKind,
} from '../../lib/accountSecurity'
import { assurance, startEnrollment, verifyCode, isWrongCode, type Enrollment } from '../../lib/mfa'
import { supabase } from '../../lib/supabase'
import { EnrollSteps, CodeForm } from '../Auth/MfaGate'
import { SignOutOthersSection } from './SignOutOthersSection'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

const day = (iso: string): string => format(new Date(iso), 'd MMM yyyy', { locale: dateLocale })

export function SecuritySection() {
  return (
    <div className="space-y-6">
      <AuthenticatorsSection />
      <PhonesSection />
      <SignOutOthersSection />
    </div>
  )
}

// ── Authenticators ──────────────────────────────────────────────────────────

function AuthenticatorsSection() {
  const [list, setList] = useState<Authenticator[] | null>(null)
  const [aal2, setAal2] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [items, a] = await Promise.all([listAuthenticators(), assurance()])
      setList(items)
      setAal2(a.currentLevel === 'aal2')
    } catch (e) {
      setError(describeError(e))
      setList([])
    }
  }, [])

  useEffect(() => {
    void load()
    // Authenticators added before sql/097 get their audit row once, here.
    void recordAuthenticators().catch(() => {})
  }, [load])

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('security.authenticatorsTitle')}</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 max-w-xl">{t('security.authenticatorsIntro')}</p>
      {!aal2 && <p role="status" className="mb-3 text-xs text-amber-600">{t('security.needMfa')}</p>}

      {list === null ? (
        <Loader2 size={16} className="animate-spin text-accent" />
      ) : (
        <ul className="space-y-2 max-w-xl">
          {list.map(f => (
            <li key={f.id} className="rounded-xl border border-ink-faint/20 p-3">
              <div className="flex items-center gap-3">
                <ShieldCheck size={16} className="flex-shrink-0 text-emerald-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{f.name || t('security.unnamed')}</p>
                  <p className="text-[11px] text-ink-muted">{t('security.added', { date: day(f.createdAt) })}</p>
                </div>
                {removing !== f.id && (
                  <button type="button" disabled={!aal2} onClick={() => { setAdding(false); setRemoving(f.id) }}
                    className="btn-ghost border border-ink-faint/30 text-xs disabled:opacity-50">
                    <Trash2 size={12} aria-hidden="true" /> {t('security.remove')}
                  </button>
                )}
              </div>
              {removing === f.id && (
                <RemoveAuthenticator factor={f} last={list.length === 1}
                  onCancel={() => setRemoving(null)}
                  onDone={() => { setRemoving(null); void load() }} />
              )}
            </li>
          ))}
          {list.length === 0 && !error && <li className="text-xs text-ink-muted">{t('security.noAuthenticators')}</li>}
        </ul>
      )}

      {list !== null && list.length === 1 && !adding && (
        <p className="mt-3 text-xs text-ink-soft max-w-xl">{t('security.backupRecommended')}</p>
      )}
      {adding ? (
        <AddAuthenticator existing={list?.map(f => f.name) ?? []}
          onCancel={() => setAdding(false)}
          onDone={() => { setAdding(false); void load() }} />
      ) : (
        <button type="button" disabled={!aal2 || list === null} onClick={() => { setRemoving(null); setAdding(true) }}
          className="mt-3 btn-ghost border border-ink-faint/30 text-sm disabled:opacity-50">
          <Plus size={14} aria-hidden="true" /> {t('security.addAnother')}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
    </section>
  )
}

function AddAuthenticator({ existing, onCancel, onDone }: { existing: string[]; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(() => backupName(existing))
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const e = await startEnrollment(name.trim())
      if (e === 'disabled') setError(t('security.mfaOff'))
      else setEnrollment(e)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    // A half-added authenticator would block the next attempt with the same name.
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId }).catch(() => {})
    onCancel()
  }

  const nameTaken = existing.some(n => n.trim().toLowerCase() === name.trim().toLowerCase())

  return (
    <div className="mt-3 max-w-xl space-y-4 rounded-xl border border-accent/40 p-4">
      {!enrollment ? (
        <>
          <label className="block">
            <span className="label">{t('security.nameLabel')}</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} className="input text-sm" />
          </label>
          <p className="text-xs text-ink-muted">{t('security.nameHelp')}</p>
          {nameTaken && <p className="text-xs text-amber-600">{t('security.nameTaken')}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void start()} disabled={busy || !name.trim() || nameTaken}
              className="btn-primary text-sm disabled:opacity-50">{t('security.continue')}</button>
            <button type="button" onClick={onCancel} className="btn-ghost text-sm">{t('security.cancel')}</button>
          </div>
        </>
      ) : (
        <>
          <EnrollSteps enrollment={enrollment} codeForm={
            <CodeForm autoFocus={false} onSubmit={async code => {
              setError(null)
              try {
                await verifyCode(enrollment.factorId, code)
                await recordAuthenticators().catch(() => {})
                onDone()
              } catch (e) {
                setError(isWrongCode(e) ? t('mfa.wrongCode') : describeError(e))
              }
            }} />
          } />
          <button type="button" onClick={() => void cancel()} className="btn-ghost text-sm">{t('security.cancel')}</button>
        </>
      )}
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </div>
  )
}

function RemoveAuthenticator({ factor, last, onCancel, onDone }: {
  factor: Authenticator; last: boolean; onCancel: () => void; onDone: () => void
}) {
  const [how, setHow] = useState<'code' | 'password'>('code')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = how === 'code' ? code.replace(/\s/g, '').length === 6 : password.length > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (last && !window.confirm(t('security.lastConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const r = await removeAuthenticator(factor.id, how === 'code' ? { code } : { password })
      // The last one: every session has ended; this one leaves now too.
      if (r.last) { await supabase.auth.signOut({ scope: 'local' }); return }
      onDone()
    } catch (err) {
      setError(securityErrorText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} className="mt-3 space-y-3 border-t border-ink-faint/15 pt-3">
      {last && (
        <div role="alert" className="flex gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertTriangle size={16} className="flex-shrink-0" aria-hidden="true" />
          <p>{t('security.lastWarning')}</p>
        </div>
      )}
      <p className="text-xs text-ink-soft">{t('security.proveIt')}</p>
      <div className="flex gap-2" role="radiogroup">
        {(['code', 'password'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={how === k} onClick={() => setHow(k)}
            className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold ${how === k ? 'border-accent bg-accent/10 text-ink' : 'border-ink-faint/30 text-ink-muted'}`}>
            {k === 'code' ? t('security.withCode') : t('security.withPassword')}
          </button>
        ))}
      </div>
      {how === 'code' ? (
        <label className="block">
          <span className="label">{t('security.codeFrom', { name: factor.name || t('security.unnamed') })}</span>
          <input value={code} onChange={e => setCode(e.target.value.replace(/[^\d\s]/g, ''))} inputMode="numeric"
            autoComplete="one-time-code" maxLength={7} placeholder="123 456" className="input font-mono text-lg tracking-widest w-40" />
        </label>
      ) : (
        <label className="block">
          <span className="label">{t('security.password')}</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
            className="input text-sm max-w-xs" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !ready}
          className={`text-sm disabled:opacity-50 ${last ? 'btn-primary bg-rose-600 hover:bg-rose-700' : 'btn-primary'}`}>
          {last ? t('security.removeAndSignOut') : t('security.removeThis')}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-sm">{t('security.cancel')}</button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </form>
  )
}

// ── Phones ──────────────────────────────────────────────────────────────────

const DEVICE = {
  iphone: 'security.device.iphone', ipad: 'security.device.ipad', android: 'security.device.android',
  mac: 'security.device.mac', windows: 'security.device.windows', linux: 'security.device.linux', other: 'security.device.other',
} as const satisfies Record<DeviceKind, string>

function PhonesSection() {
  const [phones, setPhones] = useState<Phone[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setPhones(await listPhones()) } catch (e) { setError(describeError(e)); setPhones([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(p: Phone) {
    if (!window.confirm(t('security.removePhoneConfirm'))) return
    setError(null)
    try { await removePhone(p.id); await load() } catch (e) { setError(describeError(e)) }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Smartphone size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('security.phonesTitle')}</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 max-w-xl">{t('security.phonesIntro')}</p>
      {phones === null ? (
        <Loader2 size={16} className="animate-spin text-accent" />
      ) : phones.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('security.noPhones')}</p>
      ) : (
        <ul className="space-y-2 max-w-xl">
          {phones.map(p => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-ink-faint/20 p-3">
              <Smartphone size={16} className="flex-shrink-0 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {p.browser ? t('security.deviceWithBrowser', { device: t(DEVICE[p.kind]), browser: p.browser }) : t(DEVICE[p.kind])}
                  {p.current && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{t('security.thisPhone')}</span>}
                </p>
                <p className="text-[11px] text-ink-muted">{t('security.added', { date: day(p.createdAt) })}</p>
                <p className="text-[11px] text-ink-muted">
                  {p.lastOkAt ? t('security.lastPush', { date: day(p.lastOkAt) }) : t('security.noPushYet')}
                </p>
              </div>
              <button type="button" onClick={() => void remove(p)} className="btn-ghost border border-ink-faint/30 text-xs">
                <Trash2 size={12} aria-hidden="true" /> {t('security.removePhone')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
    </section>
  )
}
