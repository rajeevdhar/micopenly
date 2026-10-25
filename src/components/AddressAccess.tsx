import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AddressRequest, OpenMicWithVenue, VenuePrivate } from '../types'
import { fetchMyRequest, fetchVenuePrivate, requestAddress } from '../lib/api'

const mapLink = (p: VenuePrivate) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`

/** Admin review: shows the real address that the public never sees. */
export function PrivateAddressNote({ venueId }: { venueId: string }) {
  const [p, setP] = useState<VenuePrivate | null | undefined>(undefined)
  useEffect(() => { void fetchVenuePrivate(venueId).then(setP) }, [venueId])
  if (p === undefined) return <p className="text-xs text-mute">Loading private address…</p>
  if (p === null) return <p className="text-xs text-accent-dark font-bold">Hidden address: none on file. Use “Edit first” to add it.</p>
  return (
    <p className="text-xs border-2 border-line bg-white px-3 py-2">
      <strong>Private address (hidden from the public):</strong> {p.address}{p.postalCode ? ` ${p.postalCode}` : ''}{' '}
      · <a className="underline text-accent-dark" href={mapLink(p)} target="_blank" rel="noopener noreferrer">map</a>
    </p>
  )
}

/**
 * Under a hidden-location listing: shows the real address to people who may see it (host, admin, approved guests),
 * otherwise lets a signed-in visitor ask the host for it.
 */
export default function AddressAccess({ mic, user, onNeedAuth, onChanged }: {
  mic: OpenMicWithVenue
  user: User | null
  onNeedAuth: () => void
  onChanged: (message: string) => void
}) {
  const venueId = mic.venueId
  const [priv, setPriv] = useState<VenuePrivate | null>(null)
  const [request, setRequest] = useState<AddressRequest | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoaded(false); setPriv(null); setRequest(null)
    if (!user) { setLoaded(true); return }
    void (async () => {
      const p = await fetchVenuePrivate(venueId)
      const r = p ? null : await fetchMyRequest(user.id, venueId)
      if (live) { setPriv(p); setRequest(r); setLoaded(true) }
    })()
    return () => { live = false }
  }, [venueId, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!user) return
    if (note.trim().length < 10) { setError('Tell the host a little about yourself (at least 10 characters).'); return }
    setBusy(true); setError('')
    const { error: err } = await requestAddress(user.id, venueId, note)
    setBusy(false)
    if (err) { setError(err); return }
    setRequest(await fetchMyRequest(user.id, venueId))
    setAsking(false)
    onChanged('Request sent. The host will decide.')
  }

  return (
    <div className="mt-3 border-2 border-ink bg-white p-3 space-y-2 text-sm" aria-label="Exact address">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-mute">Exact address is private</p>

      {priv && (
        <p>
          <strong>{priv.address}{priv.postalCode ? `, ${priv.postalCode}` : ''}</strong>{' '}
          · <a className="underline text-accent-dark" href={mapLink(priv)} target="_blank" rel="noopener noreferrer">Open map</a>
        </p>
      )}

      {!priv && loaded && !user && (
        <>
          <p>The host shares the address with people they approve. Sign in to ask.</p>
          <button className="btn btn-primary" onClick={onNeedAuth}>Sign in to request it</button>
        </>
      )}

      {!priv && loaded && user && !request && !asking && (
        <>
          <p>The pin is only approximate. The host shares the address with people they approve.</p>
          <button className="btn btn-primary" onClick={() => setAsking(true)}>Request the address</button>
        </>
      )}

      {!priv && user && !request && asking && (
        <div className="space-y-2">
          <label className="label" htmlFor={`req-${venueId}`}>Tell the host about yourself</label>
          <textarea id={`req-${venueId}`} className="field h-20 py-2" maxLength={500} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Your name, what you perform, and how the host can reach you if they want to." />
          <p className="text-xs text-mute">Only the host (and site moderators) will see this. You can ask once per venue.</p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send request'}</button>
            <button className="btn" onClick={() => { setAsking(false); setError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {!priv && request?.status === 'pending' && <p>Request sent. Waiting for the host to decide.</p>}
      {!priv && request?.status === 'declined' && <p>The host didn’t approve this request.</p>}
      {!priv && request?.status === 'approved' && <p>Approved, but the address couldn’t be loaded. Try again shortly.</p>}

      {error && <p role="alert" className="text-xs text-accent-dark font-bold">{error}</p>}
    </div>
  )
}
