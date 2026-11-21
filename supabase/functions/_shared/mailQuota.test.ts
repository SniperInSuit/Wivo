import { describe, it, expect } from 'vitest'
import { quotaLimit, quotaLimitInError } from './mailQuota.ts'

const DAILY = '{"statusCode":429,"message":"You have reached your daily email sending quota.","name":"daily_quota_exceeded"}'
const MONTHLY = '{"statusCode":429,"message":"You have reached your monthly email sending quota.","name":"monthly_quota_exceeded"}'
const RATE = '{"statusCode":429,"message":"Too many requests.","name":"rate_limit_exceeded"}'

describe('quotaLimit', () => {
  it('reads the daily and monthly limit, and nothing else', () => {
    expect(quotaLimit(429, DAILY)).toBe('daily')
    expect(quotaLimit(429, MONTHLY)).toBe('monthly')
    expect(quotaLimit(429, RATE)).toBeNull()
    expect(quotaLimit(500, DAILY)).toBeNull()
    expect(quotaLimit(200, '')).toBeNull()
  })
  it('reads it from "status body"', () => {
    expect(quotaLimitInError(`429 ${DAILY}`)).toBe('daily')
    expect(quotaLimitInError(`422 ${DAILY}`)).toBeNull()
    expect(quotaLimitInError(undefined)).toBeNull()
  })
})
