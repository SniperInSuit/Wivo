/**
 * The appointment-request inbox — what the website form drops into.
 *
 * A request is a person asking, not a booking. Confirming one opens the ordinary
 * `VisitForm`, pre-filled, so the visit that results is a normal visit written
 * the normal way; the request then points at it. Nothing here writes to the
 * calendar directly, because a request that could put itself in the calendar
 * would make the calendar unreliable — see sql/059.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not tell the patient anything. There is no "your request was
 * confirmed" mail and no status link. A patient-facing view of their own care
 * is the MDR line this product does not cross; the clinic rings them, which is
 * what they were going to do anyway.
 */
import { useState } from 'react'
import {
  Inbox, Phone, Mail, Clock, Check, X, Ban, Trash2, MessageSquare, AlertTriangle,
} from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import { t, dateLocale } from '@/lib/i18n'
import {
  useVisitRequests, useUpdateVisitRequest, useDeleteVisitRequest,
  REQUEST_STATUS_LABEL, type VisitRequest, type VisitRequestStatus,
} from '../../hooks/useVisitRequests'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { VisitForm } from './VisitForm'
import { describeError } from '../Patients/errors'

const STATUS_STYLE: Record<VisitRequestStatus, string> = {
  uus:        'bg-accent/15 text-accent',
  kinnitatud: 'bg-emerald-100 text-emerald-700',
  lykatud:    'bg-ink-faint/15 text-ink-muted',
  ramps:      'bg-red-100 text-red-700',
}

/**
 * The visit fee, said plainly. Its entire purpose is to tell the clinic whether
 * this person put money behind the request — a paid one is worth ringing first,
 * and an unpaid one is not yet a commitment.
 */
const MAKSE_SILT: Record<string, { text: string; cls: string } | null> = {
  vaba:        null,   // no fee was asked for: nothing to say
  ootel:       { text: t('calendarView.unpaid'),   cls: 'bg-amber-100 text-amber-700' },
  makstud:     { text: t('calendarView.paid'),    cls: 'bg-emerald-100 text-emerald-700' },
  ebaonnestus: { text: t('calendarView.paymentFailed'), cls: 'bg-red-100 text-red-700' },
  tuhistatud:  { text: t('calendarView.paymentCancelled'), cls: 'bg-ink-faint/15 text-ink-muted' },
}

const FILTERS: { key: VisitRequestStatus | 'all'; label: string }[] = [
  { key: 'uus',        label: t('calendarView.new') },
  { key: 'kinnitatud', label: t('calendarView.confirmed') },
  { key: 'lykatud',    label: t('calendarView.declined') },
  { key: 'ramps',      label: t('calendarView.spam') },
  { key: 'all',        label: t('calendarView.all') },
]

function fmt(iso: string): string {
  const d = parseISO(iso)
  return isValid(d) ? format(d, 'dd.MM.yyyy HH:mm', { locale: dateLocale }) : '—'
}

