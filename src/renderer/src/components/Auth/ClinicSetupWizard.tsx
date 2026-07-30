import { useState } from 'react'
import { Building2, Loader2, MapPin, Phone, Mail, FileText, Landmark, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth, type Clinic } from '../../context/AuthContext'
import wivoLogo from '../../assets/Wivo Logo.png'

interface ClinicForm {
  name: string
  address: string
  city: string
  postal_code: string
  phone: string
  email: string
  reg_code: string
  vat_number: string
  bank_name: string
  bank_account: string
}

const EMPTY: ClinicForm = {
  name: '', address: '', city: '', postal_code: '',
  phone: '', email: '', reg_code: '', vat_number: '',
  bank_name: '', bank_account: ''
}

export function ClinicSetupWizard() {
  const { user, refreshProfile, setClinic } = useAuth()
  const [form, setForm] = useState<ClinicForm>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (key: keyof ClinicForm, value: string) =>
    setForm(f => ({ ...f, [key]: value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Kliiniku nimi on kohustuslik'); return }
    if (!user) return
    setError(null)
    setSaving(true)

    try {
      // 1. Create the clinic
      const { data: clinic, error: clinicErr } = await supabase
        .from('clinics')
        .insert({
          name: form.name.trim(),
          address: form.address || null,
          city: form.city || null,
          postal_code: form.postal_code || null,
          phone: form.phone || null,
          email: form.email || null,
          reg_code: form.reg_code || null,
          vat_number: form.vat_number || null,
          bank_name: form.bank_name || null,
          bank_account: form.bank_account || null,
        })
        .select()
        .single()
      if (clinicErr) throw clinicErr

      const clinicId = clinic.id

      // 2. Link the owner profile to this clinic
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ clinic_id: clinicId, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (profileErr) throw profileErr

      // 3. Backfill existing data — assign all orphan rows to this clinic
      await Promise.all([
        supabase.from('jobs').update({ clinic_id: clinicId }).is('clinic_id', null),
        supabase.from('patients').update({ clinic_id: clinicId }).is('clinic_id', null),
        supabase.from('visits').update({ clinic_id: clinicId }).is('clinic_id', null),
      ])

      // 4. Update local state
      setClinic(clinic as Clinic)
      await refreshProfile()
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Kliiniku loomine ebaõnnestus')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-nav-bg flex items-center justify-center overflow-y-auto py-8">
      <div className="bg-bg-card rounded-2xl shadow-panel p-8 w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <img src={wivoLogo} alt="Wivo" className="w-14 h-14 rounded-xl mx-auto" />
          <h1 className="text-xl font-bold text-ink">Seadista oma kliinik</h1>
          <p className="text-sm text-ink-muted">
            Sisesta kliiniku andmed. Need lähevad arvetele ja aruannetele.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="label">Kliiniku nimi *</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Kliiniku nimi"
                className="input pl-9"
                required
                autoFocus
              />
            </div>
          </div>

          {/* Address row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Aadress</label>
              <div className="relative">
                <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="text"
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                  placeholder="Tänav, maja"
                  className="input pl-9"
                />
              </div>
            </div>
            <div>
              <label className="label">Linn</label>
              <input
                type="text"
                value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="Tallinn"
                className="input"
              />
            </div>
            <div>
              <label className="label">Postiindeks</label>
              <input
                type="text"
                value={form.postal_code}
                onChange={e => set('postal_code', e.target.value)}
                placeholder="10111"
                className="input"
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Telefon</label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="+372 5123 4567"
                  className="input pl-9"
                />
              </div>
            </div>
            <div>
              <label className="label">E-post</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="info@kliinik.ee"
                  className="input pl-9"
                />
              </div>
            </div>
          </div>

          {/* Legal */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Registrikood</label>
              <div className="relative">
                <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="text"
                  value={form.reg_code}
                  onChange={e => set('reg_code', e.target.value)}
                  placeholder="12345678"
                  className="input pl-9"
                />
              </div>
            </div>
            <div>
              <label className="label">KMKR number</label>
              <input
                type="text"
                value={form.vat_number}
                onChange={e => set('vat_number', e.target.value)}
                placeholder="EE123456789"
                className="input"
              />
            </div>
          </div>

          {/* Banking */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pank</label>
              <div className="relative">
                <Landmark size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="text"
                  value={form.bank_name}
                  onChange={e => set('bank_name', e.target.value)}
                  placeholder="LHV, SEB, Swedbank…"
                  className="input pl-9"
                />
              </div>
            </div>
            <div>
              <label className="label">IBAN</label>
              <input
                type="text"
                value={form.bank_account}
                onChange={e => set('bank_account', e.target.value)}
                placeholder="EE00 1234 5678 9012 3456"
                className="input"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="btn-primary w-full justify-center disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <Save size={14} />
                Loo kliinik ja alusta
              </>
            )}
          </button>

          <p className="text-[11px] text-ink-faint text-center">
            Kõik andmed saab hiljem Seadetest muuta.
          </p>
        </form>
      </div>
    </div>
  )
}
