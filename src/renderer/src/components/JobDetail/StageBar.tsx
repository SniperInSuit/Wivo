/**
 * The stage bar: the job's stages in order, and under each one who does it.
 * One component for the job view, the new-job form and the phone, so a job
 * looks and works the same everywhere.
 *
 * Under a stage: a "+ person" icon when nobody is on it, otherwise circles
 * with initials (two at most, then "+N"; the full name on hover). A click
 * opens a small popup: the people with tick boxes, saved as they are ticked,
 * "skip" for the stage, and for each person "assign to other stages too".
 * The popup has no Save button.
 *
 * It only draws and reports; what saving means is the caller's (the database
 * for a job, the form's state for a job not yet made).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Play, UserPlus } from 'lucide-react'
import { initials, visiblePeople, withPerson } from '@/lib/stageAssign'
import { t } from '@/lib/i18n'

export type StageBarState = 'done' | 'current' | 'upcoming' | 'skipped'

export interface StageBarItem {
  key: string
  label: string
  hex: string
  state: StageBarState
  /** Someone has pressed "I started" on this stage. */
  started: boolean
  startedBy: string | null
  people: string[]
  /** May this stage be skipped (or taken back) from here? */
  canSkip: boolean
}

export interface StageBarProps {
  items: StageBarItem[]
  everyone: { id: string; name: string }[]
  /** May this person change who is on the stages? */
  editable: boolean
  /** 'lg': thumb-sized circles, a bottom sheet instead of a popup, scrolls sideways. */
  size?: 'md' | 'lg'
  busy?: boolean
  onPeople: (stageKey: string, people: string[]) => void
  onSkip: (stageKey: string, skipped: boolean) => void
}

