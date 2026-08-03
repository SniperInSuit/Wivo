/**
 * Töötasud — what each worker earned, and paying it out.
 *
 * The preview is computed live from rules + finished work + logged hours. The
 * payout freezes it: once a period is paid, its lines are a copy, so changing a
 * rate afterwards cannot restate what someone was already paid.
 */
import { useMemo, useState } from 'react'
import {
  Wallet, Plus, Trash2, Loader2, AlertTriangle, Clock, CheckCircle2,
  ChevronDown, ChevronRight, Euro, Lock
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths, parseISO, isValid } from 'date-fns'
import { et } from 'date-fns/locale'
import type { Job } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes, useSettings } from '../../stores/useSettings'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { useProfileNames } from '../../hooks/useProfileNames'
import {
  useWorkerRates, useSaveWorkerRate, useDeleteWorkerRate,
  useWorkHours, useAddWorkHours, useDeleteWorkHours,
  useWorkerPayouts, useCreatePayout, useUpdatePayout, useDeletePayout, paidKeysFrom,
  type WorkerPayout,
} from '../../hooks/useWorkerPay'
import {
  calculateEarnings, diagnoseEarnings, earningsTotal, employerCost, employerTaxAmount,
  RATE_KIND_LABEL, RATE_KIND_HINT, RATE_KIND_SUFFIX, RATE_SCOPE_LABEL,
  type RateKind, type RateScope, type WorkerRate,
} from '../../lib/earnings'
import { useQueryClient } from '@tanstack/react-query'
import { updateProfile, type Engagement } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { describeError } from '../Patients/errors'

const KINDS: RateKind[] = ['hammas', 'too', 'protsent', 'tund', 'kuu']
const SCOPES: RateScope[] = ['too', 'disain', 'muudatus']

interface PayrollViewProps {
  jobs: Job[]
}

