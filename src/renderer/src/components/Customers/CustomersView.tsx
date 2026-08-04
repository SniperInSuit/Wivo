/**
 * Kliendid — the dental practices this lab sells to.
 *
 * Not to be confused with the clinic in Seaded, which is the lab's own company
 * profile. `sql/035` explains the naming collision; the UI keeps them apart by
 * calling this one "Kliendid" and never "Kliinikud".
 */
import { useMemo, useState } from 'react'
import { Plus, Search, Building2, Archive, ArchiveRestore, Pencil, Trash2, Loader2, X } from 'lucide-react'
import type { Customer, CustomerInput } from '../../types/customer'
import { BILLING_MODE_LABEL, BILLING_MODE_HINT, EMPTY_CUSTOMER } from '../../types/customer'
import {
  useCustomers, useCreateCustomer, useUpdateCustomer, useArchiveCustomer, useDeleteCustomer,
} from '../../hooks/useCustomers'
import { useJobs } from '../../hooks/useJobs'
import { useInvoices } from '../../hooks/useInvoices'
import { describeError } from '../Patients/errors'

export function CustomersView() {
  const { data: customers = [], isLoading } = useCustomers()
  const { data: jobs = [] } = useJobs()
  const { data: invoices = [] } = useInvoices()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)

  // What each customer has behind them. Drives both the list columns and the
  // "can this be deleted" answer — a customer with history is archived, never
  // deleted, because both FKs are `on delete set null`.
  const stats = useMemo(() => {
    const m = new Map<string, { jobs: number; invoices: number }>()
    const bump = (id: string | null, key: 'jobs' | 'invoices') => {
      if (!id) return
      const cur = m.get(id) ?? { jobs: 0, invoices: 0 }
      cur[key]++
      m.set(id, cur)
    }
    for (const j of jobs) bump(j.customer_id, 'jobs')
    for (const i of invoices) bump(i.customer_id ?? null, 'invoices')
    return m
  }, [jobs, invoices])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers
      .filter(c => showArchived ? true : !c.archived_at)
      .filter(c => !q
        || c.name.toLowerCase().includes(q)
        || (c.contact_name ?? '').toLowerCase().includes(q)
        || (c.email ?? '').toLowerCase().includes(q))
  }, [customers, query, showArchived])

  const archivedCount = customers.filter(c => c.archived_at).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-ink-faint/15 bg-bg-card flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Otsi klienti…"
            className="input pl-8 py-1.5 text-sm"
          />
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              showArchived ? 'chip-active' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
            }`}
          >
            <Archive size={12} />
            Arhiiv ({archivedCount})
          </button>
        )}
        <button onClick={() => setEditing('new')} className="btn-primary ml-auto flex-shrink-0">
          <Plus size={15} /> Uus klient
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-ink-faint p-6">Laen…</p>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 size={32} className="mx-auto text-ink-faint/50 mb-3" />
            <p className="text-sm text-ink-muted">
              {query ? 'Vastet ei leitud' : 'Kliente pole veel lisatud'}
            </p>
            {!query && (
              <p className="text-xs text-ink-faint mt-1 max-w-sm mx-auto">
                Klient on hambaravikliinik, kes sulle töid saadab. Tööd ja arved
                seotakse kliendiga, et näeksid, kes mida tellis ja kellele arveldada.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-card">
              <tr className="border-b border-ink-faint/15 text-xs font-semibold text-ink-muted uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Klient</th>
                <th className="px-4 py-3 text-left">Kontakt</th>
                <th className="px-4 py-3 text-left">Arveldus</th>
                <th className="px-4 py-3 text-right">Tööd</th>
                <th className="px-4 py-3 text-right">Arved</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map(c => {
                const s = stats.get(c.id) ?? { jobs: 0, invoices: 0 }
                return (
                  <tr
                    key={c.id}
                    onClick={() => setEditing(c)}
                    className={`border-b border-ink-faint/10 cursor-pointer hover:bg-bg-sidebar/50 transition-colors ${
                      c.archived_at ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{c.name}</p>
                      {c.reg_code && <p className="text-xs text-ink-faint">{c.reg_code}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted text-xs">
                      {c.contact_name && <p>{c.contact_name}</p>}
                      {c.email && <p className="text-ink-faint">{c.email}</p>}
                      {!c.contact_name && !c.email && <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {BILLING_MODE_LABEL[c.billing_mode]}
                      <span className="text-ink-faint"> · {c.payment_terms_days} p</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.jobs || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.invoices || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Pencil size={13} className="text-ink-faint inline" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          history={editing === 'new' ? { jobs: 0, invoices: 0 } : (stats.get(editing.id) ?? { jobs: 0, invoices: 0 })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function CustomerForm({ customer, history, onClose }: {
  customer: Customer | null
  history: { jobs: number; invoices: number }
  onClose: () => void
}) {
  const create = useCreateCustomer()
  const update = useUpdateCustomer()
  const archive = useArchiveCustomer()
  const del = useDeleteCustomer()
  const [form, setForm] = useState<CustomerInput>(() =>
    customer ? { ...customer } : { ...EMPTY_CUSTOMER })
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // A customer that has produced work or documents is history. Deleting them
  // would null the link on every one of those rows and leave them unattributed.
  const hasHistory = history.jobs > 0 || history.invoices > 0
  const saving = create.isPending || update.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError('Nimi on kohustuslik'); return }
    try {
      const patch = { ...form, name: form.name.trim() }
      if (customer) await update.mutateAsync({ id: customer.id, patch })
      else await create.mutateAsync(patch)
      onClose()
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="card w-full max-w-lg max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-faint/15">
          <h2 className="text-base font-semibold text-ink">
            {customer ? form.name || 'Klient' : 'Uus klient'}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Nimi *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Hambaravi OÜ"
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Registrikood</label>
              <input value={form.reg_code ?? ''} onChange={e => set('reg_code', e.target.value || null)} className="input" />
            </div>
            <div>
              <label className="label">KMKR number</label>
              <input value={form.vat_number ?? ''} onChange={e => set('vat_number', e.target.value || null)} className="input" />
            </div>
          </div>

          <div>
            <label className="label">Aadress</label>
            <input value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} className="input" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Kontaktisik</label>
              <input value={form.contact_name ?? ''} onChange={e => set('contact_name', e.target.value || null)} className="input" />
            </div>
            <div>
              <label className="label">Telefon</label>
              <input value={form.phone ?? ''} onChange={e => set('phone', e.target.value || null)} className="input" />
            </div>
          </div>

          <div>
            <label className="label">E-post</label>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={e => set('email', e.target.value || null)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Arveldus</label>
            <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
              {(['per_job', 'monthly'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('billing_mode', m)}
                  className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                    form.billing_mode === m ? 'chip-active' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {BILLING_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">
              {BILLING_MODE_HINT[form.billing_mode]}
            </p>
          </div>

          <div>
            <label className="label">Maksetähtaeg (päeva)</label>
            <input
              type="number"
              min={0}
              max={180}
              value={form.payment_terms_days}
              onChange={e => set('payment_terms_days', Number(e.target.value) || 0)}
              className="input w-28"
            />
          </div>

          <div>
            <label className="label">Märkus</label>
            <textarea
              value={form.note ?? ''}
              onChange={e => set('note', e.target.value || null)}
              rows={2}
              className="input resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-ink-faint/15">
          {customer && (
            <>
              <button
                type="button"
                onClick={() => archive.mutate(
                  { id: customer.id, archived: !customer.archived_at },
                  { onSuccess: onClose }
                )}
                className="btn-ghost text-xs border border-ink-faint/25"
              >
                {customer.archived_at
                  ? <><ArchiveRestore size={12} /> Taasta</>
                  : <><Archive size={12} /> Arhiveeri</>}
              </button>
              {/* Delete only for a customer nobody has traded with yet — the
                  "typed the wrong name" case. Anything with history is archived,
                  or its jobs and invoices lose the name they were ordered under. */}
              {!hasHistory && (
                confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => del.mutate(customer.id, { onSuccess: onClose })}
                    className="btn-ghost text-xs text-red-500 border border-red-500/30"
                  >
                    <Trash2 size={12} /> Kinnita kustutamine
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-ink-faint hover:text-red-500 transition-colors px-2"
                  >
                    Kustuta
                  </button>
                )
              )}
              {hasHistory && (
                <span className="text-[11px] text-ink-faint">
                  {history.jobs} tööd · {history.invoices} arvet — kustutada ei saa
                </span>
              )}
            </>
          )}
          <button type="button" onClick={onClose} className="btn-ghost text-sm ml-auto">
            Loobu
          </button>
          <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Salvesta
          </button>
        </div>
      </form>
    </div>
  )
}
