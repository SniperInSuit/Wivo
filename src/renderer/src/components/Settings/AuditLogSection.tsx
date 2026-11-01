/**
 * Seaded → Audit log, for organisation admins (spec: audit_log — view,
 * download, share, stage move; append-only). Reads `audit_entries`, which
 * resolves names and job codes and refuses anyone who is not an admin.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

interface Entry { id: number; at: string; user_name: string | null; action: string; object: string; job_code: string | null; detail: Record<string, unknown> }

const ACTIONS = ['view', 'download', 'upload', 'share', 'unshare', 'stage_move', 'partnership', 'export', 'question'] as const
const actionLabel = (a: string): string => ({
  view: t('audit.view'), download: t('audit.download'), upload: t('audit.upload'), share: t('audit.share'),
  unshare: t('audit.unshare'), stage_move: t('audit.stageMove'), partnership: t('audit.partnership'),
  export: t('audit.export'), question: t('audit.question'),
} as Record<string, string>)[a] ?? a

function describe(e: Entry): string {
  const d = e.detail
  if (e.action === 'stage_move') return `${d.from ?? ''} → ${d.to ?? ''}`
  if (e.action === 'partnership') return String(d.step ?? '')
  if (e.action === 'export') return t('audit.files', { n: Number(d.files ?? 0) })
  return ''
}

export function AuditLogSection() {
  const [action, setAction] = useState<string>('')
  const { data = [], error, isLoading } = useQuery<Entry[]>({
    queryKey: ['audit_entries', action],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase.rpc('audit_entries', { p_limit: 300, p_action: action || null, p_before: null })
      if (err) throw err
      return (rows ?? []) as Entry[]
    },
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ScrollText size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('audit.auditLog')}</h3>
        <select value={action} onChange={e => setAction(e.target.value)} aria-label={t('audit.action')} className="input ml-auto w-48 text-xs py-1">
          <option value="">{t('audit.allActions')}</option>
          {ACTIONS.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
      </div>
      <p className="text-xs text-ink-muted max-w-2xl">{t('audit.intro')}</p>
      {error ? <p role="alert" className="text-sm text-rose-500">{describeError(error)}</p>
        : isLoading ? <p className="text-sm text-ink-muted">{t('partners.loading')}</p>
        : data.length === 0 ? <p className="text-sm text-ink-muted">{t('audit.empty')}</p>
        : (
          <table className="w-full text-xs">
            <thead className="text-left text-ink-muted uppercase tracking-wider text-[10px]">
              <tr><th className="py-1.5 pr-3">{t('audit.when')}</th><th className="pr-3">{t('audit.who')}</th><th className="pr-3">{t('audit.action')}</th><th className="pr-3">{t('audit.what')}</th><th /></tr>
            </thead>
            <tbody>
              {data.map(e => (
                <tr key={e.id} className="border-t border-ink-faint/15">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{format(new Date(e.at), 'd MMM yyyy HH:mm:ss', { locale: dateLocale })}</td>
                  <td className="pr-3">{e.user_name || t('audit.system')}</td>
                  <td className="pr-3">{actionLabel(e.action)}</td>
                  <td className="pr-3 font-mono">{e.job_code ?? e.object}</td>
                  <td className="text-ink-muted">{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  )
}
