/**
 * Seaded → Partnerships (spec, Phase 1: "Creating a partnership", steps 1–7).
 *
 * The code alone grants nothing. Every step is an admin's, with two-factor
 * sign-in, and every step lands in both organisations' audit logs — all of
 * that is enforced in the database (sql/070), so this screen is only the way
 * to call it. Wivo's own approval (step 7) happens outside the app.
 */
import { useState } from 'react'
import { Handshake, KeyRound, Copy } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { usePartnerOrgs, type PartnerOrg, type PartnerRole, type PartnershipStatus } from '../../hooks/usePartners'
import { describeError } from '../Patients/errors'
import { useAuth } from '../../context/AuthContext'
import { t } from '@/lib/i18n'
import { confirmDialog } from '../../lib/confirm'

const ROLES: PartnerRole[] = ['design', 'surgery', 'supplier']
const roleLabel = (r: PartnerRole): string =>
  r === 'design' ? t('partners.roleDesign') : r === 'surgery' ? t('partners.roleSurgery') : t('partners.roleSupplier')

const statusLabel = (s: PartnershipStatus): string => ({
  awaiting_inviter: t('partners.statusAwaitingInviter'),
  awaiting_platform: t('partners.statusAwaitingWivo'),
  active: t('partners.statusActive'),
  suspended: t('partners.statusSuspended'),
  ended: t('partners.statusEnded'),
})[s]

/** The database refuses without MFA with hint `mfa_required`; say what to do. */
function explain(e: unknown): string {
  const err = e as { hint?: string }
  if (err?.hint === 'mfa_required') return t('partners.needMfa')
  if (err?.hint === 'rate_limited') return t('partners.tooManyCodes')
  return describeError(e)
}

export function PartnershipsSection() {
  const qc = useQueryClient()
  const { data: partners = [] } = usePartnerOrgs()
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner_orgs'] })

  return (
    <section className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <Handshake size={14} className="text-accent" /> {t('partners.partnerships')}
        </h3>
        <p className="text-xs text-ink-muted leading-relaxed">{t('partners.partnershipsIntro')}</p>
      </div>

      <CreateInvite />
      <EnterCode onDone={refresh} />

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('partners.yourPartnerships')}</h4>
        {partners.length === 0
          ? <p className="text-sm text-ink-muted">{t('partners.noPartnershipsYet')}</p>
          : partners.map(p => <PartnershipRow key={p.partnership_id} p={p} onChange={refresh} />)}
      </div>
    </section>
  )
}

function CreateInvite() {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_partnership_invite')
    setBusy(false)
    if (err) setError(explain(err))
    else setCode(data as string)
  }

  return (
    <div className="card p-4 space-y-2">
      <p className="text-sm font-semibold text-ink">{t('partners.inviteAPartner')}</p>
      <p className="text-xs text-ink-muted">{t('partners.inviteHelp')}</p>
      {code ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg tracking-wider text-ink bg-bg-sidebar rounded-lg px-3 py-2">{code}</span>
          <button type="button" onClick={() => void navigator.clipboard.writeText(code).catch(() => {})}
            className="btn-ghost text-xs flex items-center gap-1"><Copy size={12} /> {t('partners.copy')}</button>
          <span className="text-xs text-ink-muted">{t('partners.shownOnce')}</span>
        </div>
      ) : (
        <button type="button" onClick={create} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
          {t('partners.createInviteCode')}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </div>
  )
}

interface Preview { org_name: string; country: string; reg_code: string | null; expires_at: string }

