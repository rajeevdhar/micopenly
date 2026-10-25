// Pure helpers for the submit form: validation, cleaning, and mapping to database rows.
// Kept free of React/Supabase so they can be unit-tested (tests/test-submission.cjs).

import type {
  AgeRestriction, DayOfWeek, OpenMicFormat, OpenMicWithVenue, SignupMethod, WeekOfMonth,
} from '../types'

export interface VenueDraft {
  existingVenueId: string | null
  name: string
  address: string
  city: string
  region: string
  postalCode: string
  lat: number | null
  lng: number | null
  timezone: string
  websiteUrl: string
  instagramUrl: string
  /** Keep the exact address private; the public map shows only the town. */
  locationHidden: boolean
}

export interface MicDraft {
  title: string
  format: OpenMicFormat
  genres: string[]
  dayOfWeek: DayOfWeek | null
  weeksOfMonth: WeekOfMonth[]
  startTime: string
  endTime: string
  signupMethod: SignupMethod
  signupTime: string
  signupUrl: string
  slotMinutes: string
  hostName: string
  houseGear: string
  costNote: string
  ageRestriction: AgeRestriction
  notes: string
}

export const EMPTY_VENUE: VenueDraft = {
  existingVenueId: null, name: '', address: '', city: '', region: '', postalCode: '',
  lat: null, lng: null, timezone: 'America/New_York', websiteUrl: '', instagramUrl: '', locationHidden: false,
}

export const EMPTY_MIC: MicDraft = {
  title: '', format: 'music', genres: [], dayOfWeek: null, weeksOfMonth: [],
  startTime: '', endTime: '', signupMethod: 'list_at_door', signupTime: '', signupUrl: '',
  slotMinutes: '', hostName: '', houseGear: '', costNote: '', ageRestriction: 'all_ages', notes: '',
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (no daylight time)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'Europe/London', label: 'London' },
]

/** Rough timezone guess for the contiguous US from coordinates; null elsewhere (keep what's set). */
export function guessTimezone(lat: number, lng: number): string | null {
  if (lat < 24 || lat > 50 || lng < -125 || lng > -66) return null
  if (lng > -87) return 'America/New_York'
  if (lng > -102) return 'America/Chicago'
  if (lng > -115) return 'America/Denver'
  return 'America/Los_Angeles'
}

/**
 * Cleans a user-typed web address. Returns the cleaned https/http URL, '' if blank,
 * or null if it can't be a valid web address. Never returns javascript:/data: etc.
 */
export function cleanUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u.href
  } catch { return null }
}

/** Accepts "@handle", "handle", or a URL; returns an instagram.com URL, '' if blank, null if invalid. */
export function cleanInstagram(input: string): string | null {
  const s = input.trim()
  if (!s) return ''
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(s)) return `https://www.instagram.com/${s.replace(/^@/, '')}/`
  const url = cleanUrl(s)
  if (!url) return null
  return /(^|\.)instagram\.com$/i.test(new URL(url).hostname) ? url : null
}

export type Errors = Record<string, string>

export function validate(v: VenueDraft, m: MicDraft): Errors {
  const e: Errors = {}
  if (!v.existingVenueId) {
    if (!v.name.trim()) e.venueName = 'Enter the venue name.'
    else if (v.name.trim().length > 120) e.venueName = 'Keep the venue name under 120 characters.'
    if (!v.address.trim()) e.address = 'Enter the street address.'
    if (!v.city.trim()) e.city = 'Enter the city.'
    if (v.lat === null || v.lng === null) e.location = 'Find the address on the map so the pin is in the right place.'
    else if (v.lat < -90 || v.lat > 90 || v.lng < -180 || v.lng > 180) e.location = 'That location is out of range.'
    if (cleanUrl(v.websiteUrl) === null) e.websiteUrl = 'That doesn’t look like a web address.'
    if (cleanInstagram(v.instagramUrl) === null) e.instagramUrl = 'Use an Instagram handle or link.'
  }
  if (!m.title.trim()) e.title = 'Give the open mic a name, e.g. “Tuesday Acoustic Night”.'
  else if (m.title.trim().length > 120) e.title = 'Keep the name under 120 characters.'
  if (m.dayOfWeek === null) e.dayOfWeek = 'Pick the day of the week.'
  if (!m.startTime) e.startTime = 'Enter the start time.'
  if (cleanUrl(m.signupUrl) === null) e.signupUrl = 'That doesn’t look like a web address.'
  if (m.slotMinutes.trim()) {
    const n = Number(m.slotMinutes)
    if (!Number.isInteger(n) || n < 1 || n > 120) e.slotMinutes = 'Use a whole number of minutes from 1 to 120.'
  }
  if (m.hostName.length > 100) e.hostName = 'Keep it under 100 characters.'
  if (m.houseGear.length > 300) e.houseGear = 'Keep it under 300 characters.'
  if (m.costNote.length > 200) e.costNote = 'Keep it under 200 characters.'
  if (m.notes.length > 1000) e.notes = 'Keep notes under 1,000 characters.'
  return e
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null)

/** What the public row says instead of a street address when the location is hidden. Must match the database check. */
export const HIDDEN_ADDRESS = 'Address shared on request'

/** Round a coordinate to 2 decimals (~1 km). The database enforces the same for hidden venues. */
export const roundCoord = (n: number): number => Number(n.toFixed(2))

