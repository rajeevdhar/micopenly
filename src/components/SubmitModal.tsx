import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  AGE_OPTIONS, FORMAT_OPTIONS, GENRE_OPTIONS, SIGNUP_OPTIONS,
  type DayOfWeek, type Venue, type WeekOfMonth,
} from '../types'
import {
  EMPTY_MIC, EMPTY_VENUE, TIMEZONES, geocode, guessTimezone, validate,
  type Errors, type MicDraft, type VenueDraft,
} from '../lib/submission'
import { submitOpenMic } from '../lib/api'
import PinPicker from './PinPicker'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKS: { v: WeekOfMonth; label: string }[] = [
  { v: 1, label: '1st' }, { v: 2, label: '2nd' }, { v: 3, label: '3rd' },
  { v: 4, label: '4th' }, { v: 5, label: '5th' }, { v: -1, label: 'Last' },
]

function Field({ label, error, hint, children, htmlFor }: {
  label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-mute mt-1">{hint}</p>}
      {error && <p role="alert" className="text-xs text-accent-dark font-bold mt-1">{error}</p>}
    </div>
  )
}

export default function SubmitModal({ user, venues, onClose }: {
  user: User
  venues: Venue[]
  onClose: (submitted: boolean) => void
}) {
  const [venue, setVenue] = useState<VenueDraft>(EMPTY_VENUE)
  const [mic, setMic] = useState<MicDraft>(EMPTY_MIC)
  const [errors, setErrors] = useState<Errors>({})
  const [lookup, setLookup] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' })
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [done, setDone] = useState(false)

  const sortedVenues = useMemo(() => [...venues].sort((a, b) => a.name.localeCompare(b.name)), [venues])
  const setV = (p: Partial<VenueDraft>) => setVenue(v => ({ ...v, ...p }))
  const setM = (p: Partial<MicDraft>) => setMic(m => ({ ...m, ...p }))
  const isNew = !venue.existingVenueId

  // After a failed submit, keep messages in sync as the person fixes fields.
  useEffect(() => {
    setErrors(prev => (Object.keys(prev).length ? validate(venue, mic) : prev))
  }, [venue, mic])

  const findOnMap = async () => {
    const q = [venue.address, venue.city, venue.region, venue.postalCode].map(s => s.trim()).filter(Boolean).join(', ')
    if (!venue.address.trim() || !venue.city.trim()) { setLookup({ busy: false, msg: 'Enter the street address and city first.' }); return }
    setLookup({ busy: true, msg: '' })
    try {
      const hit = await geocode(q)
      if (!hit) { setLookup({ busy: false, msg: 'Couldn’t find that address. Check it, or click the map to place the pin yourself.' }); return }
      setV({ lat: hit.lat, lng: hit.lng, timezone: guessTimezone(hit.lat, hit.lng) ?? venue.timezone })
      setLookup({ busy: false, msg: 'Found it. Drag the pin or click the map if it’s slightly off.' })
    } catch (e) {
      setLookup({ busy: false, msg: e instanceof Error ? e.message : 'Address lookup failed.' })
    }
  }

  const onPin = (p: { lat: number; lng: number }) =>
    setV({ lat: p.lat, lng: p.lng, timezone: guessTimezone(p.lat, p.lng) ?? venue.timezone })

  const toggleGenre = (g: string) =>
    setM({ genres: mic.genres.includes(g) ? mic.genres.filter(x => x !== g) : [...mic.genres, g] })
  const toggleWeek = (w: WeekOfMonth) =>
    setM({ weeksOfMonth: mic.weeksOfMonth.includes(w) ? mic.weeksOfMonth.filter(x => x !== w) : [...mic.weeksOfMonth, w] })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    const errs = validate(venue, mic)
    setErrors(errs)
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    setBusy(true)
    const { error } = await submitOpenMic(user.id, venue, mic)
    setBusy(false)
    if (error) setServerError(error)
    else setDone(true)
  }

  if (done) {
    return (
      <div className="modal-backdrop">
        <div className="modal-box" role="dialog" aria-modal="true" aria-label="Submitted">
          <div className="p-6 space-y-3">
            <h2 className="text-lg">Thanks, it’s submitted.</h2>
            <p className="text-sm">A moderator will review it before it appears on the map. That usually doesn’t take long.</p>
            <div className="flex gap-2 pt-2">
              <button className="btn btn-primary" onClick={() => onClose(true)}>Done</button>
              <button className="btn" onClick={() => { setMic(EMPTY_MIC); setDone(false); setErrors({}) }}>Add another night</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(false) }}>
      <div className="modal-box modal-wide" role="dialog" aria-modal="true" aria-label="Add an open mic">
        <div className="sticky top-0 z-10 bg-ground flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">Add an open mic</h2>
          <button onClick={() => onClose(false)} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
        </div>

        <form onSubmit={submit} noValidate className="p-5 space-y-6">
          <p className="text-sm text-mute">Only add open mics you know are real. Submissions are reviewed before they appear.</p>

          {/* ── Venue ── */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-extrabold uppercase tracking-widest mb-2">1 · Venue</legend>
            <Field label="Which venue?" htmlFor="venue-pick">
              <select id="venue-pick" className="field" value={venue.existingVenueId ?? ''}
                onChange={e => setV({ existingVenueId: e.target.value || null })}>
                <option value="">+ A venue that isn’t listed yet</option>
                {sortedVenues.map(v => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
              </select>
            </Field>

            {isNew && (
              <>
                <Field label="Venue name" error={errors.venueName} htmlFor="v-name">
                  <input id="v-name" className="field" value={venue.name} maxLength={120} onChange={e => setV({ name: e.target.value })} />
                </Field>
                <Field label="Street address" error={errors.address} htmlFor="v-addr">
                  <input id="v-addr" className="field" autoComplete="street-address" value={venue.address} onChange={e => setV({ address: e.target.value })} />
                </Field>
                <div className="grid grid-cols-[1fr_80px_110px] gap-2">
                  <Field label="City" error={errors.city} htmlFor="v-city">
                    <input id="v-city" className="field" value={venue.city} onChange={e => setV({ city: e.target.value })} />
                  </Field>
                  <Field label="State" htmlFor="v-region">
                    <input id="v-region" className="field" maxLength={30} value={venue.region} onChange={e => setV({ region: e.target.value })} />
                  </Field>
                  <Field label="ZIP" htmlFor="v-zip">
                    <input id="v-zip" className="field" inputMode="numeric" maxLength={10} value={venue.postalCode} onChange={e => setV({ postalCode: e.target.value })} />
                  </Field>
                </div>
                <div>
                  <button type="button" className="btn" onClick={findOnMap} disabled={lookup.busy}>
                    {lookup.busy ? 'Looking…' : 'Find on map'}
                  </button>
                  {lookup.msg && <p role="status" className="text-xs mt-2">{lookup.msg}</p>}
                  {errors.location && <p role="alert" className="text-xs text-accent-dark font-bold mt-2">{errors.location}</p>}
                </div>
                <PinPicker pos={venue.lat !== null && venue.lng !== null ? { lat: venue.lat, lng: venue.lng } : null} onChange={onPin} />
                <Field label="Time zone" hint="Used to work out “tonight”. We guess it from the pin; change it if it’s wrong." htmlFor="v-tz">
                  <select id="v-tz" className="field" value={venue.timezone} onChange={e => setV({ timezone: e.target.value })}>
                    {TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Venue website (optional)" error={errors.websiteUrl} htmlFor="v-web">
                    <input id="v-web" className="field" placeholder="example.com" value={venue.websiteUrl} onChange={e => setV({ websiteUrl: e.target.value })} />
                  </Field>
                  <Field label="Venue Instagram (optional)" error={errors.instagramUrl} htmlFor="v-ig">
                    <input id="v-ig" className="field" placeholder="@handle" value={venue.instagramUrl} onChange={e => setV({ instagramUrl: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </fieldset>

          {/* ── Open mic ── */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-extrabold uppercase tracking-widest mb-2">2 · The open mic</legend>
            <Field label="Name" error={errors.title} htmlFor="m-title">
              <input id="m-title" className="field" placeholder="Tuesday Acoustic Night" maxLength={120} value={mic.title} onChange={e => setM({ title: e.target.value })} />
            </Field>

            <div>
              <span className="label">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {FORMAT_OPTIONS.map(f => (
                  <button type="button" key={f.value} className="chip" aria-pressed={mic.format === f.value} onClick={() => setM({ format: f.value })}>{f.label}</button>
                ))}
              </div>
            </div>

            <div>
              <span className="label">Genres (optional)</span>
              <div className="flex flex-wrap gap-1.5">
                {GENRE_OPTIONS.map(g => (
                  <button type="button" key={g} className="chip" aria-pressed={mic.genres.includes(g)} onClick={() => toggleGenre(g)}>{g}</button>
                ))}
              </div>
            </div>

            <Field label="Day" error={errors.dayOfWeek}>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} className="chip" aria-pressed={mic.dayOfWeek === i} onClick={() => setM({ dayOfWeek: i as DayOfWeek })}>{d.slice(0, 3)}</button>
                ))}
              </div>
            </Field>

            <div>
              <span className="label">How often</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="chip" aria-pressed={mic.weeksOfMonth.length === 0} onClick={() => setM({ weeksOfMonth: [] })}>Every week</button>
                {WEEKS.map(w => (
                  <button type="button" key={w.v} className="chip" aria-pressed={mic.weeksOfMonth.includes(w.v)} onClick={() => toggleWeek(w.v)}>{w.label}</button>
                ))}
              </div>
              <p className="text-xs text-mute mt-1">Pick the weeks it happens, e.g. 1st and 3rd. “Every other week” goes in the notes.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" error={errors.startTime} htmlFor="m-start">
                <input id="m-start" type="time" className="field" value={mic.startTime} onChange={e => setM({ startTime: e.target.value })} />
              </Field>
              <Field label="Ends (optional)" htmlFor="m-end">
                <input id="m-end" type="time" className="field" value={mic.endTime} onChange={e => setM({ endTime: e.target.value })} />
              </Field>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="How do people sign up?" htmlFor="m-signup">
                <select id="m-signup" className="field" value={mic.signupMethod} onChange={e => setM({ signupMethod: e.target.value as MicDraft['signupMethod'] })}>
                  {SIGNUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Sign-up opens (optional)" htmlFor="m-signup-time">
                <input id="m-signup-time" type="time" className="field" value={mic.signupTime} onChange={e => setM({ signupTime: e.target.value })} />
              </Field>
              <Field label="Sign-up link (optional)" error={errors.signupUrl} htmlFor="m-signup-url">
                <input id="m-signup-url" className="field" placeholder="example.com/signup" value={mic.signupUrl} onChange={e => setM({ signupUrl: e.target.value })} />
              </Field>
              <Field label="Minutes per performer (optional)" error={errors.slotMinutes} htmlFor="m-slot">
                <input id="m-slot" className="field" inputMode="numeric" value={mic.slotMinutes} onChange={e => setM({ slotMinutes: e.target.value })} />
              </Field>
              <Field label="Host (optional)" error={errors.hostName} htmlFor="m-host">
                <input id="m-host" className="field" maxLength={100} value={mic.hostName} onChange={e => setM({ hostName: e.target.value })} />
              </Field>
              <Field label="Ages" htmlFor="m-age">
                <select id="m-age" className="field" value={mic.ageRestriction} onChange={e => setM({ ageRestriction: e.target.value as MicDraft['ageRestriction'] })}>
                  {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="House gear (optional)" error={errors.houseGear} htmlFor="m-gear">
              <input id="m-gear" className="field" placeholder="PA, 2 mics, keyboard" maxLength={300} value={mic.houseGear} onChange={e => setM({ houseGear: e.target.value })} />
            </Field>
            <Field label="Cost (optional)" error={errors.costNote} htmlFor="m-cost">
              <input id="m-cost" className="field" placeholder="Free, one-drink minimum" maxLength={200} value={mic.costNote} onChange={e => setM({ costNote: e.target.value })} />
            </Field>
            <Field label="Anything else (optional)" error={errors.notes} htmlFor="m-notes">
              <textarea id="m-notes" className="field h-24 py-2" maxLength={1000} value={mic.notes} onChange={e => setM({ notes: e.target.value })} />
            </Field>
          </fieldset>

          {serverError && <p role="alert" className="text-sm text-accent-dark bg-accent-soft border-2 border-accent px-3 py-2">{serverError}</p>}
          {Object.keys(errors).length > 0 && <p className="text-sm text-accent-dark font-bold">Please fix the highlighted fields.</p>}

          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
            <button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
