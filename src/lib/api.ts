import { supabase } from './supabase'
import {
  OPEN_MIC_WITH_VENUE_SELECT, OPEN_MIC_COLUMNS, VENUE_COLUMNS, rowToAddressRequest, rowToOpenMicWithVenue, rowToVenue,
  type AddressRequest, type OpenMicWithVenue, type ReportKind, type RequestStatus, type Venue, type VenuePrivate,
} from '../types'
import {
  geocodeTown, micFields, micRow, privateFields, venueFields, venueRow, type MicDraft, type VenueDraft,
} from './submission'

export interface Result { error: string | null }

function friendly(message: string, code?: string, duplicate = 'That open mic is already listed (same venue, day and start time).'): string {
  if (code === '23505') return duplicate
  if (code === '42501') return 'You don’t have permission to do that. Try signing out and back in.'
  return message
}

/** Create the venue (if new) and the open mic, both as 'pending'. */
export async function submitOpenMic(userId: string, venue: VenueDraft, mic: MicDraft): Promise<Result> {
  let venueId = venue.existingVenueId
  if (!venueId) {
    const town = venue.locationHidden ? await geocodeTown(venue) : null
    const { data, error } = await supabase.from('venues').insert(venueRow(venue, userId, town)).select('id').single()
    if (error || !data) return { error: friendly(error?.message ?? 'Could not save the venue.', error?.code) }
    venueId = data.id as string
    if (venue.locationHidden) {
      const p = await supabase.from('venue_private').insert({ venue_id: venueId, ...privateFields(venue) })
      if (p.error) {
        return { error: `The venue was saved, but its private address wasn’t (${friendly(p.error.message, p.error.code)}). Open “My submissions” and edit it to add the address.` }
      }
    }
  }
  const { error } = await supabase.from('open_mics').insert(micRow(mic, venueId, userId))
  if (error) {
    return {
      error: friendly(error.message, error.code) +
        (venue.existingVenueId ? '' : ' (The venue was saved; resubmitting will reuse it once it is approved.)'),
    }
  }
  return { error: null }
}

export async function countPending(): Promise<number> {
  const { count } = await supabase.from('open_mics').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  return count ?? 0
}

export interface PendingBundle { mics: OpenMicWithVenue[]; orphanVenues: Venue[] }

/** Admin only (row-level security returns nothing to anyone else). */
export async function fetchPending(): Promise<{ data: PendingBundle | null; error: string | null }> {
  const [mics, venues] = await Promise.all([
    supabase.from('open_mics').select(OPEN_MIC_WITH_VENUE_SELECT).eq('status', 'pending').order('created_at'),
    supabase.from('venues').select(VENUE_COLUMNS).eq('status', 'pending').order('created_at'),
  ])
  if (mics.error) return { data: null, error: mics.error.message }
  if (venues.error) return { data: null, error: venues.error.message }
  const micRows = ((mics.data ?? []) as unknown as { venue: unknown }[]).filter(r => r.venue)
  const list = micRows.map(rowToOpenMicWithVenue)
  const withMic = new Set(list.map(m => m.venueId))
  const orphanVenues = (venues.data ?? []).map(rowToVenue).filter(v => !withMic.has(v.id))
  return { data: { mics: list, orphanVenues }, error: null }
}

/** Approve a pending open mic (and its venue if that is still pending). */
export async function approveMic(m: OpenMicWithVenue): Promise<Result> {
  if (m.venue.locationHidden && m.venue.status === 'pending') {
    const { data } = await supabase.from('venue_private').select('venue_id').eq('venue_id', m.venueId)
    if (!data?.length) return { error: 'This venue hides its address but none is on file. Use “Edit first” to add it.' }
  }
  if (m.venue.status === 'pending') {
    const { error } = await supabase.from('venues').update({ status: 'approved' }).eq('id', m.venueId)
    if (error) return { error: friendly(error.message, error.code) }
  }
  const { error } = await supabase
    .from('open_mics')
    .update({ status: 'approved', last_verified_at: new Date().toISOString() })
    .eq('id', m.id)
  return { error: error ? friendly(error.message, error.code) : null }
}

