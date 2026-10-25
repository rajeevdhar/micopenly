import { supabase } from './supabase'
import {
  OPEN_MIC_WITH_VENUE_SELECT, OPEN_MIC_COLUMNS, VENUE_COLUMNS, rowToOpenMicWithVenue, rowToVenue,
  type OpenMicWithVenue, type ReportKind, type Venue,
} from '../types'
import { micFields, micRow, venueFields, venueRow, type MicDraft, type VenueDraft } from './submission'

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
    const { data, error } = await supabase.from('venues').insert(venueRow(venue, userId)).select('id').single()
    if (error || !data) return { error: friendly(error?.message ?? 'Could not save the venue.', error?.code) }
    venueId = data.id as string
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
  const { data } = await supabase.from('venues').select(VENUE_COLUMNS).eq('status', 'approved').order('name')
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
    const v = await supabase.from('venues').update(venueFields(venue)).eq('id', mic.venueId).select('id')
    if (v.error) return { error: friendly(v.error.message, v.error.code) }
    if (!v.data?.length) return { error: 'The venue couldn’t be changed. It may already have been reviewed.' }
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