export function StageBar({ items, everyone, editable, size = 'md', busy = false, onPeople, onSkip }: StageBarProps) {
  const [open, setOpen] = useState<string | null>(null)
  const lg = size === 'lg'
  const nameOf = (id: string) => everyone.find(p => p.id === id)?.name ?? t('workflow.someone')
  const circle = lg ? 'h-11 w-11 text-sm' : 'h-7 w-7 text-[10px]'

  return (
    <div className={lg ? 'overflow-x-auto pb-1' : ''}>
      <ol className="flex items-start" style={lg ? { minWidth: `${items.length * 88}px` } : undefined}>
        {items.map((s, i) => {
          const reached = s.state === 'done' || s.state === 'current'
          const grey = s.state === 'skipped'
          const { shown, more } = visiblePeople(s.people)
          const isOpen = open === s.key
          return (
            <li key={s.key} className={`relative flex min-w-0 flex-1 flex-col items-center ${grey ? 'opacity-50' : ''}`}>
              <div className="flex w-full items-center">
                <span className={`h-[2px] flex-1 ${i === 0 ? 'opacity-0' : ''}`}
                  style={{ backgroundColor: reached ? s.hex : '#E2E8EC' }} />
                <span
                  className={`flex flex-shrink-0 items-center justify-center rounded-full ${lg ? 'h-7 w-7' : 'h-5 w-5'}`}
                  style={{
                    backgroundColor: s.state === 'done' ? s.hex : '#FFFFFF',
                    border: `2px ${grey ? 'dashed' : 'solid'} ${reached ? s.hex : '#D3DBE1'}`,
                    boxShadow: s.state === 'current' ? `0 0 0 3px ${s.hex}33` : undefined,
                  }}
                  title={s.started ? t('workflow.startedMark') : undefined}
                >
                  {s.state === 'done' && <Check size={lg ? 14 : 11} className="text-white" strokeWidth={3} />}
                  {s.state === 'current' && s.started && <Play size={lg ? 11 : 8} style={{ color: s.hex }} fill={s.hex} aria-hidden="true" />}
                </span>
                <span className={`h-[2px] flex-1 ${i === items.length - 1 ? 'opacity-0' : ''}`}
                  style={{ backgroundColor: reached && s.state === 'done' ? s.hex : '#E2E8EC' }} />
              </div>

              <span className={`mt-1.5 w-full truncate px-0.5 text-center leading-tight ${lg ? 'text-xs' : 'text-[10px]'} ${
                reached ? 'font-semibold text-ink' : 'text-ink-faint'} ${grey ? 'line-through' : ''}`} title={s.label}>
                {s.label}
              </span>

              <div className="mt-1.5 flex min-h-[28px] items-center justify-center">
                {s.people.length === 0 ? (
                  editable ? (
                    <button type="button" onClick={() => setOpen(isOpen ? null : s.key)}
                      aria-label={t('workflow.addPerson')} title={t('workflow.addPerson')}
                      className={`${circle} flex items-center justify-center rounded-full border border-dashed border-ink-faint/60 text-ink-muted hover:border-accent hover:text-accent`}>
                      <UserPlus size={lg ? 18 : 13} aria-hidden="true" />
                    </button>
                  ) : <span className="text-[11px] text-ink-faint">—</span>
                ) : (
                  <button type="button" disabled={!editable} onClick={() => setOpen(isOpen ? null : s.key)}
                    aria-label={s.people.map(nameOf).join(', ')}
                    className="flex items-center -space-x-1.5 disabled:cursor-default">
                    {shown.map(id => (
                      <span key={id} title={nameOf(id)}
                        className={`${circle} flex items-center justify-center rounded-full bg-bg-sidebar font-semibold text-ink ring-2 ring-bg-card`}
                        style={s.started && s.startedBy === id ? { boxShadow: `0 0 0 2px ${s.hex}` } : undefined}>
                        {initials(nameOf(id))}
                      </span>
                    ))}
                    {more > 0 && (
                      <span title={s.people.slice(2).map(nameOf).join(', ')}
                        className={`${circle} flex items-center justify-center rounded-full bg-bg-sidebar font-semibold text-ink-muted ring-2 ring-bg-card`}>
                        +{more}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {isOpen && editable && (
                <StagePopup
                  stage={s}
                  items={items}
                  everyone={everyone}
                  sheet={lg}
                  busy={busy}
                  onClose={() => setOpen(null)}
                  onPeople={onPeople}
                  onSkip={onSkip}
                />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StagePopup({ stage, items, everyone, sheet, busy, onClose, onPeople, onSkip }: {
  stage: StageBarItem
  items: StageBarItem[]
  everyone: { id: string; name: string }[]
  sheet: boolean
  busy: boolean
  onClose: () => void
  onPeople: StageBarProps['onPeople']
  onSkip: StageBarProps['onSkip']
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<string | null>(null)
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // A tick on the button that opened it must not close it at once: listen on the next turn.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', down)
      document.addEventListener('touchstart', down)
    }, 0)
    document.addEventListener('keydown', key)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('touchstart', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  // Stages a person can still be put on: not done, not skipped.
  const others = items.filter(x => x.key !== stage.key && x.state !== 'done' && x.state !== 'skipped')
  const box = sheet ? 'h-6 w-6' : 'h-4 w-4'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={stage.label}
      className={sheet
        ? 'fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-ink-faint/20 bg-bg-card p-4 shadow-2xl'
        : 'absolute left-1/2 top-full z-30 mt-1 max-h-80 w-64 -translate-x-1/2 overflow-y-auto rounded-xl border border-ink-faint/20 bg-bg-card p-2 shadow-xl'}
    >
      <p className="px-1 pb-1 text-xs font-semibold text-ink-muted">{stage.label}</p>
      <ul className="space-y-0.5">
        {everyone.map(p => {
          const on = stage.people.includes(p.id)
          return (
            <li key={p.id}>
              <div className={`flex items-center gap-2 rounded-lg px-1 ${sheet ? 'min-h-[44px]' : 'min-h-[30px]'}`}>
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className={box} checked={on} disabled={busy}
                    onChange={e => onPeople(stage.key, withPerson(stage.people, p.id, e.target.checked))} />
                  <span className="truncate">{p.name}</span>
                </label>
                {on && others.length > 0 && (
                  <button type="button" className="shrink-0 text-[11px] text-accent hover:underline"
                    onClick={() => setMore(more === p.id ? null : p.id)}>
                    {t('workflow.assignToOther')}
                  </button>
                )}
              </div>
              {more === p.id && on && (
                <div className="mb-1 ml-6 space-y-0.5 rounded-lg bg-bg-sidebar p-2">
                  {others.map(o => (
                    <label key={o.key} className={`flex items-center gap-2 text-sm text-ink ${sheet ? 'min-h-[40px]' : 'min-h-[26px]'}`}>
                      <input type="checkbox" className={box} disabled={busy} checked={o.people.includes(p.id)}
                        onChange={e => onPeople(o.key, withPerson(o.people, p.id, e.target.checked))} />
                      {o.label}
                    </label>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {stage.canSkip && (
        <button type="button" disabled={busy} onClick={() => onSkip(stage.key, stage.state !== 'skipped')}
          className={`mt-2 w-full rounded-lg border border-ink-faint/30 text-sm text-ink hover:bg-bg-sidebar ${sheet ? 'py-3' : 'py-1.5'}`}>
          {stage.state === 'skipped' ? t('workflow.unskip') : t('workflow.skip')}
        </button>
      )}
    </div>
  )
}
