import { ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// The one shared shell for every panel on the patient page. It replaces the
// ad-hoc `Section` that used to live inside PatientsView, so all panels share a
// single eyebrow title, icon slot and right-aligned action slot instead of each
// panel inventing its own header.
//
// `sensitive` marks a panel holding GDPR Art. 9 health data — it gets the same
// orange signal as the ravikaart callout so the user can see at a glance which
// surface must not be screenshared.
export function PanelCard({ title, icon: Icon, action, sensitive, children }: {
  title: string; icon?: LucideIcon; action?: React.ReactNode
  sensitive?: boolean; children: React.ReactNode
}) {
  return (
    <section className={`card p-4 space-y-3 ${sensitive ? 'border border-orange-200' : ''}`}>
      <div className="flex items-center gap-2">
        {Icon && <Icon size={13} className="text-ink-faint" />}
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{title}</h3>
        {sensitive && <ShieldAlert size={12} className="text-orange-500" />}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}
