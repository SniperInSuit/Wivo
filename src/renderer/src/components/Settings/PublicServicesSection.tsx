import { useState, useEffect } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, Globe, Plus, Trash2,
} from 'lucide-react'
import type { PublicService, PublicPlanStep } from '@shared/portal/publicService'
import { publicPriceRange, publicPlanSummary, publishProblems } from '@shared/portal/publicQuote'
import { useSettings } from '../../stores/useSettings'
import { CalculatorEditor } from './CalculatorEditor'
import { BookingHoursSection, type BookingConfig } from './BookingHoursSection'
import { supabase, getActiveClinicId } from '../../lib/supabase'
import { fetchPrivateSettings } from '../../lib/clinicSettings'
import { BookingReadiness } from './BookingReadiness'
import { t } from '@/lib/i18n'
import { translate } from '@shared/i18n'

/** The preview shows what PATIENTS read on the website: its language, not the UI's. */
const PORTAL_LANG = 'et'

/**
 * Seaded → Patsiendi hinnakiri.
 *
 * A separate tab in the Kliinik group, deliberately NOT inside Hinnad. That
 * physical separation is the requirement: one list is what the lab charges the
 * clinic, the other is what the patient pays, and they are different numbers.
 *
 * The preview renders through the SAME publicPriceRange / publicPlanSummary the
 * edge function calls, so what the owner sees here is what the website shows.
 * Two renderers would drift, and this one is about money.
 */
export function PublicServicesSection() {
  const {
    settings, addPublicService, removePublicService, updatePublicService, movePublicService,
  } = useSettings()
  const [uus, setUus] = useState('')
  const [avatud, setAvatud] = useState<string | null>(null)
  // Hours live in their own column (sql/061) rather than in the settings store:
  // they are read by the public edge function and by nothing else in the app.
  const [broneering, setBroneering] = useState<BookingConfig | null>(null)
  const [clinicSlug, setClinicSlug] = useState<string | null>(null)

  useEffect(() => {
    const clinicId = getActiveClinicId()
    if (!clinicId) return
    // Owners and admins only, through clinic_settings_private (sql/102).
    void fetchPrivateSettings().then(async priv => {
      const value = priv ? priv.broneering : (await supabase
        .from('clinic_settings').select('broneering').eq('clinic_id', clinicId).maybeSingle()).data?.broneering
      setBroneering((value as BookingConfig) ?? {})
    })
    supabase.from('clinics').select('public_slug').eq('id', clinicId).maybeSingle()
      .then(({ data }) => setClinicSlug((data?.public_slug as string) ?? null))
  }, [])

  const teenused = [...settings.avalikudTeenused].sort((a, b) => a.jarjekord - b.jarjekord)
  const avaldatud = teenused.filter(service => service.avalik && publishProblems(service).length === 0).length

  const lisa = () => {
    if (!uus.trim()) return
    addPublicService(uus)
    setUus('')
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Globe size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settings.patientPriceList')}</h3>
      </div>

      {/* Said once, loudly. Editing this list IS publishing. */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 mb-3 max-w-2xl">
        <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-ink-soft leading-relaxed">
          {t('settings.thisIsThe')}{' '}
          <strong className="text-ink">{t('settings.publicWebsitePriceList')}</strong>{' '}
          {t('settings.aPriceChangedHereBecomesVisible')}
        </p>
      </div>

      <p className="text-xs text-ink-faint mb-3">
        {t('settings.visibleOnTheWebsite')} <strong className="text-ink-muted">{avaldatud}</strong>{' '}
        {t('settings.serviceServices', { avaldatud })}
        {teenused.length > avaldatud && t('settings.draftOrWithIssuesDraftsOr', { teenused, avaldatud, value: teenused.length - avaldatud })}
      </p>

      <div className="space-y-1.5 mb-3">
        {teenused.length === 0 && (
          <p className="text-xs text-ink-faint">
            {t('settings.noServicesTheWebsiteShowsNo')}
          </p>
        )}
        {teenused.map((service, idx) => (
          <ServiceRow
            key={service.id}
            teenus={service}
            avatud={avatud === service.id}
            isFirst={idx === 0}
            isLast={idx === teenused.length - 1}
            onToggle={() => setAvatud(avatud === service.id ? null : service.id)}
            onPatch={patch => updatePublicService(service.id, patch)}
            onRemove={() => removePublicService(service.id)}
            onMove={dir => movePublicService(service.id, dir)}
          />
        ))}
      </div>

      <div className="flex gap-2 max-w-md">
        <input
          value={uus}
          onChange={e => setUus(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lisa() } }}
          placeholder={t('settings.newServiceNameEGDental')}
          className="input flex-1 text-sm"
        />
        <button
          type="button"
          disabled={!uus.trim()}
          onClick={lisa}
          className="btn-ghost text-xs border border-ink-faint/25 disabled:opacity-40"
        >
          <Plus size={13} /> {t('settings.add')}
        </button>
      </div>

      {/* When the website may offer those services. Below the list because the
          question only arises once there is something to book. */}
      {broneering && (
        <div className="mt-6 pt-5 border-t border-ink-faint/15 max-w-2xl space-y-5">
          {/* First, because every one of these failures looks identical from
              the website: the form shows no times. */}
          <BookingReadiness
            slug={clinicSlug}
            teenused={teenused}
            broneering={broneering}
          />
          <BookingHoursSection value={broneering} onSaved={setBroneering} />
        </div>
      )}
    </section>
  )
}

