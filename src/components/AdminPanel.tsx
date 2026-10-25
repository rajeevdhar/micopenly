import { useCallback, useEffect, useState } from 'react'
import { approveMic, fetchPending, rejectMic, setVenueStatus, type PendingBundle } from '../lib/api'
import type { OpenMicWithVenue } from '../types'
import OpenMicCard from './OpenMicCard'

export default function AdminPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [bundle, setBundle] = useState<PendingBundle | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchPending()
    if (err) setError(err)
    else { setBundle(data); setError('') }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (id: string, run: () => Promise<{ error: string | null }>) => {
    setBusyId(id); setError('')
    const { error: err } = await run()
    setBusyId(null)
    if (err) { setError(err); return }
    await load()
    onChanged()
  }

  const otherPending = (m: OpenMicWithVenue) =>
    (bundle?.mics ?? []).some(x => x.id !== m.id && x.venueId === m.venueId)

  const empty = bundle && bundle.mics.length === 0 && bundle.orphanVenues.length === 0

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box modal-wide" role="dialog" aria-modal="true" aria-label="Review submissions">
        <div className="sticky top-0 z-10 bg-ground flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">Review submissions</h2>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}
          {!bundle && !error && <p className="text-sm text-mute">Loading…</p>}
          {empty && <p className="text-sm">Nothing waiting for review.</p>}

          {bundle?.mics.map(m => (
            <div key={m.id} className="space-y-2">
              <OpenMicCard mic={m} expanded />
              <p className="text-xs text-mute">
                {m.venue.status === 'pending' ? 'New venue, approving this adds it to the map. ' : ''}
                {m.venue.lat.toFixed(4)}, {m.venue.lng.toFixed(4)} · time zone {m.venue.timezone}
              </p>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busyId === m.id} onClick={() => act(m.id, () => approveMic(m))}>Approve</button>
                <button className="btn" disabled={busyId === m.id} onClick={() => act(m.id, () => rejectMic(m, otherPending(m)))}>Reject</button>
              </div>
            </div>
          ))}

          {bundle && bundle.orphanVenues.length > 0 && (
            <div className="space-y-2 pt-2 border-t-2 border-line">
              <h3 className="text-sm uppercase tracking-widest">Venues with no open mic attached</h3>
              {bundle.orphanVenues.map(v => (
                <div key={v.id} className="border-2 border-line bg-white p-3 text-sm space-y-2">
                  <p className="font-bold">{v.name}</p>
                  <p className="text-mute">{v.address}, {v.city}</p>
                  <div className="flex gap-2">
                    <button className="btn" disabled={busyId === v.id} onClick={() => act(v.id, () => setVenueStatus(v.id, 'approved'))}>Approve venue</button>
                    <button className="btn" disabled={busyId === v.id} onClick={() => act(v.id, () => setVenueStatus(v.id, 'rejected'))}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
