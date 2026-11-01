/**
 * "Assign stages to a partner" in the new-job form (spec, Phase 1: assigning a
 * stage to a partner, e.g. "Design: Riga", creates a job_share; case type lab
 * work or referral; a referral needs the consent mark).
 *
 * Kept OUT of the wizard's own state on purpose. That state is saved as a draft
 * and has tests on its shape; a partner assignment is a one-shot instruction
 * sent with `share_job` right after the job exists, and a draft resumed next
 * week should not quietly re-share a job with whoever was picked back then.
 *
 * Renders nothing for an organisation without an active partnership.
 */
import { createContext, useContext } from 'react'
import { Handshake } from 'lucide-react'
import { usePartnerOrgs, shareSpecProblem, type ShareSpec, type PartnerRole } from '@/hooks/usePartners'
import { usePipeline } from '@/context/PipelineContext'
import { WizardField } from '../ui/WizardField'
import { WIZARD_INPUT, WIZARD_HELP, WIZARD_LABEL, FOCUS_RING } from '../wizardTheme'
import { t } from '@/lib/i18n'

export interface PartnerShareState {
  spec: ShareSpec | null
  setSpec: (spec: ShareSpec | null) => void
}

export const PartnerShareContext = createContext<PartnerShareState>({ spec: null, setSpec: () => {} })

const ROLES: PartnerRole[] = ['design', 'surgery', 'supplier']
const roleLabel = (r: PartnerRole): string =>
  r === 'design' ? t('partners.roleDesign') : r === 'surgery' ? t('partners.roleSurgery') : t('partners.roleSupplier')

export function PartnerShare(): JSX.Element | null {
  const { spec, setSpec } = useContext(PartnerShareContext)
  const { data: partners = [] } = usePartnerOrgs()
  const { stages } = usePipeline()
  const active = partners.filter(p => p.status === 'active')
  if (active.length === 0) return null

  const chosen = active.find(p => p.org_id === spec?.partnerOrg) ?? null
  const roles = chosen && chosen.roles.length > 0 ? chosen.roles : ROLES
  const problem = spec ? shareSpecProblem(spec) : null
  const update = (patch: Partial<ShareSpec>): void => { if (spec) setSpec({ ...spec, ...patch }) }

  return (
    <section className="md:col-span-2 rounded-2xl border border-ink-faint/25 p-5 space-y-5">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className={`h-5 w-5 ${FOCUS_RING}`}
          checked={spec !== null}
          onChange={e => setSpec(e.target.checked
            ? { partnerOrg: active.length === 1 ? active[0].org_id : '', caseType: 'lab_work',
                role: active[0].roles[0] ?? 'design', stages: [], consent: false, partnerPrice: null }
            : null)}
        />
        <Handshake className="h-5 w-5 text-accent" aria-hidden="true" />
        <span className="text-base font-semibold text-ink">{t('partners.assignStagesToAPartner')}</span>
      </label>

      {spec && (
        <div className="grid gap-5 md:grid-cols-2">
          <WizardField label={t('partners.partner')} htmlFor="wizard-partner"
            error={problem === 'partner' ? t('partners.choosePartner') : null}>
            <select id="wizard-partner" className={WIZARD_INPUT} value={spec.partnerOrg}
              onChange={e => update({ partnerOrg: e.target.value })}>
              <option value="">{t('partners.choose')}</option>
              {active.map(p => <option key={p.org_id} value={p.org_id}>{p.name}</option>)}
            </select>
          </WizardField>

          <WizardField label={t('partners.role')} htmlFor="wizard-partner-role">
            <select id="wizard-partner-role" className={WIZARD_INPUT} value={spec.role}
              onChange={e => update({ role: e.target.value as PartnerRole })}>
              {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </WizardField>

          <fieldset className="md:col-span-2">
            <legend className={WIZARD_LABEL}>{t('partners.caseType')}</legend>
            <div className="flex flex-wrap gap-4">
              {(['lab_work', 'referral'] as const).map(ct => (
                <label key={ct} className="flex items-center gap-2 text-base text-ink">
                  <input type="radio" name="wizard-case-type" checked={spec.caseType === ct}
                    onChange={() => update({ caseType: ct, consent: false })} />
                  {ct === 'lab_work' ? t('partners.labWork') : t('partners.referral')}
                </label>
              ))}
            </div>
            <p className={WIZARD_HELP}>
              {spec.caseType === 'lab_work' ? t('partners.labWorkHelp') : t('partners.referralHelp')}
            </p>
          </fieldset>

          <fieldset className="md:col-span-2">
            <legend className={WIZARD_LABEL}>{t('partners.stagesForPartner')}</legend>
            <div className="flex flex-wrap gap-3">
              {stages.map(st => (
                <label key={st.key} className="flex items-center gap-2 text-base text-ink">
                  <input type="checkbox" checked={spec.stages.includes(st.key)}
                    onChange={e => update({ stages: e.target.checked
                      ? [...spec.stages, st.key]
                      : spec.stages.filter(k => k !== st.key) })} />
                  {st.label}
                </label>
              ))}
            </div>
            {problem === 'stages' && <p className="mt-1.5 text-base font-medium text-rose-500">{t('partners.chooseAtLeastOneStage')}</p>}
          </fieldset>

          {spec.caseType === 'referral' && (
            <label className="md:col-span-2 flex items-start gap-3 text-base text-ink">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={spec.consent}
                onChange={e => update({ consent: e.target.checked })} />
              <span>
                <span className="font-semibold">{t('partners.patientInformedAndAgreed')}</span>
                <span className="block text-ink-muted">{t('partners.consentHelp')}</span>
                {problem === 'consent' && <span className="block font-medium text-rose-500">{t('partners.consentRequired')}</span>}
              </span>
            </label>
          )}

          <WizardField label={t('partners.partnerPrice')} htmlFor="wizard-partner-price" help={t('partners.partnerPriceHelp')}>
            <input id="wizard-partner-price" type="number" min={0} step="0.01" className={WIZARD_INPUT}
              value={spec.partnerPrice ?? ''}
              onChange={e => update({ partnerPrice: e.target.value === '' ? null : Number(e.target.value) })} />
          </WizardField>
        </div>
      )}
    </section>
  )
}
