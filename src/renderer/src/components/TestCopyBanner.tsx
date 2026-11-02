/**
 * Always on screen in test mode (`npm run dev:test`): a frame round the whole
 * window and a label at the top, so nobody mistakes the test copy for the
 * real clinic. Red, with the reason, when test mode is not connected
 * (lib/testCopy fails closed). Clicks pass through it.
 */
import { IS_TEST_COPY } from '../lib/testCopy'
import { testCopyProblem } from '../lib/supabase'
import { t } from '@/lib/i18n'

export function TestCopyBanner() {
  if (!IS_TEST_COPY) return null
  const bad = testCopyProblem !== null
  const colour = bad ? '#dc2626' : '#f59e0b'
  return (
    <div aria-hidden={false} role="status" className="pointer-events-none fixed inset-0 z-[200]"
      style={{ boxShadow: `inset 0 0 0 4px ${colour}` }}>
      <div className="absolute left-1/2 top-1 -translate-x-1/2 rounded-b-lg px-4 py-1 text-xs font-bold tracking-wider text-white shadow-card"
        style={{ backgroundColor: colour }}>
        {t('testCopy.label')}
        {testCopyProblem === 'missing' && <span className="ml-2 font-semibold">· {t('testCopy.missing')}</span>}
        {testCopyProblem === 'production' && <span className="ml-2 font-semibold">· {t('testCopy.production')}</span>}
      </div>
    </div>
  )
}
