// micopenly.com — shared types. Mirrors schema.sql.

export type ListingStatus = 'pending' | 'approved' | 'rejected' | 'closed'
export type OpenMicFormat = 'music' | 'comedy' | 'poetry' | 'variety' | 'other'
export type SignupMethod =
  | 'list_at_door' | 'sheet_in_advance' | 'online' | 'message_host' | 'walk_in' | 'other'
export type AgeRestriction = 'all_ages' | '18_plus' | '21_plus'
export type ReportKind = 'closed' | 'moved' | 'wrong_time' | 'wrong_info' | 'spam' | 'other'

/** 0 = Sunday … 6 = Saturday (same as JS Date.getDay and the database). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6
/** 1–5 = nth occurrence in the month, -1 = the last one. Empty array = every week. */
export type WeekOfMonth = -1 | 1 | 2 | 3 | 4 | 5

export interface Venue {
  id: string
  name: string
  address: string
  city: string
  region?: string
  postalCode?: string
  country: string
  lat: number
  lng: number
  timezone: string            // IANA, e.g. "America/New_York"
  websiteUrl?: string
  instagramUrl?: string
  status: ListingStatus
  createdAt: string
}

export interface OpenMic {
  id: string
  venueId: string
  title: string
  format: OpenMicFormat
  genres: string[]
  dayOfWeek: DayOfWeek
  weeksOfMonth: WeekOfMonth[]
  startTime: string           // "HH:MM[:SS]" local time at the venue
  endTime?: string
  signupMethod: SignupMethod
  signupTime?: string
  signupUrl?: string
  slotMinutes?: number
  hostName?: string
  houseGear?: string
  costNote?: string
  ageRestriction: AgeRestriction
  notes?: string
  startsOn?: string           // "YYYY-MM-DD"
  endsOn?: string
  status: ListingStatus
  lastVerifiedAt?: string
  createdAt: string
}

/** An open mic with its venue joined in (what the map and list actually render). */
export interface OpenMicWithVenue extends OpenMic {
  venue: Venue
}

// ── Explicit column lists. Never select('*'); never add private fields to these tables. ──
// (submitted_by is deliberately NOT selected: the client never needs it.)
export const VENUE_COLUMNS = [
  'id', 'name', 'address', 'city', 'region', 'postal_code', 'country', 'lat', 'lng',
  'timezone', 'website_url', 'instagram_url', 'status', 'created_at',
].join(', ')

export const OPEN_MIC_COLUMNS = [
  'id', 'venue_id', 'title', 'format', 'genres', 'day_of_week', 'weeks_of_month',
  'start_time', 'end_time', 'signup_method', 'signup_time', 'signup_url', 'slot_minutes',
  'host_name', 'house_gear', 'cost_note', 'age_restriction', 'notes', 'starts_on', 'ends_on',
  'status', 'last_verified_at', 'created_at',
].join(', ')

/** PostgREST embed: open_mics with their venue in one request. */
export const OPEN_MIC_WITH_VENUE_SELECT = `${OPEN_MIC_COLUMNS}, venue:venues(${VENUE_COLUMNS})`

// ── Row mappers (snake_case rows → camelCase app types) ──
/* eslint-disable @typescript-eslint/no-explicit-any */
export function rowToVenue(r: any): Venue {
  return {
    id: r.id, name: r.name, address: r.address, city: r.city,
    region: r.region ?? undefined, postalCode: r.postal_code ?? undefined,
    country: r.country, lat: r.lat, lng: r.lng, timezone: r.timezone,
    websiteUrl: r.website_url ?? undefined, instagramUrl: r.instagram_url ?? undefined,
    status: r.status, createdAt: r.created_at,
  }
}

export function rowToOpenMic(r: any): OpenMic {
  return {
    id: r.id, venueId: r.venue_id, title: r.title, format: r.format,
    genres: r.genres ?? [], dayOfWeek: r.day_of_week, weeksOfMonth: r.weeks_of_month ?? [],
    startTime: r.start_time, endTime: r.end_time ?? undefined,
    signupMethod: r.signup_method, signupTime: r.signup_time ?? undefined,
    signupUrl: r.signup_url ?? undefined, slotMinutes: r.slot_minutes ?? undefined,
    hostName: r.host_name ?? undefined, houseGear: r.house_gear ?? undefined,
    costNote: r.cost_note ?? undefined, ageRestriction: r.age_restriction,
    notes: r.notes ?? undefined, startsOn: r.starts_on ?? undefined, endsOn: r.ends_on ?? undefined,
    status: r.status, lastVerifiedAt: r.last_verified_at ?? undefined, createdAt: r.created_at,
  }
}

export function rowToOpenMicWithVenue(r: any): OpenMicWithVenue {
  return { ...rowToOpenMic(r), venue: rowToVenue(r.venue) }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── UI option lists ──
export const FORMAT_OPTIONS: { value: OpenMicFormat; label: string }[] = [
  { value: 'music', label: 'Music' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'poetry', label: 'Poetry / spoken word' },
  { value: 'variety', label: 'Variety' },
  { value: 'other', label: 'Other' },
]

export const SIGNUP_OPTIONS: { value: SignupMethod; label: string }[] = [
  { value: 'list_at_door', label: 'List at the door' },
  { value: 'sheet_in_advance', label: 'Sign-up sheet in advance' },
  { value: 'online', label: 'Online sign-up' },
  { value: 'message_host', label: 'Message the host' },
  { value: 'walk_in', label: 'Just walk in' },
  { value: 'other', label: 'Other' },
]

export const AGE_OPTIONS: { value: AgeRestriction; label: string }[] = [
  { value: 'all_ages', label: 'All ages' },
  { value: '18_plus', label: '18+' },
  { value: '21_plus', label: '21+' },
]

export const REPORT_OPTIONS: { value: ReportKind; label: string }[] = [
  { value: 'closed', label: 'No longer running' },
  { value: 'moved', label: 'Moved to a new venue' },
  { value: 'wrong_time', label: 'Wrong day or time' },
  { value: 'wrong_info', label: 'Other wrong info' },
  { value: 'spam', label: 'Spam / not a real open mic' },
  { value: 'other', label: 'Something else' },
]

export const GENRE_OPTIONS = [
  'Folk / Acoustic', 'Rock', 'Blues', 'Jazz', 'Country', 'Hip-Hop / Rap', 'R&B / Soul',
  'Pop', 'Indie', 'Punk', 'Metal', 'Original songs', 'Covers welcome',
]
