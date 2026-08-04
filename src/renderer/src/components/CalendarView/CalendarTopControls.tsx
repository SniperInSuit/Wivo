/**
 * The calendar's own controls, rendered into the TopBar.
 *
 * They used to sit in a full-width header row above the grid, which cost ~52px
 * of calendar height to show four buttons and a month label the scrolling strip
 * already labels inline. The top bar had empty space in the middle; the grid did
 * not have any to spare.
 */
import type { CalendarMode, CalendarScale } from './CalendarView'
import { useSettings } from '../../stores/useSettings'

interface CalendarTopControlsProps {
  mode: CalendarMode
  onModeChange: (m: CalendarMode) => void
  scale: CalendarScale
  onScaleChange: (s: CalendarScale) => void
  onToday: () => void
}

export function CalendarTopControls({
  mode, onModeChange, scale, onScaleChange, onToday,
}: CalendarTopControlsProps) {
  const { settings } = useSettings()
  return (
    <>
      <div className="flex items-center gap-1 bg-nav/10 rounded-xl p-1 flex-shrink-0">
        {/* Visits are appointment booking — a practice's front desk, not a
            lab's. Hidden unless the clinical half is on; the jobs half of the
            calendar (deadlines) is the lab's and always shows. */}
        {([
          { key: 'tood', label: 'Tööd', clinical: false },
          { key: 'visiidid', label: 'Visiidid', clinical: true },
          { key: 'kombineeritud', label: 'Kombineeritud', clinical: true },
        ] as const)
          .filter(o => !o.clinical || settings.kliinilineRezhiim)
          .map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              mode === key ? 'bg-accent text-white' : 'text-nav hover:text-nav'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Month vs week only exists in Visiidid — the week grid is a visit
          schedule, and the combined view already answers "who is coming today". */}
      {mode === 'visiidid' && (
        <div className="flex items-center gap-1 bg-nav/10 rounded-xl p-1 flex-shrink-0">
          {([
            { key: 'kuu', label: 'Kuu' },
            { key: 'nadal', label: 'Nädal' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onScaleChange(key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                scale === key ? 'bg-bg-card text-ink shadow-card' : 'text-nav hover:text-nav'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onToday}
        className="text-nav hover:text-nav font-medium px-3 py-1.5 rounded-lg transition-colors text-sm border border-nav/30 flex-shrink-0"
      >
        Täna
      </button>
    </>
  )
}
