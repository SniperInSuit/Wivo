/**
 * The spec's "big red bar" when an inventory count is due: on the overview
 * and in the stock view, for people who can read stock. Not dismissible: it
 * goes when the count is saved (the schedule moves on, sql/094).
 */
import { ClipboardList } from 'lucide-react'
import { parseISO, startOfDay } from 'date-fns'
import { useInventorySchedule } from '@/hooks/useStock'
import { usePermissions } from '@/hooks/usePermissions'
import { shortDate } from './StockView'
import { t } from '@/lib/i18n'

/** Due today or earlier. */
export function countIsDue(nextDue: string | null | undefined, today: Date): boolean {
  return !!nextDue && parseISO(nextDue) <= startOfDay(today)
}

export function InventoryBanner({ onOpen, className = '' }: { onOpen: () => void; className?: string }) {
  const { can } = usePermissions()
  const { data: schedule } = useInventorySchedule(can('stock.read'))
  if (!can('stock.read') || !countIsDue(schedule?.next_due, new Date())) return null
  return (
    <div role="alert" className={`${className} flex items-center gap-3 rounded-xl bg-rose-600 px-5 py-4 text-white shadow-card`}>
      <ClipboardList size={22} aria-hidden="true" />
      <div>
        <p className="text-base font-bold">{t('stock.countDueTitle')}</p>
        <p className="text-sm text-white/90">{t('stock.countDueSince', { date: shortDate(schedule!.next_due) })}</p>
      </div>
      <button type="button" onClick={onOpen} className="ml-auto rounded-lg bg-white px-4 py-2 text-sm font-semibold text-rose-700">
        {t('stock.countNow')}
      </button>
    </div>
  )
}
