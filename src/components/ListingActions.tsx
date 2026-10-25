import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { OpenMicWithVenue } from '../types'
import { confirmMic, setMicStatus } from '../lib/api'
import AddressAccess from './AddressAccess'

/** Buttons under an expanded listing: confirm it's still running, report a problem, and admin tools. */
export default function ListingActions({ mic, user, isAdmin, onNeedAuth, onReport, onEdit, onChanged }: {
  mic: OpenMicWithVenue
  user: User | null
  isAdmin: boolean
  onNeedAuth: () => void
  onReport: (m: OpenMicWithVenue) => void
  onEdit: (m: OpenMicWithVenue) => void
  /** Called after something changed so the page can refresh and show a message. */
  onChanged: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)

  const confirm = async () => {
    if (!user) { onNeedAuth(); return }
    setBusy(true); setError('')
    const { error: err } = await confirmMic(user.id, mic.id)
    setBusy(false)
    if (err) setError(err)
    else onChanged('Thanks! Marked as verified today.')
  }

  const close = async () => {
    setBusy(true); setError('')
    const { error: err } = await setMicStatus(mic.id, 'closed')
    setBusy(false)
    setClosing(false)
    if (err) setError(err)
    else onChanged('Listing closed and removed from the map.')
  }

  return (
    <div className="mt-2 space-y-2">
      {mic.venue.locationHidden && <AddressAccess mic={mic} user={user} onNeedAuth={onNeedAuth} onChanged={onChanged} />}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={confirm}>✓ Still running</button>
        <button className="btn" disabled={busy} onClick={() => (user ? onReport(mic) : onNeedAuth())}>Report a problem</button>
      </div>
      {!user && <p className="text-xs text-mute">Sign in to confirm or report. It keeps listings honest.</p>}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t-2 border-line">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-mute">Admin</span>
          <button className="btn" disabled={busy} onClick={() => onEdit(mic)}>Edit</button>
          {closing ? (
            <>
              <span className="text-xs">Remove from the map?</span>
              <button className="btn btn-primary" disabled={busy} onClick={close}>Yes, close it</button>
              <button className="btn" onClick={() => setClosing(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn" disabled={busy} onClick={() => setClosing(true)}>Mark closed</button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-accent-dark font-bold">{error}</p>}
    </div>
  )
}
