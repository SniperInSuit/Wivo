/**
 * "Export for the patient" (spec, Phase 1 Files: a PDF — patient, jobs,
 * treatment plans — and a ZIP of their files; the download is logged).
 *
 * The document is the PATIENT's, so it is written in the clinic's own default
 * language, not whichever language the person at the keyboard reads (spec:
 * language and country rules are separate; DECISIONS.md D8). Treatment plans
 * arrive in Phase 4; until then the PDF covers the record and the jobs.
 *
 * `patient_export` writes the single audit row and grants every file for two
 * minutes; the files are fetched with those grants and zipped with the PDF.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { PackageOpen, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { makeZip, type ZipEntry } from '../../lib/zip'
import { useAuth } from '../../context/AuthContext'
import type { Patient } from '../../types/patient'
import type { Job } from '../../types/job'
import { describeError } from './errors'
import { t } from '@/lib/i18n'
import { translate, type Lang, type MessageKey } from '@shared/i18n'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function documentHtml(lang: Lang, clinicName: string, patient: Patient, jobs: Job[], fileNames: string[]): string {
  const tr = (k: MessageKey, p?: Record<string, unknown>) => esc(translate(lang, k, p))
  const date = (d: string | null | undefined) => (d ? esc(format(new Date(d), 'dd.MM.yyyy')) : '—')
  const rows = jobs.map(j => `<tr><td>${esc(j.job_code ?? '')}</td><td>${date(j.kuupaev)}</td><td>${esc(j.too ?? '')}</td>`
    + `<td>${esc(j.hambad ?? '')}</td><td>${esc(j.materjal ?? '')}</td><td>${esc(j.varv ?? '')}</td><td>${date(j.valmis_aeg)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,system-ui,sans-serif;font-size:11pt;color:#111;margin:24px}
    h1{font-size:18pt;margin:0 0 4px} h2{font-size:12pt;margin:20px 0 6px}
    table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;font-size:9.5pt}
    .muted{color:#666}</style></head><body>
    <h1>${esc(patient.nimi)}</h1>
    <p class="muted">${tr('patientExport.madeBy', { clinic: clinicName, date: format(new Date(), 'dd.MM.yyyy') })}</p>
    <h2>${tr('patientExport.details')}</h2>
    <table><tr><th>${tr('patientExport.dateOfBirth')}</th><td>${date(patient.synniaeg)}</td></tr>
    <tr><th>${tr('patientExport.phone')}</th><td>${esc(patient.telefon ?? '—')}</td></tr>
    <tr><th>${tr('patientExport.email')}</th><td>${esc(patient.email ?? '—')}</td></tr></table>
    <h2>${tr('patientExport.jobs')}</h2>
    ${jobs.length ? `<table><tr><th>${tr('patientExport.code')}</th><th>${tr('patientExport.received')}</th><th>${tr('patientExport.work')}</th>`
      + `<th>${tr('patientExport.teeth')}</th><th>${tr('patientExport.material')}</th><th>${tr('patientExport.shade')}</th><th>${tr('patientExport.due')}</th></tr>${rows}</table>`
      : `<p class="muted">${tr('patientExport.none')}</p>`}
    <h2>${tr('patientExport.files')}</h2>
    ${fileNames.length ? `<p>${fileNames.map(esc).join('<br>')}</p>` : `<p class="muted">${tr('patientExport.none')}</p>`}
    </body></html>`
}

export function PatientExport({ patient, jobs }: { patient: Patient; jobs: Job[] }) {
  const { clinic } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('patient_export', { p_patient: patient.id })
      if (err) throw err
      const files = (data ?? []) as { file_name: string; storage_path: string }[]
      const entries: ZipEntry[] = []
      for (const f of files) {
        const { data: link, error: linkErr } = await supabase.storage.from('job-files').createSignedUrl(f.storage_path, 120)
        if (linkErr) throw linkErr
        entries.push({ name: `files/${f.file_name}`, data: new Uint8Array(await (await fetch(link.signedUrl)).arrayBuffer()) })
      }
      const lang: Lang = clinic?.default_language ?? 'et'
      const html = documentHtml(lang, clinic?.name ?? '', patient, jobs, files.map(f => f.file_name))
      const base = `${patient.nimi} ${format(new Date(), 'yyyy-MM-dd')}`.replace(/[\\/:*?"<>|]/g, '')
      const pdf = await window.wivo?.htmlToPdf?.(html)
      entries.unshift(pdf
        ? { name: `${base}.pdf`, data: pdf }
        : { name: `${base}.html`, data: new TextEncoder().encode(html) }) // no Electron (dev in a browser)

      const zip = makeZip(entries)
      const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Wivo ${base}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={run} disabled={busy}
        className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <PackageOpen size={12} aria-hidden="true" />}
        {t('patients.exportForPatient')}
      </button>
      <span className="text-[11px] text-ink-muted">{t('patients.exportHelp')}</span>
      {error && <span role="alert" className="text-xs text-rose-500">{error}</span>}
    </div>
  )
}
