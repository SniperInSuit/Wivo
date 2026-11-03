import { describe, it, expect } from 'vitest'
import { pushText, pushLang } from './pushText'

describe('the words on a push', () => {
  it('one notification: what happened, and a hint to open the job', () => {
    expect(pushText(['assigned'], 1, 'en')).toEqual({ title: 'Work assigned', body: 'Open Wivo to see the job' })
    expect(pushText(['assigned'], 1, 'et')).toEqual({ title: 'Sulle määrati töö', body: 'Ava Wivo, et tööd näha' })
    expect(pushText(['stage_reached'], 1, 'en')).toEqual({ title: 'Work phase changed', body: 'Open Wivo to see the job' })
    expect(pushText(['stage_handover'], 1, 'et')).toEqual({ title: 'Töö liikus edasi', body: 'Ava Wivo, et tööd näha' })
    expect(pushText(['assigned'], 1, 'ru').title).toBe('Вам назначена работа')
  })

  it('several waiting: how many', () => {
    expect(pushText(['assigned', 'stage_reached', 'question'], 3, 'en')).toEqual({ title: '3 new notifications', body: 'Open Wivo to see them' })
    expect(pushText(['assigned'], 3, 'et').title).toBe('3 uut teavitust')
    expect(pushText(['assigned', 'question'], 0, 'en').title).toBe('2 new notifications')
  })

  it('Russian counts the way Russian does', () => {
    const title = (n: number) => pushText(['assigned'], n, 'ru').title
    expect(title(2)).toBe('2 новых уведомления')
    expect(title(5)).toBe('5 новых уведомлений')
    expect(title(11)).toBe('11 новых уведомлений')
    expect(title(21)).toBe('21 новое уведомление')
    expect(title(24)).toBe('24 новых уведомления')
    expect(title(112)).toBe('112 новых уведомлений')
  })

  it('a security notice and an unknown kind have their own words', () => {
    expect(pushText(['mfa_reset'], 1, 'en')).toEqual({ title: 'Your sign-in was changed', body: 'Open Wivo to see what changed' })
    expect(pushText(['something_new'], 1, 'et')).toEqual({ title: 'Uus teavitus', body: 'Ava Wivo, et seda näha' })
  })

  it('never the app\'s name in a title, never more than a short line', () => {
    const kinds = ['assigned', 'stage_reached', 'stage_handover', 'job_shared', 'question', 'files_added', 'mfa_removed', 'mfa_reset', 'x']
    for (const lang of ['en', 'et', 'ru'] as const) {
      for (const k of kinds) {
        const { title, body } = pushText([k], 1, lang)
        expect(title).not.toMatch(/wivo/i)
        expect(title.length + body.length).toBeLessThan(90)
      }
    }
  })

  it('an unknown language is English', () => {
    expect(pushLang('de')).toBe('en')
    expect(pushLang(null)).toBe('en')
    expect(pushLang('ru')).toBe('ru')
  })
})
