/**
 * Always on screen in test mode (`npm run dev:test`): a frame round the whole
 * window and a label at the top, so nobody mistakes the test copy for the
 * real clinic. Red, with the reason, when test mode is not connected
 * (lib/testCopy fails closed). Clicks pass through it.
 *
 * It also shows outside test mode for the one refusal that can happen there:
 * a development build pointed at the production project. That is refused
 * (lib/testCopy), and a refusal nobody can see is how "nothing works" becomes
 * a day of looking in the wrong database.
 *
 * In a release it shows for ONE reason: the licence does not allow the address
 * the app is configured for (docs/MODULES-AND-RATINGS.md §1.2). That refusal
 * happens before the client is built, so without a banner the app would simply
 * sit there loading nothing, and a clinic would be told "Wivo is broken"
 * instead of "this key is not for this server". Otherwise a built app runs in
 * Vite mode `production`, where production is the one address allowed and
 * `testCopyProblem` is null.
 */
import { IS_TEST_COPY } from '../lib/testCopy'
import { testCopyProblem } from '../lib/supabase'
import { t } from '@/lib/i18n'

export function TestCopyBanner() {
  if (!IS_TEST_COPY && testCopyProblem === null) return null
  const bad = testCopyProblem !== null
  const colour = bad ? '#dc2626' : '#f59e0b'
  return (
    <div aria-hidden={false} role="status" className="pointer-events-none fixed inset-0 z-[200]"
      style={{ boxShadow: `inset 0 0 0 4px ${colour}` }}>
      <div className="absolute left-1/2 top-1 -translate-x-1/2 rounded-b-lg px-4 py-1 text-xs font-bold tracking-wider text-white shadow-card"
        style={{ backgroundColor: colour }}>
        {IS_TEST_COPY ? t('testCopy.label')
          : testCopyProblem === 'licence-api' ? t('testCopy.licenceLabel')
          : t('testCopy.devLabel')}
        {testCopyProblem === 'missing' && <span className="ml-2 font-semibold">· {t('testCopy.missing')}</span>}
        {testCopyProblem === 'production' && <span className="ml-2 font-semibold">· {t('testCopy.production')}</span>}
        {testCopyProblem === 'not-test-copy' && <span className="ml-2 font-semibold">· {t('testCopy.notTestCopy')}</span>}
        {testCopyProblem === 'dev-production' && <span className="ml-2 font-semibold">· {t('testCopy.devProduction')}</span>}
        {testCopyProblem === 'licence-api' && <span className="ml-2 font-semibold">· {t('testCopy.licenceApi')}</span>}
      </div>
    </div>
  )
}
