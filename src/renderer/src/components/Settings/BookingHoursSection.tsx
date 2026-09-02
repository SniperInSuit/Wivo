/**
 * When the website may offer an appointment — opening hours, breaks, closed
 * days, and how much big work a day may take.
 *
 * ── A missing setting closes the diary, never opens it ───────────────────────
 * A weekday with no hours is CLOSED. That is the direction to fail in: a
 * forgotten Saturday that offers nothing is a mild annoyance, and one that
 * offers the whole day is somebody arriving to a locked door.
 *
 * ── The rules are the clinic's, not the calendar's ───────────────────────────
 * "There must not be too many big jobs in one day" is a practice decision, not
 * something a diary can work out. It lives here beside the hours because the
 * two are answered together: what is open, and how much of it the website may
 * fill.
 */
import { useState } from 'react'
import { Clock, Plus, Trash2, CalendarOff, Save, Loader2 } from 'lucide-react'
import { supabase, getActiveClinicId } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import type { BookingRules, OpenPeriod } from '@shared/portal/slots'
import { openWindows, toClock } from '@shared/portal/slots'

/** "60 päeva" as a date somebody can recognise. Capped where the server caps. */
function horizonDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + Math.min(Math.max(1, days), 120))
  return d.toLocaleDateString('et-EE', { day: 'numeric', month: 'long', year: 'numeric' })
}

const DAYS: { key: string; label: string }[] = [
  { key: '1', label: 'Esmaspäev' },
  { key: '2', label: 'Teisipäev' },
  { key: '3', label: 'Kolmapäev' },
  { key: '4', label: 'Neljapäev' },
  { key: '5', label: 'Reede' },
  { key: '6', label: 'Laupäev' },
  { key: '7', label: 'Pühapäev' },
]

/** Everything the website reads, in one column. */
export interface BookingConfig extends BookingRules {
  automaatKinnitus?: boolean
  visiiditasu?: number
  valuuta?: string
  tagasiUrl?: string
}

