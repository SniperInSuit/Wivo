import { useMemo } from 'react'
import { format, parseISO, isValid } from 'date-fns'
import { AlertCircle } from 'lucide-react'
import type {
  ArchSelection, WizardPriority, WizardField as WizardFieldKey,
} from '@shared/wizard'
import { baseTypeName, typeKeyIndex, materialsOf, machinesOf } from '@shared/wizard'
import { quoteJob } from '@shared/pricing/quote'
import type { WizardStepComponent } from '../types'
import { WizardSummaryRow } from '../ui/WizardSummaryRow'
import { ReviewSection } from '../review/ReviewSection'
import { abutmentList } from '@/types/job'
import { PriceSummary } from '../review/PriceSummary'
import { wizardWorkItems, wizardQuoteInput } from '../state/workItems'
import type { WorkItem } from '@/types/job'
import { useSettings, useWorkTypes, priceBookOf } from '@/stores/useSettings'
import { useCustomers } from '@/hooks/useCustomers'
import { useClinicProfiles } from '@/hooks/useClinicProfiles'
import { t } from '@/lib/i18n'
import { finishLabel } from './StepMaterial'

// Three labels, duplicated from ArchSelector rather than exported through the
// contract: the review page must be able to name an arch even if the arch
// picker was never rendered (an All-on job where the arch came from a draft).
const ARCH_LABEL: Record<ArchSelection, string> = {
  upper: t('Ülemine lõualuu', 'Upper jaw'),
  lower: t('Alumine lõualuu', 'Lower jaw'),
  both:  t('Mõlemad lõualuud', 'Both jaws'),
}

// The rush multiplier is configurable (Seaded → Hinnad). Writing "×2" here
// would tell a lab that charges 1.5× a number its own invoice contradicts.
const priorityLabel = (p: WizardPriority, kordaja: number): string =>
  p === 'kiirtoo' ? t(`Kiirtöö (hind ×${kordaja})`, `Rush job (price ×${kordaja})`) : p === 'mudel' ? t('Mudel', 'Model') : t('Standard', 'Standard')

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = parseISO(iso)
  // Fall back to the raw value rather than an em dash: a malformed date the
  // user typed is information, and hiding it hides the mistake.
  return isValid(d) ? format(d, 'dd.MM.yyyy') : iso
}