/**
 * The map point the PUBLIC sees. Visible venues: the exact pin. Hidden venues: the centre of the
 * town (when we could look it up), otherwise the pin snapped to 0.1 degree (~11 km). Always rounded to 2 decimals.
 */
export function publicPoint(v: VenueDraft, town: { lat: number; lng: number } | null): { lat: number; lng: number } {
  if (!v.locationHidden) return { lat: v.lat as number, lng: v.lng as number }
  if (town) return { lat: roundCoord(town.lat), lng: roundCoord(town.lng) }
  return { lat: roundCoord(Number((v.lat as number).toFixed(1))), lng: roundCoord(Number((v.lng as number).toFixed(1))) }
}

/** The editable venue columns (no status / owner), shared by create and edit. */
export function venueFields(v: VenueDraft, town: { lat: number; lng: number } | null = null) {
  const pt = publicPoint(v, town)
  return {
    name: v.name.trim(),
    address: v.locationHidden ? HIDDEN_ADDRESS : v.address.trim(),
    city: v.city.trim(),
    region: orNull(v.region),
    postal_code: v.locationHidden ? null : orNull(v.postalCode),
    country: 'US',
    lat: pt.lat,
    lng: pt.lng,
    timezone: v.timezone,
    website_url: orNull(cleanUrl(v.websiteUrl) ?? ''),
    instagram_url: orNull(cleanInstagram(v.instagramUrl) ?? ''),
    location_hidden: v.locationHidden,
  }
}

export function venueRow(v: VenueDraft, userId: string, town: { lat: number; lng: number } | null = null) {
  return { ...venueFields(v, town), status: 'pending' as const, submitted_by: userId }
}

/** The private half of a hidden venue: the real address and pin. Never sent to the public table. */
export function privateFields(v: VenueDraft) {
  return {
    address: v.address.trim(),
    postal_code: orNull(v.postalCode),
    lat: v.lat as number,
    lng: v.lng as number,
  }
}

/** The editable open-mic columns (no venue / status / owner / verification), shared by create and edit. */
export function micFields(m: MicDraft) {
  return {
    title: m.title.trim(),
    format: m.format,
    genres: m.genres,
    day_of_week: m.dayOfWeek as number,
    weeks_of_month: [...m.weeksOfMonth].sort((a, b) => a - b),
    start_time: m.startTime,
    end_time: orNull(m.endTime),
    signup_method: m.signupMethod,
    signup_time: orNull(m.signupTime),
    signup_url: orNull(cleanUrl(m.signupUrl) ?? ''),
    slot_minutes: m.slotMinutes.trim() ? Number(m.slotMinutes) : null,
    host_name: orNull(m.hostName),
    house_gear: orNull(m.houseGear),
    cost_note: orNull(m.costNote),
    age_restriction: m.ageRestriction,
    notes: orNull(m.notes),
  }
}

export function micRow(m: MicDraft, venueId: string, userId: string) {
  return { venue_id: venueId, ...micFields(m), status: 'pending' as const, submitted_by: userId }
}

/** Turn a saved listing back into form drafts for editing. */
export function draftsFromMic(m: OpenMicWithVenue): { venue: VenueDraft; mic: MicDraft } {
  const v = m.venue
  return {
    venue: {
      // A hidden venue's public row holds only a placeholder and a town pin, so start blank;
      // the form loads the real address separately (only the host or an admin can).
      existingVenueId: null, name: v.name, address: v.locationHidden ? '' : v.address, city: v.city,
      region: v.region ?? '', postalCode: v.postalCode ?? '',
      lat: v.locationHidden ? null : v.lat, lng: v.locationHidden ? null : v.lng,
      timezone: v.timezone, websiteUrl: v.websiteUrl ?? '', instagramUrl: v.instagramUrl ?? '',
      locationHidden: v.locationHidden === true,
    },
    mic: {
      title: m.title, format: m.format, genres: [...m.genres], dayOfWeek: m.dayOfWeek,
      weeksOfMonth: [...m.weeksOfMonth], startTime: m.startTime.slice(0, 5),
      endTime: m.endTime ? m.endTime.slice(0, 5) : '', signupMethod: m.signupMethod,
      signupTime: m.signupTime ? m.signupTime.slice(0, 5) : '', signupUrl: m.signupUrl ?? '',
      slotMinutes: m.slotMinutes ? String(m.slotMinutes) : '', hostName: m.hostName ?? '',
      houseGear: m.houseGear ?? '', costNote: m.costNote ?? '', ageRestriction: m.ageRestriction,
      notes: m.notes ?? '',
    },
  }
}

/** Address → coordinates via OpenStreetMap Nominatim (free, low volume). Returns null if nothing found. */
export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}).`)
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[]
  if (!rows.length) return null
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), label: rows[0].display_name }
}

/** Centre of the town (for the public pin of a hidden venue). Null if it can't be found. */
export async function geocodeTown(v: Pick<VenueDraft, 'city' | 'region'>): Promise<{ lat: number; lng: number } | null> {
  try {
    const hit = await geocode([v.city, v.region, 'USA'].map(s => s.trim()).filter(Boolean).join(', '))
    return hit ? { lat: hit.lat, lng: hit.lng } : null
  } catch { return null }
}
