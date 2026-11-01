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
  ChevronDown, ChevronRight, Euro, Lock, Download
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths, parseISO, isValid } from 'date-fns'
import { t, lang, dateLocale } from '@/lib/i18n'
import type { Job } from '../../types/job'
import { jobHasDesigner } from '../../types/job'
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
  unassignedFinishedJobs, grossOf, payslipFromGross, backlogPeriods, owedAcrossPeriods, paidRevisionGroups, revaluationOf,
  RATE_KIND_LABEL, RATE_KIND_HINT, RATE_KIND_SUFFIX, RATE_SCOPE_LABEL, rateWorkTypes,
  type RateKind, type RateScope, type WorkerRate,
  type PayrollTaxRates, type WorkerTaxProfile, type EarningsIssue, type BacklogPeriod, type PaidRevisionGroup,
} from '../../lib/earnings'
import { useQueryClient } from '@tanstack/react-query'
import { updateProfile, type Engagement, type PayBasis } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { describeError } from '../Patients/errors'
import { exportCsv, payoutColumns, payoutLineColumns } from '../../lib/exports'

/**
 * The person's own tax settings, as overrides. Undefined where they have none —
 * `grossFromNet` reads null/undefined as "use the clinic default" and 0 as a
 * real zero, and collapsing the two here would quietly put someone back in the
 * second pillar they opted out of.
 */
function taxProfileOf(w: { kogumispension_protsent?: number | null; maksuvaba_tulu?: number | null }): WorkerTaxProfile {
  return {
    kogumispensionProtsent: w.kogumispension_protsent,
    maksuvabaTulu: w.maksuvaba_tulu,
  }
}

const KINDS: RateKind[] = ['hammas', 'too', 'protsent', 'tund', 'kuu']
const SCOPES: RateScope[] = ['too', 'disain', 'muudatus', 'mudel']

/** Kinds that pay for a piece of work, so they can be scoped and type-targeted.
 *  'tund' and 'kuu' belong to the period and have nothing to point at. */
const SCOPED_KINDS: RateKind[] = ['hammas', 'too', 'protsent']

interface PayrollViewProps {
  jobs: Job[]
  /** Opens a job. Without it the diagnostics can name a job but not reach it. */
  onOpenJob?: (job: Job) => void
}

