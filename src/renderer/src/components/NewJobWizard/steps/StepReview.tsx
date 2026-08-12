import { useMemo } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import { AlertCircle } from 'lucide-react'
import type {
  ArchSelection, WizardPriority, WizardField as WizardFieldKey,
} from '@shared/wizard'
import { baseTypeName, typeKeyIndex, materialsOf } from '@shared/wizard'
import { quoteJob } from '@shared/pricing/quote'
import type { WizardStepComponent } from '../types'
import { WizardSummaryRow } from '../ui/WizardSummaryRow'
import { ReviewSection } from '../review/ReviewSection'
import { PriceSummary } from '../review/PriceSummary'
import { wizardWorkItems, wizardQuoteInput } from '../state/workItems'
import type { WorkItem } from '@/types/job'
import { useSettings, useWorkTypes, priceBookOf } from '@/stores/useSettings'
import { useCustomers } from '@/hooks/useCustomers'
import { useClinicProfiles } from '@/hooks/useClinicProfiles'

// Three labels, duplicated from ArchSelector rather than exported through the
// contract: the review page must be able to name an arch even if the arch
// picker was never rendered (an All-on job where the arch came from a draft).
const ARCH_LABEL: Record<ArchSelection, string> = {
  upper: 'Ülemine lõualuu',
  lower: 'Alumine lõualuu',
  both:  'Mõlemad lõualuud',
}

// The rush multiplier is configurable (Seaded → Hinnad). Writing "×2" here
// would tell a lab that charges 1.5× a number its own invoice contradicts.
const priorityLabel = (p: WizardPriority, kordaja: number): string =>
  p === 'kiirtoo' ? `Kiirtöö (hind ×${kordaja})` : p === 'mudel' ? 'Mudel' : 'Standard'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = parseISO(iso)
  // Fall back to the raw value rather than an em dash: a malformed date the
  // user typed is information, and hiding it hides the mistake.
  return isValid(d) ? format(d, 'dd.MM.yyyy') : iso
}

/** FDI numbers as separate badges — a comma list of 14 numbers is unreadable. */
function ToothBadges({ hambad }: { hambad: string }) {
  const teeth = hambad.split(',').map(t => t.trim()).filter(Boolean)
  if (teeth.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {teeth.map(t => (
        <span
          key={t}
          className="px-2 py-0.5 rounded-md bg-bg-sidebar border border-ink-faint/25
                     text-base font-medium text-ink tabular-nums"
        >
          {t}
        </span>
      ))}
    </span>
  )
}

/**
 * Step 6 — "Kontrolli töö üle".
 *
 * A read-only page whose job is to be scannable: one card per group, one way
 * back from each. Nothing here writes to state except through "Muuda", because
 * an editable review page is just the old all-at-once form again.
 */
