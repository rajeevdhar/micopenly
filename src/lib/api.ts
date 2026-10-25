import { supabase } from './supabase'
import {
  OPEN_MIC_WITH_VENUE_SELECT, VENUE_COLUMNS, rowToOpenMicWithVenue, rowToVenue,
  type OpenMicWithVenue, type Venue,
} from '../types'
import { micRow, venueRow, type MicDraft, type VenueDraft } from './submission'

export interface Result { error: string | null }

function friendly(message: string, code?: string): string {
  if (code === '23505') return 'That open mic is already listed (same venue, day and start time).'
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
