/**
 * One response envelope for every route.
 *
 * The Framer component must never have to parse an HTTP 500 body or guess
 * whether a 200 contains data or a message. Every answer has the same shape, so
 * the client has exactly one branch: `ok` or not.
 */
export interface ErrorBody {
  code: string
  /** Shown to the patient. Estonian is the product language. */
  et: string
  en: string
}

const baseHeaders = { 'content-type': 'application/json; charset=utf-8' }

export function ok<T>(data: T, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ ok: true, data, generatedAt: new Date().toISOString() }),
    { status: 200, headers: { ...baseHeaders, ...headers } },
  )
}

export function fail(
  status: number, error: ErrorBody, headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ ok: false, error }),
    { status, headers: { ...baseHeaders, ...headers } },
  )
}

/** Errors the routes actually raise. Kept in one place so wording is consistent. */
export const ERRORS = {
  UNKNOWN_CLINIC: {
    code: 'UNKNOWN_CLINIC',
    et: 'Kliinikut ei leitud.',
    en: 'Clinic not found.',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    et: 'Liiga palju päringuid. Proovi hetke pärast uuesti.',
    en: 'Too many requests. Try again shortly.',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    et: 'Sellist teed ei ole.',
    en: 'No such route.',
  },
  SERVER: {
    code: 'SERVER',
    et: 'Midagi läks valesti. Helista meile või proovi hiljem uuesti.',
    en: 'Something went wrong.',
  },
} as const satisfies Record<string, ErrorBody>