export function RequestsInbox() {
  const { data: requests = [], isError, error } = useVisitRequests()
  const update = useUpdateVisitRequest()
  const remove = useDeleteVisitRequest()
  const { data: staff = [] } = useClinicProfiles()
  const nameOf = (id: string) => staff.find(p => p.id === id)?.full_name ?? ''
  const [filter, setFilter] = useState<VisitRequestStatus | 'all'>('uus')
  const [confirming, setConfirming] = useState<VisitRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const shown = filter === 'all' ? requests : requests.filter(r => r.staatus === filter)
  const countOf = (k: VisitRequestStatus | 'all') =>
    k === 'all' ? requests.length : requests.filter(r => r.staatus === k).length

  async function setStatus(r: VisitRequest, staatus: VisitRequestStatus) {
    setActionError(null)
    try { await update.mutateAsync({ id: r.id, staatus }) }
    catch (err) { setActionError(describeError(err)) }
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="card p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-ink">{t('calendarView.theRequestsTableDoesNotExist')}</p>
            <p className="text-xs text-ink-muted mt-1">{t('app.notAvailableYet')}</p>
            <p className="text-[11px] text-ink-faint mt-2">{describeError(error)}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Inbox size={15} /> {t('calendarView.visitRequests')}
        </h2>
        <div className="flex items-center gap-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === f.key ? 'chip-active' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
              }`}
            >
              {f.label} ({countOf(f.key)})
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <p className="text-xs text-red-500">{actionError}</p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint py-10 text-center">
          {filter === 'uus'
            ? t('calendarView.noNewRequests')
            : t('calendarView.noRequestsInThisView')}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map(r => (
            <div key={r.id} className="card p-3.5">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink flex items-center gap-2 flex-wrap">
                    {r.nimi}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[r.staatus]}`}>
                      {REQUEST_STATUS_LABEL[r.staatus]}
                    </span>
                    {MAKSE_SILT[r.makse_staatus] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${MAKSE_SILT[r.makse_staatus]!.cls}`}>
                        {MAKSE_SILT[r.makse_staatus]!.text}
                        {r.makse_summa != null && ` ${Number(r.makse_summa).toFixed(2)} €`}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-ink-muted">
                    {/* Clickable: the whole point of the inbox is that somebody
                        rings this number, and retyping it is where that stalls. */}
                    <a href={`tel:${r.telefon}`} className="flex items-center gap-1 hover:text-accent">
                      <Phone size={11} /> {r.telefon}
                    </a>
                    {r.email && (
                      <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-accent">
                        <Mail size={11} /> {r.email}
                      </a>
                    )}
                    {/* A time chosen from the real diary beats free text, so it
                        leads — and it says it is not yet in the calendar. */}
                    {r.soovitud_algus ? (
                      <span className="flex items-center gap-1 text-accent font-medium">
                        <Clock size={11} /> {fmt(r.soovitud_algus)}
                        {r.soovitud_kestus ? ` · ${r.soovitud_kestus} min` : ''}
                      </span>
                    ) : r.eelistatud_aeg ? (
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {r.eelistatud_aeg}
                      </span>
                    ) : null}
                  </div>
                  {r.sonum && (
                    <p className="text-xs text-ink-soft mt-1.5 flex items-start gap-1.5">
                      <MessageSquare size={11} className="flex-shrink-0 mt-0.5 text-ink-faint" />
                      <span className="min-w-0">{r.sonum}</span>
                    </p>
                  )}
                  {/* What they priced. The FDI numbers matter more than the
                      figure: a total with no teeth behind it cannot be checked
                      by the person who picks up the phone. */}
                  {r.valik && r.valik.length > 0 && (
                    <div className="mt-1.5 rounded-lg bg-bg-sidebar px-2 py-1.5">
                      <p className="text-[11px] text-ink-soft">
                        {t('calendarView.calculatedOnline')}{' '}
                        <span className="font-semibold tabular-nums">
                          {r.hinnang != null ? `${Number(r.hinnang).toFixed(2)} €` : '—'}
                        </span>
                        <span className="text-ink-faint"> · {t('calendarView.estimate')}</span>
                      </p>
                      {r.valik.map((v, i) => (
                        <p key={i} className="text-[10px] text-ink-muted">
                          {v.serviceId}: {v.hambad.join(', ') || '—'}
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-ink-faint mt-1.5">
                    {t('calendarView.sent')} {fmt(r.created_at)}
                    {r.service_id && t('calendarView.requestedService', { service_id: r.service_id })}
                    {r.kasitles && r.kasitletud_at
                      && t('calendarView.handledBy', { value: nameOf(r.kasitles) || '—', kasitletud_at: fmt(r.kasitletud_at) })}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {r.staatus === 'uus' && (
                    <>
                      <button
                        onClick={() => setConfirming(r)}
                        className="btn-primary text-xs px-2.5 py-1 flex items-center gap-1"
                      >
                        <Check size={11} /> {t('calendarView.book')}
                      </button>
                      <button
                        onClick={() => setStatus(r, 'lykatud')}
                        title={t('calendarView.notSuitableKeptOnRecordDeleted')}
                        className="btn-ghost text-xs px-2 py-1 border border-ink-faint/30 flex items-center gap-1"
                      >
                        <X size={11} /> {t('calendarView.decline')}
                      </button>
                      <button
                        onClick={() => setStatus(r, 'ramps')}
                        title={t('calendarView.spam')}
                        className="p-1.5 rounded text-ink-faint hover:text-red-500 transition-colors"
                      >
                        <Ban size={12} />
                      </button>
                    </>
                  )}
                  {r.staatus !== 'uus' && (
                    <>
                      <button
                        onClick={() => setStatus(r, 'uus')}
                        className="btn-ghost text-xs px-2 py-1 border border-ink-faint/30"
                      >
                        {t('calendarView.backToNew')}
                      </button>
                      <button
                        onClick={() => remove.mutate(r.id)}
                        title={t('calendarView.deletePermanently')}
                        className="p-1.5 rounded text-ink-faint hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The ordinary visit form, seeded. A visit made here is a normal visit —
          no second code path, no second set of rules about what a visit is. */}
      {confirming && (
        <VisitForm
          visit={null}
          initialDate={confirming.soovitud_algus ? parseISO(confirming.soovitud_algus) : undefined}
          initialDuration={confirming.soovitud_kestus ?? undefined}
          prefillRequest={{
            nimi: confirming.nimi,
            markus: [
              `Veebitaotlus · ${confirming.telefon}`,
              confirming.soovitud_algus
                ? `Veebist valitud aeg: ${fmt(confirming.soovitud_algus)}`
                : confirming.eelistatud_aeg && `Soovitud aeg: ${confirming.eelistatud_aeg}`,
              confirming.sonum,
            ].filter(Boolean).join('\n'),
          }}
          onCreated={visitId => {
            // Linked in the same breath as confirming, so a request can never
            // read "kinnitatud" while pointing at nothing.
            update.mutate({ id: confirming.id, staatus: 'kinnitatud', visit_id: visitId })
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
