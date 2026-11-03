/**
 * The words on a push (sql/103): a title that says what happened and a short
 * hint, in the person's language. NEVER a job code, a patient or a name: the
 * text crosses Apple's or Google's servers (encrypted, vapid.ts) and is read
 * off the lock screen by whoever holds the phone. The phone already shows
 * "Wivo" beside it, so the title never repeats the app's name.
 *
 * One notification waiting: its kind. Several (what the bell shows as unread):
 * how many. Tapping it opens the bell list in the app (sw.js).
 *
 * No imports, so Deno and Vitest load it as it is.
 */
export type PushLang = 'en' | 'et' | 'ru'

type Group = 'assigned' | 'stage' | 'shared' | 'question' | 'files' | 'security' | 'other'

const GROUP: Record<string, Group> = {
  assigned: 'assigned',
  stage_reached: 'stage',
  stage_handover: 'stage',
  job_shared: 'shared',
  question: 'question',
  files_added: 'files',
  mfa_removed: 'security',
  mfa_reset: 'security',
}

const TITLE: Record<PushLang, Record<Group, string>> = {
  en: {
    assigned: 'Work assigned', stage: 'Work phase changed', shared: 'Work shared with you',
    question: 'New question about a job', files: 'New files on a job', security: 'Your sign-in was changed',
    other: 'New notification',
  },
  et: {
    assigned: 'Sulle määrati töö', stage: 'Töö liikus edasi', shared: 'Sinuga jagati tööd',
    question: 'Uus küsimus töö kohta', files: 'Tööle lisati faile', security: 'Sinu sisselogimist muudeti',
    other: 'Uus teavitus',
  },
  ru: {
    assigned: 'Вам назначена работа', stage: 'Работа перешла на новый этап', shared: 'С вами поделились работой',
    question: 'Новый вопрос по работе', files: 'К работе добавлены файлы', security: 'Ваш вход изменён',
    other: 'Новое уведомление',
  },
}

const BODY: Record<PushLang, { job: string; security: string; other: string; many: string }> = {
  en: { job: 'Open Wivo to see the job', security: 'Open Wivo to see what changed', other: 'Open Wivo to see it', many: 'Open Wivo to see them' },
  et: { job: 'Ava Wivo, et tööd näha', security: 'Ava Wivo, et näha, mis muutus', other: 'Ava Wivo, et seda näha', many: 'Ava Wivo, et neid näha' },
  ru: { job: 'Откройте Wivo, чтобы увидеть работу', security: 'Откройте Wivo, чтобы узнать, что изменилось', other: 'Откройте Wivo, чтобы посмотреть', many: 'Откройте Wivo, чтобы их увидеть' },
}

function manyTitle(n: number, lang: PushLang): string {
  if (lang === 'et') return `${n} uut teavitust`
  if (lang === 'ru') {
    const ten = n % 10, hundred = n % 100
    const word = ten === 1 && hundred !== 11 ? 'новое уведомление'
      : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? 'новых уведомления'
        : 'новых уведомлений'
    return `${n} ${word}`
  }
  return `${n} new notifications`
}

export const pushLang = (v: unknown): PushLang => (v === 'et' || v === 'ru' ? v : 'en')

/**
 * The title and hint for one phone. `kinds`: the notifications this push is
 * for; `unread`: everything still unread for this person (the bell's count).
 */
export function pushText(kinds: string[], unread: number, lang: PushLang): { title: string; body: string } {
  const waiting = Math.max(unread, kinds.length)
  if (waiting > 1) return { title: manyTitle(waiting, lang), body: BODY[lang].many }
  const group = GROUP[kinds[0] ?? ''] ?? 'other'
  const body = group === 'security' ? BODY[lang].security : group === 'other' ? BODY[lang].other : BODY[lang].job
  return { title: TITLE[lang][group], body }
}
