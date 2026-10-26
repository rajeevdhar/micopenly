import { useEffect, useMemo, useRef, useState } from 'react'
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
import Intro from './components/Intro'
import { isTonight } from './lib/schedule'
import { distanceMiles, formatMiles, sortByDistance } from './lib/geo'
import { browserStore, clearRememberedAdd, hasRememberedAdd, rememberAdd, wantsToAdd, withoutAddParam } from './lib/intent'
import { countIncomingRequests, countOpenReports, countPending, fetchApprovedVenues } from './lib/api'
import type { OpenMicWithVenue, Venue } from './types'

export default function App() {
  const {
    user, isAdmin, needsPasswordReset, mics, loading, error, filters, selectedVenueId, view,
    authReady, sort, userPos, init, fetchMics, selectVenue, setView, logout,
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
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authReason, setAuthReason] = useState('')
  // Followed an "add your open mic" link (?add=1)? Read it once, then take it out of the address bar.
  const addLink = useRef(wantsToAdd(window.location.search))
  const closeAuth = () => { setShowAuth(false); setAuthMode('login'); setAuthReason('') }

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

  // "Add your open mic" links: signed in → open the form; signed out → ask them to create an account first,
  // and remember why for a day so it still works after they confirm their email.
  useEffect(() => {
    if (!authReady || !supabaseConfigured) return
    const store = browserStore()
    if (addLink.current) window.history.replaceState(null, '', withoutAddParam(window.location.pathname, window.location.search, window.location.hash))
    if (user) {
      if (addLink.current || hasRememberedAdd(store)) { addLink.current = false; clearRememberedAdd(store); void openSubmit() }
    } else if (addLink.current) {
      rememberAdd(store)
      setAuthMode('register'); setAuthReason('Create a free account to add your open mic. It only takes a minute.'); setShowAuth(true)
    }
  }, [authReady, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => sortByNext(applyFilters(mics, filters)), [mics, filters])
  const byVenue = useMemo(() => groupByVenue(filtered), [filtered])
  // When a pin is selected, the list narrows to that venue's mics.
  const listed = selectedVenueId ? (byVenue.get(selectedVenueId) ?? []) : filtered
  const nearestFirst = sort === 'nearest' && !!userPos
  const ordered = useMemo(
    () => (nearestFirst && userPos ? sortByDistance(listed, userPos, m => m.venue) : listed),
    [listed, nearestFirst, userPos],
  )
  const filtersActive = filters.day !== null || filters.tonight || filters.format !== null || filters.query !== ''
  // With no filters and no pin selected, split the list into "Tonight" and "Coming up" so what matters now comes first.
  const grouped = !filtersActive && !selectedVenueId && !nearestFirst
  const tonightList = grouped ? ordered.filter(m => isTonight(m, m.venue.timezone)) : []
  const laterList = grouped ? ordered.filter(m => !isTonight(m, m.venue.timezone)) : ordered
  const tonightCount = useMemo(() => mics.filter(m => isTonight(m, m.venue.timezone)).length, [mics])
  const renderCard = (m: OpenMicWithVenue) => (
    <OpenMicCard key={m.id} mic={m} expanded={selectedVenueId === m.venueId}
      distance={userPos ? formatMiles(distanceMiles(userPos, m.venue)) : undefined}
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
  )
  const sectionLabel = 'text-[11px] font-extrabold uppercase tracking-widest text-mute px-1 pt-1'

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 h-14 bg-ink text-white shrink-0">
        <h1 className="text-lg tracking-tight">Mic<span className="text-accent">Openly</span></h1>
        <span className="hidden sm:inline text-xs text-white/60">Open mics near you</span>
        <div className="ml-auto flex items-center gap-2">
          {supabaseConfigured && (
            <button className="text-sm font-bold bg-accent text-white px-3 h-11 sm:h-10" onClick={() => void openSubmit()}>
              <span className="sm:hidden">+ Add</span><span className="hidden sm:inline">+ Add an open mic</span>
            </button>
          )}
          {user && (
            <button className="text-sm font-bold border-2 border-white/40 text-white px-3 h-11 sm:h-10" onClick={() => setShowMine(true)}>
              <span className="sm:hidden">Mine</span><span className="hidden sm:inline">My submissions</span>
              {!isAdmin && incoming > 0 && <span className="ml-1.5 bg-accent px-1.5 text-xs">{incoming}<span className="sr-only"> address requests waiting</span></span>}
            </button>
          )}
          {isAdmin && (
            <button className="text-sm font-bold border-2 border-accent text-white px-3 h-11 sm:h-10" onClick={() => setShowAdmin(true)}>
              Review{attention > 0 && <span className="ml-1.5 bg-accent px-1.5 text-xs">{attention}</span>}
              <span className="sr-only"> submissions and reports</span>
            </button>
          )}
          {isAdmin && <span className="hidden sm:inline text-[10px] font-extrabold uppercase tracking-wider bg-accent px-2 py-1">Admin</span>}
          {user
            ? <button className="text-sm underline min-h-11 px-1" onClick={logout}>Sign out</button>
            : supabaseConfigured && <button className="text-sm font-bold border-2 border-white px-3 h-11 sm:h-10" onClick={() => setShowAuth(true)}>Sign in</button>}
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
            {!selectedVenueId && !loading && !error && <Intro canAdd={supabaseConfigured} onAdd={() => void openSubmit()} />}
            {selectedVenueId && (
              <button className="text-sm font-bold underline min-h-11" onClick={() => selectVenue(null)}>← Show all venues</button>
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
              <div className="border-2 border-line bg-white p-4 text-sm space-y-3">
                <div>
                  <p className="font-extrabold">No open mics listed yet.</p>
                  <p className="text-mute mt-1">Be the first to add one. Submissions are reviewed before they appear.</p>
                </div>
                {supabaseConfigured && <button className="btn btn-primary" onClick={() => void openSubmit()}>+ Add the first open mic</button>}
              </div>
            )}
            {!loading && !error && mics.length > 0 && listed.length === 0 && (
              <div className="border-2 border-line bg-white p-4 text-sm space-y-3">
                <div>
                  <p className="font-extrabold">{filters.tonight && !filters.query && filters.day === null && filters.format === null ? 'No open mics tonight.' : 'Nothing matches those filters.'}</p>
                  <p className="text-mute mt-1">Try another day or type, or clear the filters to see everything.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={useStore.getState().clearFilters}>Show all open mics</button>
                  {supabaseConfigured && <button className="btn" onClick={() => void openSubmit()}>Know one we’re missing?</button>}
                </div>
              </div>
            )}
            {grouped && tonightList.length > 0 && <h2 className={sectionLabel}>Tonight · {tonightList.length}</h2>}
            {tonightList.map(renderCard)}
            {grouped && tonightList.length > 0 && laterList.length > 0 && <h2 className={`${sectionLabel} pt-3`}>Coming up</h2>}
            {laterList.map(renderCard)}
          </div>
        </section>

        <section className={`${view === 'map' ? 'block' : 'hidden'} md:block flex-1 relative min-w-0`}>
          <OpenMicMap mics={filtered} selectedVenueId={selectedVenueId} onSelect={selectVenue} />
          {view === 'map' && !loading && !error && mics.length > 0 && (
            <button onClick={() => setView('list')}
              className="md:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-[1100] bg-ink text-white text-sm font-bold h-11 px-5 shadow-lg whitespace-nowrap">
              {tonightCount > 0 && <span className="text-accent-soft">{tonightCount} tonight · </span>}
              {filtered.length} open mic{filtered.length === 1 ? '' : 's'} · See list
            </button>
          )}
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
        <AuthModal initialMode={needsPasswordReset ? 'reset' : authMode} reason={authReason} onClose={closeAuth} />
      )}
    </div>
  )
}
