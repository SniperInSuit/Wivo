/**
 * Seaded → Interface → Sounds. Per device (localStorage), never in the
 * database: whether this computer makes noise is a question about the room it
 * stands in, not about the person signed in.
 */
import { Volume2 } from 'lucide-react'
import { useSoundSettings, setSoundSettings, previewSound } from '../../lib/sound'
import { t } from '@/lib/i18n'

export function SoundSection() {
  const s = useSoundSettings()
  const quiet = s.quietFrom !== null && s.quietTo !== null

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Volume2 size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('sound.sounds')}</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 max-w-xl">{t('sound.intro')}</p>

      <div className="space-y-3 max-w-xl">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" role="switch" aria-checked={s.enabled} checked={s.enabled}
            onChange={e => setSoundSettings({ enabled: e.target.checked })} />
          {t('sound.soundsOn')}
        </label>

        <label className={`flex items-center gap-3 text-sm text-ink ${s.enabled ? '' : 'opacity-50'}`}>
          <span className="w-28">{t('sound.volume')}</span>
          <input type="range" min={0} max={100} step={5} disabled={!s.enabled}
            value={Math.round(s.volume * 100)} aria-label={t('sound.volume')}
            onChange={e => setSoundSettings({ volume: Number(e.target.value) / 100 })} className="w-48" />
          <span className="w-10 text-xs text-ink-muted tabular-nums">{Math.round(s.volume * 100)} %</span>
        </label>

        <div className={`flex items-center gap-3 ${s.enabled ? '' : 'opacity-50'}`}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" role="switch" aria-checked={s.notifications} checked={s.notifications} disabled={!s.enabled}
              onChange={e => setSoundSettings({ notifications: e.target.checked })} />
            {t('sound.notificationSounds')}
          </label>
          <button type="button" onClick={() => previewSound('notification')} disabled={!s.enabled}
            className="text-xs text-accent hover:underline disabled:opacity-50">{t('sound.test')}</button>
        </div>
        <p className="text-[11px] text-ink-faint -mt-2 ml-6">{t('sound.notificationHint')}</p>

        <div className={`flex items-center gap-3 ${s.enabled ? '' : 'opacity-50'}`}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" role="switch" aria-checked={s.interface} checked={s.interface} disabled={!s.enabled}
              onChange={e => setSoundSettings({ interface: e.target.checked })} />
            {t('sound.interfaceSounds')}
          </label>
          <button type="button" onClick={() => previewSound('interface')} disabled={!s.enabled}
            className="text-xs text-accent hover:underline disabled:opacity-50">{t('sound.test')}</button>
        </div>
        <p className="text-[11px] text-ink-faint -mt-2 ml-6">{t('sound.interfaceHint')}</p>

        <div className={`flex flex-wrap items-center gap-2 text-sm text-ink ${s.enabled ? '' : 'opacity-50'}`}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={quiet} disabled={!s.enabled}
              onChange={e => setSoundSettings(e.target.checked ? { quietFrom: '22:00', quietTo: '07:00' } : { quietFrom: null, quietTo: null })} />
            {t('sound.quietHours')}
          </label>
          {quiet && (
            <>
              <input type="time" className="input w-28" value={s.quietFrom ?? ''} aria-label={t('sound.quietFrom')}
                onChange={e => setSoundSettings({ quietFrom: e.target.value || null })} />
              <span className="text-ink-muted">–</span>
              <input type="time" className="input w-28" value={s.quietTo ?? ''} aria-label={t('sound.quietTo')}
                onChange={e => setSoundSettings({ quietTo: e.target.value || null })} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
