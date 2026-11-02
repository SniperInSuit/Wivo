/**
 * A job's comments and questions (spec, Phase 1: "comments and questions on a
 * job, on top of chat"; "Question" is a flag on the card, not a column).
 *
 * The same component on both sides of a shared job. It talks only to the
 * thread RPCs, so a partner never needs to be a member of the owner's channel.
 */
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { HelpCircle, CheckCircle2, Send, Paperclip, Loader2, Camera } from 'lucide-react'
import { useJobThread, usePostJobComment, useResolveQuestion } from '@/hooks/usePartners'
import { describeError } from '../Patients/errors'
import { enqueueUpload } from '../../lib/uploadQueue'
import { fileDownloadUrl } from '../../lib/fileLink'
import { guessFileType } from '../../lib/fileClean'
import { confirmSharedUpload } from '../../lib/sharedUpload'
import { playSound } from '../../lib/sound'
import { useAuth } from '../../context/AuthContext'
import { PhoneCamera } from '../../mobile/PhoneCamera'
import { t, dateLocale } from '@/lib/i18n'

/** `camera`: a button for a photo taken inside the app (the phone app; never for a partner). */
export function JobThread({ jobId, readOnly = false, partner = false, camera = false }: { jobId: string; readOnly?: boolean; partner?: boolean; camera?: boolean }) {
  const { data: messages = [], isLoading } = useJobThread(jobId)
  const post = usePostJobComment(jobId)
  const resolve = useResolveQuestion(jobId)
  const [body, setBody] = useState('')
  const [asQuestion, setAsQuestion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A file for the comment: uploaded the normal way first (same rules — a
  // partner adds design files only), then the comment points at it.
  const [attachment, setAttachment] = useState<{ name: string; id: string | null } | null>(null)
  const { profile } = useAuth()
  const [shooting, setShooting] = useState(false)

  // A message from someone else that appears while the thread is open sounds
  // once — with the message itself on screen. The first load is history, not
  // news. Questions from the other side are announced by the bell instead,
  // so they do not sound twice.
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (isLoading) return
    if (!seen.current) { seen.current = new Set(messages.map(m => m.id)); return }
    for (const m of messages) {
      if (seen.current.has(m.id)) continue
      seen.current.add(m.id)
      if (m.mine) continue
      if (mentionsMe(m.body, profile?.full_name, profile?.username)) playSound('notify-mention')
      else if (!m.is_question) playSound('notify-message')
    }
  }, [messages, isLoading, profile?.full_name, profile?.username])

  /** `confirmed`: the camera asked before it opened. */
  async function attach(file: File | undefined, confirmed = false) {
    if (!file) return
    const type = partner ? 'design' : guessFileType(file.name)
    if (!partner && !confirmed && !(await confirmSharedUpload(jobId, [{ name: file.name, type, mime: file.type }]))) return
    setAttachment({ name: file.name, id: null })
    enqueueUpload(jobId, file, type, null, id => setAttachment(a => (a ? { ...a, id } : a)))
  }

  async function open(fileId: string, name: string) {
    try {
      window.open(await fileDownloadUrl(fileId, name))
    } catch (e) {
      setError(describeError(e))
    }
  }

  async function send() {
    if (!body.trim() && !attachment?.id) return
    setError(null)
    try {
      await post.mutateAsync({ body, isQuestion: asQuestion, fileId: attachment?.id ?? null })
      playSound('message-sent')
      setBody('')
      setAsQuestion(false)
      setAttachment(null)
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
              {m.file_id && m.file_name && (
                <button type="button" onClick={() => void open(m.file_id!, m.file_name!)}
                  className="mt-1 flex items-center gap-1 text-xs font-mono text-accent hover:underline">
                  <Paperclip size={11} aria-hidden="true" /> {m.file_name}
                </button>
              )}
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
            <label className="flex items-center gap-1 text-xs text-ink-soft cursor-pointer" title={t('partners.attachFile')}>
              {attachment && !attachment.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Paperclip size={12} aria-hidden="true" />}
              <span className="truncate max-w-[140px]">{attachment?.name ?? t('partners.attachFile')}</span>
              <input type="file" hidden onChange={e => { void attach(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {camera && !partner && !attachment && (
              <button type="button" title={t('mobile.takePhoto')} aria-label={t('mobile.takePhoto')} className="text-ink-soft"
                onClick={async () => { if (await confirmSharedUpload(jobId, [{ name: 'photo.jpg', type: 'photo' }])) setShooting(true) }}>
                <Camera size={14} aria-hidden="true" />
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={asQuestion} onChange={e => setAsQuestion(e.target.checked)} />
              {t('partners.askAsQuestion')}
            </label>
            <button type="button" onClick={send}
              disabled={(!body.trim() && !attachment?.id) || (!!attachment && !attachment.id) || post.isPending}
              className="btn-primary ml-auto flex items-center gap-1.5 text-sm disabled:opacity-50">
              <Send size={14} aria-hidden="true" />
              {t('partners.send')}
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
          {shooting && <PhoneCamera single onFile={f => void attach(f, true)} onClose={() => setShooting(false)} />}
        </div>
      )}
    </section>
  )
}

/** "@Mari" or "@mari.k" anywhere in the text: the first name or the username. */
export function mentionsMe(body: string, fullName?: string | null, username?: string | null): boolean {
  const names = [fullName?.trim().split(/\s+/)[0], username].filter((n): n is string => !!n && n.length > 1)
  const text = body.toLowerCase()
  return names.some(n => new RegExp(`(^|\\W)@${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(text))
}
