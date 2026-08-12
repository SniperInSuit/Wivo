import { differenceInHours, differenceInCalendarDays, format, isPast, isToday, isTomorrow } from 'date-fns'
import { Clock, AlertTriangle } from 'lucide-react'
import { toDate } from '../../lib/dates'

interface DeadlineChipProps {
  deadline: string | null
  compact?: boolean
  isDone?: boolean   // suppresses overdue styling for completed jobs
}

export function DeadlineChip({ deadline, compact = false, isDone = false }: DeadlineChipProps) {
  if (!deadline) return null

  // This chip is on the board, the table, the calendar and the job panel. An
  // unreadable deadline used to throw out of format() and take the whole view
  // with it, so it renders as no chip at all — same as having no deadline.
  const date = toDate(deadline)
  if (!date) return null

  const now = new Date()
  const hoursLeft = differenceInHours(date, now)
  const calDays = differenceInCalendarDays(date, now)
  const overdue = !isDone && isPast(date)
  const urgent = !isDone && !overdue && hoursLeft <= 24
  const warning = !isDone && !overdue && calDays <= 3

  const colorClass = overdue
    ? 'bg-red-100 text-red-700 border border-red-200'
    : urgent
      ? 'bg-red-50 text-red-600 border border-red-200'
      : warning
        ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : 'bg-bg-sidebar text-ink-muted border border-ink-faint/30'

  const Icon = overdue || urgent ? AlertTriangle : Clock

  const time = format(date, 'HH:mm')
  const label = overdue
    ? 'Tähtaeg möödas'
    : isDone
      ? format(date, 'dd.MM')
      : isToday(date)
        ? `Täna ${time}`
        : isTomorrow(date)
          ? `Homme ${time}`
          : calDays <= 7
            ? `${calDays}p ${time}`
            : `${format(date, 'dd.MM')} ${time}`

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
        <Icon size={10} />
        {label}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${colorClass}`}>
      <Icon size={12} />
      <span>{format(date, 'dd.MM.yyyy HH:mm')}</span>
      {overdue && <span className="ml-0.5 font-semibold">• möödas</span>}
      {urgent && !overdue && <span className="ml-0.5">• {hoursLeft}h</span>}
    </span>
  )
}
