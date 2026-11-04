/**
 * "Forgot password?" is a screen of its own: no password field or "Sign in"
 * under the answer (testing on the test copy, where it looked as if a
 * password was still needed).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { t } from '@/lib/i18n'

vi.mock('../../lib/supabase', () => ({
  signIn: vi.fn(),
  sendPasswordReset: vi.fn(),
  rememberedClinicCode: () => null,
}))
const { LoginPage, ForgotPasswordForm, ResetLinkSent } = await import('./LoginPage')

const noop = () => {}
const inputs = (html: string) => html.match(/<input\b/g)?.length ?? 0

describe('the sign-in screen', () => {
  it('starts with the address, the password, "Sign in" and "Forgot password?"', () => {
    const html = renderToStaticMarkup(<LoginPage />)
    expect(html).toContain('type="password"')
    expect(html).toContain(t('auth.signIn'))
    expect(html).toContain(t('auth.forgotPassword'))
  })
})

describe('"Forgot password?"', () => {
  it('asks only for the address, with "Send link" and a way back', () => {
    const html = renderToStaticMarkup(<ForgotPasswordForm email="tehnik" onEmail={noop} onSent={noop} onBack={noop} />)
    expect(inputs(html)).toBe(1)
    expect(html).toContain('value="tehnik"')
    expect(html).not.toContain('type="password"')
    expect(html).not.toContain(t('auth.signIn'))
    expect(html).toContain(t('auth.sendLink'))
    expect(html).toContain(t('auth.backToSignIn'))
  })

  it('after sending: only the neutral answer, the address and a way back', () => {
    const html = renderToStaticMarkup(<ResetLinkSent email="mari@kliinik.ee" onBack={noop} />)
    expect(inputs(html)).toBe(0)
    expect(html).toContain(t('auth.resetSent'))
    expect(html).toContain('mari@kliinik.ee')
    expect(html).toContain(t('auth.backToSignIn'))
    expect(html).not.toContain(t('auth.sendLink'))
    expect(html).not.toContain(t('auth.signIn'))
  })
})