export const StepReview: WizardStepComponent = ({ state, patch, rules, errors, showErrors, goToStep }) => {
  const { types, hex } = useWorkTypes()
  const { settings } = useSettings()
  const { data: customers = [] } = useCustomers()
  const { data: workers = [] } = useClinicProfiles()

  const items: WorkItem[] = useMemo(() => wizardWorkItems(state, types), [state, types])

  /** Display name: "Sild§2" → "Sild 2", "Kroon" → "Kroon" */
  const displayName = (key: string): string => {
    const base = baseTypeName(key)
    const idx = typeKeyIndex(key)
    const sameType = state.jobTypes.filter(k => baseTypeName(k) === base)
    return sameType.length > 1 ? `${base} ${idx}` : base
  }

  // The quote is built through wizardQuoteInput so the number shown here and
  // the number toJobInput() writes come from one builder — see workItems.ts.
  const rawQuote = useMemo(
    () => quoteJob(wizardQuoteInput(state, types), priceBookOf(settings)),
    [state, types, settings]
  )

  /**
   * The quote as SHOWN. Only the `unpriced` wording differs, never a number.
   *
   * quoteJob has no way of knowing that the wizard deliberately never lets you
   * pick teeth for an appliance, so an unpriced nightguard is reported as
   * "hambaid ei ole valitud …" — on a step that told the user, correctly, that
   * this job needs no teeth. The step knows the mode; the price book does not.
   */
  const quote = useMemo(() => {
    const applianceTypes = rules.perType.filter(r => r.toothMode === 'none').map(r => r.too)
    if (applianceTypes.length === 0 || rawQuote.unpriced.length === 0) return rawQuote
    return {
      ...rawQuote,
      unpriced: rawQuote.unpriced.map(reason => {
        const hit = applianceTypes.find(t => reason.startsWith(`${t}: hambaid ei ole valitud`))
        return hit ? `${hit}: töö tüübil pole hinda määratud (Seaded → Hinnad).` : reason
      }),
    }
  }, [rawQuote, rules])

  /** Is there a soodushind to offer at all? Asked of the LIVE type list, and by
   *  exact name, exactly like every other jobTypes lookup in the wizard. */
  const discountAvailable = useMemo(
    () => state.jobTypes.some(n => types.find(t => t.nimi === n)?.soodushind != null),
    [state.jobTypes, types]
  )

  const pick = (...fields: WizardFieldKey[]) => errors.filter(e => fields.includes(e.field))
  const blocking = errors.filter(e => e.severity === 'error')

  const workerName = (id: string | null): string =>
    id ? workers.find(w => w.id === id)?.full_name || 'Nimeta' : ''

  const customerName = state.customer
    ? customers.find(c => c.id === state.customer)?.name ?? 'Tundmatu tellija'
    : ''

  const deadlineText = state.deadline
    ? `${fmtDate(state.deadline)}${state.time ? ` kell ${state.time}` : ''}`
    : ''

  const showShadeSection = rules.supportsShade || rules.supportsGlaze || rules.supportsTexture

  return (
    <div className="max-w-[980px] space-y-4">

      {/* Section cards already carry their own errors inline. This loud summary
          only appears once the user has actually pressed "Loo töö" and been
          refused — shouting on arrival would be the same overwhelm the wizard
          exists to remove. */}
      {showErrors && blocking.length > 0 && (
        <div className="rounded-xl border border-rose-400/70 bg-rose-500/10 p-4" role="alert">
          <p className="flex items-center gap-2 text-base font-semibold text-rose-500">
            <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            Töö ei ole veel valmis loomiseks
          </p>
          <ul className="mt-2 space-y-1">
            {blocking.map((e, i) => (
              <li key={i} className="text-base text-ink-soft">· {e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">

        {/* ── 1. Töö tüüp ─────────────────────────────────────────────────── */}
        <ReviewSection title="Töö tüüp" step={1} onEdit={goToStep} errors={pick('jobTypes')}>
          <WizardSummaryRow
            label="Valitud tööd"
            empty={state.jobTypes.length === 0}
            value={
              <span className="flex flex-wrap gap-2">
                {state.jobTypes.map(key => (
                  <span
                    key={key}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                               bg-bg-sidebar border border-ink-faint/25 text-base text-ink"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: hex(baseTypeName(key)) }}
                      aria-hidden="true"
                    />
                    {displayName(key)}
                  </span>
                ))}
              </span>
            }
          />
        </ReviewSection>

        {/* ── 2. Hambad ───────────────────────────────────────────────────── */}
        {/* When no type on this job needs teeth, "Muuda" points at step 1: the
            only thing that could change the answer is the work type itself. */}
        <ReviewSection
          title="Hambad"
          step={rules.needsTeethStep ? 2 : 1}
          onEdit={goToStep}
          errors={pick('teeth', 'arch')}
        >
          {!rules.needsTeethStep ? (
            <WizardSummaryRow
              label="Hambad"
              value="Selle töö puhul ei ole hambaid vaja valida."
            />
          ) : (
            <>
              {state.selectedArch && (
                <WizardSummaryRow label="Lõualuu" value={ARCH_LABEL[state.selectedArch]} />
              )}
              {items.map((item, idx) => {
                const sameType = items.filter(i => i.too === item.too)
                const num = sameType.length > 1 ? ` ${sameType.indexOf(item) + 1}` : ''
                return (
                <WizardSummaryRow
                  key={item.id}
                  label={`${item.too}${num}`}
                  empty={!item.hambad}
                  value={
                    item.hambad ? (
                      <span className="flex flex-col gap-1">
                        <ToothBadges hambad={item.hambad} />
                        <span className="text-base text-ink-muted">
                          {item.hambad.split(',').filter(t => t.trim()).length} hammast
                          {item.bridge ? ' · sild' : ''}
                        </span>
                      </span>
                    ) : (
                      'Hambaid ei valitud'
                    )
                  }
                />
                )
              })}
            </>
          )}
        </ReviewSection>

        {/* ── 3. Materjal ─────────────────────────────────────────────────── */}
        {/* One row per piece of work, because they can differ. A single-material
            job still reads as one line, which is the common case. */}
        <ReviewSection title="Materjal" step={3} onEdit={goToStep} errors={pick('materials')}>
          {state.jobTypes.length <= 1 ? (
            <WizardSummaryRow
              label="Materjal"
              value={materialsOf(state)[0] ?? ''}
              empty={materialsOf(state).length === 0}
            />
          ) : (
            state.jobTypes.map(key => {
              const assigned = state.materialByType[key]?.trim()
              const fallback = materialsOf(state)[0]
              return (
                <WizardSummaryRow
                  key={key}
                  label={displayName(key)}
                  value={assigned || (fallback ? `${fallback} (esimese järgi)` : '')}
                  empty={!assigned && !fallback}
                />
              )
            })
          )}
        </ReviewSection>

        {/* ── 4. Värvitoon ────────────────────────────────────────────────── */}
        {showShadeSection && (
          <ReviewSection
            title="Värvitoon"
            step={3}
            onEdit={goToStep}
            errors={pick('defaultShade', 'glaze', 'texture')}
          >
            {rules.supportsShade && (
              <WizardSummaryRow
                label="Värv"
                value={state.defaultShade ?? ''}
                empty={!state.defaultShade}
              />
            )}
            {rules.supportsGlaze && (
              <WizardSummaryRow label="Glasuur" value={state.glaze ?? ''} empty={!state.glaze} />
            )}
            {rules.supportsTexture && (
              <WizardSummaryRow label="Tekstuur" value={state.texture ?? ''} empty={!state.texture} />
            )}
          </ReviewSection>
        )}

        {/* ── 5. Tootmine ─────────────────────────────────────────────────── */}
        <ReviewSection
          title="Tootmine"
          step={4}
          onEdit={goToStep}
          errors={pick('machine', 'designer', 'technician', 'date', 'printId', 'designId', 'priority')}
        >
          <WizardSummaryRow label="Masin" value={state.machine ?? ''} empty={!state.machine} />
          <WizardSummaryRow
            label="Disainija"
            value={workerName(state.designer)}
            empty={!state.designer}
          />
          <WizardSummaryRow
            label="Teostaja"
            value={workerName(state.technician)}
            empty={!state.technician}
          />
          <WizardSummaryRow label="Töö vastu võetud" value={fmtDate(state.date)} empty={!state.date} />
          <WizardSummaryRow label="Print ID" value={state.printId} empty={!state.printId.trim()} />
          <WizardSummaryRow label="Disain ID" value={state.designId} empty={!state.designId.trim()} />
          <WizardSummaryRow
            label="Prioriteet"
            value={priorityLabel(state.priority, settings.kiirtooKordaja)}
          />
          {/* Only for a Mudel job — the row is not stored on any other. */}
          {state.priority === 'mudel' && (
            <WizardSummaryRow label="Mudel ID" value={state.modelId} empty={!state.modelId.trim()} />
          )}
        </ReviewSection>

        {/* ── 6. Tähtaeg ──────────────────────────────────────────────────── */}
        <ReviewSection
          title="Tähtaeg"
          step={4}
          onEdit={goToStep}
          errors={pick('deadline', 'time')}
        >
          <WizardSummaryRow label="Tähtaeg" value={deadlineText} empty={!deadlineText} />
          {!state.deadline && (
            <div>
              <p className="text-base text-ink-muted">
                Tähtaega ei ole määratud. Töö luuakse ilma tähtajata ja seda saab hiljem lisada.
              </p>
            </div>
          )}
        </ReviewSection>

        {/* ── 7. Patsient ─────────────────────────────────────────────────── */}
        <ReviewSection title="Patsient" step={5} onEdit={goToStep} errors={pick('patient')}>
          <WizardSummaryRow
            label="Nimi"
            value={state.patient?.name.trim() ?? ''}
            empty={!state.patient?.name.trim()}
          />
          <WizardSummaryRow
            label="Patsiendikaart"
            value={state.patient?.patientId ? 'Seotud olemasoleva patsiendiga' : 'Sidumata'}
          />
        </ReviewSection>

        {/* ── 8. Tellija ──────────────────────────────────────────────────── */}
        <ReviewSection
          title="Tellija"
          step={5}
          onEdit={goToStep}
          errors={pick('customer', 'customerReference')}
        >
          <WizardSummaryRow label="Tellija" value={customerName} empty={!customerName} />
          <WizardSummaryRow
            label="Tellija viide"
            value={state.customerReference}
            empty={!state.customerReference.trim()}
          />
        </ReviewSection>

        {/* ── 9. Kirjeldus ja märkused ────────────────────────────────────── */}
        <ReviewSection title="Kirjeldus ja märkused" step={5} onEdit={goToStep} errors={[]}>
          <WizardSummaryRow
            label="Kirjeldus"
            value={<span className="whitespace-pre-wrap">{state.description}</span>}
            empty={!state.description.trim()}
          />
          <WizardSummaryRow
            label="Märkused"
            value={<span className="whitespace-pre-wrap">{state.notes}</span>}
            empty={!state.notes.trim()}
          />
        </ReviewSection>

        {/* ── Hind ────────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <PriceSummary
            quote={quote}
            pricing={state.pricing}
            onChange={pricing => patch({ pricing })}
            discountAvailable={discountAvailable}
          />
        </div>
      </div>
    </div>
  )
}
