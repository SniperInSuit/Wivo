import { describe, it, expect } from 'vitest'
import {
  isStandinEmail, loginAddresses, loginNameOf, normaliseClinicCode, normaliseUsername, standinAddress,
} from './loginAddress'

describe('loginAddresses: what a person typed → the addresses to try', () => {
  it('a real address is used as typed', () => {
    expect(loginAddresses(' mari@kliinik.ee ')).toEqual(['mari@kliinik.ee'])
    expect(loginAddresses('mari@kliinik.ee', { rememberedCode: 'TAL' })).toEqual(['mari@kliinik.ee'])
  })

  it('username@code is that clinic\'s stand-in, whatever the device remembers', () => {
    expect(loginAddresses('Tehnik@TAL')).toEqual(['tehnik.tal@nomail.wivodent.com'])
    expect(loginAddresses('tehnik@tal2', { rememberedCode: 'par' })).toEqual(['tehnik.tal2@nomail.wivodent.com'])
  })

  it('a plain name is the old login, unchanged, when the device remembers no clinic', () => {
    expect(loginAddresses('Tehnik')).toEqual(['tehnik@example.com'])
    expect(loginAddresses('Mari Kask')).toEqual(['marikask@example.com'])
  })

  it('a plain name on a device that remembers a clinic: that clinic first, then the old login', () => {
    expect(loginAddresses('tehnik', { rememberedCode: 'TAL' }))
      .toEqual(['tehnik.tal@nomail.wivodent.com', 'tehnik@example.com'])
  })

  it('an old name that is not a valid new username is only tried the old way', () => {
    expect(loginAddresses('ü-tehnik', { rememberedCode: 'tal' })).toEqual(['ü-tehnik@example.com'])
  })

  it('nothing to try for junk', () => {
    expect(loginAddresses('   ')).toEqual([])
    expect(loginAddresses('@tal')).toEqual([])
    expect(loginAddresses('tehnik@')).toEqual([])
    expect(loginAddresses('tehnik@t-a-l')).toEqual([])
  })

  it('another instance\'s stand-in domain', () => {
    expect(loginAddresses('tehnik@tal', { standinDomain: 'nomail.example.org' })).toEqual(['tehnik.tal@nomail.example.org'])
  })
})

describe('stand-in addresses', () => {
  it('are unique per clinic and unambiguous', () => {
    expect(standinAddress('tehnik', 'tal')).not.toEqual(standinAddress('tehnik', 'par'))
    // The code never has a dot, so it is always the last segment.
    expect(standinAddress('a.b', 'c')).toBe('a.b.c@nomail.wivodent.com')
    expect(normaliseClinicCode('b.c')).toBeNull()
  })

  it('are recognised on every domain Wivo has used, and nothing else is', () => {
    for (const e of ['x.tal@nomail.wivodent.com', 'X@Example.COM', 'a@wivo.invalid', 'a@wivo.local']) expect(isStandinEmail(e)).toBe(true)
    for (const e of ['mari@kliinik.ee', 'no-reply@mail.wivodent.com', 'a@example.com.ee', '', null, undefined, 'nonsense']) {
      expect(isStandinEmail(e)).toBe(false)
    }
  })

  it('show as the login a person types', () => {
    expect(loginNameOf('tehnik.tal@nomail.wivodent.com')).toBe('tehnik@tal')
    expect(loginNameOf('mari.k.tal@nomail.wivodent.com')).toBe('mari.k@tal')
    expect(loginNameOf('tehnik@example.com')).toBe('tehnik')
    expect(loginNameOf('mari@kliinik.ee')).toBe('mari@kliinik.ee')
  })
})

describe('usernames and codes', () => {
  it('a new username is 2–32 of a–z 0–9 . _ -, starting with a letter or digit', () => {
    expect(normaliseUsername(' Tehnik ')).toBe('tehnik')
    expect(normaliseUsername('mari.k_2-x')).toBe('mari.k_2-x')
    for (const bad of ['t', '.tehnik', 'te hnik', 'tehnik@tal', 'ülle', 'x'.repeat(33)]) expect(normaliseUsername(bad)).toBeNull()
  })

  it('a code is the job-code prefix in lower case', () => {
    expect(normaliseClinicCode('TAL')).toBe('tal')
    expect(normaliseClinicCode('TAL2')).toBe('tal2')
    expect(normaliseClinicCode('TAL10')).toBe('tal10')
    for (const bad of ['', null, 'TA L', '2TAL', 'TA2L', 'TAL1234', 'PÄR']) expect(normaliseClinicCode(bad)).toBeNull()
  })
})
