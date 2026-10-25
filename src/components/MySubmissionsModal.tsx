import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ListingStatus, OpenMicWithVenue } from '../types'
import { fetchMine } from '../lib/api'
import OpenMicCard from './OpenMicCard'
import SubmitModal from './SubmitModal'

const STATUS: Record<ListingStatus, { label: string; help: string; cls: string }> = {
  pending: { label: 'Waiting for review', help: 'You can still edit it.', cls: 'bg-accent-soft border-accent' },
  approved: { label: 'Live on the map', help: 'Spotted a mistake? Use “Report a problem” on the listing.', cls: 'bg-white border-ink' },
  rejected: { label: 'Not approved', help: 'It was reviewed and not added. You can submit a corrected version.', cls: 'bg-white border-line text-mute' },
  closed: { label: 'Closed', help: 'It was taken off the map.', cls: 'bg-white border-line text-mute' },
}

export default function MySubmissionsModal({ user, isAdmin, onClose, onChanged }: {
  user: User
  isAdmin: boolean
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [items, setItems] = useState<OpenMicWithVenue[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<OpenMicWithVenue | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchMine(user.id)
    if (err) setError(err); else { setItems(data); setError('') }
  }, [user.id])
  useEffect(() => { void load() }, [load])

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box modal-wide" role="dialog" aria-modal="true" aria-label="My submissions">
        <div className="sticky top-0 z-10 bg-ground flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">My submissions</h2>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{error}</p>}
          {!items && !error && <p className="text-sm text-mute">Loading…</p>}
          {items && items.length === 0 && <p className="text-sm">You haven’t submitted any open mics yet. Use “+ Add an open mic” to add one.</p>}
          {items?.map(m => {
            const st = STATUS[m.status]
            return (
              <div key={m.id} className="space-y-2">
                <div className={`inline-block border-2 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider ${st.cls}`}>{st.label}</div>
                <OpenMicCard mic={m} showFreshness={m.status === 'approved'} />
                <p className="text-xs text-mute">{st.help}</p>
                {m.status === 'pending' && <button className="btn" onClick={() => setEditing(m)}>Edit</button>}
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <SubmitModal
          user={user}
          venues={[]}
          editing={{ mic: editing, venueEditable: isAdmin || editing.venue.status === 'pending' }}
          onClose={saved => {
            setEditing(null)
            if (saved) { onChanged('Changes saved.'); void load() }
          }}
        />
      )}
    </div>
  )
}
