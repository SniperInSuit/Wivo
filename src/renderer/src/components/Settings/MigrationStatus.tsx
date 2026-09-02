/**
 * Which migrations have actually been run — asked of the database, not of a
 * list somebody keeps by hand.
 *
 * Migrations here are run by hand in the Supabase editor, so "did I run that
 * one" is answered by memory. Memory is wrong, and the way it turns out to be
 * wrong is a feature that silently keeps its data in localStorage, or a screen
 * that shows nothing with no error. That has now happened often enough to be
 * worth a screen of its own.
 *
 * ── How it checks ────────────────────────────────────────────────────────────
 * By SELECTING the column, `limit 0`. PostgREST answers PGRST204 / 42703 when a
 * column is missing and 42P01 when the table is. No rows are fetched and no
 * information_schema access is needed — the same request the app would make
 * anyway, just asking whether it is possible.
 *
 * A probe that fails for any OTHER reason (offline, RLS, permissions) reports
 * "ei saanud kontrollida" rather than "missing". Telling somebody to re-run a
 * migration they have already run is its own waste of an afternoon.
 */
import { useEffect, useState } from 'react'
import { Check, X, HelpCircle, RefreshCw, Database } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Probe {
  fail: string
  table: string
  column: string
  mis: string
}

/**
 * Only migrations that add something probeable, newest first. A migration that
 * changes a constraint or a policy cannot be seen this way and is deliberately
 * absent rather than guessed at.
 */
const PROBES: Probe[] = [
  { fail: 'sql/062_visit_requests_realtime.sql', table: 'visit_requests', column: 'id',
    mis: 'Taotlused reaalajas (sama tabel kui 059 — kontrollib olemasolu)' },
  { fail: 'sql/061_visit_request_payment.sql', table: 'visit_requests', column: 'soovitud_algus',
    mis: 'Visiiditasu ja veebist valitud aeg' },
  { fail: 'sql/059_visit_requests.sql', table: 'visit_requests', column: 'idempotency_key',
    mis: 'Visiiditaotluste postkast' },
  { fail: 'sql/058_payout_line_key.sql', table: 'worker_payout_lines', column: 'line_key',
    mis: 'Väljamakse rida mäletab, mis rida ta oli (topelt maksmine)' },
  { fail: 'sql/057_job_cost_override.sql', table: 'jobs', column: 'kulu_yle',
    mis: 'Omahinna käsitsi ülekirjutus' },
  { fail: 'sql/055_profile_ui_prefs.sql', table: 'profiles', column: 'ui_prefs',
    mis: 'Isiklikud vaateseaded (Minu vaade)' },
  { fail: 'sql/054_worker_net_pay.sql', table: 'profiles', column: 'tasu_arvestus',
    mis: 'Neto/bruto palk ja maksuprofiil' },
  { fail: 'sql/053_patient_marketing.sql', table: 'patients', column: 'turundusnousolek',
    mis: 'Turundusnõusolek ja kontaktide eksport' },
  { fail: 'sql/051_email_settings.sql', table: 'clinic_settings', column: 'email',
    mis: 'E-posti seaded ja saatmisõigused' },
  { fail: 'sql/050_invoice_sending.sql', table: 'invoices', column: 'sent_at',
    mis: 'Arvete saatmine (sent_at)' },
  { fail: 'sql/049_payment_plans.sql', table: 'payment_plans', column: 'id',
    mis: 'Maksegraafikud' },
  { fail: 'sql/061_visit_request_payment.sql', table: 'clinic_settings', column: 'broneering',
    mis: 'Veebibroneeringu seaded (tööajad, visiiditasu)' },
  { fail: 'sql/047_public_services.sql', table: 'clinic_settings', column: 'public_services',
    mis: 'Patsiendi hinnakiri — ilma selleta jääb ta ainult sellesse arvutisse' },
]

type State = 'ok' | 'missing' | 'unknown'

export function MigrationStatus() {
  const [state, setState] = useState<Record<string, State>>({})
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    const next: Record<string, State> = {}
    for (const p of PROBES) {
      const key = `${p.table}.${p.column}`
      try {
        const { error } = await supabase.from(p.table).select(p.column).limit(0)
        if (!error) { next[key] = 'ok'; continue }
        // PGRST204 / 42703 = no such column, 42P01 = no such table. Anything
        // else is a different problem and must not read as "not run".
        const code = (error as { code?: string }).code ?? ''
        const msg = (error.message ?? '').toLowerCase()
        next[key] = ['PGRST204', '42703', '42P01'].includes(code)
          || msg.includes('could not find') || msg.includes('does not exist')
          ? 'missing'
          : 'unknown'
      } catch {
        next[key] = 'unknown'
      }
    }
    setState(next)
    setBusy(false)
  }

  useEffect(() => { check() }, [])

  const missing = PROBES.filter(p => state[`${p.table}.${p.column}`] === 'missing')
  // One file can back several probes; the list is what to RUN, so it is unique.
  const files = [...new Set(missing.map(p => p.fail))].sort()

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Migratsioonide seis</h3>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="ml-auto btn-ghost text-xs border border-ink-faint/25 flex items-center gap-1.5"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Kontrolli
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-3">
        Küsitud andmebaasilt, mitte mälu järgi. Jooksutamata migratsioon ei anna
        veateadet — funktsioon lihtsalt ei tööta, sageli vaikselt.
      </p>

      {files.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 mb-3">
          <p className="text-xs font-semibold text-orange-800 mb-1">
            Jooksutamata: {files.length} fail{files.length === 1 ? '' : 'i'}
          </p>
          <p className="text-[11px] text-orange-700 mb-1.5">
            Supabase SQL editoris, numbrilises järjekorras. Pärast veeru lisamist
            jooksuta ka <code>notify pgrst, 'reload schema';</code> — PostgREST
            hoiab skeemi vahemälus ega märka uut veergu kohe.
          </p>
          <ul className="text-[11px] text-orange-800 font-mono space-y-0.5">
            {files.map(f => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        {PROBES.map(p => {
          const s = state[`${p.table}.${p.column}`]
          return (
            <div key={`${p.fail}|${p.table}.${p.column}`} className="flex items-start gap-2">
              {s === 'ok' && <Check size={12} className="text-emerald-600 flex-shrink-0 mt-0.5" />}
              {s === 'missing' && <X size={12} className="text-red-500 flex-shrink-0 mt-0.5" />}
              {(s === 'unknown' || !s) && (
                <HelpCircle size={12} className="text-ink-faint flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className={`text-xs ${s === 'missing' ? 'text-ink' : 'text-ink-muted'}`}>
                  {p.mis}
                </p>
                <p className="text-[10px] text-ink-faint font-mono">
                  {p.fail} · {p.table}.{p.column}
                  {s === 'unknown' && ' · ei saanud kontrollida'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