export function PayrollView({ jobs }: PayrollViewProps) {
  const auth = useAuth()
  const { can } = usePermissions()
  // Payroll is delegable: an owner with a bookkeeper should not have to run
  // every payout personally. Enforced in RLS too (migration 027), not just here.
  const isOwner = auth.role === 'owner' || can('payroll.manage')
  const { doneStageKey } = usePipeline()
  const wt = useWorkTypes()
  const { settings } = useSettings()

  const { data: workers = [] } = useClinicProfiles()

  const { data: rates = [], isError, error } = useWorkerRates()
  const { data: hours = [] } = useWorkHours()
  const { data: payouts = [] } = useWorkerPayouts()
  // People who are no longer on the team but were paid something. Their payslips
  // have to stay readable — a payout that cannot name its recipient is a worse
  // record than a slightly longer list.
  const archivedIds = useMemo(() => {
    const inClinic = new Set(workers.map(w => w.id))
    return [...new Set(payouts.map(p => p.profile_id))].filter(id => !inClinic.has(id))
  }, [payouts, workers])
  const { data: archivedProfiles } = useProfileNames(archivedIds)

  const createPayout = useCreatePayout()
  const updatePayout = useUpdatePayout()
  const deletePayout = useDeletePayout()

  const [monthOffset, setMonthOffset] = useState(0)
  const [openWorker, setOpenWorker] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Lines the user has unticked before confirming. Excluding rather than
  // editing afterwards: a frozen payout should stay frozen, and anything left
  // out simply stays unpaid and turns up in the next period.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const toggleLine = (key: string) => setExcluded(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const period = useMemo(() => {
    const base = addMonths(new Date(), monthOffset)
    return {
      start: format(startOfMonth(base), 'yyyy-MM-dd'),
      end: format(endOfMonth(base), 'yyyy-MM-dd'),
      label: format(base, 'LLLL yyyy', { locale: et }),
    }
  }, [monthOffset])

  // Workers are only visible to the owner; everyone else sees just themselves,
  // matching what the RLS policies will actually return.
  const visible = useMemo(
    () => (isOwner ? workers : workers.filter(w => w.id === auth.user?.id)),
    [isOwner, workers, auth.user?.id]
  )

  const perWorker = useMemo(() => visible.map(w => {
    const alreadyPaid = paidKeysFrom(payouts, w.id)
    const lines = calculateEarnings({
      profileId: w.id,
      rates, jobs, hours,
      types: wt.types,
      periodStart: period.start,
      periodEnd: period.end,
      doneStageKey,
      alreadyPaid,
    })
    const periodPayouts = payouts.filter(
      p => p.profile_id === w.id && p.period_start === period.start
    )
    return {
      worker: w,
      lines,
      total: earningsTotal(lines),
      rates: rates.filter(r => r.profile_id === w.id),
      payouts: periodPayouts,
      // Computed ALWAYS, not only when the total is zero. Gating it on an empty
      // list meant a partial result — three jobs assigned, one line — looked
      // exactly like a complete one, which is the harder problem to notice.
      issues: diagnoseEarnings({
        profileId: w.id, rates, jobs, hours, types: wt.types,
        periodStart: period.start, periodEnd: period.end, doneStageKey, alreadyPaid,
      }),
      assignedDone: jobs.filter(j =>
        (j.assigned_to === w.id || j.designed_by === w.id) && j.status === doneStageKey
      ).length,
    }
  }), [visible, payouts, rates, jobs, hours, wt.types, period, doneStageKey])

  // Employees and contractors cannot be added into one "gross" figure: only the
  // first kind carries employer taxes, and calling an invoice "brutopalk" would
  // overstate what the clinic owes the tax office.
  const employeeGross = perWorker
    .filter(x => (x.worker.toosuhe ?? 'tootaja') === 'tootaja')
    .reduce((s, x) => s + x.total, 0)
  const contractorTotal = perWorker
    .filter(x => x.worker.toosuhe === 'ettevote')
    .reduce((s, x) => s + x.total, 0)
  const employerTax = employerTaxAmount(employeeGross, settings.tooandjaMaksudProtsent)
  const grandTotal = employeeGross + contractorTotal

  async function payOut(profileId: string, lines: ReturnType<typeof calculateEarnings>) {
    setActionError(null)
    const included = lines.filter(l => !excluded.has(l.key))
    if (included.length === 0) {
      setActionError('Kõik read on välja jäetud — pole midagi kinnitada.')
      return
    }
    try {
      await createPayout.mutateAsync({
        profile_id: profileId,
        period_start: period.start,
        period_end: period.end,
        lines: included,
      })
      setExcluded(new Set())
    } catch (err) { setActionError(describeError(err)) }
  }

  // Deleting a payout returns its lines to the unpaid pool — `paidKeysFrom`
  // reads straight from the payouts, so nothing else has to be undone.
  async function removePayout(id: string) {
    setActionError(null)
    try { await deletePayout.mutateAsync(id) }
    catch (err) { setActionError(describeError(err)) }
  }

  if (isError) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="card p-4 flex items-start gap-2 max-w-2xl">
          <AlertTriangle size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-ink">Töötasude tabeleid ei leitud</p>
            <p className="text-xs text-ink-muted">
              Käivita <code className="px-1 rounded bg-bg-sidebar">sql/022_worker_pay.sql</code>{' '}
              Supabase SQL-redaktoris (Wivo kinni).
            </p>
            <p className="text-[10px] text-ink-faint mt-1">{(error as Error)?.message}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-ink flex items-center gap-2">
          <Wallet size={18} className="text-accent" /> Töötasud
        </h1>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setMonthOffset(o => o - 1)} className="btn-ghost p-2">
            <ChevronRight size={14} className="rotate-180" />
          </button>
          <span className="text-sm font-semibold text-ink min-w-[130px] text-center first-letter:uppercase">
            {period.label}
          </span>
          <button
            onClick={() => setMonthOffset(o => o + 1)}
            disabled={monthOffset >= 0}
            className="btn-ghost p-2 disabled:opacity-30"
            title={monthOffset >= 0 ? 'Tulevikku ei arvestata' : undefined}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-faint max-w-3xl leading-relaxed">
        Arvestatakse ainult <strong className="text-ink-muted">valmis</strong> töid, mille
        teostaja või disainija on määratud. Väljamakse külmutab read: hilisem määra muutmine
        juba makstud perioodi ümber ei arvuta.
      </p>

      {actionError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {actionError}
        </p>
      )}

      {isOwner && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center">
              <Euro size={16} className="text-accent" />
            </div>
            <div>
              <p className="text-xs text-ink-muted">Palgal, bruto ({period.label})</p>
              <p className="text-xl font-bold text-ink tabular-nums">{employeeGross.toFixed(2)} €</p>
            </div>
          </div>

          {/* Only the payroll half carries employer taxes. */}
          <div className="pl-6 border-l border-ink-faint/20">
            <p className="text-xs text-ink-muted">
              Tööandja maksud ({settings.tooandjaMaksudProtsent}%)
            </p>
            <p className="text-base font-semibold text-ink tabular-nums">
              {employerTax.toFixed(2)} €
            </p>
          </div>

          {contractorTotal > 0 && (
            <div className="pl-6 border-l border-ink-faint/20">
              <p className="text-xs text-ink-muted">Arve alusel (ettevõtted)</p>
              <p className="text-base font-semibold text-ink tabular-nums">
                {contractorTotal.toFixed(2)} €
              </p>
              <p className="text-[10px] text-ink-faint">tööandja makse ei lisandu</p>
            </div>
          )}

          <div className="pl-6 border-l border-ink-faint/20">
            <p className="text-xs text-ink-muted">Kogukulu kliinikule</p>
            <p className="text-xl font-bold text-accent tabular-nums">
              {(employeeGross + employerTax + contractorTotal).toFixed(2)} €
            </p>
          </div>

          {settings.tooandjaMaksudProtsent === 0 && employeeGross > 0 && (
            <p className="text-[11px] text-orange-500 max-w-xs leading-relaxed">
              Tööandja maksude määr on 0% — määra see Seaded → Hinnad, muidu näitab
              kogukulu palgalistel ainult brutopalka.
            </p>
          )}
        </div>
      )}

      {archivedIds.length > 0 && (
        <div className="card p-4">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
            Arhiveeritud ({archivedIds.length})
          </h3>
          <p className="text-[11px] text-ink-faint mb-2 leading-relaxed">
            Meeskonnast eemaldatud inimesed, kellele on tehtud väljamakseid. Uut tasu
            neile ei arvestata — ajalugu on siin selleks, et makstu jääks jälgitavaks.
          </p>
          <div className="space-y-1">
            {archivedIds.map(id => {
              const prof = archivedProfiles?.get(id)
              const theirs = payouts.filter(p => p.profile_id === id)
              const total = theirs.reduce((s, p) => s + Number(p.total), 0)
              return (
                <div key={id} className="flex items-center gap-2 text-xs rounded-lg border border-ink-faint/15 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate">{prof?.full_name || 'Tundmatu'}</p>
                    <p className="text-[11px] text-ink-faint">
                      {theirs.length} väljamakset · eemaldatud meeskonnast
                    </p>
                  </div>
                  <span className="font-semibold text-ink tabular-nums">{total.toFixed(2)} €</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {perWorker.length === 0 ? (
        <div className="card p-8 text-center">
          <Wallet size={26} className="text-ink-faint mx-auto mb-2" />
          <p className="text-sm text-ink-muted">Töötajaid ei ole.</p>
        </div>
      ) : perWorker.map(({ worker, lines, total, rates: workerRates, payouts: periodPayouts, issues, assignedDone }) => {
        const open = openWorker === worker.id
        return (
          <div key={worker.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenWorker(open ? null : worker.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-sidebar/60 transition-colors text-left"
            >
              {open ? <ChevronDown size={14} className="text-ink-faint" /> : <ChevronRight size={14} className="text-ink-faint" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate flex items-center gap-1.5">
                  {worker.full_name || 'Nimeta'}
                  {worker.role === 'owner' && <span className="text-[10px] text-ink-faint font-normal">omanik</span>}
                  {worker.toosuhe === 'ettevote' && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                      esitab arve
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-ink-faint">
                  {workerRates.length === 0
                    ? 'Tasureegleid ei ole määratud'
                    : `${workerRates.length} reeglit · ${lines.length} rida · ${assignedDone} määratud valmis tööd`}
                  {issues.length > 0 && (
                    <span className="text-orange-500 font-medium">
                      {' '}· {issues.reduce((n, i) => n + i.count, 0)} tööd arvestamata
                    </span>
                  )}
                </p>
              </div>
              {periodPayouts.length > 0 && (
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 flex items-center gap-1">
                  <Lock size={9} /> Välja makstud {periodPayouts.reduce((s, p) => s + Number(p.total), 0).toFixed(2)} €
                </span>
              )}
              <span className="text-right">
                <span className="block text-lg font-bold text-ink tabular-nums leading-none">
                  {total.toFixed(2)} €
                </span>
                <span className="block text-[10px] text-ink-faint">
                  {worker.toosuhe === 'ettevote' ? 'arve summa' : 'bruto'}
                </span>
              </span>
            </button>

            {open && (
              <div className="border-t border-ink-faint/15 p-4 space-y-4">
                {isOwner && (
                  <EngagementPicker
                    profileId={worker.id}
                    value={worker.toosuhe ?? 'tootaja'}
                  />
                )}
                {isOwner && (
                  <RateEditor profileId={worker.id} rates={workerRates} />
                )}

                <HoursPanel profileId={worker.id} canEdit={isOwner || worker.id === auth.user?.id} />

                {/* Earnings preview */}
                <section>
                  <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                    Arvestamata read ({lines.length})
                  </h4>
                  {/* Reasons come first and are shown whether or not anything
                      was counted — a job that quietly produced no line is the
                      case most worth surfacing. */}
                  {issues.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {issues.map(iss => (
                        <div
                          key={iss.code}
                          className="flex items-start gap-2 text-[11px] rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5"
                        >
                          <AlertTriangle size={11} className="text-orange-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-orange-800">
                              <strong>{iss.count}</strong> tööd arvestamata: {iss.label}
                            </p>
                            <p className="text-orange-700/70 truncate">{iss.examples.join(' · ')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {lines.length === 0 ? (
                    <p className="text-xs text-ink-faint">
                      {workerRates.length === 0
                        ? 'Lisa tasureegel, et arvestus tekiks.'
                        : 'Sellel perioodil ei ole arvestamata tööd.'}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {lines.map(l => {
                        const off = excluded.has(l.key)
                        return (
                          <div
                            key={l.key}
                            className={`flex items-center gap-2 text-xs py-1 border-b border-ink-faint/10 last:border-0 ${
                              off ? 'opacity-40' : ''
                            }`}
                          >
                            {/* Untick to leave a line out of this payout. It stays
                                unpaid and reappears next period — no editing of a
                                frozen payout required. */}
                            {isOwner && (
                              <input
                                type="checkbox"
                                checked={!off}
                                onChange={() => toggleLine(l.key)}
                                className="accent-accent flex-shrink-0"
                                title={off ? 'Kaasa väljamaksesse' : 'Jäta sellest väljamaksest välja'}
                              />
                            )}
                            <span className="text-ink-faint tabular-nums w-20 flex-shrink-0">{fmtDate(l.earned_on)}</span>
                            <span className={`flex-1 min-w-0 truncate text-ink ${off ? 'line-through' : ''}`}>
                              {l.description}
                            </span>
                            <span className="text-ink-faint tabular-nums flex-shrink-0">
                              {l.qty} × {l.rate.toFixed(2)}{RATE_KIND_SUFFIX[l.kind] === '%' ? '%' : ''}
                            </span>
                            <span className="font-semibold text-ink tabular-nums w-20 text-right flex-shrink-0">
                              {l.amount.toFixed(2)} €
                            </span>
                          </div>
                        )
                      })}
                      {isOwner && (() => {
                        const included = lines.filter(l => !excluded.has(l.key))
                        const sum = earningsTotal(included)
                        const left = lines.length - included.length
                        return (
                          <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
                            {left > 0 && (
                              <span className="text-[11px] text-orange-500 mr-auto">
                                {left} rida välja jäetud — jäävad maksmata ja tulevad
                                järgmisel perioodil uuesti ette
                              </span>
                            )}
                            <span className="text-sm font-bold text-ink tabular-nums">{sum.toFixed(2)} €</span>
                            <button
                              onClick={() => payOut(worker.id, lines)}
                              disabled={createPayout.isPending || included.length === 0}
                              className="btn-primary disabled:opacity-50"
                            >
                              {createPayout.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              Kinnita väljamakse ({included.length})
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </section>

                {/* Frozen payouts */}
                {periodPayouts.length > 0 && (
                  <section>
                    <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                      Selle perioodi väljamaksed
                    </h4>
                    {periodPayouts.map(p => (
                      <PayoutRow key={p.id} payout={p} isOwner={isOwner}
                        onMarkPaid={() => updatePayout.mutate({ id: p.id, status: 'makstud', paid_at: format(new Date(), 'yyyy-MM-dd') })}
                        onUnmarkPaid={() => updatePayout.mutate({ id: p.id, status: 'kinnitatud', paid_at: null })}
                        onDelete={() => removePayout(p.id)}
                      />
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Engagement ───────────────────────────────────────────────────────────────
// Whether this person is on the payroll or invoices the clinic. It changes what
// the number MEANS: a gross wage that employer taxes are added to, or a purchase
// invoice whose taxes are the sender's problem. Calling the second one "bruto"
// would overstate what the clinic owes.
function EngagementPicker({ profileId, value }: { profileId: string; value: Engagement }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: Engagement) {
    if (next === value) return
    setSaving(true); setError(null)
    try {
      await updateProfile(profileId, { toosuhe: next })
      await qc.invalidateQueries({ queryKey: ['clinic_profiles'] })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
        Töösuhe
      </h4>
      <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
        {([
          { key: 'tootaja', label: 'Palgal' },
          { key: 'ettevote', label: 'Esitab arve' },
        ] as const).map(o => (
          <button
            key={o.key}
            type="button"
            disabled={saving}
            onClick={() => set(o.key)}
            className={`text-xs font-medium px-3 py-1 rounded-md transition-colors disabled:opacity-50 ${
              value === o.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
        {value === 'ettevote'
          ? 'Summa on arve summa. Tööandja makse ei lisandu — maksud on arve esitaja enda asi.'
          : 'Summa on brutopalk, millele lisanduvad tööandja maksud.'}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Payout delete ────────────────────────────────────────────────────────────
// Two clicks, and a louder warning once the money is marked as paid — undoing a
// Expandable payout row — shows lines (jobs) when expanded
function PayoutRow({ payout: p, isOwner, onMarkPaid, onUnmarkPaid, onDelete }: {
  payout: WorkerPayout; isOwner: boolean
  onMarkPaid: () => void; onUnmarkPaid: () => void; onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-ink-faint/20 overflow-hidden">
      <div className="flex items-center gap-2 text-xs px-3 py-2 cursor-pointer hover:bg-bg-sidebar/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-ink-faint">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <div className="flex-1">
          <p className="font-semibold text-ink tabular-nums">{Number(p.total).toFixed(2)} €</p>
          <p className="text-[11px] text-ink-faint">
            {p.lines.length} rida · {p.status === 'makstud'
              ? `makstud ${fmtDate(p.paid_at)}`
              : 'kinnitatud, maksmata'}
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {p.status !== 'makstud' ? (
              <button onClick={onMarkPaid} className="btn-ghost text-xs border border-ink-faint/25">
                Märgi makstuks
              </button>
            ) : (
              <button onClick={onUnmarkPaid}
                className="text-[11px] text-ink-faint hover:text-ink transition-colors"
                title="Võta makstuks märkimine tagasi"
              >
                Võta tagasi
              </button>
            )}
            <PayoutDeleteButton paid={p.status === 'makstud'} onDelete={onDelete} />
          </div>
        )}
      </div>

      {expanded && p.lines.length > 0 && (
        <div className="border-t border-ink-faint/10 bg-bg-sidebar/30 px-3 py-2 space-y-1">
          <div className="grid grid-cols-[1fr_50px_60px_70px] gap-1 text-[10px] font-semibold text-ink-faint uppercase mb-1">
            <span>Kirjeldus</span>
            <span className="text-right">Kogus</span>
            <span className="text-right">Määr</span>
            <span className="text-right">Summa</span>
          </div>
          {p.lines.map(line => (
            <div key={line.id} className="grid grid-cols-[1fr_50px_60px_70px] gap-1 text-[11px]">
              <span className="text-ink truncate" title={line.description}>{line.description}</span>
              <span className="text-ink-muted text-right tabular-nums">{line.qty}</span>
              <span className="text-ink-muted text-right tabular-nums">{line.rate.toFixed(2)} €</span>
              <span className="text-ink font-medium text-right tabular-nums">{line.amount.toFixed(2)} €</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_50px_60px_70px] gap-1 text-[11px] border-t border-ink-faint/15 pt-1 mt-1">
            <span className="font-semibold text-ink">Kokku</span>
            <span />
            <span />
            <span className="font-bold text-ink text-right tabular-nums">{Number(p.total).toFixed(2)} €</span>
          </div>
        </div>
      )}
    </div>
  )
}

// record of something that left the bank should feel different from undoing a
// draft.
function PayoutDeleteButton({ paid, onDelete }: { paid: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)

  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="p-1 rounded text-ink-faint hover:text-red-500 transition-colors"
        title="Kustuta väljamakse"
      >
        <Trash2 size={11} />
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-red-600 font-medium">
        {paid ? 'Makstud väljamakse — kustutada?' : 'Kustutada?'}
      </span>
      <button
        onClick={() => { onDelete(); setConfirm(false) }}
        className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded"
      >
        Jah
      </button>
      <button onClick={() => setConfirm(false)} className="text-[10px] text-ink-faint">Ei</button>
    </div>
  )
}

// ─── Rate editor ──────────────────────────────────────────────────────────────

function RateEditor({ profileId, rates }: { profileId: string; rates: WorkerRate[] }) {
  const save = useSaveWorkerRate()
  const remove = useDeleteWorkerRate()
  const wt = useWorkTypes()

  const [kind, setKind] = useState<RateKind>('hammas')
  const [scope, setScope] = useState<RateScope>('too')
  const [amount, setAmount] = useState('')
  const [workType, setWorkType] = useState('')
  const [payRevisions, setPayRevisions] = useState(false)
  const [autoHours, setAutoHours] = useState(true)
  const [hoursPerDay, setHoursPerDay] = useState('8')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setError(null)
    const value = parseFloat(amount)
    if (!Number.isFinite(value) || value <= 0) { setError('Sisesta summa.'); return }
    try {
      await save.mutateAsync({
        profile_id: profileId,
        kind,
        applies_to: scope,
        amount: value,
        work_type: workType || null,
        priority: workType ? 10 : 0,
        pay_revisions: payRevisions,
        auto_hours: kind === 'tund' ? autoHours : false,
        hours_per_day: kind === 'tund' ? parseFloat(hoursPerDay) || null : null,
        work_days: '12345',
        active_from: null, active_to: null, note: null,
      })
      setAmount(''); setWorkType('')
    } catch (err) { setError(describeError(err)) }
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
        Tasureeglid
      </h4>
      <p className="text-[11px] text-ink-faint mb-2 leading-relaxed">
        Töö tüübiga reegel on ülimuslik üldise reegli ees — nii saab "15 €/hammas, aga
        Allon4 on 200 € töö kohta".
        <br />
        <strong className="text-ink-muted">Mille eest</strong> ütleb, mida reegel katab:
        teostatud töö, disain või muudatus. Muudatustele oma hinna panekuks lisa eraldi
        reegel "Muudatus" — nt 8 €/hammas. Kui muudatuse reeglit ei ole, katab tööreegel
        muudatused ainult siis, kui sellel on linnuke "Katab ka muudatused".
      </p>

      <div className="space-y-1 mb-3">
        {rates.length === 0 && <p className="text-xs text-ink-faint">Reegleid ei ole.</p>}
        {rates.map(r => (
          <div key={r.id} className="flex items-center gap-2 text-xs rounded-lg border border-ink-faint/20 px-2.5 py-1.5">
            <span className="font-medium text-ink">{RATE_KIND_LABEL[r.kind]}</span>
            <span className="tabular-nums font-semibold text-accent">
              {Number(r.amount).toFixed(2)} {RATE_KIND_SUFFIX[r.kind]}
            </span>
            {(r.applies_to ?? 'too') === 'disain' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                disaini eest
              </span>
            )}
            {(r.applies_to ?? 'too') === 'muudatus' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">
                muudatuste eest
              </span>
            )}
            {r.kind === 'tund' && r.auto_hours && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                auto {Number(r.hours_per_day ?? 0)} h/päev
              </span>
            )}
            {r.work_type && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-sidebar text-ink-muted">
                {r.work_type}
              </span>
            )}
            {r.pay_revisions && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                muudatused tasustatud
              </span>
            )}
            <button
              onClick={() => remove.mutate(r.id)}
              className="ml-auto p-1 rounded text-ink-faint hover:text-red-500 transition-colors"
              title="Kustuta reegel"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="label">Liik</label>
          <select value={kind} onChange={e => setKind(e.target.value as RateKind)} className="input py-1.5 text-sm w-48">
            {KINDS.map(k => <option key={k} value={k}>{RATE_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Summa</label>
          <div className="relative w-28">
            <input
              type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="input py-1.5 pr-12 text-sm text-right"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">
              {RATE_KIND_SUFFIX[kind]}
            </span>
          </div>
        </div>
        {(kind === 'hammas' || kind === 'too' || kind === 'protsent') && (
          <div>
            <label className="label">Mille eest</label>
            <select value={scope} onChange={e => setScope(e.target.value as RateScope)} className="input py-1.5 text-sm w-40">
              {SCOPES.map(sc => <option key={sc} value={sc}>{RATE_SCOPE_LABEL[sc]}</option>)}
            </select>
          </div>
        )}
        {kind === 'tund' && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer">
              <input
                type="checkbox" checked={autoHours}
                onChange={e => setAutoHours(e.target.checked)}
                className="accent-accent"
              />
              Täida tunnid automaatselt
            </label>
            {autoHours && (
              <div>
                <label className="label">Tunde päevas</label>
                <input
                  type="number" min="0" max="24" step="0.5" value={hoursPerDay}
                  onChange={e => setHoursPerDay(e.target.value)}
                  className="input py-1.5 text-sm w-20 text-right"
                />
              </div>
            )}
          </>
        )}
        {(kind === 'hammas' || kind === 'too' || kind === 'protsent') && (
          <div>
            <label className="label">Ainult töö tüübile</label>
            <select value={workType} onChange={e => setWorkType(e.target.value)} className="input py-1.5 text-sm w-44">
              <option value="">Kõik tööd</option>
              {wt.types.map(t => <option key={t.nimi} value={t.nimi}>{t.nimi}</option>)}
            </select>
          </div>
        )}
        {(kind === 'hammas' || kind === 'too' || kind === 'protsent') && scope === 'too' && (
          <label
            className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer"
            title="Kehtib ainult siis, kui eraldi 'Muudatus' reeglit ei ole"
          >
            <input
              type="checkbox" checked={payRevisions}
              onChange={e => setPayRevisions(e.target.checked)}
              className="accent-accent"
            />
            Katab ka muudatused
          </label>
        )}
        <button onClick={add} disabled={save.isPending} className="btn-ghost border border-ink-faint/25 mb-0.5 disabled:opacity-50">
          <Plus size={13} /> Lisa reegel
        </button>
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5">
        {RATE_KIND_HINT[kind]}
        {kind === 'tund' && autoHours && ' Esmaspäevast reedeni; käsitsi sisestatud päev on ülimuslik.'}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Hours ────────────────────────────────────────────────────────────────────

function HoursPanel({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const { data: hours = [] } = useWorkHours()
  const add = useAddWorkHours()
  const remove = useDeleteWorkHours()

  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mine = hours.filter(h => h.profile_id === profileId).slice(0, 8)

  async function submit() {
    setError(null)
    const h = parseFloat(value)
    if (!Number.isFinite(h) || h <= 0) { setError('Sisesta tundide arv.'); return }
    try {
      await add.mutateAsync({
        profile_id: profileId, work_date: date, hours: h,
        note: note.trim() || null, recorded_by: null,
      })
      setValue(''); setNote('')
    } catch (err) { setError(describeError(err)) }
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Clock size={11} /> Töötunnid
      </h4>
      {mine.length === 0 ? (
        <p className="text-xs text-ink-faint mb-2">Tunde ei ole sisestatud.</p>
      ) : (
        <div className="space-y-0.5 mb-2">
          {mine.map(h => (
            <div key={h.id} className="flex items-center gap-2 text-xs py-0.5">
              <span className="text-ink-faint tabular-nums w-20">{fmtDate(h.work_date)}</span>
              <span className="font-medium text-ink tabular-nums w-12">{Number(h.hours)} h</span>
              <span className="flex-1 truncate text-ink-muted">{h.note ?? ''}</span>
              {canEdit && (
                <button
                  onClick={() => remove.mutate(h.id)}
                  className="p-1 rounded text-ink-faint hover:text-red-500 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="label">Kuupäev</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input py-1.5 text-sm w-36" />
          </div>
          <div>
            <label className="label">Tunde</label>
            <input
              type="number" min="0" max="24" step="0.25" value={value}
              onChange={e => setValue(e.target.value)}
              className="input py-1.5 text-sm w-20 text-right"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="label">Märkus</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="input py-1.5 text-sm" />
          </div>
          <button onClick={submit} disabled={add.isPending} className="btn-ghost border border-ink-faint/25 mb-0.5 disabled:opacity-50">
            <Plus size={13} /> Lisa
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const parsed = parseISO(d)
  return isValid(parsed) ? format(parsed, 'dd.MM.yy') : '—'
}
