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
import { BookingReadiness } from './BookingReadiness'
import { t } from '@/lib/i18n'

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
    supabase.from('clinic_settings').select('broneering').eq('clinic_id', clinicId)
      .maybeSingle()
      .then(({ data }) => setBroneering(((data?.broneering as BookingConfig) ?? {})))
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
        <h3 className="text-sm font-semibold text-ink">{t('Patsiendi hinnakiri', 'Patient price list')}</h3>
      </div>

      {/* Said once, loudly. Editing this list IS publishing. */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 mb-3 max-w-2xl">
        <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-ink-soft leading-relaxed">
          {t('See on', 'This is the')}{' '}
          <strong className="text-ink">{t('avalik veebilehe hinnakiri', 'public website price list')}</strong>{' '}
          {t(
            '— siin muudetud hind läheb patsiendile nähtavale. See ei ole sama, mis Hinnad all olevad labori hinnad. Teenus jõuab veebi alles siis, kui ta on märgitud avalikuks ja tal ei ole puudusi.',
            '— a price changed here becomes visible to patients. It is not the same as the lab prices under Prices. A service reaches the website only once it is marked public and has no issues.',
          )}
        </p>
      </div>

      <p className="text-xs text-ink-faint mb-3">
        {t('Veebis nähtav:', 'Visible on the website:')} <strong className="text-ink-muted">{avaldatud}</strong>{' '}
        {t('teenust', avaldatud === 1 ? 'service' : 'services')}
        {teenused.length > avaldatud && t(
          ` · ${teenused.length - avaldatud} mustandit või puudustega`,
          ` · ${teenused.length - avaldatud} ${teenused.length - avaldatud === 1 ? 'draft or with issues' : 'drafts or with issues'}`,
        )}
      </p>

      <div className="space-y-1.5 mb-3">
        {teenused.length === 0 && (
          <p className="text-xs text-ink-faint">
            {t('Teenuseid ei ole. Veebileht ei näita hinnakirja.', 'No services. The website shows no price list.')}
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
          placeholder={t('Uue teenuse nimi, nt Hambaimplantaat', 'New service name, e.g. Dental implant')}
          className="input flex-1 text-sm"
        />
        <button
          type="button"
          disabled={!uus.trim()}
          onClick={lisa}
          className="btn-ghost text-xs border border-ink-faint/25 disabled:opacity-40"
        >
          <Plus size={13} /> {t('Lisa', 'Add')}
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
          title={teenus.avalik ? t('Avalik — klõpsa peitmiseks', 'Public — click to hide') : t('Mustand — klõpsa avaldamiseks', 'Draft — click to publish')}
          className={teenus.avalik ? 'text-emerald-600' : 'text-ink-faint'}
        >
          {teenus.avalik ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
          <p className="text-sm text-ink truncate">{teenus.nimi || t('Nimeta teenus', 'Untitled service')}</p>
          <p className="text-[11px] text-ink-faint">
            {hind.tekst} · {plaan.visiite} {t('visiiti', plaan.visiite === 1 ? 'visit' : 'visits')} · {plaan.kestusTekst}
            {probleemid.length > 0 && (
              <span className="text-orange-500 font-medium"> · {probleemid.length} {t('puudust', probleemid.length === 1 ? 'issue' : 'issues')}</span>
            )}
          </p>
        </button>

        <button type="button" onClick={() => onMove('up')} disabled={isFirst}
          className="p-1 text-ink-faint hover:text-ink disabled:opacity-25" title={t('Üles', 'Up')}>
          <ChevronUp size={13} />
        </button>
        <button type="button" onClick={() => onMove('down')} disabled={isLast}
          className="p-1 text-ink-faint hover:text-ink disabled:opacity-25" title={t('Alla', 'Down')}>
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          onClick={() => (kustuta ? onRemove() : setKustuta(true))}
          onBlur={() => setKustuta(false)}
          className={`p-1 ${kustuta ? 'text-red-500' : 'text-ink-faint hover:text-red-500'}`}
          title={kustuta ? t('Klõpsa uuesti kustutamiseks', 'Click again to delete') : t('Kustuta', 'Delete')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {avatud && (
        <div className="border-t border-ink-faint/15 p-3 space-y-3 bg-bg-sidebar/40">
          {probleemid.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-orange-800 mb-0.5">
                {t('Veebi ei jõua, kuni need on parandatud:', 'Won’t reach the website until these are fixed:')}
              </p>
              {probleemid.map(p => (
                <p key={p} className="text-[11px] text-orange-700">· {p}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('Nimi patsiendile', 'Name for the patient')}</label>
              <input
                value={teenus.nimi}
                onChange={e => onPatch({ nimi: e.target.value })}
                placeholder={t('Hambaimplantaat (üks hammas)', 'Dental implant (single tooth)')}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label">{t('Kategooria', 'Category')}</label>
              <input
                value={teenus.kategooria ?? ''}
                onChange={e => onPatch({ kategooria: e.target.value || undefined })}
                placeholder={t('Implantoloogia', 'Implantology')}
                className="input text-sm"
              />
            </div>
          </div>

          <div>
            <label className="label">{t('Lühikirjeldus', 'Short description')}</label>
            <textarea
              value={teenus.luhikirjeldus ?? ''}
              onChange={e => onPatch({ luhikirjeldus: e.target.value || undefined })}
              rows={2}
              placeholder={t('Üks lõik patsiendi keeles.', 'One paragraph in the patient’s language.')}
              className="input text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{t('Hind alates (€)', 'Price from (€)')}</label>
              <input type="number" min={0} value={teenus.hinnaAlates}
                onChange={e => onPatch({ hinnaAlates: parseFloat(e.target.value) || 0 })}
                className="input text-sm" />
            </div>
            <div>
              <label className="label">{t('Hind kuni (€)', 'Price up to (€)')}</label>
              <input type="number" min={0} value={teenus.hinnaKuni}
                onChange={e => onPatch({ hinnaKuni: parseFloat(e.target.value) || 0 })}
                className="input text-sm" />
            </div>
            <div>
              <label className="label">{t('Käibemaks', 'VAT')}</label>
              <button
                type="button"
                onClick={() => onPatch({ kmSisaldub: !teenus.kmSisaldub })}
                className={`input text-sm text-left ${teenus.kmSisaldub ? 'text-ink' : 'text-orange-600'}`}
              >
                {teenus.kmSisaldub ? t('Sisaldub hinnas', 'Included in price') : t('EI sisaldu', 'NOT included')}
              </button>
            </div>
          </div>

          <div>
            <label className="label">{t('Visiidi kestus (min)', 'Visit length (min)')}</label>
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
              {t(
                'Nii pikk aeg pannakse kalendrist kinni. Ilma selleta ei paku veeb sellele teenusele aegu.',
                'This much time is blocked out in the calendar. Without it the website offers no times for this service.',
              )}
            </p>
          </div>

          <div>
            <label className="label">{t('Hinna märkus', 'Price note')}</label>
            <input
              value={teenus.hinnaMarkus ?? ''}
              onChange={e => onPatch({ hinnaMarkus: e.target.value || undefined })}
              placeholder={t('sõltub luu mahust; sisaldab krooni', 'depends on bone volume; includes the crown')}
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
            <label className="label">{t('Kogukestus patsiendile', 'Total duration for the patient')}</label>
            <input
              value={teenus.kestusKokkuTekst ?? ''}
              onChange={e => onPatch({ kestusKokkuTekst: e.target.value || undefined })}
              placeholder={plaan.kestusTekst}
              className="input text-sm"
            />
            <p className="text-[11px] text-ink-faint mt-1">
              {t('Tühjaks jättes arvutatakse ootaegadest:', 'Left empty, it is worked out from the waiting times:')}{' '}
              <strong>{plaan.kestusTekst}</strong>.{' '}
              {t(
                'Oma sõnadega on parem — päevade summa annab võltsi täpsuse.',
                'Your own words are better — a sum of days gives false precision.',
              )}
            </p>
          </div>

          {/* Rendered by the same functions the website runs — and so in the
              website's language; only the heading is translated. */}
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-1.5">
              {t('Nii näeb patsient', 'What the patient sees')}
            </p>
            <p className="text-sm font-semibold text-ink">{teenus.nimi || t('Nimeta teenus', 'Untitled service')}</p>
            <p className="text-lg font-bold text-ink tabular-nums">
              {hind.tekst}
              <span className="text-[11px] font-normal text-ink-muted ml-1.5">
                {hind.kmSisaldub ? 'km-ga' : 'km-ta'}
              </span>
            </p>
            {hind.markus && <p className="text-[11px] text-ink-muted">{hind.markus}</p>}
            <p className="text-xs text-ink-soft mt-1">
              {plaan.visiite} visiiti · {plaan.kestusTekst}
            </p>
            {plaan.sammud.map((x, i) => (
              <p key={i} className="text-[11px] text-ink-muted">
                {i + 1}. {x.pealkiri || '—'}
                {x.kestusMin ? ` · ${x.kestusMin} min` : ''}
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
      <label className="label">{t('Raviplaan — üldine, kõigile patsientidele ühesugune', 'Treatment plan — general, the same for every patient')}</label>
      {/* The empty state is where people got stuck: the booking DURATION lives
          on a plan visit, so with no visits there is no duration field, and the
          readiness panel's "no service has a duration" had nowhere to point. */}
      {sammud.length === 0 ? (
        <p className="text-[11px] text-ink-faint mb-1.5 leading-relaxed">
          {t(
            'Vabatahtlik. Mitmest visiidist koosneva ravi puhul näitab see patsiendile, mis teda ees ootab. Ühe visiidi teenusel ei ole vaja — kestus on juba ülal.',
            'Optional. For treatment spread over several visits it shows the patient what lies ahead. A single-visit service doesn’t need it — the length is already above.',
          )}
        </p>
      ) : (
        <div className="flex items-center gap-2 mb-1 text-[10px] text-ink-faint">
          <span className="w-[22px] shrink-0" />
          <span className="flex-1">{t('Visiidi nimi', 'Visit name')}</span>
          <span className="w-[70px] text-center">{t('kestus', 'length')}</span>
          <span className="w-[90px] text-center">{t('ootaeg', 'wait')}</span>
          <span className="w-[22px] shrink-0" />
        </div>
      )}
      <div className="space-y-1.5">
        {sammud.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBookable(i)}
              title={t('See visiit on veebist broneeritav', 'This visit can be booked on the website')}
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
              placeholder={t('Konsultatsioon ja plaan', 'Consultation and plan')}
              className="input text-sm flex-1"
            />
            <input
              type="number" min={0} value={s.kestusMin ?? ''}
              onChange={e => patch(i, { kestusMin: parseInt(e.target.value) || undefined })}
              placeholder="min" title={t('Visiidi pikkus minutites', 'Visit length in minutes')}
              className="input text-sm w-[70px]"
            />
            <input
              type="number" min={0} value={s.ootaegPaevad ?? ''}
              onChange={e => patch(i, { ootaegPaevad: parseInt(e.target.value) || undefined })}
              placeholder={t('ootaeg', 'wait')} title={t('Mitu päeva pärast eelmist visiiti', 'How many days after the previous visit')}
              className="input text-sm w-[90px]"
            />
            <button
              type="button"
              onClick={() => onChange(sammud.filter((_, n) => n !== i))}
              className="p-1 text-ink-faint hover:text-red-500"
              title={t('Eemalda visiit', 'Remove visit')}
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
        <Plus size={12} /> {t('Lisa visiit', 'Add visit')}
      </button>
      <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
        {t('Sinine number märgib visiiti, mille patsient veebist broneerib —', 'The blue number marks the visit the patient books on the website —')}
        <strong> {t('selle kestus on see, mis kalendrist kinni pannakse', 'its length is what gets blocked out in the calendar')}</strong>.{' '}
        {t(
          'Ootaeg on päevi eelmisest visiidist ja puudutab ainult plaani kuvamist.',
          'The wait is days since the previous visit and only affects how the plan is shown.',
        )}
      </p>
    </div>
  )
}