function EnterCode({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [shareStock, setShareStock] = useState(false)
  const [roles, setRoles] = useState<PartnerRole[]>(['design'])
  const [dpa, setDpa] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function look() {
    setError(null)
    setPreview(null)
    const { data, error: err } = await supabase.rpc('preview_partnership_invite', { p_code: code })
    if (err) { setError(explain(err)); return }
    const row = ((data ?? []) as Preview[])[0]
    if (!row) setError(t('partners.codeNotValid'))
    else setPreview(row)
  }

  async function accept() {
    setError(null)
    const { data, error: err } = await supabase.rpc('accept_partnership_invite', {
      p_code: code, p_share_stock: shareStock, p_default_visibility: 'partial',
      p_roles: roles, p_dpa_reference: dpa,
    })
    if (err) { setError(explain(err)); return }
    // A wrong or used code returns nothing rather than an error (sql/084).
    if (!data) { setError(t('partners.codeNotValid')); return }
    setDone(true)
    onDone()
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="text-sm font-semibold text-ink flex items-center gap-2"><KeyRound size={14} /> {t('partners.haveACode')}</p>
      {done ? (
        <p className="text-sm text-emerald-600">{t('partners.acceptedWaiting')}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="WIVO-XXXX-XXXX"
              aria-label={t('partners.inviteCode')} className="input font-mono w-56" />
            <button type="button" onClick={look} disabled={!code.trim()} className="btn-ghost text-sm border border-ink-faint/30 disabled:opacity-50">
              {t('partners.check')}
            </button>
          </div>

          {preview && (
            <div className="space-y-3 border-t border-ink-faint/20 pt-3">
              <p className="text-sm text-ink">
                {t('partners.invitedBy', { name: preview.org_name, country: preview.country, reg: preview.reg_code ?? '—' })}
              </p>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={shareStock} onChange={e => setShareStock(e.target.checked)} />
                {t('partners.shareStock')}
              </label>
              <p className="text-xs text-ink-muted">{t('partners.neverPatientIdentity')}</p>
              <fieldset>
                <legend className="label">{t('partners.roles')}</legend>
                <div className="flex gap-4">
                  {ROLES.map(r => (
                    <label key={r} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={roles.includes(r)}
                        onChange={e => setRoles(e.target.checked ? [...roles, r] : roles.filter(x => x !== r))} />
                      {roleLabel(r)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm text-ink">
                <span className="label">{t('partners.dpaReference')}</span>
                <input className="input w-full" value={dpa} onChange={e => setDpa(e.target.value)} placeholder={t('partners.dpaPlaceholder')} />
              </label>
              <button type="button" onClick={accept} disabled={!dpa.trim()} className="btn-primary text-sm disabled:opacity-50">
                {t('partners.acceptTerms')}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </div>
  )
}

function PartnershipRow({ p, onChange }: { p: PartnerOrg; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const { role } = useAuth()
  const accepted = p.status === 'active' || p.status === 'suspended'

  async function call(fn: string, args: Record<string, unknown>) {
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) setError(explain(err))
    else onChange()
  }

  return (
    <div className="card p-3 flex flex-wrap items-center gap-3">
      <div>
        <p className="text-sm font-semibold text-ink">{p.name} <span className="text-ink-muted font-normal">· {p.country}</span></p>
        <p className="text-xs text-ink-muted">
          {statusLabel(p.status)} · {p.roles.map(roleLabel).join(', ') || '—'}
          {p.share_stock ? ` · ${t('partners.stockShared')}` : ''}
        </p>
      </div>
      <div className="ml-auto flex gap-2">
        {p.status === 'awaiting_inviter' && p.i_am_inviter && (
          <button type="button" className="btn-primary text-xs" onClick={() => call('confirm_partnership', { p_id: p.partnership_id })}>
            {t('partners.confirmTerms')}
          </button>
        )}
        {p.status === 'active' && (
          <button type="button" className="btn-ghost text-xs border border-ink-faint/30"
            onClick={() => call('set_partnership_status', { p_id: p.partnership_id, p_status: 'suspended' })}>
            {t('partners.pause')}
          </button>
        )}
        {p.status === 'suspended' && (
          <button type="button" className="btn-ghost text-xs border border-ink-faint/30"
            onClick={() => call('set_partnership_status', { p_id: p.partnership_id, p_status: 'active' })}>
            {t('partners.resume')}
          </button>
        )}
        {(p.status === 'active' || p.status === 'suspended') && (
          <button type="button" className="btn-ghost text-xs border border-rose-400/40 text-rose-500"
            onClick={() => void confirmDialog({ message: t('partners.endConfirm'), confirmLabel: t('partners.end'), danger: true })
              .then(yes => { if (yes) void call('set_partnership_status', { p_id: p.partnership_id, p_status: 'ended' }) })}>
            {t('partners.end')}
          </button>
        )}
      </div>
      {/* sql/093: either side's owner, logged in both audit logs. */}
      {accepted && role === 'owner' && (
        <label className="w-full flex items-start gap-2 text-sm text-ink border-t border-ink-faint/15 pt-2">
          <input type="checkbox" role="switch" aria-checked={p.share_stock} checked={p.share_stock} className="mt-0.5"
            onChange={e => void call('set_partnership_share_stock', { p_partnership: p.partnership_id, p_on: e.target.checked })} />
          <span>
            {t('partners.shareStockSwitch')}
            <span className="block text-xs text-ink-muted">{t('partners.shareStockSwitchHelp', { name: p.name })}</span>
          </span>
        </label>
      )}
      {error && <p role="alert" className="w-full text-sm text-rose-500">{error}</p>}
    </div>
  )
}
