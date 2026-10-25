import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  approveMic, fetchPending, fetchReports, rejectMic, resolveReport, setMicStatus, setVenueStatus,
  type PendingBundle, type ReportItem,
} from '../lib/api'
import { REPORT_OPTIONS, type OpenMicWithVenue } from '../types'
import OpenMicCard from './OpenMicCard'
import SubmitModal from './SubmitModal'

type Tab = 'pending' | 'reports'

export default function AdminPanel({ user, initialTab = 'pending', onClose, onChanged }: {
  user: User
  initialTab?: Tab
  onClose: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [bundle, setBundle] = useState<PendingBundle | null>(null)
  const [reports, setReports] = useState<ReportItem[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<OpenMicWithVenue | null>(null)

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([fetchPending(), fetchReports()])
    if (p.error || r.error) setError(p.error ?? r.error ?? '')
    else setError('')
    if (p.data) setBundle(p.data)
    if (r.data) setReports(r.data)
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

  const pendingCount = (bundle?.mics.length ?? 0) + (bundle?.orphanVenues.length ?? 0)
  const reportCount = reports?.length ?? 0
  const kindLabel = (k: string) => REPORT_OPTIONS.find(o => o.value === k)?.label ?? k

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box modal-wide" role="dialog" aria-modal="true" aria-label="Review">
        <div className="sticky top-0 z-10 bg-ground border-b-2 border-ink">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-lg">Review</h2>
            <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
          </div>
          <div className="flex" role="tablist">
            {([['pending', `New submissions (${pendingCount})`], ['reports', `Problem reports (${reportCount})`]] as const).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`flex-1 h-11 text-xs font-extrabold uppercase tracking-wider border-t-2 border-ink ${tab === t ? 'bg-ink text-white' : 'bg-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}

          {tab === 'pending' && (
            <>
              {!bundle && !error && <p className="text-sm text-mute">Loading…</p>}
              {bundle && pendingCount === 0 && <p className="text-sm">Nothing waiting for review.</p>}

              {bundle?.mics.map(m => (
                <div key={m.id} className="space-y-2">
                  <OpenMicCard mic={m} expanded showFreshness={false} />
                  <p className="text-xs text-mute">
                    {m.venue.status === 'pending' ? 'New venue; approving this adds it to the map. ' : ''}
                    {m.venue.lat.toFixed(4)}, {m.venue.lng.toFixed(4)} · time zone {m.venue.timezone}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" disabled={busyId === m.id} onClick={() => act(m.id, () => approveMic(m))}>Approve</button>
                    <button className="btn" disabled={busyId === m.id} onClick={() => setEditing(m)}>Edit first</button>
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
            </>
          )}

          {tab === 'reports' && (
            <>
              {!reports && !error && <p className="text-sm text-mute">Loading…</p>}
              {reports && reports.length === 0 && <p className="text-sm">No open reports.</p>}
              {reports?.map(r => (
                <div key={r.id} className="space-y-2">
                  <div className="border-2 border-accent bg-accent-soft px-3 py-2 text-sm">
                    <p className="font-extrabold">{kindLabel(r.kind)}</p>
                    {r.note && <p className="mt-1">“{r.note}”</p>}
                    <p className="text-xs text-mute mt-1">Reported {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  <OpenMicCard mic={r.mic} expanded />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn" disabled={busyId === r.id} onClick={() => setEditing(r.mic)}>Edit listing</button>
                    <button className="btn btn-primary" disabled={busyId === r.id}
                      onClick={() => act(r.id, async () => {
                        const c = await setMicStatus(r.mic.id, 'closed')
                        return c.error ? c : resolveReport(r.id, user.id, 'resolved')
                      })}>Close listing &amp; resolve</button>
                    <button className="btn" disabled={busyId === r.id} onClick={() => act(r.id, () => resolveReport(r.id, user.id, 'resolved'))}>Mark resolved</button>
                    <button className="btn" disabled={busyId === r.id} onClick={() => act(r.id, () => resolveReport(r.id, user.id, 'dismissed'))}>Dismiss</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {editing && (
        <SubmitModal
          user={user}
          venues={[]}
          editing={{ mic: editing, venueEditable: true }}
          onClose={saved => { setEditing(null); if (saved) { void load(); onChanged() } }}
        />
      )}
    </div>
  )
}