export function PayrollView({ jobs, onOpenJob }: PayrollViewProps) {
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

  // Names for the export. Archived people included — a payout that cannot name
  // its recipient is a worse record than a slightly longer lookup.
  const nameOf = (id: string): string =>
    workers.find(w => w.id === id)?.full_name
    ?? archivedProfiles?.get(id)?.full_name
    ?? 'Tundmatu'

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
      label: format(base, 'LLLL yyyy', { locale: dateLocale }),
    }
  }, [monthOffset])

  // Workers are only visible to the owner; everyone else sees just themselves,
  // matching what the RLS policies will actually return.
  const visible = useMemo(
    () => (isOwner ? workers : workers.filter(w => w.id === auth.user?.id)),
    [isOwner, workers, auth.user?.id]
  )

  // One object, assembled once, passed to every payslip on the screen. The
  // rates are settings rather than constants because tax law is annual and the
  // pension rate is the employee's own choice — see lib/earnings.
  const taxRates = useMemo<PayrollTaxRates>(() => ({
    tooandjaMaksudProtsent: settings.tooandjaMaksudProtsent,
    tulumaksProtsent: settings.tulumaksProtsent,
    maksuvabaTuluKuus: settings.maksuvabaTuluKuus,
    tootajaTootuskindlustusProtsent: settings.tootajaTootuskindlustusProtsent,
    kogumispensionProtsent: settings.kogumispensionProtsent,
  }), [
    settings.tooandjaMaksudProtsent, settings.tulumaksProtsent, settings.maksuvabaTuluKuus,
    settings.tootajaTootuskindlustusProtsent, settings.kogumispensionProtsent,
  ])

  const perWorker = useMemo(() => visible.map(w => {
    const alreadyPaid = paidKeysFrom(payouts, w.id, rates)
    const lines = calculateEarnings({
      profileId: w.id,
      rates, jobs, hours,
      types: wt.types,
      periodStart: period.start,
      periodEnd: period.end,
      doneStageKey,
      alreadyPaid,
      rushMultiplier: w.kiirtoo_kordaja ?? 1,
    })
    const periodPayouts = payouts.filter(
      p => p.profile_id === w.id && p.period_start === period.start
    )
    // What EARLIER months still owe. Computed on the current month's screen
    // because that is the one anybody opens — the whole failure this answers is
    // that nobody opens August again. See `backlogPeriods`.
    const backlog = backlogPeriods({
      profileId: w.id,
      rates, jobs, hours,
      types: wt.types,
      periodStart: period.start,
      periodEnd: period.end,
      doneStageKey,
      alreadyPaid,
      rushMultiplier: w.kiirtoo_kordaja ?? 1,
    })
    // What is still owed for this period. `calculateEarnings` drops every line
    // already frozen into a payout, so this is the UNPAID half and nothing else.
    const outstanding = earningsTotal(lines)
    // The other half, which exists nowhere in `lines` and has to be read back
    // off the payouts themselves.
    const paid = periodPayouts.reduce((s, p) => s + Number(p.total), 0)
    // Confirmed in some OTHER month and still not handed over.
    //
    // This screen was month-shaped all the way through, which was fine while
    // every payout was confirmed from the month it belonged to. Settling a
    // backlog breaks that assumption: the payouts land in August and September
    // and the person standing in October — who just created them — had nowhere
    // to see them, nowhere to see what they contained, and no way to find out
    // what the whole bill now came to. The work disappeared from the screen at
    // the exact moment it became a debt.
    const otherOpen = payouts
      .filter(p => p.profile_id === w.id
        && p.period_start !== period.start
        && p.status !== 'makstud')
      .sort((a, b) => b.period_start.localeCompare(a.period_start))
    const otherOpenTotal = otherOpen.reduce((s, p) => s + Number(p.total), 0)
    // See `owedAcrossPeriods` — the one figure on this screen that is not
    // about the month on screen.
    const owed = owedAcrossPeriods(outstanding, payouts, w.id)
    // Bounded at the month on screen: rates were corrected going forward, so
    // everything from here on is already right, and half-counting the current
    // month would put lines in the claim that nobody disputes.
    const revalue = paidRevisionGroups(payouts, w.id, period.start)
    return {
      worker: w,
      lines,
      backlog,
      outstanding,
      paid,
      otherOpen,
      otherOpenTotal,
      owed,
      revalue,
      // The month's earning, paid or not. This is what the summary tiles, the
      // employer tax and the clinic's total cost are computed from: those are
      // facts about the PERIOD, and paying someone does not make the month
      // cheaper. Showing only `outstanding` there emptied the whole header the
      // moment a payout was confirmed.
      total: outstanding + paid,
      // The same month read as GROSS. For a 'bruto' person that is the total
      // itself; for a 'neto' one it is what the clinic must run through payroll
      // to leave that amount in their account. Every cost figure below —
      // employer tax, the clinic's total — is computed from this, never from
      // the entered number, because employer tax on a net figure is a smaller
      // tax on a smaller wage: wrong twice.
      gross: grossOf(outstanding + paid, w.tasu_arvestus, taxRates, taxProfileOf(w)),
      rates: rates.filter(r => r.profile_id === w.id),
      payouts: periodPayouts,
      // Computed ALWAYS, not only when the total is zero. Gating it on an empty
      // list meant a partial result — three jobs assigned, one line — looked
      // exactly like a complete one, which is the harder problem to notice.
      // Filter out 'makstud' — already paid is normal, not a warning
      issues: diagnoseEarnings({
        profileId: w.id, rates, jobs, hours, types: wt.types,
        periodStart: period.start, periodEnd: period.end, doneStageKey, alreadyPaid,
        rushMultiplier: w.kiirtoo_kordaja ?? 1,
      }).filter(iss => iss.code !== 'makstud'),
      // jobHasDesigner, not `designed_by === w.id`: someone who designed only
      // the laminates on a split case still has that job counted for them.
      assignedDone: jobs.filter(j =>
        (j.assigned_to === w.id || jobHasDesigner(j, w.id)) && j.status === doneStageKey
      ).length,
    }
  }), [visible, payouts, rates, jobs, hours, wt.types, period, doneStageKey, taxRates])

  // Not per worker — see unassignedFinishedJobs. A job with nobody on it is in
  // no worker's list, so no worker's diagnostics can ever mention it.
  const unassigned = useMemo(
    () => unassignedFinishedJobs({
      jobs, periodStart: period.start, periodEnd: period.end, doneStageKey,
    }),
    [jobs, period, doneStageKey]
  )

  // Employees and contractors cannot be added into one "gross" figure: only the
  // first kind carries employer taxes, and calling an invoice "brutopalk" would
  // overstate what the clinic owes the tax office.
  const employeeGross = perWorker
    .filter(x => (x.worker.toosuhe ?? 'tootaja') === 'tootaja')
    .reduce((s, x) => s + x.gross, 0)
  // What the people on the payroll actually take home. Equal to the gross when
  // nobody is on a net agreement, and the number the owner recognises when
  // somebody is.
  const employeeNet = perWorker
    .filter(x => (x.worker.toosuhe ?? 'tootaja') === 'tootaja')
    .reduce((s, x) => s + (x.worker.tasu_arvestus === 'neto'
      ? x.total
      : payslipFromGross(x.total, taxRates, taxProfileOf(x.worker)).net), 0)
  const hasNetWorkers = perWorker.some(x =>
    x.worker.tasu_arvestus === 'neto' && (x.worker.toosuhe ?? 'tootaja') === 'tootaja')
  const contractorTotal = perWorker
    .filter(x => x.worker.toosuhe === 'ettevote')
    .reduce((s, x) => s + x.total, 0)
  const employerTax = employerTaxAmount(employeeGross, settings.tooandjaMaksudProtsent)
  // How much of the period's cost has already left the account. Shown under the
  // total rather than subtracted from it — the month cost what it cost.
  const paidTotal = perWorker.reduce((s, x) => s + x.paid, 0)

  async function payOut(profileId: string, lines: ReturnType<typeof calculateEarnings>) {
    setActionError(null)
    const included = lines.filter(l => !excluded.has(l.key))
    if (included.length === 0) {
      setActionError(t('Kõik read on välja jäetud — pole midagi kinnitada.', 'All lines are excluded — nothing to confirm.'))
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

  /**
   * Settles earlier months — ONE payout per month, not one big one.
   *
   * The button is in the current month because that is where somebody is
   * standing, but each month's work is frozen against its own period. See
   * `backlogPeriods`: a payout carries the period it belongs to and the whole
   * app reads it, so sweeping August into October would make October cost more
   * than October did, permanently, because a confirmed payout is frozen.
   *
   * Sequential and not `Promise.all`: if the third month fails, the first two
   * are already real and the error names which month stopped. Fired together,
   * a partial failure would leave an unknown subset confirmed.
   */
  async function payOutBacklog(profileId: string, backlog: BacklogPeriod[]) {
    setActionError(null)
    let done = 0
    try {
      for (const p of backlog) {
        const included = p.lines.filter(l => !excluded.has(l.key))
        if (included.length === 0) continue
        await createPayout.mutateAsync({
          profile_id: profileId,
          period_start: p.periodStart,
          period_end: p.periodEnd,
          lines: included,
        })
        done++
      }
      if (done === 0) setActionError(t('Kõik vanad read on välja jäetud — pole midagi kinnitada.', 'All earlier lines are excluded — nothing to confirm.'))
      else setExcluded(new Set())
    } catch (err) {
      setActionError(
        `${describeError(err)}${done > 0 ? t(` (${done} kuud jõudsid kinnituda)`, ` (${done} ${done === 1 ? 'month was' : 'months were'} confirmed)`) : ''}`
      )
    }
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
            <p className="text-sm font-semibold text-ink">{t('Töötasude tabeleid ei leitud', 'Payroll tables not found')}</p>
            <p className="text-xs text-ink-muted">
              {t('Käivita', 'Run')} <code className="px-1 rounded bg-bg-sidebar">sql/022_worker_pay.sql</code>{' '}
              {t('Supabase SQL-redaktoris (Wivo kinni).', 'in the Supabase SQL editor (with Wivo closed).')}
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
        <h1 className="text-xl font-bold text-page-ink flex items-center gap-2">
          <Wallet size={18} className="text-accent" /> {t('Töötasud', 'Payroll')}
        </h1>

        {/* The accountant's export. Two files rather than one: the summary is
            what goes on a payroll run, the lines are the answer to "why is this
            person's number what it is" — and being asked that months later is
            exactly when the payout has already been frozen. */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => exportCsv('valjamaksed', payouts, payoutColumns(nameOf))}
            disabled={payouts.length === 0}
            className="btn-ghost text-xs border border-ink-faint/25 disabled:opacity-40"
            title={t('Väljamaksed kokku, CSV', 'Payout totals, CSV')}
          >
            <Download size={13} /> {t('Väljamaksed', 'Payouts')}
          </button>
          <button
            onClick={() => exportCsv(
              'valjamaksed-read',
              payouts.flatMap(p => p.lines.map(line => ({ payout: p, line }))),
              payoutLineColumns(nameOf),
            )}
            disabled={payouts.length === 0}
            className="btn-ghost text-xs border border-ink-faint/25 disabled:opacity-40"
            title={t('Iga väljamakse rida eraldi, CSV', 'Each payout line separately, CSV')}
          >
            <Download size={13} /> {t('Read', 'Lines')}
          </button>
        </div>

        <div className="flex items-center gap-1">
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
            title={monthOffset >= 0 ? t('Tulevikku ei arvestata', 'Future months are not calculated') : undefined}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-faint max-w-3xl leading-relaxed">
        {t('Arvestatakse ainult', 'Only')} <strong className="text-ink-muted">{t('valmis', 'done')}</strong> {t('töid, mille teostaja või disainija on määratud. Väljamakse külmutab read: hilisem määra muutmine juba makstud perioodi ümber ei arvuta.', 'jobs with an assigned technician or designer are counted. A payout freezes its lines: changing a rate later does not recalculate a period already paid.')}
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
              <p className="text-xs text-ink-muted">{t(`Palgal, bruto (${period.label})`, `Employees, gross (${period.label})`)}</p>
              <p className="text-xl font-bold text-ink tabular-nums">{employeeGross.toFixed(2)} €</p>
              {/* Only when somebody is on a net agreement. Otherwise it is a
                  derived figure nobody asked for, sitting under one they did. */}
              {hasNetWorkers && (
                <p className="text-[10px] text-ink-faint tabular-nums">
                  {t('kätte', 'take-home')} {employeeNet.toFixed(2)} €
                </p>
              )}
            </div>
          </div>

          {/* Only the payroll half carries employer taxes. */}
          <div className="pl-6 border-l border-ink-faint/20">
            <p className="text-xs text-ink-muted">
              {t('Tööandja maksud', 'Employer taxes')} ({settings.tooandjaMaksudProtsent}%)
            </p>
            <p className="text-base font-semibold text-ink tabular-nums">
              {employerTax.toFixed(2)} €
            </p>
          </div>

          {contractorTotal > 0 && (
            <div className="pl-6 border-l border-ink-faint/20">
              <p className="text-xs text-ink-muted">{t('Arve alusel (ettevõtted)', 'Invoiced (companies)')}</p>
              <p className="text-base font-semibold text-ink tabular-nums">
                {contractorTotal.toFixed(2)} €
              </p>
              <p className="text-[10px] text-ink-faint">{t('tööandja makse ei lisandu', 'no employer taxes added')}</p>
            </div>
          )}

          <div className="pl-6 border-l border-ink-faint/20">
            <p className="text-xs text-ink-muted">{t('Kogukulu kliinikule', 'Total cost to clinic')}</p>
            <p className="text-xl font-bold text-accent tabular-nums">
              {(employeeGross + employerTax + contractorTotal).toFixed(2)} €
            </p>
            {paidTotal > 0 && (
              <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                <Lock size={8} /> {t('sh välja makstud', 'incl. paid out')} {paidTotal.toFixed(2)} €
              </p>
            )}
          </div>

          {settings.tooandjaMaksudProtsent === 0 && employeeGross > 0 && (
            <p className="text-[11px] text-orange-500 max-w-xs leading-relaxed">
              {t('Tööandja maksude määr on 0% — määra see Seaded → Hinnad, muidu näitab kogukulu palgalistel ainult brutopalka.', 'The employer tax rate is 0% — set it in Settings → Prices, otherwise the total cost for employees shows only gross pay.')}
            </p>
          )}

          {/* A net agreement with no employee-side rates grosses up to itself:
              the toggle would look set and change nothing. Say so here rather
              than let the cost figure be quietly short by the tax wedge. */}
          {hasNetWorkers && settings.tulumaksProtsent === 0 && (
            <p className="text-[11px] text-orange-500 max-w-xs leading-relaxed">
              {t('Mõne inimese tasu on sisestatud netona, aga tulumaksu määr on 0% — bruto arvutatakse netost samaks numbriks. Määra Seaded → Hinnad → Palgamaksud.', 'Someone\'s pay is entered as net, but the income tax rate is 0% — gross works out to the same number as net. Set it in Settings → Prices → Payroll taxes.')}
            </p>
          )}
        </div>
      )}

      {archivedIds.length > 0 && (
        <div className="card p-4">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
            {t('Arhiveeritud', 'Archived')} ({archivedIds.length})
          </h3>
          <p className="text-[11px] text-ink-faint mb-2 leading-relaxed">
            {t('Meeskonnast eemaldatud inimesed, kellele on tehtud väljamakseid. Uut tasu neile ei arvestata — ajalugu on siin selleks, et makstu jääks jälgitavaks.', 'People removed from the team who have received payouts. No new pay is calculated for them — the history is here so that what was paid stays traceable.')}
          </p>
          <div className="space-y-1">
            {archivedIds.map(id => {
              const prof = archivedProfiles?.get(id)
              const theirs = payouts.filter(p => p.profile_id === id)
              const total = theirs.reduce((s, p) => s + Number(p.total), 0)
              return (
                <div key={id} className="flex items-center gap-2 text-xs rounded-lg border border-ink-faint/15 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate">{prof?.full_name || t('Tundmatu', 'Unknown')}</p>
                    <p className="text-[11px] text-ink-faint">
                      {t(`${theirs.length} väljamakset · eemaldatud meeskonnast`, `${theirs.length} ${theirs.length === 1 ? 'payout' : 'payouts'} · removed from team`)}
                    </p>
                  </div>
                  <span className="font-semibold text-ink tabular-nums">{total.toFixed(2)} €</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Work that belongs to NOBODY. Every warning below this one lives inside
          a worker's card, and a job with neither a technician nor a designer is
          in none of them — the per-worker diagnostics skips any job the worker
          has no part in, so this is the one finding that has to be reported for
          the payout as a whole or not at all. */}
      {unassigned.length > 0 && (
        <div className="card p-3 border border-orange-200 bg-orange-50">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-orange-800">
                {t(`${unassigned.length} valmis tööd ilma teostaja ja disainijata — nende eest ei maksta kellelegi`, `${unassigned.length} done ${unassigned.length === 1 ? 'job' : 'jobs'} with no technician or designer — nobody gets paid for ${unassigned.length === 1 ? 'it' : 'them'}`)}
              </p>
              <p className="text-[11px] text-orange-700/80 mt-0.5">
                {t('Ava töö ja määra Teostaja. Ilma selleta ei jõua töö ühelegi palgareale ega ka ühegi töötaja hoiatuste alla.', 'Open the job and set the Technician. Without one, the job reaches no pay line and no staff member\'s warnings either.')}
              </p>
              <p className="text-[11px] text-orange-700 mt-1">
                {unassigned.slice(0, 5).map((u, i) => (
                  <span key={u.id}>
                    {i > 0 && ' · '}
                    <button
                      type="button"
                      onClick={() => {
                        const j = jobs.find(x => x.id === u.id)
                        if (j && onOpenJob) onOpenJob(j)
                      }}
                      className="underline decoration-dotted underline-offset-2 hover:text-orange-900"
                      title={t('Ava töö', 'Open job')}
                    >
                      {u.label}
                    </button>
                  </span>
                ))}
                {unassigned.length > 5 && ` · +${unassigned.length - 5}`}
              </p>
            </div>
          </div>
        </div>
      )}

      {perWorker.length === 0 ? (
        <div className="card p-8 text-center">
          <Wallet size={26} className="text-ink-faint mx-auto mb-2" />
          <p className="text-sm text-ink-muted">{t('Töötajaid ei ole.', 'No staff.')}</p>
        </div>
      ) : perWorker.map(({ worker, lines, backlog, total, gross, outstanding, paid, otherOpen, otherOpenTotal, owed, revalue, rates: workerRates, payouts: periodPayouts, issues, assignedDone }) => {
        const open = openWorker === worker.id
        // `periood` is work belonging to another month and `makstud` is settled
        // business. Neither is an open item, and neither belongs in a count
        // that is coloured orange to mean "look at this".
        const openIssues = issues
          .filter(i => i.code !== 'periood' && i.code !== 'makstud')
          .reduce((n, i) => n + i.count, 0)
        const onPayroll = (worker.toosuhe ?? 'tootaja') === 'tootaja'
        const netBasis = onPayroll && worker.tasu_arvestus === 'neto'
        return (
          <div key={worker.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenWorker(open ? null : worker.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-sidebar/60 transition-colors text-left"
            >
              {open ? <ChevronDown size={14} className="text-ink-faint" /> : <ChevronRight size={14} className="text-ink-faint" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate flex items-center gap-1.5">
                  {worker.full_name || t('Nimeta', 'Unnamed')}
                  {worker.role === 'owner' && <span className="text-[10px] text-ink-faint font-normal">{t('omanik', 'owner')}</span>}
                  {worker.toosuhe === 'ettevote' && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                      {t('esitab arve', 'invoices')}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-ink-faint">
                  {workerRates.length === 0
                    ? t('Tasureegleid ei ole määratud', 'No pay rules set')
                    : t(`${workerRates.length} reeglit · ${lines.length} arvestamata rida · ${assignedDone} määratud valmis tööd`, `${workerRates.length} ${workerRates.length === 1 ? 'rule' : 'rules'} · ${lines.length} unpaid ${lines.length === 1 ? 'line' : 'lines'} · ${assignedDone} assigned done ${assignedDone === 1 ? 'job' : 'jobs'}`)}
                  {/* Only what somebody can DO something about. It used to add
                      up every issue, so a row reading "0 arvestamata rida"
                      ended with "40 tööd arvestamata" — and 37 of those forty
                      were work belonging to another month, which is not a
                      fault and not this period's business. */}
                  {openIssues > 0 && (
                    <span className="text-orange-500 font-medium">
                      {' '}· {t(`${openIssues} tööd vajab tähelepanu`, `${openIssues} ${openIssues === 1 ? 'job needs' : 'jobs need'} attention`)}
                    </span>
                  )}
                </p>
              </div>
              {/* The badges say how the period's total splits. The total itself
                  stays put — it is what the person earned this month, and it
                  used to fall to 0.00 € the moment they were paid, which read
                  as "nothing was earned" rather than "nothing is owed". */}
              {paid > 0 && (
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 flex items-center gap-1">
                  <Lock size={9} /> {t('Välja makstud', 'Paid out')} {paid.toFixed(2)} €
                </span>
              )}
              {paid > 0 && outstanding > 0 && (
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">
                  {t('Maksmata', 'Unpaid')} {outstanding.toFixed(2)} €
                </span>
              )}
              {/* Crosses periods, and says so, because every other number on
                  this row is about the month on screen. Without it the only
                  way to learn what the whole bill came to was to open each
                  earlier month one at a time and add them up by hand. */}
              {owed > 0 && Math.abs(owed - outstanding) > 0.005 && (
                <span
                  className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-orange-100 text-orange-700"
                  title={t('Kõik, mis sellele inimesele praegu võlgu ollakse — selle kuu arvestamata töö pluss kõik kinnitatud, aga veel välja maksmata väljamaksed igast kuust', 'Everything currently owed to this person — this month\'s unpaid work plus every confirmed but not yet paid payout from any month')}
                >
                  {t('Maksmata kokku', 'Total unpaid')} {owed.toFixed(2)} €
                </span>
              )}
              {/* The headline is always the number that was AGREED — the one
                  the owner recognises. What it costs is spelled out beneath it
                  rather than substituted for it. */}
              <span className="text-right">
                <span className="block text-lg font-bold text-ink tabular-nums leading-none">
                  {total.toFixed(2)} €
                </span>
                <span className="block text-[10px] text-ink-faint">
                  {worker.toosuhe === 'ettevote' ? t('arve summa', 'invoice amount') : netBasis ? t('neto (kätte)', 'net (take-home)') : t('bruto', 'gross')}
                </span>
                {netBasis && gross > 0 && (
                  <span className="block text-[10px] text-ink-faint tabular-nums">
                    {t('bruto', 'gross')} {gross.toFixed(2)} € · {t('kulu', 'cost')}{' '}
                    {employerCost(gross, settings.tooandjaMaksudProtsent).toFixed(2)} €
                  </span>
                )}
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
                {isOwner && onPayroll && (
                  <PayBasisPicker profileId={worker.id} value={worker.tasu_arvestus ?? 'bruto'} />
                )}
                {isOwner && onPayroll && (
                  <TaxProfilePicker
                    profileId={worker.id}
                    kogumispension={worker.kogumispension_protsent ?? null}
                    maksuvabaTulu={worker.maksuvaba_tulu ?? null}
                  />
                )}
                {onPayroll && total > 0 && (
                  <PayslipPanel
                    slip={payslipFromGross(gross, taxRates, taxProfileOf(worker))}
                    rates={taxRates}
                    worker={taxProfileOf(worker)}
                  />
                )}
                {isOwner && (
                  <RushPicker profileId={worker.id} value={worker.kiirtoo_kordaja ?? null} />
                )}
                {isOwner && (
                  <RateEditor profileId={worker.id} rates={workerRates} />
                )}

                <HoursPanel profileId={worker.id} canEdit={isOwner || worker.id === auth.user?.id} />

                {/* Why some work is not on the list. Its own section, because it
                    is not the list: it used to sit under "Arvestamata read (3)"
                    and then show thirteen cards, so the heading counted one
                    thing and the cards below it another. */}
                {issues.length > 0 && (
                  <IssuesPanel
                    issues={issues}
                    jobs={jobs}
                    onOpenJob={onOpenJob}
                    onGoToMonth={m => setMonthOffset(monthsBetween(period.start, m))}
                  />
                )}

                {/* Above the current month's list on purpose. This is the part
                    nobody knew about — the current month is already on screen
                    every time somebody opens this page. */}
                {backlog.length > 0 && (
                  <BacklogPanel
                    backlog={backlog}
                    excluded={excluded}
                    isOwner={isOwner}
                    busy={createPayout.isPending}
                    onToggleLine={toggleLine}
                    onSettle={() => payOutBacklog(worker.id, backlog)}
                    onGoToMonth={m => setMonthOffset(monthsBetween(period.start, m))}
                  />
                )}

                {/* Earnings preview */}
                <section>
                  <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                    {t('Arvestamata read', 'Unpaid lines')} ({lines.length})
                  </h4>

                  {lines.length === 0 ? (
                    <p className="text-xs text-ink-faint">
                      {workerRates.length === 0
                        ? t('Lisa tasureegel, et arvestus tekiks.', 'Add a pay rule to start calculating.')
                        : t('Sellel perioodil ei ole arvestamata tööd.', 'No unpaid work in this period.')}
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
                                title={off ? t('Kaasa väljamaksesse', 'Include in payout') : t('Jäta sellest väljamaksest välja', 'Leave out of this payout')}
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
                                {t(`${left} rida välja jäetud — jäävad maksmata ja tulevad järgmisel perioodil uuesti ette`, `${left} ${left === 1 ? 'line' : 'lines'} left out — ${left === 1 ? 'it stays' : 'they stay'} unpaid and ${left === 1 ? 'comes' : 'come'} up again next period`)}
                              </span>
                            )}
                            <span className="text-sm font-bold text-ink tabular-nums">{sum.toFixed(2)} €</span>
                            <button
                              onClick={() => payOut(worker.id, lines)}
                              disabled={createPayout.isPending || included.length === 0}
                              className="btn-primary disabled:opacity-50"
                            >
                              {createPayout.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              {t('Kinnita väljamakse', 'Confirm payout')} ({included.length})
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </section>

                {/* A one-off audit, not part of the monthly flow — folded shut
                    and below the lists somebody actually came here for. */}
                {isOwner && revalue.length > 0 && (
                  <RevaluePanel groups={revalue} workerName={nameOf(worker.id)} />
                )}

                {/* Confirmed elsewhere, still owed. Directly above this
                    month's own payouts, because after settling a backlog this
                    is where the money went — and the backlog panel that listed
                    those jobs is correctly gone, so this is the only thing left
                    that can say what was in them. */}
                {otherOpen.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                      {t('Muude kuude kinnitatud väljamaksed — veel maksmata', 'Confirmed payouts from other months — not yet paid')}
                    </h4>
                    <div className="space-y-1.5">
                      {otherOpen.map(p => (
                        <PayoutRow
                          key={p.id}
                          payout={p}
                          isOwner={isOwner}
                          periodLabel={monthLabel(p.period_start)}
                          onMarkPaid={() => updatePayout.mutate({ id: p.id, status: 'makstud', paid_at: format(new Date(), 'yyyy-MM-dd') })}
                          onUnmarkPaid={() => updatePayout.mutate({ id: p.id, status: 'kinnitatud', paid_at: null })}
                          onDelete={() => removePayout(p.id)}
                        />
                      ))}
                      <div className="flex items-center justify-end gap-3 pt-1">
                        <span className="mr-auto text-[11px] text-ink-muted">
                          {t('Klõpsa real, et näha, millised tööd selle sees on.', 'Click a row to see which jobs it contains.')}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-ink">
                          {otherOpenTotal.toFixed(2)} €
                        </span>
                      </div>
                    </div>
                  </section>
                )}

                {/* Frozen payouts */}
                {periodPayouts.length > 0 && (
                  <section>
                    <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                      {t('Selle perioodi väljamaksed', 'Payouts for this period')}
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

/**
 * Why some work is not on the payout list — and what to DO about each answer.
 *
 * The old version was thirteen identical orange cards saying "the completion
 * date falls outside this period", one per distinct date, with no button on any
 * of them. Every one of them was true, none of them was a fault, and there was
 * nothing on screen to press. A warning nobody can act on is not a warning; it
 * is furniture.
 *
 * So the rows are now split by what they ask of you:
 *   `periood`  — nothing is wrong. Look at the other month; there is a button.
 *   `makstud`  — already settled. Stated once, quietly.
 *   the rest   — something to fix on the job or in the rate rules. Orange, and
 *                every named job opens with a click.
 */
function IssuesPanel({ issues, jobs, onOpenJob, onGoToMonth }: {
  issues: EarningsIssue[]
  jobs: Job[]
  onOpenJob?: (job: Job) => void
  onGoToMonth: (month: string) => void
}) {
  const [open, setOpen] = useState(false)
  const actionable = issues.filter(i => i.code !== 'periood' && i.code !== 'makstud')
  const quiet = issues.filter(i => i.code === 'periood' || i.code === 'makstud')

  const openJob = (id: string) => {
    const job = jobs.find(j => j.id === id)
    if (job && onOpenJob) onOpenJob(job)
  }

  /** "august 2026" from '2026-08'. Unparseable months keep their raw form. */
  const monthLabel = (m: string): string => {
    const d = parseISO(`${m}-01`)
    return isValid(d) ? format(d, 'LLLL yyyy', { locale: dateLocale }) : m
  }

  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
        {t('Miks mõni töö siin ei ole', 'Why some jobs are not here')}
      </h4>

      {actionable.map(iss => (
        <div
          key={`${iss.code}|${iss.label}`}
          className="flex items-start gap-2 text-[11px] rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5"
        >
          <AlertTriangle size={11} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-orange-800">
              <strong>{iss.count}</strong> {t('tööd', iss.count === 1 ? 'job' : 'jobs')}: {iss.label}
            </p>
            <p className="text-orange-700/70 truncate">
              {iss.examples.map((ex, i) => (
                <span key={ex.id}>
                  {i > 0 && ' · '}
                  {onOpenJob ? (
                    <button
                      type="button"
                      onClick={() => openJob(ex.id)}
                      className="underline decoration-dotted underline-offset-2 hover:text-orange-900"
                      title={t('Ava töö', 'Open job')}
                    >
                      {ex.label}
                    </button>
                  ) : ex.label}
                </span>
              ))}
              {iss.count > iss.examples.length && ` · +${iss.count - iss.examples.length}`}
            </p>
          </div>
        </div>
      ))}

      {/* Not a fault, so not orange. One line, folded away, with the only thing
          there is to do about it: go and look at that month. */}
      {quiet.map(iss => (
        <div
          key={`${iss.code}|${iss.label}`}
          className="text-[11px] rounded-lg border border-ink-faint/20 bg-bg-sidebar px-2.5 py-1.5"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ink-muted">
              <strong className="text-ink">{iss.count}</strong> {t('tööd', iss.count === 1 ? 'job' : 'jobs')} — {iss.label}
            </span>
            {iss.months.slice(0, 4).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => onGoToMonth(m)}
                className="text-accent hover:text-accent-dark font-medium underline decoration-dotted underline-offset-2"
                title={t(`Ava ${monthLabel(m)} periood`, `Open the ${monthLabel(m)} period`)}
              >
                {monthLabel(m)}
              </button>
            ))}
            {iss.examples.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="text-ink-faint hover:text-ink ml-auto"
              >
                {open ? t('peida', 'hide') : t('näita', 'show')}
              </button>
            )}
          </div>
          {open && (
            <p className="text-ink-faint mt-1 truncate">
              {iss.examples.map((ex, i) => (
                <span key={ex.id}>
                  {i > 0 && ' · '}
                  {onOpenJob ? (
                    <button
                      type="button"
                      onClick={() => openJob(ex.id)}
                      className="underline decoration-dotted underline-offset-2 hover:text-ink"
                      title={t('Ava töö', 'Open job')}
                    >
                      {ex.label}
                    </button>
                  ) : ex.label}
                </span>
              ))}
              {iss.count > iss.examples.length && ` · +${iss.count - iss.examples.length}`}
            </p>
          )}
        </div>
      ))}
    </section>
  )
}

/**
 * Whole months from the period currently on screen to `month` ('yyyy-MM'),
 * as an offset from TODAY — which is what `monthOffset` counts.
 */
/**
 * What earlier months still owe, and the one button that settles them.
 *
 * ── Why it is folded shut ───────────────────────────────────────────────────
 * It can be a year of months. Open, it would push the month you actually came
 * here for off the screen — and this is a backlog, not today's work. The
 * heading carries the two numbers that decide whether it is worth opening.
 *
 * ── Why each month keeps its own total and its own link ─────────────────────
 * Settling creates one payout per month (see `payOutBacklog`), so the months
 * are the unit the records are kept in. Showing one merged total would describe
 * a payout that is never created, and the first question after confirming —
 * "why are there three rows?" — would have no answer on this screen.
 */
function BacklogPanel({
  backlog, excluded, isOwner, busy, onToggleLine, onSettle, onGoToMonth,
}: {
  backlog: BacklogPeriod[]
  excluded: Set<string>
  isOwner: boolean
  busy: boolean
  onToggleLine: (key: string) => void
  onSettle: () => void
  onGoToMonth: (month: string) => void
}) {
  const [open, setOpen] = useState(false)
  const included = backlog.flatMap(p => p.lines).filter(l => !excluded.has(l.key))
  const total = earningsTotal(included)

  return (
    <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={14} className="text-ink-muted" /> : <ChevronRight size={14} className="text-ink-muted" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          {t('Varasemast arveldamata', 'Unsettled from earlier')}
        </span>
        <span className="text-xs text-ink-muted">
          {backlog.length} {backlog.length === 1 ? t('kuu', 'month') : t('kuud', 'months')}
        </span>
        <span className="ml-auto text-sm font-bold tabular-nums text-ink">{total.toFixed(2)} €</span>
      </button>

      {!open && (
        <p className="mt-1 pl-6 text-xs text-ink-muted">
          {t('Valmis tööd, mille eest ei ole kunagi väljamakset kinnitatud. Ava, et näha.', 'Done jobs that never had a payout confirmed. Open to see.')}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          {backlog.map(p => (
            <div key={p.month}>
              <div className="mb-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onGoToMonth(p.month)}
                  className="text-xs font-semibold text-accent hover:underline"
                  title={t('Ava see kuu', 'Open this month')}
                >
                  {p.month}
                </button>
                <span className="text-[11px] text-ink-faint">{p.lines.length} {t('rida', p.lines.length === 1 ? 'line' : 'lines')}</span>
                <span className="ml-auto text-xs font-semibold tabular-nums text-ink">
                  {p.total.toFixed(2)} €
                </span>
              </div>
              {p.lines.map(l => {
                const off = excluded.has(l.key)
                return (
                  <div
                    key={l.key}
                    className={`flex items-center gap-2 border-b border-ink-faint/10 py-1 text-xs last:border-0 ${off ? 'opacity-40' : ''}`}
                  >
                    {isOwner && (
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => onToggleLine(l.key)}
                        className="flex-shrink-0 accent-accent"
                        title={off ? t('Kaasa väljamaksesse', 'Include in payout') : t('Jäta sellest väljamaksest välja', 'Leave out of this payout')}
                      />
                    )}
                    <span className="w-20 flex-shrink-0 tabular-nums text-ink-faint">{fmtDate(l.earned_on)}</span>
                    <span className={`min-w-0 flex-1 truncate text-ink ${off ? 'line-through' : ''}`}>
                      {l.description}
                    </span>
                    <span className="w-20 flex-shrink-0 text-right font-semibold tabular-nums text-ink">
                      {l.amount.toFixed(2)} €
                    </span>
                  </div>
                )
              })}
            </div>
          ))}

          {isOwner && (
            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              {/* Said before the click, not after. Somebody settling from
                  October will otherwise look for the money in October. */}
              <span className="mr-auto text-[11px] text-ink-muted">
                {t('Iga kuu kohta tekib eraldi väljamakse selle kuu alla — nii jääb iga kuu kulu sinna, kus töö tehti.', 'Each month gets its own payout under that month — so each month\'s cost stays where the work was done.')}
              </span>
              <span className="text-sm font-bold tabular-nums text-ink">{total.toFixed(2)} €</span>
              <button
                onClick={onSettle}
                disabled={busy || included.length === 0}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {t('Arvelda vanad kuud', 'Settle earlier months')} ({included.length})
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Recalculating revisions that were already paid at the wrong rate.
 *
 * ── Why it does not fix anything ────────────────────────────────────────────
 * A payout is frozen on purpose: changing a rule afterwards must not restate
 * what somebody was already paid, or every past month becomes editable and no
 * figure in this app can be trusted again. So this answers the question and
 * leaves the record alone. What comes out is a number to settle BETWEEN people
 * — invoiced, or added as a line to a future payout — and the trail of how it
 * was arrived at, as a CSV.
 *
 * ── Why the correct rate is typed in and not inferred ───────────────────────
 * The obvious move is to reprice each line under today's rules. But a rule
 * carries `active_from`, so "today's rules" may legitimately answer with the
 * old rate for an old month — and whether the fix was made by editing the rule
 * or by dating a new one is not knowable from here. Guessing wrong produces a
 * confident number that gets invoiced. The person who changed the rate knows
 * what it should have been; the app does the arithmetic.
 */
function RevaluePanel({ groups, workerName }: {
  groups: PaidRevisionGroup[]
  workerName: string
}) {
  const [open, setOpen] = useState(false)
  // Keyed by kind|rate, and EMPTY means "unchanged" rather than 0 — a blank box
  // that silently meant zero would show the whole payment as an overpayment.
  const [corrected, setCorrected] = useState<Record<string, string>>({})

  const rows = groups.map(g => {
    const key = `${g.kind}|${g.rate}`
    const typed = corrected[key]
    const rate = typed === undefined || typed.trim() === ''
      ? g.rate
      : Number(typed.replace(',', '.'))
    const valid = Number.isFinite(rate)
    return { g, key, typed: typed ?? '', ...revaluationOf(g, valid ? rate : g.rate), valid }
  })
  const totalDiff = rows.reduce((s, r) => s + r.difference, 0)

  return (
    <section className="rounded-xl border border-ink-faint/25 p-3">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 text-left">
        {open ? <ChevronDown size={14} className="text-ink-muted" /> : <ChevronRight size={14} className="text-ink-muted" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          {t('Varem makstud muudatused — ümberarvutus', 'Revisions paid earlier — recalculation')}
        </span>
        <span className="ml-auto text-xs text-ink-muted">
          {groups.length} {groups.length === 1 ? t('määr', 'rate') : t('määra', 'rates')}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-ink-muted">
            {t('Muudatused, mis on juba välja makstud, rühmitatud selle järgi, mida nende eest tegelikult maksti. Sisesta õige määr ja vaata vahet.', 'Revisions already paid out, grouped by what was actually paid for them. Enter the correct rate and see the difference.')} <strong>{t('Midagi ei muudeta', 'Nothing is changed')}</strong> {t('— kinnitatud väljamakse jääb puutumata, see on ainult arvutus.', '— the confirmed payout stays untouched; this is only a calculation.')}
          </p>

          {rows.map(r => (
            <div key={r.key} className="rounded-lg border border-ink-faint/20 p-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-ink tabular-nums">
                  {r.g.rate.toFixed(2)} {RATE_KIND_SUFFIX[r.g.kind as RateKind] ?? r.g.kind}
                </span>
                <span className="text-ink-muted tabular-nums">
                  {r.g.qty} × · {r.g.lines.length} {t('rida', r.g.lines.length === 1 ? 'line' : 'lines')}
                </span>
                <span className="text-ink-muted tabular-nums">
                  {t('makstud', 'paid')} {r.g.paid.toFixed(2)} €
                </span>
                <label className="ml-auto flex items-center gap-1.5">
                  <span className="text-ink-muted">{t('Õige määr', 'Correct rate')}</span>
                  <input
                    value={r.typed}
                    onChange={e => setCorrected(c => ({ ...c, [r.key]: e.target.value }))}
                    placeholder={r.g.rate.toFixed(2)}
                    inputMode="decimal"
                    className="input w-24 text-right tabular-nums"
                  />
                </label>
              </div>
              {r.difference !== 0 && (
                <p className="mt-1.5 text-xs tabular-nums text-ink">
                  {t('Peaks olema', 'Should be')} <strong>{r.should.toFixed(2)} €</strong> —{' '}
                  <span className={r.difference > 0 ? 'font-bold text-orange-600' : 'font-bold text-emerald-600'}>
                    {r.difference > 0 ? t('maksmata ', 'underpaid ') : t('ülemakstud ', 'overpaid ')}
                    {Math.abs(r.difference).toFixed(2)} €
                  </span>
                </p>
              )}
              {!r.valid && (
                <p className="mt-1.5 text-xs text-red-600">
                  {t('See ei ole number — vahe arvutamata.', 'That is not a number — difference not calculated.')}
                </p>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-faint/15 pt-2">
            <button
              onClick={() => exportCsv(
                `muudatuste-umberarvutus-${workerName}`,
                rows.flatMap(r => r.g.lines.map(l => ({ ...l, correctRate: r.should / (r.g.qty || 1) }))),
                [
                  { header: 'Kuu', value: l => l.period },
                  { header: 'Kirjeldus', value: l => l.description },
                  { header: 'Kogus', value: l => l.qty },
                  { header: 'Makstud määr', value: l => l.rate.toFixed(2) },
                  { header: 'Makstud summa', value: l => l.amount.toFixed(2) },
                  { header: 'Õige määr', value: l => l.correctRate.toFixed(2) },
                  { header: 'Peaks olema', value: l => (l.qty * l.correctRate).toFixed(2) },
                  { header: 'Vahe', value: l => (l.qty * l.correctRate - l.amount).toFixed(2) },
                ],
              )}
              className="btn-ghost mr-auto border border-ink-faint/25 text-xs"
            >
              <Download size={13} /> {t('Laadi alla read', 'Download lines')}
            </button>
            <span className="text-xs text-ink-muted">{t('Kokku taotleda', 'Total to claim')}</span>
            <span className="text-base font-bold tabular-nums text-ink">
              {totalDiff.toFixed(2)} €
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

/** 'august 2026' from a period start, or the raw value if it is not a date. */
function monthLabel(periodStart: string): string {
  const d = parseISO(periodStart)
  return isValid(d) ? format(d, 'LLLL yyyy', { locale: dateLocale }) : periodStart
}

function monthsBetween(_periodStart: string, month: string): number {
  const target = parseISO(`${month}-01`)
  if (!isValid(target)) return 0
  const now = new Date()
  return (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
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
        {t('Töösuhe', 'Engagement')}
      </h4>
      <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
        {([
          { key: 'tootaja', label: t('Palgal', 'Employee') },
          { key: 'ettevote', label: t('Esitab arve', 'Invoices') },
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
          ? t('Summa on arve summa. Tööandja makse ei lisandu — maksud on arve esitaja enda asi.', 'The amount is the invoice amount. No employer taxes are added — taxes are the invoicer\'s own concern.')
          : t('Summa on brutopalk, millele lisanduvad tööandja maksud.', 'The amount is gross pay, with employer taxes added on top.')}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Bruto või neto ───────────────────────────────────────────────────────────
/**
 * How to READ the numbers in this person's pay rules: as gross wage, or as the
 * amount that lands in their account.
 *
 * Most small employers agree on take-home pay. Reading that as gross does not
 * merely mislabel it — it understates the clinic's cost by the entire
 * employee-side tax wedge, because employer tax is then charged on a wage that
 * is too small. In Estonia 2026 that is 432.28 € a month on a single 1600 €
 * agreement, and it lands straight in the profit figure on Statistika.
 *
 * Per person, not one clinic-wide switch: an owner drawing gross and an
 * assistant on a net agreement are both ordinary, and often the same clinic.
 */
function PayBasisPicker({ profileId, value }: { profileId: string; value: PayBasis }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: PayBasis) {
    if (next === value) return
    setSaving(true); setError(null)
    try {
      await updateProfile(profileId, { tasu_arvestus: next })
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
        {t('Tasureeglite summad on', 'Pay rule amounts are')}
      </h4>
      <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
        {([
          { key: 'bruto', label: t('Bruto', 'Gross') },
          { key: 'neto', label: t('Neto (kätte)', 'Net (take-home)') },
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
        {value === 'neto'
          ? t('Sisestatud summa on see, mis inimesele kätte jõuab. Bruto ja tööandja kulu arvutatakse sellest tagurpidi — maksumäärad on Seaded → Hinnad → Palgamaksud.', 'The amount entered is what the person takes home. Gross and employer cost are worked back from it — tax rates are in Settings → Prices → Payroll taxes.')
          : t('Sisestatud summa on brutopalk. Kui lepite kokku kättesaadava summa, vali „Neto" — muidu jääb kliiniku kulust töötaja maksuosa välja.', 'The amount entered is gross pay. If you agree on a take-home amount, choose "Net" — otherwise the employee\'s share of tax is left out of the clinic\'s cost.')}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Isiklik maksuprofiil ─────────────────────────────────────────────────────
/**
 * The two tax facts that genuinely differ from person to person, and that a
 * clinic-wide default gets wrong for somebody:
 *
 *   II sammas — the employee's own choice of 2, 4 or 6%, or none at all.
 *   Maksuvaba tulu — only where they have applied for it. Someone with a second
 *   job has usually used it there, and giving it to them here understates the
 *   gross their net requires.
 *
 * Both are stored as NULL when unset, which reads as "clinic default" — kept
 * distinct from 0, which is a real answer meaning "none".
 */
function TaxProfilePicker({ profileId, kogumispension, maksuvabaTulu }: {
  profileId: string; kogumispension: number | null; maksuvabaTulu: number | null
}) {
  const qc = useQueryClient()
  const { settings } = useSettings()
  const [draft, setDraft] = useState(maksuvabaTulu != null ? String(maksuvabaTulu) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(updates: Parameters<typeof updateProfile>[1]) {
    setSaving(true); setError(null)
    try {
      await updateProfile(profileId, updates)
      await qc.invalidateQueries({ queryKey: ['clinic_profiles'] })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSaving(false)
    }
  }

  async function commitTaxFree() {
    const raw = draft.trim()
    const next = raw === '' ? null : parseFloat(raw)
    if (next != null && !Number.isFinite(next)) {
      setError(t('Sisesta summa eurodes, nt 700.', 'Enter an amount in euros, e.g. 700.')); return
    }
    if (next === maksuvabaTulu) return
    await save({ maksuvaba_tulu: next })
  }

  const options: { key: number | null; label: string }[] = [
    { key: null, label: t(`Vaikimisi (${settings.kogumispensionProtsent}%)`, `Default (${settings.kogumispensionProtsent}%)`) },
    { key: 0, label: t('Ei ole', 'None') },
    { key: 2, label: '2%' },
    { key: 4, label: '4%' },
    { key: 6, label: '6%' },
  ]

  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
        {t('Maksuprofiil', 'Tax profile')}
      </h4>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] text-ink-faint mb-1">{t('Kogumispension (II sammas)', 'Funded pension (II pillar)')}</p>
          <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
            {options.map(o => (
              <button
                key={String(o.key)}
                type="button"
                disabled={saving}
                onClick={() => void save({ kogumispension_protsent: o.key })}
                className={`text-[11px] font-medium px-2 py-1 rounded-md transition-colors disabled:opacity-50 ${
                  kogumispension === o.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-ink-faint mb-1">{t('Maksuvaba tulu', 'Tax-free allowance')}</p>
          <div className="relative w-28">
            <input
              type="number" min="0" step="10" value={draft}
              disabled={saving}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => void commitTaxFree()}
              placeholder={String(settings.maksuvabaTuluKuus)}
              className="input py-1.5 pr-6 text-sm text-right"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">
              €
            </span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
        {t(`Mõjutab ainult netost brutosse arvutamist. Tühi lahter = kliiniku vaikeväärtus (${settings.maksuvabaTuluKuus} €). Kirjuta 0, kui inimene maksuvaba tulu siin ei kasuta — nt teise tööandja juures.`, `Only affects working gross out from net. Empty = the clinic default (${settings.maksuvabaTuluKuus} €). Enter 0 if the person does not use the tax-free allowance here — e.g. it is used with another employer.`)}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Palgaleht ────────────────────────────────────────────────────────────────
/**
 * Bruto → kätte, line by line. Shown for everyone on the payroll and not only
 * for net agreements: the same arithmetic answers "what will they receive" for
 * a gross one, and that is the question a contract is signed on.
 */
function PayslipPanel({ slip, rates, worker }: {
  slip: ReturnType<typeof payslipFromGross>
  rates: PayrollTaxRates
  worker: WorkerTaxProfile
}) {
  const ii = worker.kogumispensionProtsent ?? rates.kogumispensionProtsent
  const rows: { label: string; value: number; muted?: boolean }[] = [
    { label: t('Bruto', 'Gross'), value: slip.gross },
    { label: t(`Kogumispension (${ii}%)`, `Funded pension (${ii}%)`), value: -slip.kogumispension, muted: true },
    { label: t(`Töötuskindlustus (${rates.tootajaTootuskindlustusProtsent}%)`, `Unemployment insurance (${rates.tootajaTootuskindlustusProtsent}%)`), value: -slip.tootuskindlustus, muted: true },
    { label: t(`Tulumaks (${rates.tulumaksProtsent}%)`, `Income tax (${rates.tulumaksProtsent}%)`), value: -slip.tulumaks, muted: true },
    { label: t('Kätte', 'Take-home'), value: slip.net },
    { label: t(`Tööandja maksud (${rates.tooandjaMaksudProtsent}%)`, `Employer taxes (${rates.tooandjaMaksudProtsent}%)`), value: slip.tooandjaMaksud, muted: true },
    { label: t('Kulu kliinikule', 'Cost to clinic'), value: slip.employerCost },
  ]
  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
        {t('Palgaleht (arvestuslik)', 'Payslip (estimate)')}
      </h4>
      <div className="rounded-lg border border-ink-faint/15 divide-y divide-ink-faint/10 max-w-sm">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between px-3 py-1.5 text-[11px]">
            <span className={r.muted ? 'text-ink-faint' : 'text-ink-muted font-medium'}>{r.label}</span>
            <span className={`tabular-nums ${r.muted ? 'text-ink-faint' : 'text-ink font-semibold'}`}>
              {r.value.toFixed(2)} €
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
        {t('Arvutatud Seaded → Hinnad → Palgamaksud määradega. See ei ole raamatupidamise palgateatis — sotsiaalmaksu miinimumkohustust ja aastapõhiseid ümberarvestusi siin ei arvestata.', 'Calculated with the rates in Settings → Prices → Payroll taxes. This is not an accounting payslip — the social tax minimum and annual recalculations are not taken into account here.')}
      </p>
    </section>
  )
}

/**
 * What a rush job pays THIS person, as a multiplier on their piece rates.
 *
 * Per worker and not one number in Seaded, because the two multipliers answer
 * different questions. `settings.kiirtooKordaja` is what the CUSTOMER pays for
 * a rush — it is already baked into `job.hind` by the time the job is saved.
 * How much of that uplift reaches the bench is an agreement with each person:
 * one gets the same 2×, another 1.5×, a salaried technician nothing at all. A
 * single field for both meant raising the rush price quietly raised the payroll.
 *
 * Empty = 1× and nothing is added, which is exactly how every payout before
 * this behaved — so nobody's past pay moved when this shipped.
 */
function RushPicker({ profileId, value }: { profileId: string; value: number | null }) {
  const qc = useQueryClient()
  const { settings } = useSettings()
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    const raw = draft.trim()
    // Blank and "1" are the same answer — store null so the field reads as
    // unset rather than as a deliberate 1.00 somebody once typed.
    const next = raw === '' || parseFloat(raw) === 1 ? null : parseFloat(raw)
    if (raw !== '' && (!Number.isFinite(next as number) && next !== null)) {
      setError(t('Sisesta kordaja, nt 2 või 1.5.', 'Enter a multiplier, e.g. 2 or 1.5.')); return
    }
    if (next === value) return
    setSaving(true); setError(null)
    try {
      await updateProfile(profileId, { kiirtoo_kordaja: next })
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
        {t('Kiirtöö kordaja', 'Rush job multiplier')}
      </h4>
      <div className="flex items-center gap-2">
        <div className="relative w-24">
          <input
            type="number" min="1" step="0.1" value={draft}
            disabled={saving}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            placeholder="1"
            className="input py-1.5 pr-7 text-sm text-right"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">
            ×
          </span>
        </div>
        <div className="flex gap-1">
          {[1.5, 2].map(m => (
            <button
              key={m}
              type="button"
              disabled={saving}
              onClick={() => { setDraft(String(m)); void updateProfile(profileId, { kiirtoo_kordaja: m }).then(() => qc.invalidateQueries({ queryKey: ['clinic_profiles'] })) }}
              className="text-[11px] font-medium px-2 py-1 rounded-md bg-bg-sidebar text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
            >
              {m}×
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
        {t(`Kiirtööl korrutatakse selle inimese hamba- ja töötasu selle arvuga. Tühi = 1×, ülekurssi ei maksta. Protsendireeglit ei korrutata — töö hind kannab kliiniku kordajat (${settings.kiirtooKordaja}×) juba endas, nii et protsent kasvab niigi.`, `On a rush job, this person's per-tooth and per-job pay is multiplied by this number. Empty = 1×, no rush premium is paid. Percentage rules are not multiplied — the job price already carries the clinic's multiplier (${settings.kiirtooKordaja}×), so the percentage grows anyway.`)}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </section>
  )
}

// ─── Payout delete ────────────────────────────────────────────────────────────
// Two clicks, and a louder warning once the money is marked as paid — undoing a
// Expandable payout row — shows lines (jobs) when expanded
function PayoutRow({ payout: p, isOwner, periodLabel, onMarkPaid, onUnmarkPaid, onDelete }: {
  payout: WorkerPayout; isOwner: boolean
  /** Set only where the row can be from a month other than the one on screen. */
  periodLabel?: string
  onMarkPaid: () => void; onUnmarkPaid: () => void; onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  // Only per-tooth lines count — the same qty column also holds hours, jobs and
  // job prices, and summing those together would be a number of nothing.
  const teeth = p.lines.reduce((n, l) => l.kind === 'hammas' ? n + l.qty : n, 0)

  return (
    <div className="rounded-lg border border-ink-faint/20 overflow-hidden">
      <div className="flex items-center gap-2 text-xs px-3 py-2 cursor-pointer hover:bg-bg-sidebar/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-ink-faint">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <div className="flex-1">
          <p className="font-semibold text-ink tabular-nums">
            {Number(p.total).toFixed(2)} €
            {periodLabel && (
              <span className="ml-2 text-[11px] font-medium text-accent">{periodLabel}</span>
            )}
          </p>
          <p className="text-[11px] text-ink-faint">
            {p.lines.length} {t('rida', p.lines.length === 1 ? 'line' : 'lines')} · {p.status === 'makstud'
              ? t(`makstud ${fmtDate(p.paid_at)}`, `paid ${fmtDate(p.paid_at)}`)
              : t('kinnitatud, maksmata', 'confirmed, unpaid')}
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {p.status !== 'makstud' ? (
              <button onClick={onMarkPaid} className="btn-ghost text-xs border border-ink-faint/25">
                {t('Märgi makstuks', 'Mark as paid')}
              </button>
            ) : (
              <button onClick={onUnmarkPaid}
                className="text-[11px] text-ink-faint hover:text-ink transition-colors"
                title={t('Võta makstuks märkimine tagasi', 'Undo marking as paid')}
              >
                {t('Võta tagasi', 'Undo')}
              </button>
            )}
            <PayoutDeleteButton paid={p.status === 'makstud'} onDelete={onDelete} />
          </div>
        )}
      </div>

      {expanded && p.lines.length > 0 && (
        <div className="border-t border-ink-faint/10 bg-bg-sidebar/30 px-3 py-2 space-y-1">
          <div className="grid grid-cols-[1fr_50px_60px_70px] gap-1 text-[10px] font-semibold text-ink-faint uppercase mb-1">
            <span>{t('Kirjeldus', 'Description')}</span>
            <span className="text-right">{t('Kogus', 'Qty')}</span>
            <span className="text-right">{t('Määr', 'Rate')}</span>
            <span className="text-right">{t('Summa', 'Amount')}</span>
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
            <span className="font-semibold text-ink">
              {t('Kokku', 'Total')}
              {teeth > 0 && (
                <span className="ml-1.5 font-normal text-ink-faint tabular-nums">
                  {teeth} {t('hammast', teeth === 1 ? 'tooth' : 'teeth')}
                </span>
              )}
            </span>
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
        title={t('Kustuta väljamakse', 'Delete payout')}
      >
        <Trash2 size={11} />
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-red-600 font-medium">
        {paid ? t('Makstud väljamakse — kustutada?', 'Paid payout — delete?') : t('Kustutada?', 'Delete?')}
      </span>
      <button
        onClick={() => { onDelete(); setConfirm(false) }}
        className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded"
      >
        {t('Jah', 'Yes')}
      </button>
      <button onClick={() => setConfirm(false)} className="text-[10px] text-ink-faint">{t('Ei', 'No')}</button>
    </div>
  )
}

// ─── Rate editor ──────────────────────────────────────────────────────────────

function RateEditor({ profileId, rates }: { profileId: string; rates: WorkerRate[] }) {
  const save = useSaveWorkerRate()
  const remove = useDeleteWorkerRate()
  // The amount, editable in place. Before this the only way to correct a rate
  // was delete-and-retype the whole rule, which is why a wrong one could sit
  // there for months: nobody deletes a working rule to change one number.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(r: WorkerRate): void {
    setEditing(r.id)
    setDraft(String(Number(r.amount)))
  }

  async function commitEdit(r: WorkerRate): Promise<void> {
    const v = parseFloat(draft.replace(',', '.'))
    setEditing(null)
    // Anything unparseable or negative is a typo, not an instruction. An
    // unchanged value is not worth a write — or an `updated_at` bump.
    if (!Number.isFinite(v) || v < 0 || v === Number(r.amount)) return
    await save.mutateAsync({ ...r, amount: v })
  }
  const wt = useWorkTypes()

  const [kind, setKind] = useState<RateKind>('hammas')
  const [scope, setScope] = useState<RateScope>('too')
  const [amount, setAmount] = useState('')
  // A list, not one name: "igeme tasu on these four types" is one decision and
  // was previously four near-identical rules to write and keep in step.
  const [workTypes, setWorkTypes] = useState<string[]>([])
  // "Lisandub" and "mille eest" are different questions: gum design IS design,
  // it just stacks instead of competing. Forcing one dropdown to say both left
  // the ordinary design rule with nowhere to go.
  const [additive, setAdditive] = useState(false)
  const [label, setLabel] = useState('')
  const [payRevisions, setPayRevisions] = useState(false)
  const [autoHours, setAutoHours] = useState(true)
  const [hoursPerDay, setHoursPerDay] = useState('8')
  const [workDays, setWorkDays] = useState('1234') // default Mon-Thu (4 days)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setError(null)
    const value = parseFloat(amount)
    if (!Number.isFinite(value) || value <= 0) { setError(t('Sisesta summa.', 'Enter an amount.')); return }
    try {
      await save.mutateAsync({
        profile_id: profileId,
        kind,
        applies_to: scope,
        amount: value,
        work_type: workTypes.length > 0 ? workTypes.join('|') : null,
        priority: workTypes.length > 0 ? 10 : 0,
        additive,
        label: label.trim() || null,
        pay_revisions: payRevisions,
        auto_hours: kind === 'tund' || kind === 'kuu' ? autoHours : false,
        hours_per_day: kind === 'tund' || kind === 'kuu' ? parseFloat(hoursPerDay) || null : null,
        work_days: kind === 'tund' || kind === 'kuu' ? workDays : '12345',
        active_from: null, active_to: null, note: null,
      })
      setAmount(''); setWorkTypes([]); setLabel(''); setAdditive(false)
    } catch (err) { setError(describeError(err)) }
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
        {t('Tasureeglid', 'Pay rules')}
      </h4>
      <p className="text-[11px] text-ink-faint mb-2 leading-relaxed">
        {t('Töö tüübiga reegel on ülimuslik üldise reegli ees — nii saab "15 €/hammas, aga Allon4 on 200 € töö kohta". Ühele reeglile võib valida mitu tüüpi, nii et sama hinna jaoks ei pea kirjutama kümmet ühesugust reeglit.', 'A rule with a work type takes precedence over a general rule — so you can have "15 €/tooth, but Allon4 is 200 € per job". One rule can cover several types, so you don\'t have to write ten identical rules for the same price.')}
        <br />
        <strong className="text-ink-muted">{t('Mille eest', 'Paid for')}</strong> {t('ütleb, mida reegel katab: teostatud töö, disain, muudatus või mudel. Muudatustele oma hinna panekuks lisa eraldi reegel "Muudatus" — nt 8 €/hammas. Kui muudatuse reeglit ei ole, katab tööreegel muudatused ainult siis, kui sellel on linnuke "Katab ka muudatused".', 'says what the rule covers: the work done, design, a revision or a model. To give revisions their own price, add a separate "Revision" rule — e.g. 8 €/tooth. Without a revision rule, a job rule covers revisions only if "Also covers revisions" is ticked.')}
        <br />
        <strong className="text-ink-muted">{t('Mudel', 'Model')}</strong> {t('makstakse tööle, millel on mudeli märge — lisandub tootmistasule, ei võistle sellega. Kõige tavalisem on "Töö tasu (fikseeritud)", nt 5 € mudeli kohta.', 'is paid on a job marked as having a model — it adds to the production pay rather than competing with it. The most common is "Job pay (fixed)", e.g. 5 € per model.')}
      </p>

      <div className="space-y-1 mb-3">
        {rates.length === 0 && <p className="text-xs text-ink-faint">{t('Reegleid ei ole.', 'No rules.')}</p>}
        {rates.map(r => (
          <div key={r.id} className="flex items-center gap-2 text-xs rounded-lg border border-ink-faint/20 px-2.5 py-1.5">
            {/* The rule's own name leads when it has one — that is the whole
                reason it exists, so "Igeme disain" is read before the method. */}
            {r.label?.trim()
              ? <span className="font-semibold text-ink">{r.label.trim()}</span>
              : <span className="font-medium text-ink">{RATE_KIND_LABEL[r.kind]}</span>}
            {editing === r.id ? (
              <span className="flex items-center gap-1">
                <input
                  type="number" min="0" step="0.01" autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => void commitEdit(r)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void commitEdit(r) }
                    if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                  }}
                  className="input py-0.5 px-1.5 text-xs w-20 text-right tabular-nums"
                />
                <span className="text-[10px] text-ink-faint">{RATE_KIND_SUFFIX[r.kind]}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => startEdit(r)}
                title={t('Muuda summat', 'Edit amount')}
                className="tabular-nums font-semibold text-accent hover:underline decoration-dotted underline-offset-2"
              >
                {Number(r.amount).toFixed(2)} {RATE_KIND_SUFFIX[r.kind]}
              </button>
            )}
            {r.additive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                {t('lisandub', 'additive')}
              </span>
            )}
            {(r.applies_to ?? 'too') === 'disain' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                {t('disaini eest', 'for design')}
              </span>
            )}
            {(r.applies_to ?? 'too') === 'muudatus' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-700">
                {t('muudatuste eest', 'for revisions')}
              </span>
            )}
            {(r.applies_to ?? 'too') === 'mudel' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {t('mudeli eest', 'for models')}
              </span>
            )}
            {r.kind === 'tund' && r.auto_hours && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                auto {Number(r.hours_per_day ?? 0)} {t('h/päev', 'h/day')}
              </span>
            )}
            {(r.kind === 'tund' || r.kind === 'kuu') && r.work_days && r.work_days !== '12345' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                {r.work_days.split('').map(d => (lang === 'en' ? ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['', 'E', 'T', 'K', 'N', 'R', 'L', 'P'])[parseInt(d)] ?? d).join('')}
              </span>
            )}
            {/* Through rateWorkTypes, never the raw column — it holds several
                names joined by '|' and printing it raw would show the plumbing. */}
            {rateWorkTypes(r).map(name => (
              <span key={name} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-sidebar text-ink-muted">
                {name}
              </span>
            ))}
            {r.pay_revisions && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {t('muudatused tasustatud', 'revisions paid')}
              </span>
            )}
            <button
              onClick={() => remove.mutate(r.id)}
              className="ml-auto p-1 rounded text-ink-faint hover:text-red-500 transition-colors"
              title={t('Kustuta reegel', 'Delete rule')}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="label">{t('Liik', 'Type')}</label>
          <select value={kind} onChange={e => setKind(e.target.value as RateKind)} className="input py-1.5 text-sm w-48">
            {KINDS.map(k => <option key={k} value={k}>{RATE_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('Summa', 'Amount')}</label>
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
        {SCOPED_KINDS.includes(kind) && (
          <div>
            <label className="label">{t('Mille eest', 'Paid for')}</label>
            <select value={scope} onChange={e => setScope(e.target.value as RateScope)} className="input py-1.5 text-sm w-40">
              {SCOPES.map(sc => <option key={sc} value={sc}>{RATE_SCOPE_LABEL[sc]}</option>)}
            </select>
          </div>
        )}
        {(kind === 'tund' || kind === 'kuu') && (
          <>
            <div>
              <label className="label">{t('Tööpäevad', 'Work days')}</label>
              <div className="flex gap-0.5">
                {[
                  { d: '1', l: t('E', 'M') }, { d: '2', l: t('T', 'T') }, { d: '3', l: t('K', 'W') },
                  { d: '4', l: t('N', 'T') }, { d: '5', l: t('R', 'F') }, { d: '6', l: t('L', 'S') }, { d: '7', l: t('P', 'S') },
                ].map(({ d, l }) => (
                  <button key={d} type="button"
                    onClick={() => setWorkDays(workDays.includes(d) ? workDays.replace(d, '') : [...workDays, d].sort().join(''))}
                    className={`w-7 h-7 rounded text-[10px] font-bold transition-colors ${
                      workDays.includes(d)
                        ? 'bg-accent text-white'
                        : 'bg-bg-sidebar text-ink-faint hover:text-ink-muted'
                    }`}
                  >{l}</button>
                ))}
              </div>
            </div>
            {kind === 'tund' && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer">
                  <input
                    type="checkbox" checked={autoHours}
                    onChange={e => setAutoHours(e.target.checked)}
                    className="accent-accent"
                  />
                  {t('Täida tunnid automaatselt', 'Fill in hours automatically')}
                </label>
                {autoHours && (
                  <div>
                    <label className="label">{t('Tunde päevas', 'Hours per day')}</label>
                    <input
                      type="number" min="0" max="24" step="0.5" value={hoursPerDay}
                      onChange={e => setHoursPerDay(e.target.value)}
                      className="input py-1.5 text-sm w-20 text-right"
                    />
                  </div>
                )}
              </>
            )}
            {kind === 'kuu' && (
              <div>
                <label className="label">{t('Tunde päevas', 'Hours per day')}</label>
                <input
                  type="number" min="0" max="24" step="0.5" value={hoursPerDay}
                  onChange={e => setHoursPerDay(e.target.value)}
                  className="input py-1.5 text-sm w-20 text-right"
                />
              </div>
            )}
          </>
        )}
        {SCOPED_KINDS.includes(kind) && (
          <label
            className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer"
            title={t('Makstakse tootmistasu KÕRVALE, mitte selle asemel', 'Paid IN ADDITION to production pay, not instead of it')}
          >
            <input
              type="checkbox" checked={additive}
              onChange={e => setAdditive(e.target.checked)}
              className="accent-accent"
            />
            {t('Lisandub', 'Additive')}
          </label>
        )}
        {/* 'muudatus', not 'revision': RateScope has no such member, so this
            condition was always true and the checkbox showed on the very rules
            it makes no sense for — a revision rule covering revisions. An
            additive rule never competes either, so the question does not
            arise for it. */}
        {SCOPED_KINDS.includes(kind) && scope !== 'muudatus' && !additive && (
          <label
            className="flex items-center gap-1.5 text-xs text-ink-muted pb-2 cursor-pointer"
            title={t("Kehtib ainult siis, kui eraldi 'Muudatus' reeglit ei ole", "Applies only when there is no separate 'Revision' rule")}
          >
            <input
              type="checkbox" checked={payRevisions}
              onChange={e => setPayRevisions(e.target.checked)}
              className="accent-accent"
            />
            {t('Katab ka muudatused', 'Also covers revisions')}
          </label>
        )}
        <button onClick={add} disabled={save.isPending} className="btn-ghost border border-ink-faint/25 mb-0.5 disabled:opacity-50">
          <Plus size={13} /> {t('Lisa reegel', 'Add rule')}
        </button>
      </div>

      {/* Work types on their own line, all of them visible at once. A dropdown
          would hide which are picked behind a click, and picking several is the
          normal case — one rule for the four types that carry gum work beats
          four rules that have to be kept in step by hand. */}
      {SCOPED_KINDS.includes(kind) && (
        <div className="mt-2">
          <label className="label">
            {t('Ainult töö tüüpidele', 'Only for work types')}
            {workTypes.length === 0 && (
              <span className="font-normal text-ink-faint ml-1">{t('— valimata tähendab kõiki töid', '— none selected means all jobs')}</span>
            )}
          </label>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setWorkTypes([])}
              className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                workTypes.length === 0
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
              }`}
            >
              {t('Kõik tööd', 'All jobs')}
            </button>
            {wt.types.map(type => {
              const picked = workTypes.includes(type.nimi)
              return (
                <button
                  key={type.nimi}
                  type="button"
                  onClick={() => setWorkTypes(prev =>
                    picked ? prev.filter(n => n !== type.nimi) : [...prev, type.nimi]
                  )}
                  className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                    picked
                      ? 'border-accent bg-accent/10 text-ink font-medium'
                      : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: type.hex }} />
                  {type.nimi}
                </button>
              )
            })}
          </div>
          {/* An additive rule with no type named would pay on every piece of
              work there is. Legal, almost never meant, and expensive to
              discover at the end of the month. */}
          {additive && workTypes.length === 0 && (
            <p className="text-[10px] text-amber-600 mt-1">
              {t('Vali töötüübid — praegu lisanduks see tasu iga töö peale.', 'Pick work types — as it stands, this pay would be added to every job.')}
            </p>
          )}
          {/* "Mudel" is two different things in this app: a rate SCOPE and a
              work TYPE. Picking the type here makes a rule that pays only for a
              job carrying a Mudel work ITEM — and models are recorded with the
              flag beside Kiirtöö, so the rule silently never fires. It looks
              completely correct in the list, which is why it needs saying at
              the moment it is written. */}
          {scope === 'too' && workTypes.some(n => /mudel|model/i.test(n)) && (
            <p className="text-[10px] text-amber-600 mt-1">
              {t('Mudelit märgitakse tööl Kiirtöö kõrval, mitte tööosana — see reegel ei rakenduks. Vali pigem „Mille eest: Mudel".', 'A model is marked on the job next to Rush, not as a work item — this rule would never apply. Choose "Paid for: Model" instead.')}{' '}
              <button
                type="button"
                onClick={() => { setScope('mudel'); setWorkTypes([]) }}
                className="underline font-medium hover:text-amber-700"
              >
                {t('Sea ära', 'Fix it')}
              </button>
            </p>
          )}
        </div>
      )}

      {/* A name, because "Lisatasu 9 €" three times over is a list nobody can
          read. It follows the money onto the payslip line. */}
      {additive && (
        <div className="mt-2">
          <label className="label">{t('Nimi', 'Name')}</label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={t('nt Igeme disain', 'e.g. Gum design')}
            className="input py-1.5 text-sm w-56"
          />
          <p className="text-[10px] text-ink-faint mt-1">
            {t('Kuvatakse töötasude real, et sarnaseid lisatasusid saaks eristada.', 'Shown on the payroll line so similar extras can be told apart.')}
          </p>
        </div>
      )}

      <p className="text-[10px] text-ink-faint mt-1.5">
        {RATE_KIND_HINT[kind]}
        {kind === 'tund' && autoHours && t(' Esmaspäevast reedeni; käsitsi sisestatud päev on ülimuslik.', ' Monday to Friday; a manually entered day takes precedence.')}
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
    if (!Number.isFinite(h) || h <= 0) { setError(t('Sisesta tundide arv.', 'Enter the number of hours.')); return }
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
        <Clock size={11} /> {t('Töötunnid', 'Work hours')}
      </h4>
      {mine.length === 0 ? (
        <p className="text-xs text-ink-faint mb-2">{t('Tunde ei ole sisestatud.', 'No hours entered.')}</p>
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
            <label className="label">{t('Kuupäev', 'Date')}</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input py-1.5 text-sm w-36" />
          </div>
          <div>
            <label className="label">{t('Tunde', 'Hours')}</label>
            <input
              type="number" min="0" max="24" step="0.25" value={value}
              onChange={e => setValue(e.target.value)}
              className="input py-1.5 text-sm w-20 text-right"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="label">{t('Märkus', 'Note')}</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="input py-1.5 text-sm" />
          </div>
          <button onClick={submit} disabled={add.isPending} className="btn-ghost border border-ink-faint/25 mb-0.5 disabled:opacity-50">
            <Plus size={13} /> {t('Lisa', 'Add')}
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