export async function rejectMic(m: OpenMicWithVenue, venueHasOtherPending: boolean): Promise<Result> {
  const { error } = await supabase.from('open_mics').update({ status: 'rejected' }).eq('id', m.id)
  if (error) return { error: friendly(error.message, error.code) }
  if (m.venue.status === 'pending' && !venueHasOtherPending) {
    const v = await supabase.from('venues').update({ status: 'rejected' }).eq('id', m.venueId)
    if (v.error) return { error: friendly(v.error.message, v.error.code) }
  }
  return { error: null }
}

export async function setVenueStatus(id: string, status: 'approved' | 'rejected'): Promise<Result> {
  const { error } = await supabase.from('venues').update({ status }).eq('id', id)
  return { error: error ? friendly(error.message, error.code) : null }
}

export async function fetchApprovedVenues(): Promise<Venue[]> {
  // Venues with a hidden address are left out: adding nights to someone else's private venue isn't offered.
  const { data } = await supabase.from('venues').select(VENUE_COLUMNS).eq('status', 'approved').eq('location_hidden', false).order('name')
  return (data ?? []).map(rowToVenue)
}

// ── Freshness: "still running" and problem reports ──

export async function confirmMic(userId: string, micId: string): Promise<Result> {
  const { error } = await supabase.from('open_mic_confirmations').insert({ open_mic_id: micId, user_id: userId })
  return { error: error ? friendly(error.message, error.code, 'You already confirmed this one today. Thanks!') : null }
}

export async function reportMic(userId: string, micId: string, kind: ReportKind, note: string): Promise<Result> {
  const { error } = await supabase.from('reports').insert({
    open_mic_id: micId, reporter_id: userId, kind, note: note.trim() || null,
  })
  return { error: error ? friendly(error.message, error.code, 'You’ve already reported this one. A moderator will take a look.') : null }
}

// ── My submissions ──

