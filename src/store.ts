import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './lib/supabase'
import { DEMO_MICS } from './lib/demo'
import { isTonight, nextOccurrence, todayInTz } from './lib/schedule'
import {
  OPEN_MIC_WITH_VENUE_SELECT, rowToOpenMicWithVenue,
  type DayOfWeek, type OpenMicFormat, type OpenMicWithVenue,
} from './types'

export interface Filters {
  day: DayOfWeek | null
  tonight: boolean
  format: OpenMicFormat | null
  query: string
}
export const NO_FILTERS: Filters = { day: null, tonight: false, format: null, query: '' }

const DEMO = import.meta.env.DEV && import.meta.env.VITE_DEMO_DATA === '1'

interface State {
  user: User | null
  isAdmin: boolean
  needsPasswordReset: boolean
  mics: OpenMicWithVenue[]
  loading: boolean
  error: string | null
  filters: Filters
  selectedVenueId: string | null
  view: 'map' | 'list'

  init: () => void
  fetchMics: () => Promise<void>
  setFilters: (f: Partial<Filters>) => void
  clearFilters: () => void
  selectVenue: (id: string | null) => void
  setView: (v: 'map' | 'list') => void
  login: (email: string, password: string) => Promise<string | null>
  register: (email: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
}

let initialised = false

export const useStore = create<State>((set, get) => ({
  user: null,
  isAdmin: false,
  needsPasswordReset: false,
  mics: [],
  loading: true,
  error: null,
  filters: NO_FILTERS,
  selectedVenueId: null,
  view: 'map',

  init: () => {
    if (initialised) return
    initialised = true
    void get().fetchMics()
    if (!supabaseConfigured) return

    const applySession = async (user: User | null) => {
      set({ user, isAdmin: false })
      if (user) {
        // is_admin() is a security-definer function; the admins table itself is invisible to clients.
        const { data } = await supabase.rpc('is_admin')
        set({ isAdmin: data === true })
      }
    }
    supabase.auth.getSession().then(({ data }) => applySession(data.session?.user ?? null))
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') set({ needsPasswordReset: true })
      void applySession(session?.user ?? null)
    })
  },

  fetchMics: async () => {
    if (DEMO && !supabaseConfigured) {
      set({ mics: DEMO_MICS, loading: false, error: null })
      return
    }
    if (!supabaseConfigured) {
      set({ loading: false, error: 'not-configured' })
      return
    }
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('open_mics')
      .select(OPEN_MIC_WITH_VENUE_SELECT)
      .eq('status', 'approved')
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    // Defensive: drop any row whose venue didn't come back (RLS hides unapproved venues).
    const rows = (data ?? []) as unknown as { venue: unknown }[]
    const mics = rows.filter(r => r.venue).map(rowToOpenMicWithVenue)
    set({ mics, loading: false })
  },

  setFilters: f => set(s => ({ filters: { ...s.filters, ...f } })),
  clearFilters: () => set({ filters: NO_FILTERS }),
  selectVenue: id => set({ selectedVenueId: id }),
  setView: view => set({ view }),

  login: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  },
  register: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    return error ? error.message : null
  },
  logout: async () => { await supabase.auth.signOut() },
}))

// ── Selectors (pure, so they're easy to test) ──

export function applyFilters(mics: OpenMicWithVenue[], f: Filters, now: Date = new Date()): OpenMicWithVenue[] {
  const q = f.query.trim().toLowerCase()
  return mics.filter(m => {
    if (f.day !== null && m.dayOfWeek !== f.day) return false
    if (f.format && m.format !== f.format) return false
    if (f.tonight && !isTonight(m, m.venue.timezone, now)) return false
    if (q) {
      const hay = [m.title, m.venue.name, m.venue.city, m.venue.region, m.hostName, ...m.genres]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Soonest first, judged in each venue's own timezone. Mics with no upcoming date go last. */
export function sortByNext(mics: OpenMicWithVenue[], now: Date = new Date()): OpenMicWithVenue[] {
  const key = (m: OpenMicWithVenue) => {
    const next = nextOccurrence(m, todayInTz(m.venue.timezone, now))
    return next ? `${next}T${m.startTime}` : '9999'
  }
  return [...mics].sort((a, b) => key(a).localeCompare(key(b)))
}

export function groupByVenue(mics: OpenMicWithVenue[]): Map<string, OpenMicWithVenue[]> {
  const out = new Map<string, OpenMicWithVenue[]>()
  for (const m of mics) out.set(m.venueId, [...(out.get(m.venueId) ?? []), m])
  return out
}
