import type { ReactNode } from 'react'
import type { OpenMicWithVenue } from '../types'
import { AGE_OPTIONS, FORMAT_OPTIONS, SIGNUP_OPTIONS } from '../types'
import { describeRecurrence, formatTime, isStale, isTonight, verifiedAgo } from '../lib/schedule'

const label = <T extends string>(opts: { value: T; label: string }[], v: T) =>
  opts.find(o => o.value === v)?.label ?? v

function safeUrl(u?: string): string | null {
  if (!u) return null
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

export default function OpenMicCard({ mic, expanded = false, onSelect, actions, showFreshness = true }: {
  mic: OpenMicWithVenue
  expanded?: boolean
  onSelect?: () => void
  /** Rendered under the details when the card is expanded. */
  actions?: ReactNode
  /** Hide the “verified / may be out of date” line (used for listings not yet public). */
  showFreshness?: boolean
}) {
  const tonight = isTonight(mic, mic.venue.timezone)
  const stale = isStale(mic.lastVerifiedAt)
  const site = safeUrl(mic.venue.websiteUrl)
  const insta = safeUrl(mic.venue.instagramUrl)
  const signupUrl = safeUrl(mic.signupUrl)

  const when = [
    describeRecurrence(mic),
    mic.endTime ? `${formatTime(mic.startTime)}–${formatTime(mic.endTime)}` : formatTime(mic.startTime),
  ].join(' · ')

  return (
    <article className="border-2 border-line bg-white p-4 text-left">
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base leading-tight">{mic.title}</h3>
          {tonight && <span className="shrink-0 bg-accent text-white text-[10px] font-extrabold uppercase tracking-wider px-2 py-1">Tonight</span>}
        </div>
        <p className="mt-1 text-sm font-semibold">{mic.venue.name}</p>
        <p className="text-sm text-mute">{mic.venue.city}{mic.venue.region ? `, ${mic.venue.region}` : ''}</p>
        <p className="mt-2 text-sm font-bold">{when}</p>
      </button>

      {showFreshness && (
        <p className={`mt-2 text-xs ${stale ? 'text-accent-dark font-bold' : 'text-mute'}`}>
          {stale && '⚠ '}{verifiedAgo(mic.lastVerifiedAt)}{stale && ' — details may be out of date'}
        </p>
      )}

      {expanded && (
        <dl className="mt-3 pt-3 border-t-2 border-line grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-mute">Type</dt><dd>{label(FORMAT_OPTIONS, mic.format)}{mic.genres.length ? ` · ${mic.genres.join(', ')}` : ''}</dd>
          <dt className="text-mute">Sign-up</dt>
          <dd>
            {label(SIGNUP_OPTIONS, mic.signupMethod)}{mic.signupTime ? ` at ${formatTime(mic.signupTime)}` : ''}
            {signupUrl && <> · <a className="underline text-accent-dark" href={signupUrl} target="_blank" rel="noopener noreferrer">sign up</a></>}
          </dd>
          {mic.slotMinutes && <><dt className="text-mute">Slot</dt><dd>{mic.slotMinutes} min</dd></>}
          {mic.hostName && <><dt className="text-mute">Host</dt><dd>{mic.hostName}</dd></>}
          {mic.houseGear && <><dt className="text-mute">Gear</dt><dd>{mic.houseGear}</dd></>}
          {mic.costNote && <><dt className="text-mute">Cost</dt><dd>{mic.costNote}</dd></>}
          <dt className="text-mute">Ages</dt><dd>{label(AGE_OPTIONS, mic.ageRestriction)}</dd>
          <dt className="text-mute">Address</dt>
          <dd>{mic.venue.locationHidden ? <>Private. Shared by the host on request. Pin shows the town only.</> : <>{mic.venue.address}, {mic.venue.city}</>}</dd>
          {mic.notes && <><dt className="text-mute">Notes</dt><dd>{mic.notes}</dd></>}
          {(site || insta) && (
            <>
              <dt className="text-mute">Venue</dt>
              <dd className="space-x-3">
                {site && <a className="underline text-accent-dark" href={site} target="_blank" rel="noopener noreferrer">Website</a>}
                {insta && <a className="underline text-accent-dark" href={insta} target="_blank" rel="noopener noreferrer">Instagram</a>}
              </dd>
            </>
          )}
        </dl>
      )}
      {expanded && actions}
    </article>
  )
}
