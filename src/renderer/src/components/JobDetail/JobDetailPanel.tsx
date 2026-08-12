import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Trash2, Euro, Check, Calendar, Save, Loader2, Cpu, Calculator, Pencil, Zap, UserRound, Building2, ChevronDown, ChevronUp
} from 'lucide-react'
import type { Job, JobInput, StageKey, Revision } from '../../types/job'
import { MATERIAL_SHADES, jobWorkItems } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { stageChipStyle } from '../../config/pipeline'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { ShadePicker } from './ShadePicker'
import { RevisionBlock } from './RevisionBlock'
import { WorkItemsField } from './WorkItemsField'
import { RevisionEditFullscreen } from './RevisionEditFullscreen'
import { PatientPicker } from '../Patients/PatientPicker'
import { JobReadView } from './JobReadView'
import { JobTimeline } from './JobTimeline'
import { StatusPill } from '../ui/StatusPill'
import { useSettings, useWorkTypes, calcProduction, countSmallTeeth, countLargeTeeth, workTypePriceFor, priceBookOf } from '../../stores/useSettings'
import { quoteJob } from '@shared/pricing/quote'

const toothCountOf = (h: string) => h.split(',').filter(t => t.trim()).length
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { WorkerSelect } from './WorkerSelect'
import { useCustomers } from '../../hooks/useCustomers'
import { DELIVERY_LABEL } from '../../types/customer'
import { useMarkJobsPaid, usePayments } from '../../hooks/useInvoices'
import { useWorkerRates } from '../../hooks/useWorkerPay'
import { pickRateFor } from '../../lib/earnings'
import { jobMaterialCost } from '../../lib/finance'
import { workTypeConsumables } from '../../config/workTypes'
import { MarkPaidDialog } from './MarkPaidDialog'
import { workTypeImage } from '../../lib/workTypeImages'
import { normalizeDateTime } from '../../lib/dates'
import { DieShadePicker } from './DieShadePicker'

interface JobDetailPanelProps {
  job: Job | null       // null = create mode
  onClose: () => void
  onSave: (input: JobInput) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  saving?: boolean
  position?: 'side' | 'bottom' | 'fullscreen'  // default: side
  initialDate?: string           // pre-fill valmis_aeg for new jobs (ISO or datetime-local)
  highlightRevisionId?: string   // auto-expand + scroll to this revision on open
  highlightNoteId?: string       // scroll to + highlight this note on open
  onOpenPatient?: (patientId: string) => void
}

const EMPTY_FORM: JobInput = {
  status: 'disain',
  kuupaev: new Date().toISOString().split('T')[0],
  patsient: '',
  patient_id: null,
  customer_id: null,
  customer_ref: '',
  delivery_status: 'labor',
  delivered_at: null,
  too: '',
  kirjeldus: '',
  materjal: '',
  masina: '',
  print_id: '',
  disain_id: '',
  varv: '',
  kondivarv: '',
  hambad: '',
  work_items: [],
  extras: [],
  extra_costs: [],
  valmis_aeg: '',
  valmis_kuupaev: null,
  kiirtoo: false,
  mudel: false,
  mudel_id: '',
  revisions: [],
  hind: null,
  disain_hind: null,
  makstud: false,
  makse_kuupaev: '',
  assigned_to: null,
  designed_by: null
}

