/**
 * THE selected-state primitive for the whole wizard.
 *
 * Work types, materials, shades, arches, priority, delivery status — every
 * choice in every step renders one of these. One component rather than six
 * lookalikes because "selected" is exactly the thing that must not vary: a user
 * who learns that a teal border with a tick means chosen has to be right about
 * that on all six steps.
 *
 * Selected is carried by FOUR signals at once — border colour, a tick icon, a
 * heavier label, and an sr-only "Valitud." — because colour alone fails for the
 * colour-blind, for a washed-out screen, and for a screen reader. `aria-checked`
 * covers assistive tech; the other three cover eyes.
 *
 * TWO SHAPES, one component. `tile` is the big glyph-above-label card the
 * job-type grid and the shade grid want; `row` is the compact left-aligned card
 * that suits a wrapped set of materials or three priority options. They share
 * every state rule — only the arrangement differs — so a user still learns
 * "selected" exactly once.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { FOCUS_RING, WIZARD_CARD_MIN } from '../wizardTheme'

export interface SelectableCardProps {
  selected: boolean
  onToggle: () => void
  /** Main text. Always rendered — never an icon-only control. */
  label: string
  /** Secondary line under the label (price, tooth count, hint). */
  sublabel?: string
  /** Work-type hex — tints the icon tile, exactly like JobDetailPanel's grid. */
  hex?: string
  /** workTypeImage() result. null → fall back to `icon`, then to a hex dot. */
  imageSrc?: string | null
  icon?: ReactNode
  /** Small pill (e.g. 'Sild', '4 hammast'). */
  badge?: string
  disabled?: boolean
  /** true → role="checkbox" (multi-select). false → role="radio". Default true. */
  multi?: boolean
  /** Announced reason the card cannot be picked. */
  disabledReason?: string
  /** 'tile' — big, centred, glyph above the label. 'row' — compact, left-aligned.
   *  Default 'row'. */
  size?: 'tile' | 'row'
  className?: string
}

export function SelectableCard({
  selected, onToggle, label, sublabel, hex, imageSrc, icon, badge,
  disabled = false, multi = true, disabledReason, size = 'row', className = '',
}: SelectableCardProps): JSX.Element {
  const reasonId = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const hasArt = Boolean(imageSrc || icon || hex)
  const tile = size === 'tile'

  /**
   * Arrow keys move between the cards of one group.
   *
   * The cards announce themselves as radios and checkboxes, so a screen-reader
   * user is told "radio button, 1 of 3" and reaches for an arrow key. Without
   * this they press it and nothing happens — the role promises a behaviour the
   * component does not have. Siblings are found through the DOM rather than
   * through a shared context because the seven call sites already wrap their
   * cards in a role="radiogroup" / role="group" element; asking each of them to
   * thread state down would be seven chances to get it wrong.
   */
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(e.key)) return
    const group = btnRef.current?.closest('[role="radiogroup"],[role="group"]')
    if (!group) return
    const peers = [...group.querySelectorAll<HTMLButtonElement>(`[role="${multi ? 'checkbox' : 'radio'}"]`)]
      .filter(b => b.getAttribute('aria-disabled') !== 'true')
    const i = peers.indexOf(e.currentTarget)
    if (i < 0 || peers.length < 2) return
    e.preventDefault()
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const next = peers[(i + (forward ? 1 : -1) + peers.length) % peers.length]
    next.focus()
    // A radio group's selection follows focus; a checkbox group's does not.
    // Moving through six materials must not select all six on the way past.
    if (!multi) next.click()
  }

  return (
    <button
      ref={btnRef}
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      // aria-disabled rather than the native `disabled` attribute: a disabled
      // button drops out of the tab order, so the one user who most needs to
      // hear WHY it cannot be picked is the one who can never reach it.
      aria-disabled={disabled || undefined}
      aria-describedby={disabled && disabledReason ? reasonId : undefined}
      onClick={() => { if (!disabled) onToggle() }}
      onKeyDown={onKeyDown}
      className={[
        'relative transition-colors duration-150',
        tile
          ? 'flex flex-col items-center justify-center gap-3 text-center min-h-[136px] p-4 rounded-2xl text-base'
          : `flex flex-col items-start gap-2 text-left ${WIZARD_CARD_MIN} min-w-[132px] p-4 rounded-xl text-base`,
        // border-2 in BOTH states on purpose. The spec draws the unselected card
        // with a 1px border, but then every toggle reflows the grid by a pixel
        // and a page of cards visibly twitches — the opposite of what a steady
        // hand needs. The weight is constant; only the colour changes.
        selected
          // The teal wash from the mockup: a tint light enough that the label
          // still carries the contrast, with the border doing the shouting.
          ? 'border-2 border-accent bg-accent/[0.09] shadow-card'
          : 'border-2 border-ink-faint/40 bg-bg-card hover:border-ink-faint/70',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        FOCUS_RING,
        className,
      ].join(' ')}
    >
      {selected && (
        <Check className="w-5 h-5 text-accent absolute top-2 right-2" aria-hidden="true" />
      )}

      {hasArt && (
        <span
          className={[
            'flex items-center justify-center rounded-xl flex-shrink-0 overflow-hidden',
            tile ? 'w-14 h-14' : 'w-11 h-11 rounded-lg',
          ].join(' ')}
          style={{ backgroundColor: hex ? `${hex}1f` : undefined }}
          aria-hidden="true"
        >
          {imageSrc ? (
            <img src={imageSrc} alt="" className="w-full h-full object-contain" />
          ) : icon ? (
            icon
          ) : (
            <span
              className="w-3.5 h-3.5 rounded-full"
              style={{ backgroundColor: hex }}
            />
          )}
        </span>
      )}

      <span className={tile ? 'min-w-0 w-full' : 'min-w-0 w-full pr-6'}>
        {/* Read out before the label, so the state is heard first rather than
            after the user has already committed to the word. */}
        {selected && <span className="sr-only">Valitud. </span>}
        <span
          className={`block text-base leading-snug ${
            selected ? 'font-semibold text-ink' : 'font-medium text-ink-soft'
          }`}
        >
          {label}
        </span>
        {sublabel && (
          <span className="block mt-0.5 text-base text-ink-muted">{sublabel}</span>
        )}
      </span>

      {badge && (
        // Bottom row, not the corner the spec names: the tick already owns the
        // top-right and two marks stacked there read as one smudge.
        <span className={[
          'inline-flex items-center px-2.5 py-1 rounded-full text-base font-medium',
          'bg-bg-sidebar text-ink-muted',
          tile ? '' : 'mt-auto',
        ].join(' ')}>
          {badge}
        </span>
      )}

      {disabled && disabledReason && (
        <span id={reasonId} className="sr-only">{disabledReason}</span>
      )}
    </button>
  )
}
