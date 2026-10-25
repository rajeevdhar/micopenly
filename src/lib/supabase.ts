import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False until the two VITE_ env vars are set (they are baked in at build time). */
export const supabaseConfigured = Boolean(url && key)

// A placeholder keeps the app bootable (and showing a helpful message) when unconfigured.
export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured')
