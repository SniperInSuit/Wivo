import { useId } from 'react'
import { AlertCircle } from 'lucide-react'
import type { WizardStepComponent } from '../types'
import { fieldErrors } from '../types'
import { WizardField } from '../ui/WizardField'
import { WizardCustomerSelect } from '../patient/WizardCustomerSelect'
import { WIZARD_INPUT, WIZARD_LABEL, WIZARD_HELP, WIZARD_ERROR } from '../wizardTheme'
import { t } from '@/lib/i18n'
import { PatientPicker } from '@/components/Patients/PatientPicker'

/**
 * Step 5 — "Patsient ja tellimus".
 *
 * Everything here is about WHO the job is for, and nothing here is about how it
 * is made. Every field carries visible helper text rather than a tooltip: this
 * product is used by people who will not hover to find out what a field means,
 * and a hidden explanation is the same as no explanation.
 */
export const StepOrder: WizardStepComponent = ({ state, patch, errors, showErrors }) => {
  const customerId = useId()
  const refId = useId()
  const descriptionId = useId()
  const notesId = useId()

  const patientError = showErrors ? fieldErrors(errors, 'patient')[0]?.message ?? null : null
  const customerError = showErrors ? fieldErrors(errors, 'customer')[0]?.message ?? null : null
  const refError = showErrors ? fieldErrors(errors, 'customerReference')[0]?.message ?? null : null

  return (
    <div className="max-w-[820px] space-y-8">

      {/* ── Kes ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h3 className="text-base font-semibold text-ink">{t('Kelle jaoks', 'Who it is for')}</h3>

        {/* PatientPicker is reused verbatim — it owns the patient-record linking
            and the "Loo patsient" shortcut, and forking it here would give the
            wizard a second way to create a patient. It ships its own <label>,
            so it is NOT wrapped in a WizardField (two labels on one input reads
            as two fields). Its chrome is sized up to the wizard's 16px / 44px
            floor from the outside instead. */}
        <div
          // The dropdown ROWS are patched too, not just the input: the option
          // labels are 14px and their clinic/doctor line and the seotud badge
          // are 10px, which is a quarter of the size this wizard promises. The
          // descendant selectors out-specify the component's own text-[10px].
          onKeyDown={e => {
            // Escape belongs to the dropdown before it belongs to the wizard.
            // PatientPicker has no Escape handler of its own, so the key used to
            // travel up to the shell's window listener and raise the
            // unsaved-changes dialog on a form the user was mid-way through
            // typing into. Stopping it here is enough — the shell listens on
            // `window`, which is the last node the event reaches. The synthetic
            // mousedown is what the picker itself treats as "clicked away".
            if (e.key !== 'Escape') return
            e.stopPropagation()
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          }}
          className="
            [&_.label]:text-base [&_.label]:font-semibold [&_.label]:text-ink-soft [&_.label]:mb-1.5
            [&_input]:min-h-[44px] [&_input]:text-base [&_input]:rounded-xl [&_input]:px-3.5
            [&_button]:min-h-[44px] [&_button]:text-base
            [&_button_span]:text-base [&_label_span]:text-sm
            [&_button]:outline-none [&_button:focus-visible]:ring-2
            [&_button:focus-visible]:ring-stage-varvi
          "
        >
          <PatientPicker
            name={state.patient?.name ?? ''}
            patientId={state.patient?.patientId ?? null}
            onChange={(name, patientId) =>
              // An emptied field is "no patient", not a patient with a blank
              // name — otherwise validation would see an object and pass.
              patch({ patient: name.trim() || patientId ? { name, patientId } : null })
            }
            required
          />
          <p className={WIZARD_HELP}>
            {t(
              'Kirjuta patsiendi nimi. Kui ta on juba olemas, vali ta nimekirjast — siis seotakse töö tema kaardiga ja ajalugu jääb ühte kohta.',
              "Type the patient's name. If they already exist, pick them from the list — the job is then linked to their record and the history stays in one place."
            )}
          </p>
          {patientError && (
            <p className={WIZARD_ERROR} role="alert">
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {patientError}
            </p>
          )}
        </div>

        <WizardField
          label={t('Tellija', 'Client')}
          htmlFor={customerId}
          help={t('Kliinik või arst, kes töö tellis. Võid selle ka hiljem lisada.', 'The clinic or dentist who ordered the job. You can also add this later.')}
          error={customerError}
        >
          <WizardCustomerSelect
            id={customerId}
            value={state.customer}
            onChange={value => patch({ customer: value })}
            invalid={!!customerError}
          />
        </WizardField>

        <WizardField
          label={t('Tellija viide', 'Client reference')}
          htmlFor={refId}
          help={t("Tellija enda tellimuse number. Jälgimislink näitab ainult seda viidet — patsiendi nime seal ei kuvata.", "The client's own order number. The tracking link shows only this reference — the patient's name is not shown there.")}
          error={refError}
        >
          <input
            id={refId}
            type="text"
            value={state.customerReference}
            onChange={e => patch({ customerReference: e.target.value })}
            placeholder={t('Nt 2024-118', 'e.g. 2024-118')}
            autoComplete="off"
            className={WIZARD_INPUT}
          />
        </WizardField>
      </section>

      {/* Väljastus is deliberately NOT asked here. A job being created is at the
          lab by definition, so the question has exactly one possible answer —
          and a step that can only be answered one way is a step that teaches
          people to click through without reading. It appears on the job page
          once the work reaches the done stage, which is when it starts to mean
          something. */}

      {/* ── Vaba tekst ─────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h3 className="text-base font-semibold text-ink">{t('Kirjeldus ja märkused', 'Description and notes')}</h3>

        <div>
          <label htmlFor={descriptionId} className={WIZARD_LABEL}>{t('Kirjeldus', 'Description')}</label>
          <textarea
            id={descriptionId}
            value={state.description}
            onChange={e => patch({ description: e.target.value })}
            rows={3}
            placeholder={t('Mida täpselt tehakse', 'What exactly is being made')}
            className={WIZARD_INPUT + ' resize-y'}
          />
          <p className={WIZARD_HELP}>
            {t('Kirjuta nii, nagu seletaksid kolleegile. Näiteks eritingimused või kokkulepped arstiga.', 'Write it as you would explain it to a colleague. For example, special conditions or agreements with the dentist.')}
          </p>
        </div>

        <div>
          <label htmlFor={notesId} className={WIZARD_LABEL}>{t('Märkused', 'Notes')}</label>
          <textarea
            id={notesId}
            value={state.notes}
            onChange={e => patch({ notes: e.target.value })}
            rows={3}
            placeholder={t('Lisainfo laborile', 'Extra information for the lab')}
            className={WIZARD_INPUT + ' resize-y'}
          />
          {/* Honest about where it lands: notes have no column of their own and
              are folded into the job description, so promising privacy here
              would be a lie the user finds out about on the job page. */}
          <p className={WIZARD_HELP}>
            {t('Lisainfo laborile. See läheb töö kirjelduse juurde ja on hiljem töö lehel nähtav.', "Extra information for the lab. It's added to the job description and will be visible on the job page.")}
          </p>
        </div>
      </section>
    </div>
  )
}