export function BookingHoursSection({ value, onSaved }: {
  value: BookingConfig
  onSaved: (next: BookingConfig) => void
}) {
  const [cfg, setCfg] = useState<BookingConfig>(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const patch = (p: Partial<BookingConfig>) => {
    setCfg(c => ({ ...c, ...p }))
    setDirty(true)
  }

  const daysOf = (key: string): OpenPeriod[] => cfg.tooajad?.[key] ?? []
  const setDay = (key: string, periods: OpenPeriod[]) =>
    patch({ tooajad: { ...(cfg.tooajad ?? {}), [key]: periods } })

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub.')
      // Merged, never written whole: the payment settings live in the same
      // column and a full overwrite from this screen would erase them.
      const { data: row } = await supabase
        .from('clinic_settings').select('broneering').eq('clinic_id', clinicId).maybeSingle()
      const merged = { ...((row?.broneering as object) ?? {}), ...cfg }
      const { error: err } = await supabase
        .from('clinic_settings').update({ broneering: merged }).eq('clinic_id', clinicId)
      if (err) throw err
      onSaved(merged as BookingConfig)
      setDirty(false)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Clock size={14} /> Veebibroneeringu ajad
        </h3>
        <p className="text-xs text-ink-muted mt-1">
          Millal veeb tohib aega pakkuda. <strong>Päev ilma kellaaegadeta on kinni</strong> —
          unustatud laupäev ei tohi kunagi tähendada, et keegi tuleb lukus ukse taha.
        </p>
      </div>

      {/* ── Hours per weekday ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {DAYS.map(d => {
          const periods = daysOf(d.key)
          return (
            <div key={d.key} className="flex items-start gap-3 py-1.5 border-b border-ink-faint/10 last:border-0">
              <span className={`text-xs w-24 flex-shrink-0 pt-1.5 ${
                periods.length ? 'text-ink font-medium' : 'text-ink-faint'
              }`}>
                {d.label}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                {periods.length === 0 && (
                  <span className="text-xs text-ink-faint">Kinni</span>
                )}
                {periods.map((p, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="time" value={p.algus}
                      onChange={e => {
                        const next = [...periods]
                        next[i] = { ...next[i], algus: e.target.value }
                        setDay(d.key, next)
                      }}
                      className="input text-sm py-1 w-28"
                    />
                    <span className="text-ink-faint text-xs">–</span>
                    <input
                      type="time" value={p.lopp}
                      onChange={e => {
                        const next = [...periods]
                        next[i] = { ...next[i], lopp: e.target.value }
                        setDay(d.key, next)
                      }}
                      className="input text-sm py-1 w-28"
                    />
                    <button
                      type="button"
                      onClick={() => setDay(d.key, periods.filter((_, j) => j !== i))}
                      className="text-ink-faint hover:text-red-500 p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDay(d.key, [...periods, { algus: '09:00', lopp: '17:00' }])}
                  className="text-[11px] text-accent hover:text-accent/80 flex items-center gap-1"
                >
                  <Plus size={11} /> {periods.length ? 'Lisa aeg' : 'Ava päev'}
                </button>
              </div>
              {/* What the rules actually produce for this day, after breaks. */}
              {periods.length > 0 && (
                <span className="text-[10px] text-ink-faint pt-1.5 w-32 text-right flex-shrink-0">
                  {openWindows(cfg, Number(d.key))
                    .map(w => `${toClock(w.algus)}–${toClock(w.lopp)}`)
                    .join(', ') || 'paus katab kõik'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Breaks ────────────────────────────────────────────────────────── */}
      <div>
        <label className="label">Igapäevased pausid</label>
        <div className="space-y-1">
          {(cfg.pausid ?? []).map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="time" value={p.algus}
                onChange={e => {
                  const next = [...(cfg.pausid ?? [])]
                  next[i] = { ...next[i], algus: e.target.value }
                  patch({ pausid: next })
                }}
                className="input text-sm py-1 w-28"
              />
              <span className="text-ink-faint text-xs">–</span>
              <input
                type="time" value={p.lopp}
                onChange={e => {
                  const next = [...(cfg.pausid ?? [])]
                  next[i] = { ...next[i], lopp: e.target.value }
                  patch({ pausid: next })
                }}
                className="input text-sm py-1 w-28"
              />
              <button
                type="button"
                onClick={() => patch({ pausid: (cfg.pausid ?? []).filter((_, j) => j !== i) })}
                className="text-ink-faint hover:text-red-500 p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => patch({ pausid: [...(cfg.pausid ?? []), { algus: '12:00', lopp: '13:00' }] })}
          className="text-[11px] text-accent hover:text-accent/80 mt-1 flex items-center gap-1"
        >
          <Plus size={11} /> Lisa paus
        </button>
      </div>

      {/* ── Grid and horizon ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Aja samm (min)</label>
          <input type="number" min={5} step={5} value={cfg.samm ?? 15}
            onChange={e => patch({ samm: parseInt(e.target.value, 10) || 15 })}
            className="input text-sm" />
        </div>
        <div>
          <label className="label">Kohti korraga</label>
          <input type="number" min={1} value={cfg.kohti ?? 1}
            onChange={e => patch({ kohti: parseInt(e.target.value, 10) || 1 })}
            className="input text-sm" />
          <p className="text-[10px] text-ink-faint mt-1">Toole või arste.</p>
        </div>
        <div>
          <label className="label">Ette (päeva)</label>
          <input type="number" min={0} value={cfg.ette ?? 1}
            onChange={e => patch({ ette: parseInt(e.target.value, 10) || 0 })}
            className="input text-sm" />
          <p className="text-[10px] text-ink-faint mt-1">
            0 = ka täna · alates {horizonDate(cfg.ette ?? 1)}
          </p>
        </div>
        <div>
          <label className="label">Kuni (päeva)</label>
          <input type="number" min={1} max={120} value={cfg.kuni ?? 60}
            onChange={e => patch({ kuni: parseInt(e.target.value, 10) || 60 })}
            className="input text-sm" />
          {/* The number turned into a date, because "60 days" is not something
              anyone can check by looking. A cap that silently disagreed with
              this field is exactly the bug this line makes visible. */}
          <p className="text-[10px] text-ink-faint mt-1">
            Kuni {horizonDate(cfg.kuni ?? 60)}
            {(cfg.kuni ?? 60) > 120 && ' · ülempiir on 120'}
          </p>
        </div>
      </div>

      {/* ── Load control ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-faint/25 bg-bg-sidebar/40 p-3">
        <p className="text-xs font-semibold text-ink-soft mb-1">Koormus</p>
        <p className="text-[11px] text-ink-faint mb-2">
          Päev, mille veeb saab täita nelja suure tööga, on päev, mida ei jõua ära teha.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">„Suur töö" alates (min)</label>
            <input type="number" min={0} step={15}
              value={cfg.koormus?.suurMin ?? ''}
              onChange={e => patch({
                koormus: {
                  suurMin: parseInt(e.target.value, 10) || 0,
                  suuriPaevas: cfg.koormus?.suuriPaevas ?? 2,
                },
              })}
              placeholder="piiramata"
              className="input text-sm" />
          </div>
          <div>
            <label className="label">Suuri töid päevas kuni</label>
            <input type="number" min={0}
              value={cfg.koormus?.suuriPaevas ?? ''}
              onChange={e => patch({
                koormus: {
                  suurMin: cfg.koormus?.suurMin ?? 120,
                  suuriPaevas: parseInt(e.target.value, 10) || 0,
                },
              })}
              className="input text-sm" />
          </div>
        </div>
      </div>

      {/* ── Automatic confirmation ────────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-faint/25 bg-bg-sidebar/40 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.automaatKinnitus === true}
            onChange={e => patch({ automaatKinnitus: e.target.checked })}
            className="accent-accent mt-0.5"
          />
          <span className="min-w-0">
            <span className="text-xs font-semibold text-ink block">
              Kinnita broneeringud automaatselt
            </span>
            <span className="text-[11px] text-ink-muted block mt-0.5 leading-relaxed">
              Sees: veebist valitud aeg läheb <strong>kohe kalendrisse</strong>, keegi
              ei vaata üle. Väljas: taotlus ootab „Taotlused" lehel ja keegi vajutab
              „Broneeri".
            </span>
          </span>
        </label>
        {cfg.automaatKinnitus === true && (
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2 leading-relaxed">
            {(cfg.visiiditasu ?? 0) > 0
              ? 'Visiiditasu on sees — see on tugev filter, sest robot ei maksa. '
                + 'Kalendrisse jõuab aeg alles pärast laekumist.'
              : 'Visiiditasu ei küsita, nii et iga veebivormi täitja saab aja otse '
                + 'kalendrisse. Kaalu tasu sisselülitamist või jäta kinnitamine käsitsi.'}
          </p>
        )}
      </div>

      {/* ── Closed dates ──────────────────────────────────────────────────── */}
      <div>
        <label className="label flex items-center gap-1.5">
          <CalendarOff size={12} /> Suletud kuupäevad
        </label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {(cfg.puhkused ?? []).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => patch({ puhkused: (cfg.puhkused ?? []).filter(x => x !== d) })}
              className="text-[11px] px-2 py-1 rounded-lg bg-bg-sidebar text-ink-muted hover:text-red-500"
            >
              {d} ×
            </button>
          ))}
        </div>
        <input
          type="date"
          onChange={e => {
            const d = e.target.value
            if (!d) return
            if (!(cfg.puhkused ?? []).includes(d)) {
              patch({ puhkused: [...(cfg.puhkused ?? []), d].sort() })
            }
            e.target.value = ''
          }}
          className="input text-sm w-auto"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        {dirty ? 'Salvesta ajad' : 'Salvestatud'}
      </button>
    </section>
  )
}
