import { useMemo } from 'react'
import { CalendarClock, Plus, Clock, Stethoscope, AlertTriangle } from 'lucide-react'
import { format, parseISO, isValid, isAfter } from 'date-fns'
import type { Patient } from '../../types/patient'
import type { Visit } from '../../types/visit'
import { VISIT_STATUS_LABEL, VISIT_STATUS_HEX } from '../../types/visit'
import { useVisits } from '../../hooks/useVisits'
import { stageChipStyle } from '../../config/pipeline'
import { PanelCard } from './PanelCard'

interface VisitsPanelProps {
  patient: Patient
  onVisitClick: (visit: Visit) => void
  onAddVisit: () => void
}

export function VisitsPanel({ patient, onVisitClick, onAddVisit }: VisitsPanelProps) {
  const { data: visits = [], isError } = useVisits()

  const mine = useMemo(() => {
    const key = patient.nimi.trim().toLowerCase()
    return visits
      // Linked by id, or by name for visits recorded before the patient was
      // linked — the same fallback the job history uses.
      .filter(v => v.patient_id === patient.id
        || (!v.patient_id && v.patsient.trim().toLowerCase() === key))
      .sort((a, b) => b.algus.localeCompare(a.algus))
  }, [visits, patient])

  const now = new Date()
  const next = [...mine]
    .reverse()
    .find(v => v.staatus === 'planeeritud' && isAfter(parseISO(v.algus), now))

  const noShows = mine.filter(v => v.staatus === 'ei_tulnud').length

  return (
    <PanelCard
      title="VISIIDID"
      icon={CalendarClock}
      action={
        <button
          onClick={onAddVisit}
          className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <Plus size={11} />
          Lisa visiit
        </button>
      }
    >
      {isError ? (
        <p className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
          Visiitide tabelit pole. Käivita sql/007_visits.sql Supabase SQL-redaktoris.
        </p>
      ) : mine.length === 0 ? (
        <p className="text-sm text-ink-muted">Visiite pole.</p>
      ) : (
        <div className="space-y-2.5">
          {/* The next appointment is the one thing worth surfacing above the list */}
          {next && (
            <div className="rounded-xl bg-accent/10 border border-accent/30 px-2.5 py-2">
              <p className="text-[10px] font-semibold text-accent uppercase tracking-wider">
                Järgmine visiit
              </p>
              <p className="text-sm font-bold text-ink tabular-nums">
                {format(parseISO(next.algus), 'dd.MM.yyyy HH:mm')}
              </p>
              {next.arst?.trim() && (
                <p className="text-[11px] text-ink-muted truncate">{next.arst}</p>
              )}
            </div>
          )}

          {noShows > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle size={11} />
              {noShows}× ei tulnud kohale
            </p>
          )}

          <ul className="space-y-1.5">
            {mine.map(v => {
              const d = parseISO(v.algus)
              return (
                <li key={v.id}>
                  <button
                    onClick={() => onVisitClick(v)}
                    className="w-full text-left rounded-lg px-2 py-1.5 -mx-1 hover:bg-bg-sidebar transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink tabular-nums flex-shrink-0">
                        {isValid(d) ? format(d, 'dd.MM.yy') : '—'}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                        <Clock size={9} />
                        {isValid(d) ? format(d, 'HH:mm') : '—'}
                      </span>
                      <span
                        className="ml-auto text-[10px] font-medium rounded-full px-1.5 flex-shrink-0"
                        style={stageChipStyle(VISIT_STATUS_HEX[v.staatus])}
                      >
                        {VISIT_STATUS_LABEL[v.staatus]}
                      </span>
                    </div>
                    {v.arst?.trim() && (
                      <p className="flex items-center gap-1 text-[11px] text-ink-soft truncate">
                        <Stethoscope size={9} className="text-ink-faint flex-shrink-0" />
                        {v.arst}
                        <span className="text-ink-faint">· {v.kestus_min} min</span>
                      </p>
                    )}
                    {v.markus?.trim() && (
                      <p className="text-[10px] text-ink-muted truncate">{v.markus}</p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </PanelCard>
  )
}
