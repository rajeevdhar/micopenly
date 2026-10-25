// micopenly.com — recurrence helpers.
// All date math is done on plain year/month/day numbers (no local-time Date objects), so
// results never depend on the viewer's timezone. "Today" is computed in the VENUE's timezone.

import type { DayOfWeek, WeekOfMonth } from '../types'

export interface Schedule {
  dayOfWeek: DayOfWeek
  weeksOfMonth: WeekOfMonth[]
  startsOn?: string   // "YYYY-MM-DD"
  endsOn?: string
}

type Ymd = { y: number; m: number; d: number }   // m is 1–12

function parseYmd(s: string): Ymd {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

function formatYmd({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function dayOfWeekOf({ y, m, d }: Ymd): DayOfWeek {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as DayOfWeek
}

function addDays({ y, m, d }: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** Today's date ("YYYY-MM-DD") in the given IANA timezone. */
export function todayInTz(timezone: string, now: Date = new Date()): string {
  // 'en-CA' formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Does this schedule occur on the given calendar date ("YYYY-MM-DD")? */
export function occursOn(s: Schedule, date: string): boolean {
  const ymd = parseYmd(date)
  if (dayOfWeekOf(ymd) !== s.dayOfWeek) return false
  if (s.startsOn && date < s.startsOn.slice(0, 10)) return false
  if (s.endsOn && date > s.endsOn.slice(0, 10)) return false
  if (s.weeksOfMonth.length === 0) return true

  const nth = Math.floor((ymd.d - 1) / 7) + 1                 // 1st..5th occurrence this month
  const isLast = ymd.d + 7 > daysInMonth(ymd.y, ymd.m)
  return s.weeksOfMonth.includes(nth as WeekOfMonth) || (isLast && s.weeksOfMonth.includes(-1))
}

/** Next date on or after `from` ("YYYY-MM-DD") that this schedule occurs, or null within the horizon. */
export function nextOccurrence(s: Schedule, from: string, horizonDays = 400): string | null {
  const start = parseYmd(from)
  for (let i = 0; i <= horizonDays; i++) {
    const candidate = formatYmd(addDays(start, i))
    if (occursOn(s, candidate)) return candidate
    if (s.endsOn && candidate > s.endsOn.slice(0, 10)) return null
  }
  return null
}

/** True if the open mic happens today in the venue's timezone. */
export function isTonight(s: Schedule, timezone: string, now: Date = new Date()): boolean {
  return occursOn(s, todayInTz(timezone, now))
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', [-1]: 'last' }

/** "Every Tuesday", "1st & 3rd Thursdays", "Last Friday". */
export function describeRecurrence(s: Pick<Schedule, 'dayOfWeek' | 'weeksOfMonth'>): string {
  const day = DAY_NAMES[s.dayOfWeek]
  if (s.weeksOfMonth.length === 0) return `Every ${day}`
  // order: 1st … 5th, then last
  const sorted = [...s.weeksOfMonth].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b))
  const parts = sorted.map(w => ORDINALS[w])
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
  const capitalised = joined.charAt(0).toUpperCase() + joined.slice(1)
  return parts.length === 1 && sorted[0] === -1 ? `${capitalised} ${day}` : `${capitalised} ${day}s`
}

/** "19:30:00" → "7:30 PM", "12:00" → "12:00 PM", "00:15" → "12:15 AM". */
export function formatTime(t: string): string {
  const [hh, mm] = t.split(':').map(Number)
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`
}

/** How long ago something was verified, for the "last verified" badge. */
export function verifiedAgo(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return 'Not verified yet'
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'Verified today'
  if (days === 1) return 'Verified yesterday'
  if (days < 30) return `Verified ${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'Verified a month ago' : `Verified ${months} months ago`
}

/** Listings not verified for this long should be visually flagged as possibly stale. */
export const STALE_AFTER_DAYS = 120
export function isStale(iso: string | undefined, now: Date = new Date()): boolean {
  if (!iso) return true
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000 > STALE_AFTER_DAYS
}
