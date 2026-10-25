import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { REPORT_OPTIONS, type OpenMicWithVenue, type ReportKind } from '../types'
import { reportMic } from '../lib/api'

export default function ReportModal({ mic, user, onClose }: {
  mic: OpenMicWithVenue
  user: User
  onClose: (sent: boolean) => void
}) {
  const [kind, setKind] = useState<ReportKind>('closed')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error: err } = await reportMic(user.id, mic.id, kind, note)
    setBusy(false)
    if (err) setError(err)
    else onClose(true)
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(false) }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label="Report a problem">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">Report a problem</h2>
          <button onClick={() => onClose(false)} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
        </div>
        <form onSubmit={send} className="p-5 space-y-4">
          <p className="text-sm"><strong>{mic.title}</strong><br /><span className="text-mute">{mic.venue.name}, {mic.venue.city}</span></p>
          <div>
            <label className="label" htmlFor="rep-kind">What’s wrong?</label>
            <select id="rep-kind" className="field" value={kind} onChange={e => setKind(e.target.value as ReportKind)}>
              {REPORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rep-note">Details (optional)</label>
            <textarea id="rep-note" className="field h-24 py-2" maxLength={1000} value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. It moved to Wednesdays at 8 PM" />
          </div>
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
            <button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