// ─── Worker select ────────────────────────────────────────────────────────────
// Reads the clinic's profiles. Empty is a real answer — plenty of work is done
// by someone who is not in the system, or outsourced, and forcing a name would
// put fictional people on payroll reports.
// ─── Customer select ──────────────────────────────────────────────────────────
// Archived customers are still shown when one is already selected, so opening
// an old job does not silently blank the practice it was ordered by.
function CustomerSelect({ value, onChange }: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const { data: customers = [] } = useCustomers()
  const options = customers.filter(c => !c.archived_at || c.id === value)
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Building2 size={11} /> Tellija
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="input"
      >
        <option value="">—</option>
        {options.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}{c.archived_at ? ' (arhiveeritud)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Pricing sub-component (shared between side + bottom layouts) ─────────────
function PricingBlock({ form, set, settings, smallCount, largeCount, prodPrice, hasCalc, onHindChange, useDiscount, onDiscountChange, onRequestMarkPaid, paidSoFar, allRates }: {
  form: JobInput
  set: <K extends keyof JobInput>(key: K, val: JobInput[K]) => void
  settings: ReturnType<typeof useSettings>['settings']
  smallCount: number
  largeCount: number
  prodPrice: number
  hasCalc: boolean
  onHindChange: (v: number | null) => void
  useDiscount: boolean
  onDiscountChange: (v: boolean) => void
  onRequestMarkPaid?: () => void
  paidSoFar: number
  allRates: import('../../lib/earnings').WorkerRate[]
}) {
  // Recomputed here rather than threaded in: this block is rendered by two
  // layouts, and a prop the two callers could set differently is a way for the
  // side panel and the bottom panel to disagree about the same job's price.
  const teeth = toothCountOf(form.hambad ?? '')
  const info = workTypePriceFor(form.too, settings.tooTuubid, teeth, useDiscount)
  const typePrice = info?.amount ?? null

  // Same reasoning as above: computed here, from the same function the
  // auto-price effect and the repricer call, rather than passed down.
  const unpriced = quoteJob({
    items: jobWorkItems({
      work_items: form.work_items,
      too: form.too,
      hambad: form.hambad,
    }).map(i => ({ too: i.too, hambad: i.hambad, materjal: i.materjal ?? null })),
    materjal: form.materjal,
    kiirtoo: form.kiirtoo,
    useDiscount,
  }, priceBookOf(settings)).unpriced

  return (
    <div className="border border-ink-faint/20 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-ink flex items-center gap-2">
        <Euro size={15} className="text-accent" />
        Hind ja maksmine
      </p>

      {/* The auto-price deliberately leaves the field alone when it cannot work
          a number out. Silence would read as "nothing to do here", so it says
          what is missing — otherwise the price is quietly whatever was typed. */}
      {unpriced.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Hinda ei arvutatud automaatselt
          </p>
          <ul className="mt-1 space-y-0.5">
            {unpriced.map((reason, i) => (
              <li key={i} className="text-[11px] text-ink-muted">· {reason}</li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-faint mt-1">
            Sisesta hind käsitsi või määra hind Seaded → Hinnad all.
          </p>
        </div>
      )}

      {hasCalc && (
        <div className="bg-bg-sidebar rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-ink-muted mb-2">Autoarvutus</p>
          {/* A work-type price replaces the per-tooth rows rather than adding to
              them — showing both would read as if they were summed. */}
          {typePrice != null && info ? (
            <>
              <div className="flex justify-between text-xs text-ink-muted">
                <span>
                  {info.mode === 'hammas'
                    ? `${teeth} × ${info.unit.toFixed(2)} € / hammas`
                    : `1 × ${form.too?.trim() || 'töö'} (hind töö kohta)`}
                </span>
                <span className="font-medium text-ink">{typePrice.toFixed(2)} €</span>
              </div>
              {info.hasDiscount && (
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onDiscountChange(false)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                      !useDiscount ? 'bg-accent text-white' : 'bg-ink-faint/20 text-ink-muted hover:text-ink'
                    }`}
                  >
                    Täishind
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscountChange(true)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                      useDiscount ? 'bg-accent text-white' : 'bg-ink-faint/20 text-ink-muted hover:text-ink'
                    }`}
                  >
                    Soodushind
                  </button>
                </div>
              )}
            </>
          ) : prodPrice > 0 && form.materjal && (
            <>
              {smallCount > 0 && (
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>{smallCount} × väike hammas</span>
                  <span className="font-medium text-ink">
                    {(smallCount * (settings.materialPrices[form.materjal]?.small ?? 0)).toFixed(2)} €
                  </span>
                </div>
              )}
              {largeCount > 0 && (
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>{largeCount} × suur hammas</span>
                  <span className="font-medium text-ink">
                    {(largeCount * (settings.materialPrices[form.materjal]?.large ?? 0)).toFixed(2)} €
                  </span>
                </div>
              )}
            </>
          )}
          {settings.designFee > 0 && (
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="flex items-center gap-1"><Pencil size={10} /> Disain</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{settings.designFee.toFixed(2)} €</span>
                <button
                  type="button"
                  onClick={() => set('disain_hind', form.disain_hind != null ? null : settings.designFee)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                    form.disain_hind != null
                      ? 'bg-accent text-white'
                      : 'bg-ink-faint/20 text-ink-muted hover:bg-accent/20 hover:text-accent'
                  }`}
                >
                  {form.disain_hind != null ? 'Lisatud ✓' : 'Lisa'}
                </button>
              </div>
            </div>
          )}
          {(prodPrice > 0 || form.disain_hind != null) && (() => {
            const base = prodPrice + (form.disain_hind ?? 0)
            const total = form.kiirtoo ? base * settings.kiirtooKordaja : base
            return (
              <>
                <div className="border-t border-ink-faint/20 pt-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1">
                    Kokku
                    {form.kiirtoo && (
                      <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">
                        {settings.kiirtooKordaja}×
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-accent">{total.toFixed(2)} €</span>
                </div>
                <button
                  type="button"
                  onClick={() => set('hind', total)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-accent hover:text-accent-dark font-semibold mt-1 py-1 rounded-lg hover:bg-accent/5 transition-colors"
                >
                  <Calculator size={11} />
                  Kanna hinna väljale
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* ── Cost breakdown — what this job costs the lab ── */}
      {(() => {
        const allHambad = form.work_items.length > 0
          ? form.work_items.map(i => i.hambad).filter(Boolean).join(',')
          : (form.hambad ?? '')
        const effectiveMaterjal = form.work_items.find(i => i.materjal)?.materjal ?? (form.materjal ?? '')
        const costMat = jobMaterialCost(
          { materjal: effectiveMaterjal, hambad: allHambad, masina: form.masina },
          settings.materialCosts, settings.materialPrices
        ) ?? 0
        const costTeeth = toothCountOf(allHambad)
        const today = new Date().toISOString().slice(0, 10)

        // Build work items for rate matching
        const workItems = form.work_items.length > 0
          ? form.work_items.map(i => ({ too: i.too, hambad: i.hambad }))
          : [{ too: form.too ?? '', hambad: allHambad }]

        const tId = form.assigned_to
        const tRates = tId ? allRates.filter(r => r.profile_id === tId) : []

        // Sum production rates across all work items
        type CostLine = { label: string; amount: number }
        const techLines: CostLine[] = []
        for (const item of workItems) {
          const tc = toothCountOf(item.hambad)
          const rate = tId ? pickRateFor(tRates, item.too, today, settings.tooTuubid, 'too') : null
          if (rate) {
            const amt = rate.kind === 'hammas' ? tc * rate.amount : rate.kind === 'too' ? rate.amount : 0
            if (amt > 0) techLines.push({ label: `${item.too}: ${tc} × ${rate.amount} €`, amount: amt })
          }
        }
        // Additive rules (e.g. "igeme disain" per tooth on Allon types)
        for (const r of tRates) {
          if (!r.additive || (r.applies_to ?? 'too') !== 'too') continue
          const covered = workItems.filter(i => {
            const rt = (r.work_type ?? '').toLowerCase()
            if (!rt) return true
            return rt.split('|').some(wt => i.too.toLowerCase().includes(wt.trim()))
          })
          if (covered.length === 0) continue
          const tc = covered.reduce((s, i) => s + toothCountOf(i.hambad), 0)
          const amt = r.kind === 'hammas' ? tc * r.amount : r.kind === 'too' ? r.amount * covered.length : 0
          if (amt > 0) techLines.push({ label: `${r.label || 'Lisatasu'}: ${tc} × ${r.amount} €`, amount: amt })
        }
        const tCost = Math.round(techLines.reduce((s, l) => s + l.amount, 0) * 100) / 100

        const dId = form.designed_by
        const dRates = dId ? allRates.filter(r => r.profile_id === dId) : []
        const designLines: CostLine[] = []
        for (const item of workItems) {
          const tc = toothCountOf(item.hambad)
          const rate = dId ? pickRateFor(dRates, item.too, today, settings.tooTuubid, 'disain') : null
          if (rate) {
            const amt = rate.kind === 'hammas' ? tc * rate.amount : rate.kind === 'too' ? rate.amount : 0
            if (amt > 0) designLines.push({ label: `${item.too}: ${tc} × ${rate.amount} €`, amount: amt })
          }
        }
        // Additive design rules
        for (const r of dRates) {
          if (!r.additive || (r.applies_to ?? 'too') !== 'disain') continue
          const covered = workItems.filter(i => {
            const rt = (r.work_type ?? '').toLowerCase()
            if (!rt) return true
            return rt.split('|').some(wt => i.too.toLowerCase().includes(wt.trim()))
          })
          if (covered.length === 0) continue
          const tc = covered.reduce((s, i) => s + toothCountOf(i.hambad), 0)
          const amt = r.kind === 'hammas' ? tc * r.amount : r.kind === 'too' ? r.amount * covered.length : 0
          if (amt > 0) designLines.push({ label: `${r.label || 'Lisatasu'}: ${tc} × ${r.amount} €`, amount: amt })
        }
        const dCost = Math.round(designLines.reduce((s, l) => s + l.amount, 0) * 100) / 100

        // Hourly cost from tund/kuu rate (for info)
        const tHourRate = tId ? tRates.find(r => r.kind === 'tund') : null
        const tMonthRate = tId ? tRates.find(r => r.kind === 'kuu') : null
        let tHourlyCost: number | null = null
        if (tHourRate) {
          tHourlyCost = tHourRate.amount
        } else if (tMonthRate && tMonthRate.hours_per_day && tMonthRate.work_days) {
          const daysPerWeek = tMonthRate.work_days.length
          const monthlyHours = daysPerWeek * 4.33 * tMonthRate.hours_per_day
          tHourlyCost = monthlyHours > 0 ? Math.round(tMonthRate.amount / monthlyHours * 100) / 100 : null
        }

        // Consumables (screws, abutments etc) from work type settings
        const items = form.work_items.length > 0 ? form.work_items : [{ too: form.too ?? '', hambad: allHambad }]
        const consumables = items.flatMap(i => {
          const tc = toothCountOf(i.hambad)
          return workTypeConsumables(i.too, settings.tooTuubid, tc).items
        })
        const consCost = consumables.reduce((s, c) => s + c.summa, 0)

        const adHocCost = (form.extra_costs ?? []).reduce((s, c) => s + (c.summa || 0), 0)
        const totalCost = Math.round((tCost + dCost + costMat + consCost + adHocCost) * 100) / 100
        if (totalCost === 0 && !tId && !dId) return null
        return (
          <div className="bg-bg-sidebar rounded-xl p-3 space-y-1">
            <p className="text-xs font-semibold text-ink-muted mb-1.5">Omahind (labori kulu)</p>
            {techLines.map((l, i) => (
              <div key={`t${i}`} className="flex justify-between text-xs text-ink-muted">
                <span className="truncate">{techLines.length === 1 ? 'Tehnik' : `Tehnik: ${l.label.split(':')[0]}`}</span>
                <span className="tabular-nums text-ink flex-shrink-0 ml-2">{l.amount.toFixed(2)} € <span className="text-ink-faint text-[10px]">{l.label.split(':').slice(1).join(':').trim()}</span></span>
              </div>
            ))}
            {tHourlyCost != null && (
              <div className="flex justify-between text-[10px] text-ink-faint">
                <span>Tehnik tunnihind</span>
                <span className="tabular-nums">{tHourlyCost.toFixed(2)} €/h</span>
              </div>
            )}
            {tId && tCost === 0 && !tHourlyCost && (
              <div className="text-[10px] text-ink-faint">Tehnikul puudub tasureegel</div>
            )}
            {designLines.map((l, i) => (
              <div key={`d${i}`} className="flex justify-between text-xs text-ink-muted">
                <span className="truncate">{designLines.length === 1 ? 'Disainija' : `Disain: ${l.label.split(':')[0]}`}</span>
                <span className="tabular-nums text-ink flex-shrink-0 ml-2">{l.amount.toFixed(2)} € <span className="text-ink-faint text-[10px]">{l.label.split(':').slice(1).join(':').trim()}</span></span>
              </div>
            ))}
            {costMat > 0 && (
              <div className="flex justify-between text-xs text-ink-muted">
                <span>Materjal</span>
                <span className="tabular-nums text-ink">{costMat.toFixed(2)} €</span>
              </div>
            )}
            {consumables.map((c, i) => (
              <div key={i} className="flex justify-between text-xs text-ink-muted">
                <span>{c.nimi}</span>
                <span className="tabular-nums text-ink">{c.summa.toFixed(2)} €</span>
              </div>
            ))}
            {/* Ad-hoc extra costs */}
            {(form.extra_costs ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-1 text-xs text-ink-muted">
                <input type="text" value={c.nimi}
                  onChange={e => {
                    const next = [...(form.extra_costs ?? [])]
                    next[i] = { ...next[i], nimi: e.target.value }
                    set('extra_costs', next)
                  }}
                  placeholder="Kulu nimi"
                  className="input py-0.5 px-1.5 text-xs flex-1 min-w-0"
                />
                <div className="relative w-20">
                  <input type="number" min="0" step="0.01" value={c.summa || ''}
                    onChange={e => {
                      const next = [...(form.extra_costs ?? [])]
                      next[i] = { ...next[i], summa: parseFloat(e.target.value) || 0 }
                      set('extra_costs', next)
                    }}
                    className="input py-0.5 px-1.5 pr-5 text-xs text-right"
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-ink-faint pointer-events-none">€</span>
                </div>
                <button type="button" onClick={() => set('extra_costs', (form.extra_costs ?? []).filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-500 text-xs px-0.5">×</button>
              </div>
            ))}
            <button type="button" onClick={() => set('extra_costs', [...(form.extra_costs ?? []), { nimi: '', summa: 0 }])}
              className="text-[10px] text-accent hover:text-accent/80 font-medium">
              + Lisa kulu
            </button>

            <div className="flex justify-between text-xs border-t border-ink-faint/15 pt-1 mt-1">
              <span className="font-semibold text-ink">Kokku kulu</span>
              <span className="font-bold text-red-500 tabular-nums">{totalCost.toFixed(2)} €</span>
            </div>
            {(form.hind ?? 0) > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Kate</span>
                <span className={`font-semibold tabular-nums ${(form.hind ?? 0) - totalCost >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {((form.hind ?? 0) - totalCost).toFixed(2)} € ({totalCost > 0 && (form.hind ?? 0) > 0 ? `${(((form.hind ?? 0) - totalCost) / (form.hind ?? 1) * 100).toFixed(0)}%` : '—'})
                </span>
              </div>
            )}
          </div>
        )
      })()}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Hind kokku (€)</label>
          <input
            type="number" step="0.01" min="0"
            value={form.hind ?? ''}
            onChange={e => {
              onHindChange(e.target.value === '' ? null : parseFloat(e.target.value))
            }}
            placeholder="0.00" className="input"
          />
        </div>
        <div>
          <label className="label flex items-center gap-1">
            <Pencil size={10} /> Disain hind (€)
          </label>
          <input
            type="number" step="0.01" min="0"
            value={form.disain_hind ?? ''}
            onChange={e => set('disain_hind', e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder="0.00" className="input"
          />
        </div>
      </div>

      <div className="flex flex-col">
        <label className="label">Makstud</label>
        <button
          type="button"
          onClick={() => {
            // Turning it ON asks for the method; turning it OFF is just a
            // correction and needs nothing.
            if (form.makstud) { set('makstud', false); set('makse_kuupaev', '') }
            else onRequestMarkPaid?.()
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all duration-150 ${
            form.makstud
              ? 'bg-green-50 border-green-400 text-green-700'
              : 'bg-bg-sidebar border-ink-faint/30 text-ink-muted hover:border-ink-faint/60'
          }`}
        >
          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
            form.makstud ? 'bg-green-500 border-green-500' : 'border-ink-faint'
          }`}>
            {form.makstud && <Check size={10} className="text-white" />}
          </span>
          {form.makstud ? 'Makstud' : 'Maksmata'}
        </button>
        {/* A job can be unpaid by the flag and still have money against it. */}
        {paidSoFar > 0 && !form.makstud && (
          <p className="text-[11px] text-amber-600 mt-1 leading-relaxed">
            Osaliselt makstud: laekunud {paidSoFar.toFixed(2)} €
          </p>
        )}
      </div>

      {form.makstud && (
        <div>
          <label className="label flex items-center gap-1">
            <Calendar size={11} /> Makse kuupäev
          </label>
          <input
            type="date"
            value={form.makse_kuupaev ?? ''}
            onChange={e => set('makse_kuupaev', e.target.value)}
            className="input"
          />
        </div>
      )}
    </div>
  )
}

export function JobDetailPanel({ job, onClose, onSave, onDelete, saving, position = 'side', initialDate, highlightRevisionId, highlightNoteId, onOpenPatient }: JobDetailPanelProps) {
  const isBottom = position === 'bottom'
  const isFullscreen = position === 'fullscreen'
  // Both bottom and fullscreen are sheets: they rise from the bottom edge and
  // stop short of the top, so the blurred page underneath stays visible and the
  // panel keeps reading as something layered over your work, not a new screen.
  // They differ only in how far up they go.
  const isSheet = isBottom || isFullscreen
  const { settings } = useSettings()
  const wt = useWorkTypes()
  // Full price vs the type's discount price. Per job, not a setting: the person
  // filling the form is the one who knows whether this case is discounted.
  const [useDiscount, setUseDiscount] = useState(false)
  // Marking paid always asks HOW — see MarkPaidDialog.
  const [paidDialog, setPaidDialog] = useState(false)
  const markPaid = useMarkJobsPaid()
  const { data: jobPayments = [] } = usePayments()
  const { data: workerRates = [] } = useWorkerRates()
  const { stages, doneStageKey } = usePipeline()
  const [form, setForm] = useState<JobInput>(EMPTY_FORM)
  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(null)
  const [editingRevId, setEditingRevId] = useState<string | null>(null)
  // Revision overlay on read view: '__new__' = add, revision id = edit, null = hidden
  const [quickRevisionId, setQuickRevisionId] = useState<string | null>(null)
  const [showAllTypes, setShowAllTypes] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  // Opening an existing job shows it, it does not offer to change it. A new job
  // has nothing to look at, so it starts in the form.
  const [editing, setEditing] = useState(job == null)
  // Which variant the read view is showing: null = the original job, otherwise a
  // revision id. Seeded from the row that was clicked, so opening a "-M1" line
  // from the patient history lands on that revision instead of the original.
  const [activeRevId, setActiveRevId] = useState<string | null>(highlightRevisionId ?? null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Auto-price mode: on for new jobs OR existing jobs with no price set
  const hindAutoRef = useRef(false)

  // Populate form when job changes
  useEffect(() => {
    hindAutoRef.current = job ? job.hind == null : true  // auto on if no price exists yet
    if (job) {
      // Migrate legacy single-revision fields into revisions array
      let revisions: Revision[] = job.revisions ?? []
      if (revisions.length === 0 && job.muudatused) {
        revisions = [{
          id: crypto.randomUUID(),
          ts: job.updated_at,
          note: job.muudatused,
          hambad: job.rev_hambad ?? undefined,
          varv: job.rev_varv ?? undefined,
          deadline: job.uus_valmis ?? undefined,
        }]
      }

      setForm({
        status: job.status,
        kuupaev: job.kuupaev,
        patsient: job.patsient,
        patient_id: job.patient_id ?? null,
        customer_id: job.customer_id ?? null,
        customer_ref: job.customer_ref ?? '',
        delivery_status: job.delivery_status ?? 'labor',
        delivered_at: job.delivered_at ?? null,
        too: job.too ?? '',
        kirjeldus: job.kirjeldus ?? '',
        materjal: job.materjal ?? '',
        masina: job.masina ?? '',
        print_id: job.print_id ?? '',
        disain_id: job.disain_id ?? '',
        varv: job.varv ?? '',
        kondivarv: job.kondivarv ?? '',
        hambad: job.hambad ?? '',
        work_items: Array.isArray(job.work_items) ? job.work_items.map(i => ({ ...i })) : [],
        extras: Array.isArray(job.extras) ? job.extras.map(e => ({ ...e })) : [],
        // Was missing entirely, so opening a saved job blanked its ad-hoc costs
        // in the form. They survived in the DB only until the next edit added
        // one — then the save wrote a one-item list over the lot.
        extra_costs: Array.isArray(job.extra_costs) ? job.extra_costs.map(c => ({ ...c })) : [],
        valmis_aeg: job.valmis_aeg ? job.valmis_aeg.replace('Z', '').slice(0, 16) : '',
        valmis_kuupaev: job.valmis_kuupaev ?? null,
        kiirtoo: job.kiirtoo ?? false,
        mudel: job.mudel ?? false,
        mudel_id: job.mudel_id ?? '',
        revisions,
        hind: job.hind,
        disain_hind: job.disain_hind ?? null,
        assigned_to: job.assigned_to ?? null,
        designed_by: job.designed_by ?? null,
        makstud: job.makstud,
        makse_kuupaev: job.makse_kuupaev ?? ''
      })
    } else {
      setForm({
        ...EMPTY_FORM,
        masina: settings.defaultMachine ?? '',
        valmis_aeg: initialDate ?? '',
      })
    }
    setDeleteConfirm(false)
    setEditing(job == null)
    setActiveRevId(highlightRevisionId ?? null)
  // Keyed on the job ID, not the object: adding a note refetches `jobs` and hands
  // us a new object for the same job. Re-running on that would reset the variant
  // selection and, mid-edit, overwrite the form with server values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, highlightRevisionId])

  const set = useCallback(<K extends keyof JobInput>(key: K, val: JobInput[K]) => {
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  // What this job is worth, by the same rules the repricer and the web order
  // form use — see shared/pricing/quote.ts. Every work item is priced on its
  // own, so a job holding crowns AND a bridge is the sum of both rather than
  // one type spread across all the teeth.
  const quote = useMemo(() => quoteJob({
    items: jobWorkItems({
      work_items: form.work_items,
      too: form.too,
      hambad: form.hambad,
    }).map(i => ({ too: i.too, hambad: i.hambad, materjal: i.materjal ?? null })),
    materjal: form.materjal,
    kiirtoo: form.kiirtoo,
    useDiscount,
  }, priceBookOf(settings)),
  [form.work_items, form.too, form.hambad, form.materjal, form.kiirtoo, useDiscount, settings])

  // Live auto-price (new jobs only). Leaves the field ALONE when any part of
  // the job cannot be priced: this used to write `teeth * hambaHind` even when
  // that rate was 0, stamping a free job onto the record. A gap is not a price.
  useEffect(() => {
    if (!hindAutoRef.current) return
    if (quote.unpriced.length > 0) return
    if (quote.production === 0) return
    set('hind', quote.production)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.production, quote.unpriced.length])

  // Auto-calculate: small teeth + large teeth from settings, plus design fee
  // The revision currently being viewed, if any — drives both the timeline and
  // the read view so they never disagree about what is on screen.
  const activeRev = job && activeRevId
    ? (job.revisions ?? []).find(r => r.id === activeRevId) ?? null
    : null

  const hambad = form.hambad ?? ''
  const smallCount = countSmallTeeth(hambad)
  const largeCount = countLargeTeeth(hambad)
  const typePriceInfo = workTypePriceFor(form.too, settings.tooTuubid, toothCountOf(hambad), useDiscount)
  const prodPrice = typePriceInfo?.amount ?? (form.materjal
    ? calcProduction(hambad, form.materjal, settings.materialPrices)
    : 0)
  const hasCalc = prodPrice > 0 || settings.designFee > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    const cleaned: JobInput = {
      ...form,
      // Sync denormalized too/hambad from work_items if items exist
      too: form.work_items.length > 0
        ? form.work_items[0].too
        : (form.too || null),
      hambad: form.work_items.length > 0
        ? [...new Set(form.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || null
        : (form.hambad || null),
      work_items: form.work_items,
      kirjeldus: form.kirjeldus || null,
      materjal: (form.work_items.length > 1
        ? form.work_items[0]?.materjal ?? form.materjal
        : form.materjal) || null,
      masina: (form.work_items.length > 1
        ? form.work_items[0]?.masina ?? form.masina
        : form.masina) || null,
      print_id: form.print_id || null,
      disain_id: form.disain_id || null,
      // Follows the flag. The field is only on screen while Mudel is on, so
      // keeping a value after it is switched off would store an ID for a model
      // this job no longer has — invisible in the form, visible in the export.
      mudel_id: form.mudel ? (form.mudel_id || null) : null,
      varv: form.varv || null,
      kondivarv: form.kondivarv || null,
      // Store as-is — no UTC conversion. The user types local time and expects
      // to see it back unchanged. toISOString() shifts by the timezone offset.
      //
      // Normalised rather than passed through: the column is text, so nothing
      // downstream rejects a malformed timestamp, and one bad row was enough to
      // crash every view that formatted it. The widget above can no longer
      // produce one — this is the backstop for anything that still could.
      valmis_aeg: normalizeDateTime(form.valmis_aeg),
      disain_hind: form.disain_hind,
      // Clear legacy fields on save
      muudatused: null,
      rev_hambad: null,
      rev_varv: null,
      uus_valmis: null,
      makse_kuupaev: form.makse_kuupaev || null
    } as JobInput
    try {
      await onSave(cleaned)
      // Existing job: return to read view instead of closing
      if (job) {
        setEditing(false)
      }
    } catch (err: unknown) {
      setSaveError((err as Error)?.message ?? 'Salvestamine ebaõnnestus')
    }
  }

  async function handleDelete() {
    if (!job || !onDelete) return
    await onDelete(job.id)
    onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        key="panel"
        initial={isSheet ? { y: '100%' } : { x: '100%' }}
        animate={isSheet ? { y: 0 } : { x: 0 }}
        exit={isSheet ? { y: '100%' } : { x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className={
          isFullscreen
            ? 'fixed left-0 right-0 bottom-0 top-8 bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-ink-faint/15'
            : isBottom
              ? 'fixed left-0 right-0 bottom-0 h-panel bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-ink-faint/15'
              : 'fixed right-0 top-0 bottom-0 w-[680px] bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden'
        }
        onClick={e => e.stopPropagation()}
      >
        {/* Work-type colour strip — sheets only, where there is a top edge to
            crown. Colour comes from Seaded → Valikud, same source as the
            calendar and the legend. */}
        {isSheet && (
          <div
            className="h-1.5 flex-shrink-0 rounded-t-2xl"
            style={{ backgroundColor: wt.hex(job?.too ?? form.too) }}
          />
        )}

        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-faint/20 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="text-base font-semibold text-ink truncate">
                {!job ? 'Uus töö' : editing ? 'Muuda tööd' : (job.too || 'Töö')}
                {job && !editing && !activeRev && job.print_id && (
                  <span className="text-ink-muted font-normal"> · {job.print_id}</span>
                )}
                {activeRev && !editing && (
                  <span className="text-accent font-normal">
                    {' '}· muudatus {(job?.revisions ?? []).findIndex(r => r.id === activeRev.id) + 1}
                  </span>
                )}
              </h2>
              {job && <StatusPill status={activeRev?.status ?? job.status} />}
            </div>
            {/* Identity line: who, what, when — the three things you check first */}
            {job && !editing && (
              <div className="flex items-center gap-3 mt-1 text-xs text-ink-muted min-w-0">
                <span className="truncate">{job.patsient}</span>
                {(() => {
                  const t = (activeRev ? activeRev.hambad : job.hambad) ?? ''
                  const n = t.split(',').filter(x => x.trim()).length
                  return n > 0 ? <span className="whitespace-nowrap">{n} hammast</span> : null
                })()}
                <span className="whitespace-nowrap">
                  {activeRev
                    ? (activeRev.ts ?? '').slice(0, 10).split('-').reverse().join('.')
                    : (job.kuupaev ? job.kuupaev.split('-').reverse().join('.') : '')}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {job && onDelete && (
              deleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Kustutada?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    Jah
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded-lg transition-colors"
                  >
                    Ei
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="btn-ghost text-red-400 hover:text-red-600 hover:bg-red-50 p-2"
                >
                  <Trash2 size={15} />
                </button>
              )
            )}
            {job && !editing && (
              <button type="button" onClick={() => {
                if (activeRev) {
                  setQuickRevisionId(activeRev.id)
                } else {
                  setEditing(true)
                }
              }} className="btn-ghost">
                <Pencil size={14} />
                {activeRev ? 'Muuda muudatust' : 'Muuda'}
              </button>
            )}
            {/* Save/Cancel in header when editing */}
            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => (job ? setEditing(false) : onClose())}
                  className="btn-ghost text-sm"
                >
                  Tühista
                </button>
                <button
                  type="submit"
                  form="job-form"
                  disabled={saving || !form.patsient}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {job ? 'Salvesta' : 'Loo töö'}
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="btn-ghost p-2">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Read-only view of an existing job — the form is one click away */}
        {job && !editing ? (
          <>
            <div className="flex-1 overflow-y-auto bg-nav-bg">
              <JobTimeline
                job={job}
                status={activeRev?.status ?? job.status}
                finishedAt={activeRev ? (activeRev.deadline ?? null) : undefined}
              />
              <JobReadView
                job={job}
                isBottom={isBottom}
                activeRevisionId={activeRevId}
                onSelectVariant={setActiveRevId}
                highlightNoteId={highlightNoteId}
                onOpenPatient={onOpenPatient}
                onMarkPaid={() => setPaidDialog(true)}
                onAddRevision={() => setQuickRevisionId('__new__')}
                onDuplicate={() => {
                  setForm(f => ({
                    ...f,
                    ...job,
                    revisions: [],
                    makstud: false,
                    makse_kuupaev: null,
                    valmis_kuupaev: null,
                    status: stages[0]?.key ?? 'disain',
                    kuupaev: new Date().toISOString().split('T')[0],
                  }))
                  setEditing(true)
                }}
              />
            </div>
          </>
        ) : (
        /* Scrollable form body */
        <form id="job-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className={
            isFullscreen
              ? 'px-6 py-5 grid grid-cols-[1fr_minmax(400px,2fr)_1fr] gap-x-6 items-start'
              : isBottom
                ? 'px-6 py-5 grid grid-cols-2 gap-x-8 items-start'
                : 'px-6 py-5 space-y-5'
          }>

            {/* ── LEFT / SINGLE COLUMN ── metadata fields */}
            <div className="space-y-5">

              {/* Status */}
              <div>
                <label className="label">Staatus</label>
                <div className="flex flex-wrap gap-1.5">
                  {stages.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        status: s.key as StageKey,
                        // Fill the completion date the moment the job lands on
                        // the done stage, so it is visible and correctable here
                        // rather than being stamped invisibly on save. Never
                        // cleared on the way back out — a date that was true
                        // once does not stop being true because someone
                        // reopened the job.
                        valmis_kuupaev: s.key === doneStageKey && !f.valmis_kuupaev
                          ? new Date().toISOString().slice(0, 10)
                          : f.valmis_kuupaev,
                      }))}
                      // Selected state comes from the stage's hex, so a recoloured
                      // stage reads the same here as on the board and in the pills.
                      style={form.status === s.key ? stageChipStyle(s.hex) : undefined}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all duration-100 ${
                        form.status === s.key
                          ? 'border-current'
                          : 'bg-bg-sidebar text-ink-muted border-transparent hover:border-ink-faint/40'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kiirtöö + Mudel toggles */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => set('kiirtoo', !form.kiirtoo)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all duration-150 ${
                    form.kiirtoo
                      ? 'bg-orange-50 border-orange-400 text-orange-700'
                      : 'bg-bg-sidebar border-ink-faint/30 text-ink-muted hover:border-ink-faint/60'
                  }`}
                >
                  <Zap size={14} className={form.kiirtoo ? 'text-orange-500 fill-orange-400' : ''} />
                  {/* The multiplier is configurable (Seaded → Hinnad). A fixed
                      "2×" here contradicted the price the same panel shows. */}
                  {form.kiirtoo ? `Kiirtöö — hind ${settings.kiirtooKordaja}×` : 'Kiirtöö'}
                </button>
                <button
                  type="button"
                  onClick={() => set('mudel', !form.mudel)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all duration-150 ${
                    form.mudel
                      ? 'bg-amber-50 border-amber-400 text-amber-700'
                      : 'bg-bg-sidebar border-ink-faint/30 text-ink-muted hover:border-ink-faint/60'
                  }`}
                >
                  <Cpu size={14} className={form.mudel ? 'text-amber-500' : ''} />
                  {form.mudel ? `Mudel${settings.mudeliHind > 0 ? ` — ${settings.mudeliHind}€` : ''}` : 'Mudel'}
                </button>
              </div>

              {/* Mudel ID — right under the toggle that creates it, not down in
                  the Print ID / Disain ID pair: the model is a separate print
                  with its own job number, and it only exists while Mudel is on. */}
              {form.mudel && (
                <div>
                  <label className="label">Mudel ID</label>
                  <input
                    type="text"
                    value={form.mudel_id ?? ''}
                    onChange={e => set('mudel_id', e.target.value)}
                    placeholder="Mudeli töö nr…"
                    className="input font-mono"
                  />
                </div>
              )}

              {/* Kuupäev + Tähtaeg + Kellaaeg */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <div>
                  <label className="label">Kuupäev</label>
                  <input
                    type="date"
                    value={form.kuupaev}
                    onChange={e => set('kuupaev', e.target.value)}
                    required
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Tähtaeg</label>
                  <input
                    type="date"
                    value={(form.valmis_aeg ?? '').split('T')[0] || ''}
                    onChange={e => {
                      const time = (form.valmis_aeg ?? '').split('T')[1] || '12:00'
                      set('valmis_aeg', e.target.value ? `${e.target.value}T${time}` : '')
                    }}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Kell</label>
                  {/* Was a free-text box that wrote every keystroke straight into
                      `valmis_aeg` — so typing "12:00" stored `…T1`, then `…T12`,
                      and whichever half-finished string was there on save stayed
                      in the row. `valmis_aeg` is a text column, so Postgres took
                      it, and every view that later formatted that job threw
                      "Invalid time value". A native time input can only produce
                      a complete HH:MM or nothing, which is what the wizard's
                      deadline field already used. */}
                  <input
                    type="time"
                    value={(form.valmis_aeg ?? '').split('T')[1]?.slice(0, 5) || ''}
                    onChange={e => {
                      const date = (form.valmis_aeg ?? '').split('T')[0]
                      if (!date) return
                      set('valmis_aeg', `${date}T${e.target.value || '12:00'}`)
                    }}
                    className="input w-[110px]"
                  />
                </div>
              </div>

              {/* Patsient */}
              <PatientPicker
                name={form.patsient}
                patientId={form.patient_id}
                onChange={(nimi, pid) => setForm(f => ({ ...f, patsient: nimi, patient_id: pid }))}
                required
              />

              {/* Who ordered it. The customer is the paying party — the patient
                  is who the work is for. A lab bills the practice, not the
                  person in the chair, so these are two different questions. */}
              <div className="grid grid-cols-2 gap-3">
                <CustomerSelect
                  value={form.customer_id}
                  onChange={id => set('customer_id', id)}
                />
                <div>
                  <label className="label">Tellija viide</label>
                  <input
                    value={form.customer_ref ?? ''}
                    onChange={e => set('customer_ref', e.target.value || null)}
                    placeholder="nt A-2291"
                    className="input"
                  />
                  <p className="text-[10px] text-ink-faint mt-1">
                    Kliiniku enda juhtumi number. Ainus viide, mida jälgimislink näitab.
                  </p>
                </div>
              </div>

              {/* Everything that only exists once the bench is finished.
                  Shown at the done stage and nowhere else: on work still in
                  progress a completion date is a guess and a handover state is
                  noise, and asking for either at that point was the thing that
                  made this form confusing. */}
              {form.status === doneStageKey && (
                <div className="rounded-xl border border-ink-faint/25 bg-bg-sidebar/40 p-3 space-y-3">
                  <p className="text-xs font-semibold text-ink-soft">Valmis</p>

                  {/* The date payroll pays on. It is stamped automatically when
                      the job reaches this stage, but it was never editable —
                      so a job finished on the 30th could not be moved into the
                      next month's wages, which is a correction a lab makes. */}
                  <div>
                    <label className="label">Valmimiskuupäev</label>
                    <input
                      type="date"
                      value={form.valmis_kuupaev ?? ''}
                      onChange={e => set('valmis_kuupaev', e.target.value || null)}
                      className="input w-auto"
                    />
                    <p className="text-[10px] text-ink-faint mt-1">
                      Millal töö päriselt valmis sai. Töötasu arvestatakse selle kuupäeva järgi,
                      mitte tähtaja järgi.
                    </p>
                  </div>

                  {/* Where the work physically is. The pipeline ending here says
                      the bench has finished with it — not that the practice has
                      it in their hands. Those are different days. */}
                  <div>
                    <label className="label">Väljastus</label>
                    <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
                      {(['labor', 'teel', 'yle_antud'] as const).map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            delivery_status: d,
                            // Stamped when it leaves, cleared if that is undone —
                            // a handover date on work still at the lab is a lie.
                            delivered_at: d === 'yle_antud'
                              ? (f.delivered_at ?? new Date().toISOString())
                              : null,
                          }))}
                          className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                            form.delivery_status === d ? 'chip-active' : 'text-ink-muted hover:text-ink'
                          }`}
                        >
                          {DELIVERY_LABEL[d]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Töö — multi-select grid (in fullscreen, this moves to center column) */}
              <div className={isFullscreen ? 'hidden' : ''}>
                <label className="label">Töö tüüp (vali üks või mitu)</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {(showAllTypes || form.work_items.length === 0
                    ? settings.tooTuubid
                    : settings.tooTuubid.filter(t => form.work_items.some(i => i.too === t.nimi))
                  ).map(t => {
                    const hasItem = form.work_items.some(i => i.too === t.nimi)
                    const img = workTypeImage(t.nimi, t.pilt)
                    return (
                      <button
                        key={t.nimi}
                        type="button"
                        onClick={() => {
                          if (hasItem) {
                            const next = form.work_items.filter(i => i.too !== t.nimi)
                            setForm(f => ({ ...f, work_items: next, too: next[0]?.too ?? '' }))
                          } else {
                            const isBridge = /sild|bridge/i.test(t.nimi)
                            const item = { id: crypto.randomUUID(), too: t.nimi, hambad: '', ...(isBridge ? { bridge: true } : {}) }
                            const next = [...form.work_items, item]
                            setForm(f => ({ ...f, work_items: next, too: next[0]?.too ?? t.nimi }))
                          }
                        }}
                        className={`relative rounded-xl border-2 overflow-hidden text-center transition-all duration-150 ${
                          hasItem
                            ? 'border-accent bg-accent/5 shadow-card'
                            : 'border-ink-faint/25 bg-white hover:border-accent/40 hover:shadow-sm'
                        }`}
                      >
                        {hasItem && (
                          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center z-10">
                            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </span>
                        )}
                        <span className="flex h-14 items-center justify-center p-1.5">
                          {img
                            ? <img src={img} alt="" className="h-full object-contain" />
                            : <span className="w-5 h-5 rounded-full" style={{ backgroundColor: t.hex }} />}
                        </span>
                        <span className={`block px-1 pb-1.5 text-[11px] font-semibold truncate ${
                          hasItem ? 'text-accent' : 'text-ink'
                        }`}>
                          {t.nimi}
                        </span>
                        {t.hind != null && (
                          <span className={`block px-1 pb-1 text-[9px] tabular-nums ${
                            hasItem ? 'text-accent/70' : 'text-ink-faint'
                          }`}>
                            {t.hind.toFixed(0)} € / {t.hinnaTyyp === 'hammas' ? 'hammas' : 'töö'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {form.work_items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllTypes(!showAllTypes)}
                    className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-lg transition-colors mb-2"
                  >
                    {showAllTypes ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAllTypes ? 'Peida' : `Näita kõiki (${settings.tooTuubid.length})`}
                  </button>
                )}

                {/* Selected types as chips — click to activate, + to duplicate */}
                {form.work_items.length > 0 && (() => {
                  // Count instances per type for numbering (Sild 1, Sild 2)
                  const typeCountMap = new Map<string, number>()
                  form.work_items.forEach(i => typeCountMap.set(i.too, (typeCountMap.get(i.too) ?? 0) + 1))
                  const typeSeenMap = new Map<string, number>()

                  return (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {form.work_items.map(item => {
                      const hex = settings.tooTuubid.find(t => t.nimi === item.too)?.hex ?? '#94A3B8'
                      const isActive = item.id === activeWorkItemId
                      const teethCount = item.hambad.split(',').filter(t => t.trim()).length
                      const typeTotal = typeCountMap.get(item.too) ?? 1
                      const seen = (typeSeenMap.get(item.too) ?? 0) + 1
                      typeSeenMap.set(item.too, seen)
                      const label = typeTotal > 1 ? `${item.too} ${seen}` : item.too

                      return (
                        <div key={item.id} className="flex items-center gap-0">
                          <button
                            type="button"
                            onClick={() => setActiveWorkItemId(isActive ? null : item.id)}
                            className={`flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1.5 py-1.5 rounded-l-lg border-2 border-r-0 transition-all ${
                              isActive
                                ? 'border-accent bg-accent/10'
                                : 'border-transparent hover:border-ink-faint/30'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}15` }}
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                            <span style={{ color: isActive ? '#0AB6C4' : hex }}>{label}</span>
                            {teethCount > 0 && (
                              <span className="text-[10px] text-ink-faint">{teethCount}</span>
                            )}
                            {item.materjal && (
                              <span className="text-[9px] text-ink-faint bg-bg-sidebar/50 px-1 py-0.5 rounded truncate max-w-[80px]">
                                {item.materjal}
                              </span>
                            )}
                            {/* Bridge toggle */}
                            <span
                              role="button"
                              onClick={e => {
                                e.stopPropagation()
                                setForm(f => ({
                                  ...f,
                                  work_items: f.work_items.map(i => i.id === item.id ? { ...i, bridge: !i.bridge } : i)
                                }))
                              }}
                              title={item.bridge ? 'Eemalda silla märge' : 'Märgi sillaks'}
                              className={`text-[10px] px-1 py-0.5 rounded transition-colors ${
                                item.bridge ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink-muted'
                              }`}
                            >
                              {item.bridge ? '⛓ sild' : '⛓'}
                            </span>
                          </button>
                          {/* + add another / × remove */}
                          <button
                            type="button"
                            title={`Lisa veel üks ${item.too}`}
                            onClick={e => {
                              e.stopPropagation()
                              const newItem = { id: crypto.randomUUID(), too: item.too, hambad: '', ...(item.bridge ? { bridge: true } : {}) }
                              setForm(f => {
                                const idx = f.work_items.findIndex(i => i.id === item.id)
                                const next = [...f.work_items]
                                next.splice(idx + 1, 0, newItem)
                                return { ...f, work_items: next }
                              })
                              setActiveWorkItemId(newItem.id)
                            }}
                            className={`text-[10px] font-bold px-1 py-1.5 border-2 border-l-0 transition-colors ${
                              isActive
                                ? 'border-accent bg-accent/5 text-accent hover:bg-accent/15'
                                : 'border-transparent text-ink-faint hover:text-ink-muted'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            title="Eemalda"
                            onClick={e => {
                              e.stopPropagation()
                              setForm(f => {
                                const next = f.work_items.filter(i => i.id !== item.id)
                                return { ...f, work_items: next, too: next[0]?.too ?? '' }
                              })
                              if (activeWorkItemId === item.id) setActiveWorkItemId(null)
                            }}
                            className={`text-[10px] font-bold px-1 py-1.5 rounded-r-lg border-2 border-l-0 transition-colors ${
                              isActive
                                ? 'border-accent bg-accent/5 text-red-400 hover:text-red-500 hover:bg-red-50'
                                : 'border-transparent text-ink-faint hover:text-red-400'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                    <p className="text-[10px] text-ink-faint">
                      {activeWorkItemId ? 'Klõpsa hammastel' : 'Vali tüüp, et hambaid märkida'}
                    </p>
                  </div>
                  )
                })()}

                {/* Shared odontogram for all work items (hidden in fullscreen — shown in center column) */}
                {!isFullscreen && form.work_items.length > 0 && (
                  <div className="bg-bg-sidebar rounded-xl p-3">
                    <MultiOdontogramPicker
                      items={form.work_items}
                      activeItemId={activeWorkItemId}
                      colorMap={Object.fromEntries(settings.tooTuubid.map(t => [t.nimi, t.hex]))}
                      onToggleTooth={tooth => {
                        if (!activeWorkItemId) return
                        const s = String(tooth)
                        // Check if tooth belongs to another item
                        const otherOwner = form.work_items.find(i => i.id !== activeWorkItemId && i.hambad.split(',').map(t => t.trim()).includes(s))
                        if (otherOwner) return // tooth belongs to another item — don't steal it
                        setForm(f => ({
                          ...f,
                          work_items: f.work_items.map(item => {
                            if (item.id !== activeWorkItemId) return item
                            const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
                            teeth.has(s) ? teeth.delete(s) : teeth.add(s)
                            return { ...item, hambad: [...teeth].join(',') }
                          })
                        }))
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Kirjeldus */}
              <div>
                <label className="label">Kirjeldus</label>
                <textarea
                  value={form.kirjeldus ?? ''}
                  onChange={e => set('kirjeldus', e.target.value)}
                  placeholder="Töö kirjeldus…"
                  rows={2}
                  className="input resize-none"
                />
              </div>

              {/* Materjal — per-work-item when items exist, otherwise global */}
              <div>
                {(() => {
                  const activeItem = form.work_items.find(i => i.id === activeWorkItemId)
                  const hasItems = form.work_items.length > 1
                  const currentMat = hasItems && activeItem ? (activeItem.materjal ?? '') : (form.materjal ?? '')
                  const setMat = (val: string) => {
                    if (hasItems && activeItem) {
                      setForm(f => ({
                        ...f,
                        work_items: f.work_items.map(i => i.id === activeItem.id ? { ...i, materjal: val || undefined } : i),
                        materjal: f.work_items[0]?.id === activeItem.id ? val : f.materjal,
                      }))
                    } else {
                      set('materjal', val)
                    }
                  }
                  const sortedMats = [...settings.materjalid].sort((a, b) => b.length - a.length)
                  const baseMat = sortedMats.find(m => currentMat === m || currentMat.startsWith(m + ' ')) ?? null
                  const shades = baseMat ? MATERIAL_SHADES[baseMat] : undefined
                  const currentShade = baseMat && currentMat !== baseMat ? currentMat.slice(baseMat.length + 1) : null
                  return (
                    <>
                      <label className="label">
                        Materjal
                        {hasItems && activeItem && (
                          <span className="text-accent font-normal ml-1">
                            — {activeItem.too}
                          </span>
                        )}
                        {hasItems && !activeItem && (
                          <span className="text-ink-faint font-normal ml-1">— vali tööosa</span>
                        )}
                      </label>
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {settings.materjalid.map(m => {
                          const active = baseMat === m
                          return (
                            <button
                              key={m}
                              type="button"
                              disabled={hasItems && !activeItem}
                              onClick={() => setMat(active ? '' : m)}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-100 font-medium ${
                                active
                                  ? 'bg-accent text-white border-accent'
                                  : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                              } disabled:opacity-30 disabled:cursor-not-allowed`}
                            >
                              {m}
                            </button>
                          )
                        })}
                      </div>
                      {shades && (
                        <div className="flex items-center gap-1.5 flex-wrap mb-2 pl-1">
                          <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-wide">Toon:</span>
                          {shades.map(shade => (
                            <button
                              key={shade}
                              type="button"
                              onClick={() => setMat(currentShade === shade ? baseMat! : `${baseMat} ${shade}`)}
                              className={`text-xs px-2 py-0.5 rounded border transition-all duration-100 font-medium ${
                                currentShade === shade
                                  ? 'bg-accent text-white border-accent'
                                  : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                              }`}
                            >
                              {shade}
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        value={currentMat}
                        disabled={hasItems && !activeItem}
                        onChange={e => setMat(e.target.value)}
                        placeholder={hasItems && !activeItem ? 'Vali kõigepealt tööosa…' : 'Või sisesta vabalt…'}
                        className="input disabled:opacity-30"
                      />
                    </>
                  )
                })()}
              </div>

              {/* Masin — per-work-item when multiple items exist */}
              <div>
                {(() => {
                  const activeItem = form.work_items.find(i => i.id === activeWorkItemId)
                  const hasItems = form.work_items.length > 1
                  const currentMachine = hasItems && activeItem ? (activeItem.masina ?? '') : (form.masina ?? '')
                  const setMachine = (val: string) => {
                    if (hasItems && activeItem) {
                      setForm(f => ({
                        ...f,
                        work_items: f.work_items.map(i => i.id === activeItem.id ? { ...i, masina: val || undefined } : i),
                        masina: f.work_items[0]?.id === activeItem.id ? val : f.masina,
                      }))
                    } else {
                      set('masina', val)
                    }
                  }
                  return (
                    <>
                      <label className="label flex items-center gap-1.5">
                        <Cpu size={11} /> Masin
                        {hasItems && activeItem && (
                          <span className="text-accent font-normal ml-1">— {activeItem.too}</span>
                        )}
                        {hasItems && !activeItem && (
                          <span className="text-ink-faint font-normal ml-1">— vali tööosa</span>
                        )}
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {settings.masinad.map(m => (
                          <button
                            key={m}
                            type="button"
                            disabled={hasItems && !activeItem}
                            onClick={() => setMachine(currentMachine === m ? '' : m)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all duration-100 ${
                              currentMachine === m
                                ? 'bg-accent text-white border-accent'
                                : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Teostaja + Disainija — what worker pay is calculated from.
                  Two fields because design is compensated separately: often the
                  same person, sometimes not, sometimes outsourced (leave empty). */}
              <div className="grid grid-cols-2 gap-4">
                <WorkerSelect
                  label="Teostaja"
                  value={form.assigned_to}
                  onChange={v => set('assigned_to', v)}
                />
                <WorkerSelect
                  label="Disainija"
                  value={form.designed_by}
                  onChange={v => set('designed_by', v)}
                />
              </div>

              {/* Print ID + Disain ID */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Print ID</label>
                  <input
                    type="text"
                    value={form.print_id ?? ''}
                    onChange={e => set('print_id', e.target.value)}
                    placeholder="SprintRay töö nr…"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Disain ID</label>
                  <input
                    type="text"
                    value={form.disain_id ?? ''}
                    onChange={e => set('disain_id', e.target.value)}
                    placeholder="Disaini viide…"
                    className="input"
                  />
                </div>
              </div>

              {/* Värv */}
              <div>
                <label className="label">Värv (VITA)</label>
                <ShadePicker value={form.varv ?? null} onChange={v => set('varv', v)} />
              </div>

              {/* Köndivärv — the stump under the crown, not the crown. Sits
                  directly below the tooth shade because the two are read
                  together: the ingot is chosen from the pair, never from the
                  target shade alone. */}
              <div>
                <label className="label">Köndivärv (VITA ND)</label>
                <p className="text-[11px] text-ink-faint mb-1.5 leading-snug">
                  Ihutud köndi enda toon. Läbipaistva keraamika all paistab see krooni
                  läbi — tume könt vajab teistsugust ingotit sama lõpptooni saamiseks.
                </p>
                <DieShadePicker value={form.kondivarv ?? null} onChange={v => set('kondivarv', v)} />
              </div>

              {/* Valmis aeg moved to top row with Kuupäev */}

            </div>

            {/* ── CENTER COLUMN (fullscreen: work types + odontogram) ── */}
            {isFullscreen && (
              <div className="space-y-3 sticky top-0">
                <label className="label">Töö tüüp ja hambad</label>
                <WorkItemsField
                  value={form.work_items}
                  onChange={items => {
                    setForm(f => ({ ...f, work_items: items, too: items[0]?.too ?? '' }))
                  }}
                  activeId={activeWorkItemId}
                  onActiveChange={setActiveWorkItemId}
                  looseTeeth={form.hambad ?? ''}
                  onLooseTeethChange={v => set('hambad', v)}
                  typeColumns={5}
                />
              </div>
            )}

            {/* ── RIGHT COLUMN (bottom/fullscreen) / continuation (side mode) ── */}
            <div className="space-y-5">
              {/* No work type selected — hint (non-fullscreen only, fullscreen shows it in center) */}
              {!isFullscreen && form.work_items.length === 0 && (
              <div className="bg-bg-sidebar rounded-xl p-4 text-center">
                <p className="text-xs text-ink-faint">Vali ülalt töötüüp, et hambaid märkida</p>
              </div>
              )}

              {/* Extra services picker */}
              {settings.lisateenused.length > 0 && (
                <div>
                  <label className="label">Lisateenused</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {settings.lisateenused.map(svc => {
                      const added = (form.extras ?? []).find(e => e.id === svc.id)
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => {
                            if (added) {
                              setForm(f => ({ ...f, extras: (f.extras ?? []).filter(e => e.id !== svc.id) }))
                            } else {
                              setForm(f => ({ ...f, extras: [...(f.extras ?? []), { id: svc.id, nimi: svc.nimi, hind: svc.hind }] }))
                            }
                          }}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border-2 font-medium transition-all ${
                            added
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-ink-faint/25 text-ink-muted hover:border-accent/40'
                          }`}
                        >
                          {svc.nimi} · {svc.hind.toFixed(0)}€
                        </button>
                      )
                    })}
                  </div>
                  {(form.extras ?? []).length > 0 && (
                    <div className="space-y-1 mb-2">
                      {(form.extras ?? []).map(ext => (
                        <div key={ext.id} className="flex items-center gap-2 text-xs">
                          <span className="text-ink flex-1">{ext.nimi}</span>
                          <div className="relative w-20">
                            <input
                              type="number"
                              step="0.01"
                              value={ext.hind}
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0
                                setForm(f => ({ ...f, extras: (f.extras ?? []).map(x => x.id === ext.id ? { ...x, hind: v } : x) }))
                              }}
                              className="input py-1 text-xs pr-6 text-right"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint">€</span>
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-ink-muted">
                        Lisateenused kokku: <strong className="tabular-nums">{(form.extras ?? []).reduce((s, e) => s + e.hind, 0).toFixed(2)} €</strong>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Pricing block — after teeth in both modes */}
              <PricingBlock
                form={form} set={set} settings={settings}
                smallCount={smallCount} largeCount={largeCount}
                prodPrice={prodPrice} hasCalc={hasCalc}
                onHindChange={v => { hindAutoRef.current = false; set('hind', v) }}
                useDiscount={useDiscount} onDiscountChange={setUseDiscount}
                onRequestMarkPaid={job ? () => setPaidDialog(true) : undefined}
                paidSoFar={job ? jobPayments.filter(p => p.job_id === job.id)
                  .reduce((s, p) => s + Number(p.amount), 0) : 0}
                allRates={workerRates}
              />

              {/* Muudatused */}
              <RevisionBlock
                value={form.revisions}
                autoExpandId={activeRevId ?? highlightRevisionId}
                autoEditId={editingRevId}
                onAutoEditDone={() => setEditingRevId(null)}
                onChange={revs => set('revisions', revs)}
                jobAssignedTo={form.assigned_to}
                jobDesignedBy={form.designed_by}
              />
            </div>

          </div>
        </form>
        )}

        {/* Footer */}
        {/* Save error shown at the top of the form */}
        {saveError && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 flex-shrink-0">
            <p className="text-xs text-red-600">{saveError}</p>
          </div>
        )}
      </motion.aside>

      {/* Revision overlay — add or edit from read view without entering edit mode */}
      {quickRevisionId && job && (() => {
        const isNew = quickRevisionId === '__new__'
        const existingRev = isNew ? null : (job.revisions ?? []).find(r => r.id === quickRevisionId)
        const revision = existingRev
          ?? { id: crypto.randomUUID(), ts: new Date().toISOString(), note: '', status: stages[0]?.key ?? 'disain' } as Revision
        return (
          <RevisionEditFullscreen
            revision={revision}
            jobAssignedTo={job.assigned_to}
            jobDesignedBy={job.designed_by}
            onSave={async rev => {
              if (!rev.note.trim()) return
              try {
                const updatedRevisions = isNew
                  ? [...(job.revisions ?? []), rev]
                  : (job.revisions ?? []).map(r => r.id === rev.id ? rev : r)
                const { id: _id, created_at: _c, updated_at: _u, markused: _m, ...input } = job as Job & { markused?: unknown }
                await onSave({ ...input, revisions: updatedRevisions })
                setActiveRevId(rev.id)
                setQuickRevisionId(null)
              } catch (err) {
                console.error('Revision save failed:', err)
              }
            }}
            onCancel={() => setQuickRevisionId(null)}
            saving={saving}
          />
        )
      })()}

      {/* Marking paid always records HOW — never a bare boolean flip. */}
      {paidDialog && job && (() => {
        const total = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
          + (job.revisions ?? []).reduce((s, r) => s + Number(r.price ?? 0), 0)
        const already = jobPayments
          .filter(p => p.job_id === job.id)
          .reduce((s, p) => s + Number(p.amount), 0)
        return (
          <MarkPaidDialog
            title={`Märgi makstuks · ${job.too ?? 'Töö'}`}
            amount={total}
            alreadyPaid={already}
            busy={markPaid.isPending}
            onClose={() => setPaidDialog(false)}
            onConfirm={async details => {
              const paying = details.amount ?? Math.max(0, total - already)
              await markPaid.mutateAsync({
                jobs: [{ id: job.id, amount: paying, total: Math.max(0, total - already) }],
                method: details.method,
                paid_at: details.paid_at,
                reference: details.reference,
              })
              if (paying >= Math.max(0, total - already) - 0.005) {
                set('makstud', true)
                set('makse_kuupaev', details.paid_at)
              }
              setPaidDialog(false)
            }}
            onConfirmMulti={async detailsList => {
              const owed = Math.max(0, total - already)
              let totalPaying = 0
              for (const details of detailsList) {
                const paying = details.amount ?? 0
                totalPaying += paying
                await markPaid.mutateAsync({
                  jobs: [{ id: job.id, amount: paying, total: owed }],
                  method: details.method,
                  paid_at: details.paid_at,
                  reference: details.reference,
                })
              }
              if (totalPaying >= owed - 0.005) {
                set('makstud', true)
                set('makse_kuupaev', detailsList[0]?.paid_at ?? '')
              }
              setPaidDialog(false)
            }}
          />
        )
      })()}
    </AnimatePresence>
  )
}
