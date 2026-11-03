import { useSettings, useWorkTypes } from '../../stores/useSettings'
import { MATERIAL_SHADES } from '../../types/job'
import { workTypeRules } from '@shared/wizard'
import { t } from '@/lib/i18n'

/**
 * The second material of one piece of work: a denture's teeth (Apex Teeth) on
 * its base (Apex Base). Stored joined with the first — see
 * shared/pricing/materials.
 *
 * Offered on whole-arch work (dentures, All-on-X), where base and teeth are two
 * prints. Elsewhere it shows only when a second material is already set, so it
 * can still be seen and removed.
 */
export function SecondMaterialField({ too, first, second, onChange, disabled, tone }: {
  too: string | null | undefined
  first: string
  second: string
  onChange: (second: string) => void
  disabled?: boolean
  /** The job page is light; the revision editors are dark. */
  tone: 'light' | 'dark'
}) {
  const { settings } = useSettings()
  const { types } = useWorkTypes()
  const arch = !!too && workTypeRules(too, types).toothMode === 'arch'
  if (!second && !arch) return null

  // Same split as the first material: "Crown HT A1" is Crown HT in shade A1.
  const base = [...settings.materjalid]
    .sort((a, b) => b.length - a.length)
    .find(m => second === m || second.startsWith(m + ' ')) ?? null
  const shades = base ? MATERIAL_SHADES[base] : undefined
  const shade = base && second !== base ? second.slice(base.length + 1) : null
  const options = second && !base ? [second, ...settings.materjalid] : settings.materjalid
  const off = disabled || (!first && !second)

  const chip = (active: boolean) => active
    ? (tone === 'light' ? 'bg-accent text-white border-accent' : 'bg-accent/15 border-accent text-accent')
    : (tone === 'light'
      ? 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
      : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400')

  return (
    <div className="mt-2 mb-2">
      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${tone === 'light' ? 'text-ink-faint' : 'text-slate-500'}`}>
        {t('jobDetail.secondMaterial')}
        <span className="normal-case font-normal tracking-normal ml-1">— {t('jobDetail.secondMaterialHint')}</span>
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {options.map(m => {
          const active = base ? base === m : second === m
          return (
            <button key={m} type="button" disabled={off}
              onClick={() => onChange(active ? '' : m)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all duration-100 font-medium disabled:opacity-30 disabled:cursor-not-allowed ${chip(active)}`}
            >
              {m}
            </button>
          )
        })}
      </div>
      {shades && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 pl-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${tone === 'light' ? 'text-ink-faint' : 'text-slate-500'}`}>{t('jobDetail.shade')}</span>
          {shades.map(s => (
            <button key={s} type="button" disabled={off}
              onClick={() => onChange(shade === s ? base! : `${base} ${s}`)}
              className={`text-xs px-2 py-0.5 rounded border transition-all duration-100 font-medium ${chip(shade === s)}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