export async function fetchMine(userId: string): Promise<{ data: OpenMicWithVenue[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('open_mics')
    .select(OPEN_MIC_WITH_VENUE_SELECT)
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  const rows = (data ?? []) as unknown as { venue: unknown }[]
  return { data: rows.filter(r => r.venue).map(rowToOpenMicWithVenue), error: null }
}

/**
 * Save edits to a listing. Pass `venue` only when the venue itself may be edited
 * (still pending and yours, or you're an admin). Row-level security decides what actually saves;
 * we check that rows really changed, because a blocked update returns no error, just zero rows.
 */
export async function updateListing(mic: OpenMicWithVenue, venue: VenueDraft | null, draft: MicDraft): Promise<Result> {
  if (venue) {
    // Keep the public pin where it is unless the venue is hidden and its town changed.
    const town = venue.locationHidden ? await geocodeTown(venue) : null
    const v = await supabase.from('venues').update(venueFields(venue, town)).eq('id', mic.venueId).select('id')
    if (v.error) return { error: friendly(v.error.message, v.error.code) }
    if (!v.data?.length) return { error: 'The venue couldn’t be changed. It may already have been reviewed.' }
    if (venue.locationHidden) {
      const p = await supabase.from('venue_private').upsert({ venue_id: mic.venueId, ...privateFields(venue) }).select('venue_id')
      if (p.error) return { error: friendly(p.error.message, p.error.code) }
      if (!p.data?.length) return { error: 'The private address couldn’t be saved.' }
    } else {
      const d = await supabase.from('venue_private').delete().eq('venue_id', mic.venueId)
      if (d.error) return { error: friendly(d.error.message, d.error.code) }
    }
  }
  const m = await supabase.from('open_mics').update(micFields(draft)).eq('id', mic.id).select('id')
  if (m.error) return { error: friendly(m.error.message, m.error.code) }
  if (!m.data?.length) return { error: 'This listing couldn’t be changed. It may already have been reviewed. Use “Report a problem” to ask for a fix.' }
  return { error: null }
}

// ── Admin: reports queue, closing listings ──

export interface ReportItem { id: string; kind: ReportKind; note?: string; createdAt: string; mic: OpenMicWithVenue }

export async function fetchReports(): Promise<{ data: ReportItem[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('reports')
    .select(`id, kind, note, created_at, open_mic:open_mics(${OPEN_MIC_COLUMNS}, venue:venues(${VENUE_COLUMNS}))`)
    .eq('status', 'open')
    .order('created_at')
  if (error) return { data: null, error: error.message }
  type Raw = { id: string; kind: ReportKind; note: string | null; created_at: string; open_mic: { venue: unknown } | null }
  const items = ((data ?? []) as unknown as Raw[])
    .filter(r => r.open_mic && r.open_mic.venue)
    .map(r => ({ id: r.id, kind: r.kind, note: r.note ?? undefined, createdAt: r.created_at, mic: rowToOpenMicWithVenue(r.open_mic) }))
  return { data: items, error: null }
}

export async function countOpenReports(): Promise<number> {
  const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
  return count ?? 0
}

export async function resolveReport(id: string, adminId: string, status: 'resolved' | 'dismissed'): Promise<Result> {
  const { error } = await supabase
    .from('reports')
    .update({ status, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error ? friendly(error.message, error.code) : null }
}

/** Admin: take a listing off the map (reversible, the row is kept). */
export async function setMicStatus(id: string, status: 'closed' | 'approved'): Promise<Result> {
  const { data, error } = await supabase.from('open_mics').update({ status }).eq('id', id).select('id')
  if (error) return { error: friendly(error.message, error.code) }
  return { error: data?.length ? null : 'That change wasn’t saved.' }
}

// ── Hidden addresses: private address and requests ──

/** The real address. Returns null unless you're the host, an admin, or an approved guest. */
export async function fetchVenuePrivate(venueId: string): Promise<VenuePrivate | null> {
  const { data } = await supabase.from('venue_private').select('address, postal_code, lat, lng').eq('venue_id', venueId).maybeSingle()
  if (!data) return null
  return { address: data.address, postalCode: data.postal_code ?? undefined, lat: data.lat, lng: data.lng }
}

export async function requestAddress(userId: string, venueId: string, note: string): Promise<Result> {
  const { error } = await supabase.from('address_requests').insert({ venue_id: venueId, requester_id: userId, note: note.trim() })
  return { error: error ? friendly(error.message, error.code, 'You’ve already asked for this address.') : null }
}

/** My own request for a venue, if any. */
export async function fetchMyRequest(userId: string, venueId: string): Promise<AddressRequest | null> {
  const { data } = await supabase
    .from('address_requests').select('id, venue_id, note, status, created_at')
    .eq('venue_id', venueId).eq('requester_id', userId).maybeSingle()
  return data ? rowToAddressRequest(data) : null
}

export interface IncomingRequest extends AddressRequest { venueName: string }

/** Requests from other people for venues I host. Pass my hidden venue ids. */
export async function fetchIncomingRequests(venueIds: string[]): Promise<{ data: IncomingRequest[]; error: string | null }> {
  if (!venueIds.length) return { data: [], error: null }
  const { data, error } = await supabase
    .from('address_requests')
    .select('id, venue_id, note, status, created_at, venue:venues(name)')
    .in('venue_id', venueIds)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  const rows = (data ?? []) as unknown as { venue: { name: string } | null }[]
  return { data: rows.map(r => ({ ...rowToAddressRequest(r), venueName: r.venue?.name ?? 'Your venue' })), error: null }
}

/** How many requests from other people are waiting on me. Admins are skipped (they see everyone's). */
export async function countIncomingRequests(userId: string): Promise<number> {
  const { count } = await supabase
    .from('address_requests').select('id', { count: 'exact', head: true })
    .eq('status', 'pending').neq('requester_id', userId)
  return count ?? 0
}

export async function decideRequest(id: string, status: Exclude<RequestStatus, 'pending'>): Promise<Result> {
  const { data, error } = await supabase.from('address_requests').update({ status }).eq('id', id).select('id')
  if (error) return { error: friendly(error.message, error.code) }
  return { error: data?.length ? null : 'That change wasn’t saved.' }
}
