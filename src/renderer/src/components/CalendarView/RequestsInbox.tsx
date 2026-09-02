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
import { et } from 'date-fns/locale'
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
  ootel:       { text: 'Tasumata',   cls: 'bg-amber-100 text-amber-700' },
  makstud:     { text: 'Tasutud',    cls: 'bg-emerald-100 text-emerald-700' },
  ebaonnestus: { text: 'Makse tõrge', cls: 'bg-red-100 text-red-700' },
  tuhistatud:  { text: 'Makse katkes', cls: 'bg-ink-faint/15 text-ink-muted' },
}

const FILTERS: { key: VisitRequestStatus | 'all'; label: string }[] = [
  { key: 'uus',        label: 'Uued' },
  { key: 'kinnitatud', label: 'Kinnitatud' },
  { key: 'lykatud',    label: 'Tagasi lükatud' },
  { key: 'ramps',      label: 'Rämps' },
  { key: 'all',        label: 'Kõik' },
]

function fmt(iso: string): string {
  const d = parseISO(iso)
  return isValid(d) ? format(d, 'dd.MM.yyyy HH:mm', { locale: et }) : '—'
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
            <p className="text-sm font-semibold text-ink">Taotluste tabelit ei ole veel</p>
            <p className="text-xs text-ink-muted mt-1">
              Jooksuta <code className="text-accent">sql/059_visit_requests.sql</code> Supabase
              SQL editoris. Kuni seda ei ole, ei saa veebivorm kuhugi kirjutada.
            </p>
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
          <Inbox size={15} /> Visiiditaotlused
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
            ? 'Uusi taotlusi ei ole.'
            : 'Selles vaates ei ole taotlusi.'}
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
                    {r.eelistatud_aeg && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {r.eelistatud_aeg}
                      </span>
                    )}
                  </div>
                  {r.sonum && (
                    <p className="text-xs text-ink-soft mt-1.5 flex items-start gap-1.5">
                      <MessageSquare size={11} className="flex-shrink-0 mt-0.5 text-ink-faint" />
                      <span className="min-w-0">{r.sonum}</span>
                    </p>
                  )}
                  <p className="text-[10px] text-ink-faint mt-1.5">
                    Saadetud {fmt(r.created_at)}
                    {r.service_id && ` · soovitud teenus: ${r.service_id}`}
                    {r.kasitles && r.kasitletud_at
                      && ` · käsitles ${nameOf(r.kasitles) || '—'} ${fmt(r.kasitletud_at)}`}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {r.staatus === 'uus' && (
                    <>
                      <button
                        onClick={() => setConfirming(r)}
                        className="btn-primary text-xs px-2.5 py-1 flex items-center gap-1"
                      >
                        <Check size={11} /> Broneeri
                      </button>
                      <button
                        onClick={() => setStatus(r, 'lykatud')}
                        title="Ei sobi — jääb kirja, kustub 90 päeva pärast"
                        className="btn-ghost text-xs px-2 py-1 border border-ink-faint/30 flex items-center gap-1"
                      >
                        <X size={11} /> Lükka tagasi
                      </button>
                      <button
                        onClick={() => setStatus(r, 'ramps')}
                        title="Rämps"
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
                        Tagasi uueks
                      </button>
                      <button
                        onClick={() => remove.mutate(r.id)}
                        title="Kustuta jäädavalt"
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
          prefillRequest={{
            nimi: confirming.nimi,
            markus: [
              `Veebitaotlus · ${confirming.telefon}`,
              confirming.eelistatud_aeg && `Soovitud aeg: ${confirming.eelistatud_aeg}`,
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
