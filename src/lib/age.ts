// Minimum age to create an account, and the check for it.
// We only ever ask for a date of birth to decide yes/no. The date itself is never sent or stored:
// the account just records that the check was passed (see AuthModal / store.register).

export const MIN_AGE = 16

export interface BirthDate { year: number; month: number; day: number }

export type AgeCheck = 'ok' | 'too_young' | 'invalid'

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Turns the three form boxes into a real calendar date, or null if they aren't one. */
export function parseBirthDate(year: string, month: string, day: string): BirthDate | null {
  if (!/^\d{4}$/.test(year.trim()) || !/^\d{1,2}$/.test(month.trim()) || !/^\d{1,2}$/.test(day.trim())) return null
  const y = Number(year), m = Number(month), d = Number(day)
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null
  return { year: y, month: m, day: d }
}

const key = (y: number, m: number, d: number) => y * 10000 + m * 100 + d

/**
 * Is this person at least MIN_AGE on `today`? Compared as plain calendar dates in the visitor's own
 * date, so there are no timezone or time-of-day surprises. A 29 February birthday counts as 1 March in
 * years without one, so nobody is let in a day early.
 */
export function checkAge(birth: BirthDate | null, today: Date = new Date(), min = MIN_AGE): AgeCheck {
  if (!birth) return 'invalid'
  const t = key(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const b = key(birth.year, birth.month, birth.day)
  if (b > t) return 'invalid'                       // born in the future
  const cutoff = key(today.getFullYear() - min, today.getMonth() + 1, today.getDate())
  return b <= cutoff ? 'ok' : 'too_young'
}

export const AGE_MESSAGES = {
  invalid: 'Enter your date of birth as month, day and a four-digit year.',
  too_young: `Sorry, you need to be ${MIN_AGE} or older to create a MicOpenly account.`,
  locked: `Sorry, you need to be ${MIN_AGE} or older to create a MicOpenly account. You can still browse the map without an account.`,
} as const