function ServiceRow({
  teenus, avatud, isFirst, isLast, onToggle, onPatch, onRemove, onMove,
}: {
  teenus: PublicService
  avatud: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: () => void
  onPatch: (patch: Partial<PublicService>) => void
  onRemove: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const [kustuta, setKustuta] = useState(false)
  const probleemid = publishProblems(teenus)
  const hind = publicPriceRange(teenus)
  const plaan = publicPlanSummary(teenus)

  return (
    <div className="rounded-lg border border-ink-faint/20 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 hover:bg-bg-sidebar/60">
        <button type="button" onClick={onToggle} className="text-ink-faint">
          {avatud ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <button
          type="button"
          onClick={() => onPatch({ avalik: !teenus.avalik })}
          title={teenus.avalik ? t('settings.publicClickToHide') : t('settings.draftClickToPublish')}
          className={teenus.avalik ? 'text-emerald-600' : 'text-ink-faint'}
        >
          {teenus.avalik ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
          <p className="text-sm text-ink truncate">{teenus.nimi || t('settings.untitledService')}</p>
          <p className="text-[11px] text-ink-faint">
            {hind.tekst} · {plaan.visiite} {t('settings.visitVisits', { plaan })} · {plaan.kestusTekst}
            {probleemid.length > 0 && (
              <span className="text-orange-500 font-medium"> · {probleemid.length} {t('settings.issueIssues', { probleemid })}</span>
            )}
          </p>
        </button>

        <button type="button" onClick={() => onMove('up')} disabled={isFirst}
          className="p-1 text-ink-faint hover:text-ink disabled:opacity-25" title={t('settings.up')}>
          <ChevronUp size={13} />
        </button>
        <button type="button" onClick={() => onMove('down')} disabled={isLast}
          className="p-1 text-ink-faint hover:text-ink disabled:opacity-25" title={t('settings.down')}>
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          onClick={() => (kustuta ? onRemove() : setKustuta(true))}
          onBlur={() => setKustuta(false)}
          className={`p-1 ${kustuta ? 'text-red-500' : 'text-ink-faint hover:text-red-500'}`}
          title={kustuta ? t('settings.clickAgainToDelete') : t('settings.delete')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {avatud && (
        <div className="border-t border-ink-faint/15 p-3 space-y-3 bg-bg-sidebar/40">
          {probleemid.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-orange-800 mb-0.5">
                {t('settings.wonTReachTheWebsiteUntil')}
              </p>
              {probleemid.map(p => (
                <p key={p} className="text-[11px] text-orange-700">· {p}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('settings.nameForThePatient')}</label>
              <input
                value={teenus.nimi}
                onChange={e => onPatch({ nimi: e.target.value })}
                placeholder={t('settings.dentalImplantSingleTooth')}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label">{t('settings.category')}</label>
              <input
                value={teenus.kategooria ?? ''}
                onChange={e => onPatch({ kategooria: e.target.value || undefined })}
                placeholder={t('settings.implantology')}
                className="input text-sm"
              />
            </div>
          </div>

          <div>
            <label className="label">{t('settings.shortDescription')}</label>
            <textarea
              value={teenus.luhikirjeldus ?? ''}
              onChange={e => onPatch({ luhikirjeldus: e.target.value || undefined })}
              rows={2}
              placeholder={t('settings.oneParagraphInThePatientS')}
              className="input text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{t('settings.priceFrom')}</label>
              <input type="number" min={0} value={teenus.hinnaAlates}
                onChange={e => onPatch({ hinnaAlates: parseFloat(e.target.value) || 0 })}
                className="input text-sm" />
            </div>
            <div>
              <label className="label">{t('settings.priceUpTo')}</label>
              <input type="number" min={0} value={teenus.hinnaKuni}
                onChange={e => onPatch({ hinnaKuni: parseFloat(e.target.value) || 0 })}
                className="input text-sm" />
            </div>
            <div>
              <label className="label">{t('settings.vAT')}</label>
              <button
                type="button"
                onClick={() => onPatch({ kmSisaldub: !teenus.kmSisaldub })}
                className={`input text-sm text-left ${teenus.kmSisaldub ? 'text-ink' : 'text-orange-600'}`}
              >
                {teenus.kmSisaldub ? t('settings.includedInPrice') : t('settings.nOTIncluded')}
              </button>
            </div>
          </div>

          <div>
            <label className="label">{t('settings.visitLengthMin')}</label>
            <input
              type="number" min={5} step={5}
              value={teenus.kestusMin ?? ''}
              onChange={e => onPatch({ kestusMin: parseInt(e.target.value, 10) || undefined })}
              placeholder="30"
              className="input text-sm w-32"
            />
            {/* The single most load-bearing number on this screen: it is what
                gets blocked out of the diary. Said plainly rather than left to
                be inferred from a treatment plan. */}
            <p className="text-[11px] text-ink-faint mt-1">
              {t('settings.thisMuchTimeIsBlockedOut')}
            </p>
          </div>

          <div>
            <label className="label">{t('settings.priceNote')}</label>
            <input
              value={teenus.hinnaMarkus ?? ''}
              onChange={e => onPatch({ hinnaMarkus: e.target.value || undefined })}
              placeholder={t('settings.dependsOnBoneVolumeIncludesThe')}
              className="input text-sm"
            />
          </div>

          <CalculatorEditor teenus={teenus} onPatch={onPatch} />

          <PlanEditor
            sammud={teenus.samm}
            broneeritavSamm={teenus.broneeritavSamm}
            onChange={samm => onPatch({ samm })}
            onBookable={broneeritavSamm => onPatch({ broneeritavSamm })}
          />

          <div>
            <label className="label">{t('settings.totalDurationForThePatient')}</label>
            <input
              value={teenus.kestusKokkuTekst ?? ''}
              onChange={e => onPatch({ kestusKokkuTekst: e.target.value || undefined })}
              placeholder={plaan.kestusTekst}
              className="input text-sm"
            />
            <p className="text-[11px] text-ink-faint mt-1">
              {t('settings.leftEmptyItIsWorkedOut')}{' '}
              <strong>{plaan.kestusTekst}</strong>.{' '}
              {t('settings.yourOwnWordsAreBetterA')}
            </p>
          </div>

          {/* Rendered by the same functions the website runs — and so in the
              website's language; only the heading is translated. */}
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-1.5">
              {t('settings.whatThePatientSees')}
            </p>
            <p className="text-sm font-semibold text-ink">{teenus.nimi || t('settings.untitledService')}</p>
            <p className="text-lg font-bold text-ink tabular-nums">
              {hind.tekst}
              <span className="text-[11px] font-normal text-ink-muted ml-1.5">
                {translate(PORTAL_LANG, hind.kmSisaldub ? 'publicServices.inclVat' : 'publicServices.exclVat')}
              </span>
            </p>
            {hind.markus && <p className="text-[11px] text-ink-muted">{hind.markus}</p>}
            <p className="text-xs text-ink-soft mt-1">
              {translate(PORTAL_LANG, 'publicServices.visitCount', { n: plaan.visiite })} · {plaan.kestusTekst}
            </p>
            {plaan.sammud.map((x, i) => (
              <p key={i} className="text-[11px] text-ink-muted">
                {i + 1}. {x.pealkiri || '—'}
                {x.kestusMin ? ` · ${x.kestusMin} ${translate(PORTAL_LANG, 'common.minutesShort')}` : ''}
                {x.ootaegTekst ? ` · ${x.ootaegTekst}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PlanEditor({ sammud, broneeritavSamm, onChange, onBookable }: {
  sammud: PublicPlanStep[]
  broneeritavSamm: number
  onChange: (s: PublicPlanStep[]) => void
  onBookable: (i: number) => void
}) {
  const patch = (i: number, p: Partial<PublicPlanStep>) =>
    onChange(sammud.map((s, n) => (n === i ? { ...s, ...p } : s)))

  return (
    <div>
      <label className="label">{t('settings.treatmentPlanGeneralTheSameFor')}</label>
      {/* The empty state is where people got stuck: the booking DURATION lives
          on a plan visit, so with no visits there is no duration field, and the
          readiness panel's "no service has a duration" had nowhere to point. */}
      {sammud.length === 0 ? (
        <p className="text-[11px] text-ink-faint mb-1.5 leading-relaxed">
          {t('settings.optionalForTreatmentSpreadOverSeveral')}
        </p>
      ) : (
        <div className="flex items-center gap-2 mb-1 text-[10px] text-ink-faint">
          <span className="w-[22px] shrink-0" />
          <span className="flex-1">{t('settings.visitName')}</span>
          <span className="w-[70px] text-center">{t('settings.length')}</span>
          <span className="w-[90px] text-center">{t('settings.wait')}</span>
          <span className="w-[22px] shrink-0" />
        </div>
      )}
      <div className="space-y-1.5">
        {sammud.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBookable(i)}
              title={t('settings.thisVisitCanBeBookedOn')}
              className={`text-[10px] font-medium px-1.5 py-1 rounded shrink-0 ${
                broneeritavSamm === i
                  ? 'bg-accent text-white'
                  : 'bg-bg-card text-ink-faint border border-ink-faint/25'
              }`}
            >
              {i + 1}
            </button>
            <input
              value={s.pealkiri}
              onChange={e => patch(i, { pealkiri: e.target.value })}
              placeholder={t('settings.consultationAndPlan')}
              className="input text-sm flex-1"
            />
            <input
              type="number" min={0} value={s.kestusMin ?? ''}
              onChange={e => patch(i, { kestusMin: parseInt(e.target.value) || undefined })}
              placeholder={t('common.minutesShort')} title={t('settings.visitLengthInMinutes')}
              className="input text-sm w-[70px]"
            />
            <input
              type="number" min={0} value={s.ootaegPaevad ?? ''}
              onChange={e => patch(i, { ootaegPaevad: parseInt(e.target.value) || undefined })}
              placeholder={t('settings.wait')} title={t('settings.howManyDaysAfterThePrevious')}
              className="input text-sm w-[90px]"
            />
            <button
              type="button"
              onClick={() => onChange(sammud.filter((_, n) => n !== i))}
              className="p-1 text-ink-faint hover:text-red-500"
              title={t('settings.removeVisit')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...sammud, { pealkiri: '' }])}
        className="btn-ghost text-xs border border-ink-faint/25 mt-2"
      >
        <Plus size={12} /> {t('settings.addVisit')}
      </button>
      <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
        {t('settings.theBlueNumberMarksTheVisit')}
        <strong> {t('settings.itsLengthIsWhatGetsBlocked')}</strong>.{' '}
        {t('settings.theWaitIsDaysSinceThe')}
      </p>
    </div>
  )
}
