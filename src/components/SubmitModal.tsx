import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  AGE_OPTIONS, FORMAT_OPTIONS, GENRE_OPTIONS, SIGNUP_OPTIONS,
  type DayOfWeek, type Venue, type WeekOfMonth,
} from '../types'
import {
  EMPTY_MIC, EMPTY_VENUE, TIMEZONES, draftsFromMic, geocode, guessTimezone, suggestVenues, validate,
  type Errors, type MicDraft, type VenueDraft,
} from '../lib/submission'
import { fetchVenuePrivate, submitOpenMic, updateListing } from '../lib/api'
import type { OpenMicWithVenue } from '../types'
import PinPicker from './PinPicker'
import { normalizePlace } from '../lib/places'

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

/** Pass `editing` to change an existing listing instead of creating one. */
export interface Editing { mic: OpenMicWithVenue; venueEditable: boolean }

export default function SubmitModal({ user, venues, editing, onClose }: {
  user: User
  venues: Venue[]
  editing?: Editing
  onClose: (submitted: boolean) => void
}) {
  const initial = editing ? draftsFromMic(editing.mic) : null
  const [venue, setVenue] = useState<VenueDraft>(
    initial ? { ...initial.venue, existingVenueId: editing!.venueEditable ? null : editing!.mic.venueId } : EMPTY_VENUE)
  const [mic, setMic] = useState<MicDraft>(initial ? initial.mic : EMPTY_MIC)
  const [errors, setErrors] = useState<Errors>({})
  const [lookup, setLookup] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' })
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [done, setDone] = useState(false)

  // Editing a hidden venue: its real address lives in a private table, so load it for the form.
  const [privLoading, setPrivLoading] = useState(!!editing && editing.venueEditable && editing.mic.venue.locationHidden)
  useEffect(() => {
    if (!privLoading || !editing) return
    let live = true
    void fetchVenuePrivate(editing.mic.venueId).then(p => {
      if (!live) return
      if (p) setVenue(v => ({ ...v, address: p.address, postalCode: p.postalCode ?? '', lat: p.lat, lng: p.lng }))
      setPrivLoading(false)
    })
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sortedVenues = useMemo(() => [...venues].sort((a, b) => a.name.localeCompare(b.name)), [venues])
  const setV = (p: Partial<VenueDraft>) => setVenue(v => ({ ...v, ...p }))
  const setM = (p: Partial<MicDraft>) => setMic(m => ({ ...m, ...p }))
  const isNew = !venue.existingVenueId

  // After a failed submit, keep messages in sync as the person fixes fields.
  useEffect(() => {
    setErrors(prev => (Object.keys(prev).length ? validate(venue, mic) : prev))
  }, [venue, mic])

  // Address lookup. The button always moves the pin; the automatic lookup (after you stop typing the
  // street, city and state) fills in a blank ZIP and never overrides a pin you placed or a ZIP you typed.
  const addrTouched = useRef(false)   // the person has typed in the address fields
  const pinPlaced = useRef(false)     // the person has dragged/clicked the pin
  const lookupSeq = useRef(0)         // ignore answers that arrive after a newer lookup started

  const lookup_ = async (manual: boolean) => {
    const place = normalizePlace(venue.city, venue.region)
    const q = [venue.address, place.city, place.region, manual ? venue.postalCode : ''].map(s => s.trim()).filter(Boolean).join(', ')
    if (!venue.address.trim() || !place.city) { if (manual) setLookup({ busy: false, msg: 'Enter the street address and city first.' }); return }
    const seq = ++lookupSeq.current
    setLookup({ busy: true, msg: '' })
    try {
      const hit = await geocode(q)
      if (seq !== lookupSeq.current) return
      if (!hit) { setLookup({ busy: false, msg: manual ? 'Couldn’t find that address. Check it, or click the map to place the pin yourself.' : '' }); return }
      const movePin = manual || !pinPlaced.current
      if (manual) pinPlaced.current = false
      setVenue(v => ({
        ...v,
        ...(movePin ? { lat: hit.lat, lng: hit.lng, timezone: guessTimezone(hit.lat, hit.lng) ?? v.timezone } : {}),
        postalCode: v.postalCode.trim() ? v.postalCode : (hit.postcode ?? ''),
      }))
      const zipFilled = !venue.postalCode.trim() && !!hit.postcode
      setLookup({ busy: false, msg: `${movePin ? 'Found it. Drag the pin or click the map if it’s slightly off.' : 'Looked up the address.'}${zipFilled ? ` ZIP ${hit.postcode} filled in.` : ''}` })
    } catch (e) {
      if (seq === lookupSeq.current) setLookup({ busy: false, msg: manual ? (e instanceof Error ? e.message : 'Address lookup failed.') : '' })
    }
  }
  const findOnMap = () => lookup_(true)

  // Automatic lookup once street, city and state are filled in and typing has paused.
  useEffect(() => {
    if (!addrTouched.current || !isNew) return
    const place = normalizePlace(venue.city, venue.region)
    if (venue.address.trim().length < 3 || !place.city || !place.region) return
    const t = window.setTimeout(() => { void lookup_(false) }, 1100)
    return () => window.clearTimeout(t)
  }, [venue.address, venue.city, venue.region]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeAddr = (p: Partial<VenueDraft>) => { addrTouched.current = true; setV(p) }
  // Tidy "New York City"/"NYC"/"New Jersey" into one standard form when leaving the box.
  const tidyPlace = () => setVenue(v => {
    const p = normalizePlace(v.city, v.region)
    return p.city === v.city && p.region === v.region ? v : { ...v, city: p.city, region: p.region }
  })

  const onPin = (p: { lat: number; lng: number }) => {
    pinPlaced.current = true
    setV({ lat: p.lat, lng: p.lng, timezone: guessTimezone(p.lat, p.lng) ?? venue.timezone })
  }

  // "Already on the map?" suggestions while typing a new venue's name (hidden venues are never offered).
  const suggestions = useMemo(() => (editing ? [] : suggestVenues(venues, venue.name)), [venues, venue.name, editing])

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
    const { error } = editing
      ? await updateListing(editing.mic, editing.venueEditable ? venue : null, mic)
      : await submitOpenMic(user.id, venue, mic)
    setBusy(false)
    if (error) setServerError(error)
    else if (editing) onClose(true)
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
      <div className="modal-box modal-wide" role="dialog" aria-modal="true" aria-label={editing ? 'Edit open mic' : 'Add an open mic'}>
        <div className="sticky top-0 z-10 bg-ground flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="text-lg">{editing ? 'Edit open mic' : 'Add an open mic'}</h2>
          <button onClick={() => onClose(false)} aria-label="Close" className="text-2xl leading-none text-mute hover:text-ink">×</button>
        </div>

        <form onSubmit={submit} noValidate className="p-5 space-y-6">
          <p className="text-sm text-mute">
            {editing ? 'Changes to a listing that’s still waiting for review stay in the review queue.'
              : 'Only add open mics you know are real. Submissions are reviewed before they appear.'}
          </p>

          {/* ── Venue ── */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-extrabold uppercase tracking-widest mb-2">1 · Venue</legend>
            {editing && !editing.venueEditable && (
              <p className="text-sm border-2 border-line bg-white p-3">
                <strong>{editing.mic.venue.name}</strong><br />
                <span className="text-mute">{editing.mic.venue.locationHidden ? `${editing.mic.venue.city} (exact address private)` : `${editing.mic.venue.address}, ${editing.mic.venue.city}`}. The venue is already approved; to change it, use “Report a problem”.</span>
              </p>
            )}
            {!editing && <Field label="Which venue?" htmlFor="venue-pick">
              <select id="venue-pick" className="field" value={venue.existingVenueId ?? ''}
                onChange={e => setV({ existingVenueId: e.target.value || null })}>
                <option value="">+ A venue that isn’t listed yet</option>
                {sortedVenues.map(v => <option key={v.id} value={v.id}>{v.name} — {v.city}</option>)}
              </select>
            </Field>}

            {isNew && (
              <>
                <Field label="Venue name" error={errors.venueName} htmlFor="v-name">
                  <input id="v-name" className="field" value={venue.name} maxLength={120} autoComplete="off" onChange={e => setV({ name: e.target.value })} />
                </Field>
                {suggestions.length > 0 && (
                  <div className="border-2 border-ink bg-white" role="group" aria-label="Venues already on the map">
                    <p className="px-3 py-2 text-xs font-extrabold uppercase tracking-wider bg-accent-soft border-b-2 border-ink">Already on the map? Tap to use it</p>
                    {suggestions.map(v => (
                      <button type="button" key={v.id} className="block w-full text-left px-3 py-2 text-sm border-b border-line last:border-b-0 hover:bg-ground"
                        onClick={() => setV({ existingVenueId: v.id })}>
                        <strong>{v.name}</strong> <span className="text-mute">· {v.address}, {v.city}{v.region ? `, ${v.region}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-2 border-line bg-white p-3">
                  <label className="flex items-start gap-2 text-sm font-bold cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={venue.locationHidden} onChange={e => setV({ locationHidden: e.target.checked })} />
                    <span>Keep the exact address private</span>
                  </label>
                  <p className="text-xs text-mute mt-1 ml-6">
                    {venue.locationHidden
                      ? 'The public map shows only the town, with “≈” on the pin. People ask for the address; you approve them (you’ll see requests under My submissions). Don’t put the street in the venue name or notes.'
                      : 'Use this for house shows or rooms where you vet people first. Otherwise the street address is public.'}
                  </p>
                </div>
                {privLoading && <p className="text-xs text-mute">Loading the private address…</p>}
                <Field label={venue.locationHidden ? 'Exact address (kept private)' : 'Street address'} error={errors.address} htmlFor="v-addr">
                  <input id="v-addr" className="field" autoComplete="street-address" value={venue.address} onChange={e => typeAddr({ address: e.target.value })} />
                </Field>
                <div className="grid grid-cols-[1fr_80px_110px] gap-2">
                  <Field label="City" error={errors.city} htmlFor="v-city">
                    <input id="v-city" className="field" value={venue.city} onChange={e => typeAddr({ city: e.target.value })} onBlur={tidyPlace} />
                  </Field>
                  <Field label="State" htmlFor="v-region">
                    <input id="v-region" className="field" maxLength={30} value={venue.region} onChange={e => typeAddr({ region: e.target.value })} onFocus={e => e.target.select()} onBlur={tidyPlace} />
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
            <button className="btn btn-primary" disabled={busy || privLoading}>{busy ? (editing ? 'Saving…' : 'Submitting…') : (editing ? 'Save changes' : 'Submit for review')}</button>
            <button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
