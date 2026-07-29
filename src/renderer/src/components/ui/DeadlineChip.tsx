import { differenceInHours, differenceInDays, format, isPast, isToday } from 'date-fns'
import { Clock, AlertTriangle } from 'lucide-react'

interface DeadlineChipProps {
  deadline: string | null
  compact?: boolean
  isDone?: boolean   // suppresses overdue styling for completed jobs
}

export function DeadlineChip({ deadline, compact = false, isDone = false }: DeadlineChipProps) {
  if (!deadline) return null

  const date = new Date(deadline)
  const hoursLeft = differenceInHours(date, new Date())
  const daysLeft = differenceInDays(date, new Date())
  const overdue = !isDone && isPast(date)
  const urgent = !isDone && !overdue && hoursLeft <= 24
  const warning = !isDone && !overdue && daysLeft <= 3

  const colorClass = overdue
    ? 'bg-red-100 text-red-700 border border-red-200'
    : urgent
      ? 'bg-red-50 text-red-600 border border-red-200'
      : warning
        ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : 'bg-bg-sidebar text-ink-muted border border-ink-faint/30'

  const Icon = overdue || urgent ? AlertTriangle : Clock

  const label = overdue
    ? 'Tähtaeg möödas'
    : isDone
      ? format(date, 'dd.MM')
      : isToday(date)
      ? 'Täna'
      : daysLeft === 1
        ? 'Homme'
        : daysLeft <= 7
          ? `${daysLeft}p`
          : format(date, 'dd.MM')

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