/** FDI numbers as separate badges — a comma list of 14 numbers is unreadable. */
function ToothBadges({ hambad, implantaadid }: { hambad: string; implantaadid?: string }) {
  const teeth = hambad.split(',').map(tooth => tooth.trim()).filter(Boolean)
  if (teeth.length === 0) return null
  // Its own copy of the chip rather than ui/ToothBadges: the wizard runs at a
  // larger type scale throughout. The implant mark has to be here too — this is
  // the screen where the job is confirmed, and a screw you cannot see here is
  // one you cannot check before it is on the invoice.
  const implants = new Set((implantaadid ?? '').split(',').map(tooth => tooth.trim()).filter(Boolean))
  return (
    <span className="flex flex-wrap gap-1">
      {teeth.map(tooth => {
        const isImplant = implants.has(tooth)
        return (
          <span
            key={tooth}
            title={isImplant ? t(`Hammas ${tooth} — implantaadil`, `Tooth ${tooth} — on an implant`) : undefined}
            className={`relative px-2 py-0.5 rounded-md border text-base font-medium tabular-nums ${
              isImplant
                ? 'bg-slate-800 border-slate-800 text-white'
                : 'bg-bg-sidebar border-ink-faint/25 text-ink'
            }`}
          >
            {tooth}
            {isImplant && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-white"
              />
            )}
          </span>
        )
      })}
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
        // Matched on the label alone, not the Estonian wording, which quote.ts now
        // translates: an appliance item has no teeth, so its only reason is this one.
        const hit = applianceTypes.find(type => reason.startsWith(`${type}: `))
        return hit ? t(`${hit}: töö tüübil pole hinda määratud (Seaded → Hinnad).`, `${hit}: no price set for this work type (Settings → Prices).`) : reason
      }),
    }
  }, [rawQuote, rules])

  /** Is there a soodushind to offer at all? Asked of the LIVE type list, and by
   *  exact name, exactly like every other jobTypes lookup in the wizard. */
  const discountAvailable = useMemo(
    () => state.jobTypes.some(n => types.find(type => type.nimi === n)?.soodushind != null),
    [state.jobTypes, types]
  )

  const pick = (...fields: WizardFieldKey[]) => errors.filter(e => fields.includes(e.field))
  const blocking = errors.filter(e => e.severity === 'error')

  const workerName = (id: string | null): string =>
    id ? workers.find(w => w.id === id)?.full_name || t('Nimeta', 'Unnamed') : ''

  const customerName = state.customer
    ? customers.find(c => c.id === state.customer)?.name ?? t('Tundmatu tellija', 'Unknown client')
    : ''

  const deadlineText = state.deadline
    ? `${fmtDate(state.deadline)}${state.time ? t(` kell ${state.time}`, ` at ${state.time}`) : ''}`
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
            {t('Töö ei ole veel valmis loomiseks', 'The job is not ready to be created yet')}
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
        <ReviewSection title={t('Töö tüüp', 'Work type')} step={1} onEdit={goToStep} errors={pick('jobTypes')}>
          <WizardSummaryRow
            label={t('Valitud tööd', 'Selected work')}
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
          title={t('Hambad', 'Teeth')}
          step={rules.needsTeethStep ? 2 : 1}
          onEdit={goToStep}
          errors={pick('teeth', 'arch')}
        >
          {!rules.needsTeethStep ? (
            <WizardSummaryRow
              label={t('Hambad', 'Teeth')}
              value={t('Selle töö puhul ei ole hambaid vaja valida.', "This job doesn't need any teeth chosen.")}
            />
          ) : (
            <>
              {state.selectedArch && (
                <WizardSummaryRow label={t('Lõualuu', 'Jaw')} value={ARCH_LABEL[state.selectedArch]} />
              )}
              {items.map((item, idx) => {
                const sameType = items.filter(i => i.too === item.too)
                const num = sameType.length > 1 ? ` ${sameType.indexOf(item) + 1}` : ''
                const toothCount = item.hambad.split(',').filter(tooth => tooth.trim()).length
                return (
                <WizardSummaryRow
                  key={item.id}
                  label={`${item.too}${num}`}
                  empty={!item.hambad}
                  value={
                    item.hambad ? (
                      <span className="flex flex-col gap-1">
                        <ToothBadges hambad={item.hambad} implantaadid={item.implantaadid} />
                        <span className="text-base text-ink-muted">
                          {t(`${toothCount} hammast`, `${toothCount} ${toothCount === 1 ? 'tooth' : 'teeth'}`)}
                          {item.bridge ? t(' · sild', ' · bridge') : ''}
                        </span>
                      </span>
                    ) : (
                      t('Hambaid ei valitud', 'No teeth chosen')
                    )
                  }
                />
                )
              })}
              {/* Abutments, one row per implant item. Grouped by CODE rather
                  than listed per tooth: "MIS C1 — 14, 15, 16" is the sentence a
                  technician says, and four identical rows is not. */}
              {items.map(item => {
                const codes = abutmentList(item)
                if (codes.length === 0) return null
                const grouped = new Map<string, string[]>()
                for (const { tooth, code } of codes) {
                  grouped.set(code, [...(grouped.get(code) ?? []), tooth])
                }
                return (
                  <WizardSummaryRow
                    key={`abut:${item.id}`}
                    label={t(`Kruvi / abutment — ${item.too}`, `Screw / abutment — ${item.too}`)}
                    value={
                      <span className="flex flex-col gap-0.5">
                        {[...grouped.entries()].map(([code, teeth]) => (
                          <span key={code}>
                            <span className="font-medium">{code}</span>
                            <span className="text-ink-muted"> — {teeth.join(', ')}</span>
                          </span>
                        ))}
                      </span>
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
        <ReviewSection title={t('Materjal', 'Material')} step={3} onEdit={goToStep} errors={pick('materials')}>
          {state.jobTypes.length <= 1 ? (
            <WizardSummaryRow
              label={t('Materjal', 'Material')}
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
                  value={assigned || (fallback ? t(`${fallback} (esimese järgi)`, `${fallback} (same as first)`) : '')}
                  empty={!assigned && !fallback}
                />
              )
            })
          )}
        </ReviewSection>

        {/* ── 4. Värvitoon ────────────────────────────────────────────────── */}
        {showShadeSection && (
          <ReviewSection
            title={t('Värvitoon', 'Shade')}
            step={3}
            onEdit={goToStep}
            errors={pick('defaultShade', 'glaze', 'texture')}
          >
            {rules.supportsShade && (
              <>
                <WizardSummaryRow
                  label={t('Värv', 'Shade')}
                  value={state.defaultShade ?? ''}
                  empty={!state.defaultShade}
                />
                {/* Shown even when blank — an unrecorded stump shade is worth
                    noticing before the job is created, not after. */}
                <WizardSummaryRow
                  label={t('Köndivärv', 'Stump shade')}
                  value={state.dieShade ?? ''}
                  empty={!state.dieShade}
                />
              </>
            )}
            {rules.supportsGlaze && (
              <WizardSummaryRow label={t('Glasuur', 'Glaze')} value={state.glaze ? finishLabel(state.glaze) : ''} empty={!state.glaze} />
            )}
            {rules.supportsTexture && (
              <WizardSummaryRow label={t('Tekstuur', 'Texture')} value={state.texture ? finishLabel(state.texture) : ''} empty={!state.texture} />
            )}
          </ReviewSection>
        )}

        {/* ── 5. Tootmine ─────────────────────────────────────────────────── */}
        <ReviewSection
          title={t('Tootmine', 'Production')}
          step={4}
          onEdit={goToStep}
          errors={pick('machine', 'designer', 'technician', 'date', 'printId', 'designId', 'priority')}
        >
          {/* Per work item once the job has more than one, so a case split
              across two printers is visible before it is created. */}
          {state.jobTypes.length > 1 ? (
            state.jobTypes.map(key => (
              <WizardSummaryRow
                key={key}
                label={t(`Masin — ${baseTypeName(key)}`, `Machine — ${baseTypeName(key)}`)}
                value={state.machineByType[key] ?? ''}
                empty={!state.machineByType[key]}
              />
            ))
          ) : (
            <WizardSummaryRow
              label={t('Masin', 'Machine')}
              value={machinesOf(state)[0] ?? state.machine ?? ''}
              empty={!machinesOf(state)[0] && !state.machine}
            />
          )}
          <WizardSummaryRow
            label={t('Disainija', 'Designer')}
            value={workerName(state.designer)}
            empty={!state.designer}
          />
          <WizardSummaryRow
            label={t('Teostaja', 'Technician')}
            value={workerName(state.technician)}
            empty={!state.technician}
          />
          <WizardSummaryRow label={t('Töö vastu võetud', 'Job received')} value={fmtDate(state.date)} empty={!state.date} />
          <WizardSummaryRow label={t('Print ID', 'Print ID')} value={state.printId} empty={!state.printId.trim()} />
          <WizardSummaryRow label={t('Disain ID', 'Design ID')} value={state.designId} empty={!state.designId.trim()} />
          <WizardSummaryRow
            label={t('Prioriteet', 'Priority')}
            value={priorityLabel(state.priority, settings.kiirtooKordaja)}
          />
          {/* Only for a Mudel job — the row is not stored on any other. */}
          {state.priority === 'mudel' && (
            <WizardSummaryRow label={t('Mudel ID', 'Model ID')} value={state.modelId} empty={!state.modelId.trim()} />
          )}
        </ReviewSection>

        {/* ── 6. Tähtaeg ──────────────────────────────────────────────────── */}
        <ReviewSection
          title={t('Tähtaeg', 'Due date')}
          step={4}
          onEdit={goToStep}
          errors={pick('deadline', 'time')}
        >
          <WizardSummaryRow label={t('Tähtaeg', 'Due date')} value={deadlineText} empty={!deadlineText} />
          {!state.deadline && (
            <div>
              <p className="text-base text-ink-muted">
                {t('Tähtaega ei ole määratud. Töö luuakse ilma tähtajata ja seda saab hiljem lisada.', 'No due date set. The job will be created without one, and you can add it later.')}
              </p>
            </div>
          )}
        </ReviewSection>

        {/* ── 7. Patsient ─────────────────────────────────────────────────── */}
        <ReviewSection title={t('Patsient', 'Patient')} step={5} onEdit={goToStep} errors={pick('patient')}>
          <WizardSummaryRow
            label={t('Nimi', 'Name')}
            value={state.patient?.name.trim() ?? ''}
            empty={!state.patient?.name.trim()}
          />
          <WizardSummaryRow
            label={t('Patsiendikaart', 'Patient record')}
            value={state.patient?.patientId ? t('Seotud olemasoleva patsiendiga', 'Linked to an existing patient') : t('Sidumata', 'Not linked')}
          />
        </ReviewSection>

        {/* ── 8. Tellija ──────────────────────────────────────────────────── */}
        <ReviewSection
          title={t('Tellija', 'Client')}
          step={5}
          onEdit={goToStep}
          errors={pick('customer', 'customerReference')}
        >
          <WizardSummaryRow label={t('Tellija', 'Client')} value={customerName} empty={!customerName} />
          <WizardSummaryRow
            label={t('Tellija viide', 'Client reference')}
            value={state.customerReference}
            empty={!state.customerReference.trim()}
          />
        </ReviewSection>

        {/* ── 9. Kirjeldus ja märkused ────────────────────────────────────── */}
        <ReviewSection title={t('Kirjeldus ja märkused', 'Description and notes')} step={5} onEdit={goToStep} errors={[]}>
          <WizardSummaryRow
            label={t('Kirjeldus', 'Description')}
            value={<span className="whitespace-pre-wrap">{state.description}</span>}
            empty={!state.description.trim()}
          />
          <WizardSummaryRow
            label={t('Märkused', 'Notes')}
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
