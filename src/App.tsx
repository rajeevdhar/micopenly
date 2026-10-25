import { useEffect, useMemo, useState } from 'react'
import { applyFilters, groupByVenue, sortByNext, useStore } from './store'
import { supabaseConfigured } from './lib/supabase'
import OpenMicMap from './components/OpenMicMap'
import OpenMicCard from './components/OpenMicCard'
import FilterBar from './components/FilterBar'
import AuthModal from './components/AuthModal'
import SubmitModal from './components/SubmitModal'
import AdminPanel from './components/AdminPanel'
import ListingActions from './components/ListingActions'
import ReportModal from './components/ReportModal'
import MySubmissionsModal from './components/MySubmissionsModal'
import { countIncomingRequests, countOpenReports, countPending, fetchApprovedVenues } from './lib/api'
import type { OpenMicWithVenue, Venue } from './types'

export default function App() {
  const {
    user, isAdmin, needsPasswordReset, mics, loading, error, filters, selectedVenueId, view,
    init, fetchMics, selectVenue, setView, logout,
  } = useStore()
  const [showAuth, setShowAuth] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showMine, setShowMine] = useState(false)
  const [reporting, setReporting] = useState<OpenMicWithVenue | null>(null)
  const [adminEditing, setAdminEditing] = useState<OpenMicWithVenue | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  const [pending, setPending] = useState(0)
  const [reportCount, setReportCount] = useState(0)
  const [incoming, setIncoming] = useState(0)
  const [flash, setFlash] = useState('')

  const notify = (message: string) => {
    setFlash(message)
    window.setTimeout(() => setFlash(f => (f === message ? '' : f)), 4000)
  }
  const refreshCounts = () => {
    if (user && !isAdmin) void countIncomingRequests(user.id).then(setIncoming)
    if (!isAdmin) return
    void countPending().then(setPending)
    void countOpenReports().then(setReportCount)
  }
  useEffect(() => { refreshCounts() }, [isAdmin, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const attention = pending + reportCount

  const openSubmit = async () => {
    if (!user) { setShowAuth(true); return }
    setVenues(await fetchApprovedVenues())
    setShowSubmit(true)
  }

  useEffect(() => { init() }, [init])

  const filtered = useMemo(() => sortByNext(applyFilters(mics, filters)), [mics, filters])
  const byVenue = useMemo(() => groupByVenue(filtered), [filtered])
  // When a pin is selected, the list narrows to that venue's mics.
  const listed = selectedVenueId ? (byVenue.get(selectedVenueId) ?? []) : filtered

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 h-14 bg-ink text-white shrink-0">
        <h1 className="text-lg tracking-tight">Mic<span className="text-accent">Openly</span></h1>
        <span className="hidden sm:inline text-xs text-white/60">Open mics near you</span>
        <div className="ml-auto flex items-center gap-2">
          {supabaseConfigured && (
            <button className="text-sm font-bold bg-accent text-white px-3 h-9" onClick={() => void openSubmit()}>
              <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">+ Add an open mic</span>
            </button>
          )}
          {user && (
            <button className="text-sm font-bold border-2 border-white/40 text-white px-3 h-9" onClick={() => setShowMine(true)}>
              <span className="sm:hidden">Mine</span><span className="hidden sm:inline">My submissions</span>
              {!isAdmin && incoming > 0 && <span className="ml-1.5 bg-accent px-1.5 text-xs">{incoming}<span className="sr-only"> address requests waiting</span></span>}
            </button>
          )}
          {isAdmin && (
            <button className="text-sm font-bold border-2 border-accent text-white px-3 h-9" onClick={() => setShowAdmin(true)}>
              Review{attention > 0 && <span className="ml-1.5 bg-accent px-1.5 text-xs">{attention}</span>}
              <span className="sr-only"> submissions and reports</span>
            </button>
          )}
          {isAdmin && <span className="hidden sm:inline text-[10px] font-extrabold uppercase tracking-wider bg-accent px-2 py-1">Admin</span>}
          {user
            ? <button className="text-sm underline" onClick={logout}>Sign out</button>
            : supabaseConfigured && <button className="text-sm font-bold border-2 border-white px-3 h-9" onClick={() => setShowAuth(true)}>Sign in</button>}
        </div>
      </header>

      {/* Mobile map/list switch */}
      <div className="md:hidden flex border-b-2 border-ink shrink-0" role="tablist">
        {(['map', 'list'] as const).map(v => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`flex-1 h-11 text-sm font-extrabold uppercase tracking-wider ${view === v ? 'bg-ink text-white' : 'bg-white'}`}>
            {v}
          </button>
        ))}
      </div>

      <main className="flex-1 min-h-0 flex">
        <section className={`${view === 'list' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[420px] md:border-r-2 border-ink bg-ground min-h-0`}>
          <FilterBar count={filtered.length} />
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {selectedVenueId && (
              <button className="text-xs underline text-mute" onClick={() => selectVenue(null)}>← Show all venues</button>
            )}
            {loading && <p className="text-sm text-mute p-2">Loading open mics…</p>}
            {!loading && error === 'not-configured' && (
              <div className="border-2 border-ink bg-white p-4 text-sm space-y-2">
                <p className="font-extrabold">Supabase isn’t configured yet.</p>
                <p>Copy <code>.env.local.example</code> to <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart.</p>
              </div>
            )}
            {!loading && error && error !== 'not-configured' && (
              <div role="alert" className="border-2 border-accent bg-accent-soft p-4 text-sm space-y-2">
                <p className="font-extrabold">Couldn’t load open mics.</p>
                <p className="text-mute">{error}</p>
                <button className="btn" onClick={() => void fetchMics()}>Try again</button>
              </div>
            )}
            {!loading && !error && mics.length === 0 && (
              <div className="border-2 border-line bg-white p-4 text-sm">
                <p className="font-extrabold">No open mics listed yet.</p>
                <p className="text-mute mt-1">Be the first to add one — submissions are reviewed before they appear.</p>
              </div>
            )}
            {!loading && !error && mics.length > 0 && listed.length === 0 && (
              <p className="text-sm text-mute p-2">Nothing matches those filters.</p>
            )}
            {listed.map(m => (
              <OpenMicCard key={m.id} mic={m} expanded={selectedVenueId === m.venueId}
                onSelect={() => { selectVenue(m.venueId); setView('map') }}
                actions={
                  <ListingActions
                    mic={m} user={user} isAdmin={isAdmin}
                    onNeedAuth={() => setShowAuth(true)}
                    onReport={setReporting}
                    onEdit={setAdminEditing}
                    onChanged={message => { notify(message); void fetchMics(); refreshCounts() }}
                  />
                } />
            ))}
          </div>
        </section>

        <section className={`${view === 'map' ? 'block' : 'hidden'} md:block flex-1 relative min-w-0`}>
          <OpenMicMap mics={filtered} selectedVenueId={selectedVenueId} onSelect={selectVenue} />
        </section>
      </main>

      {flash && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[3000] bg-ink text-white text-sm px-4 py-2 shadow-lg">{flash}</div>
      )}

      {showSubmit && user && (
        <SubmitModal user={user} venues={venues} onClose={submitted => {
          setShowSubmit(false)
          if (submitted) { notify('Submitted for review.'); refreshCounts() }
        }} />
      )}
      {showAdmin && isAdmin && user && (
        <AdminPanel user={user} onClose={() => setShowAdmin(false)} onChanged={() => { refreshCounts(); void fetchMics() }} />
      )}
      {showMine && user && (
        <MySubmissionsModal user={user} isAdmin={isAdmin} onClose={() => setShowMine(false)}
          onChanged={message => { notify(message); refreshCounts(); void fetchMics() }} />
      )}
      {reporting && user && (
        <ReportModal mic={reporting} user={user} onClose={sent => {
          setReporting(null)
          if (sent) { notify('Thanks. A moderator will take a look.'); refreshCounts() }
        }} />
      )}
      {adminEditing && user && isAdmin && (
        <SubmitModal user={user} venues={[]} editing={{ mic: adminEditing, venueEditable: true }}
          onClose={saved => { setAdminEditing(null); if (saved) { notify('Changes saved.'); void fetchMics() } }} />
      )}

      {(showAuth || needsPasswordReset) && (
        <AuthModal initialMode={needsPasswordReset ? 'reset' : 'login'} onClose={() => setShowAuth(false)} />
      )}
    </div>
  )
}
