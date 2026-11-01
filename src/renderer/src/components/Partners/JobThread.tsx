/**
 * A job's comments and questions (spec, Phase 1: "comments and questions on a
 * job, on top of chat"; "Question" is a flag on the card, not a column).
 *
 * The same component on both sides of a shared job. It talks only to the
 * thread RPCs, so a partner never needs to be a member of the owner's channel.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { HelpCircle, CheckCircle2, Send } from 'lucide-react'
import { useJobThread, usePostJobComment, useResolveQuestion } from '@/hooks/usePartners'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

export function JobThread({ jobId, readOnly = false }: { jobId: string; readOnly?: boolean }) {
  const { data: messages = [], isLoading } = useJobThread(jobId)
  const post = usePostJobComment(jobId)
  const resolve = useResolveQuestion(jobId)
  const [body, setBody] = useState('')
  const [asQuestion, setAsQuestion] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!body.trim()) return
    setError(null)
    try {
      await post.mutateAsync({ body, isQuestion: asQuestion })
      setBody('')
      setAsQuestion(false)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('partners.commentsAndQuestions')}</h3>

      {isLoading ? (
        <p className="text-sm text-ink-muted">{t('partners.loading')}</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('partners.noCommentsYet')}</p>
      ) : (
        <ul className="space-y-2">
          {messages.map(m => (
            <li key={m.id}
              className={`rounded-xl px-3 py-2 text-sm ${m.is_question && !m.resolved_at
                ? 'border border-amber-400/60 bg-amber-400/10'
                : 'bg-bg-sidebar'}`}>
              <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                {m.is_question && (m.resolved_at
                  ? <CheckCircle2 size={12} className="text-emerald-500" aria-label={t('partners.answered')} />
                  : <HelpCircle size={12} className="text-amber-500" aria-label={t('partners.openQuestion')} />)}
                <span className="font-semibold text-ink-soft">{m.author_name || '—'}</span>
                {m.author_org && <span>· {m.author_org}</span>}
                <span className="ml-auto">{format(new Date(m.created_at), 'd MMM HH:mm', { locale: dateLocale })}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
              {m.is_question && !m.resolved_at && !readOnly && (
                <button type="button" onClick={() => resolve.mutate(m.id)}
                  className="mt-1 text-xs font-semibold text-accent hover:underline">
                  {t('partners.markAnswered')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="space-y-2">
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
            placeholder={t('partners.writeAComment')}
            className="input w-full resize-y" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={asQuestion} onChange={e => setAsQuestion(e.target.checked)} />
              {t('partners.askAsQuestion')}
            </label>
            <button type="button" onClick={send} disabled={!body.trim() || post.isPending}
              className="btn-primary ml-auto flex items-center gap-1.5 text-sm disabled:opacity-50">
              <Send size={14} aria-hidden="true" />
              {t('partners.send')}
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        </div>
      )}
    </section>
  )
}
