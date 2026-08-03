import { useState } from 'react'
import { Loader2, Lock, Eye, EyeOff, Mail } from 'lucide-react'
import { signIn } from '../../lib/supabase'
import wivoLogo from '../../assets/Wivo Logo.png'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error } = await signIn(email, password)
      if (error) throw error
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Midagi läks valesti'
      if (msg.includes('Invalid login credentials')) setError('Vale kasutajanimi või parool')
      else if (msg.includes('valid email')) setError('Sisesta kehtiv kasutajanimi või e-posti aadress')
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-nav-bg flex items-center justify-center">
      <div className="bg-bg-card rounded-2xl shadow-panel p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <img src={wivoLogo} alt="Wivo" className="w-16 h-16 rounded-xl mx-auto" />
          <h1 className="text-xl font-bold text-ink">Wivo</h1>
          <p className="text-sm text-ink-muted">Logi sisse oma kontoga</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Kasutajanimi või e-post</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tehnik või nimi@kliinik.ee"
                className="input pl-9"
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="label">Parool</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pl-9 pr-9"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Logi sisse'}
          </button>
        </form>

        <p className="text-center text-[10px] text-ink-faint">
          Kontod loob kliiniku administraator
        </p>
      </div>
    </div>
  )
}
