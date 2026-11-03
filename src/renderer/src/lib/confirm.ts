/**
 * Wivo's own "Are you sure?" in place of the browser's built-in dialog, on desktop
 * and phone. The system dialog looks foreign, shows the site's address on the
 * phone ("app.wivodent.com says…") and cannot be styled or translated.
 *
 *   if (!(await confirmDialog({ message: t('…'), danger: true }))) return
 *
 * One question at a time; a second waits for the first. ConfirmHost (mounted
 * once on desktop and phone) draws it. No host mounted (a test, a screen
 * outside the app): the answer is no, so nothing irreversible happens.
 */
export interface ConfirmRequest {
  message: string
  /** The confirming button's words; "Confirm" when not given. */
  confirmLabel?: string
  /** A red button: deleting, ending, signing out. */
  danger?: boolean
}

interface Pending extends ConfirmRequest { resolve: (yes: boolean) => void }

let queue: Pending[] = []
let hosts = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

/** Ask; resolves true for yes, false for cancel, Esc or a click outside. */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(false)
  return new Promise(resolve => {
    queue = [...queue, { ...request, resolve }]
    emit()
  })
}

/** The question on screen now, if any. */
export const currentConfirm = (): ConfirmRequest | null => queue[0] ?? null

/** The host's answer to the question on screen. */
export function answerConfirm(yes: boolean): void {
  const [first, ...rest] = queue
  if (!first) return
  queue = rest
  first.resolve(yes)
  emit()
}

/** For ConfirmHost: follow the queue. Returns the unsubscribe. */
export function subscribeConfirm(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** For ConfirmHost: there is somewhere to draw the question. Returns the release. */
export function registerConfirmHost(): () => void {
  hosts++
  return () => {
    hosts--
    // The host went away with questions open: they are answered no.
    if (hosts === 0) while (queue.length) answerConfirm(false)
  }
}
