const s = require('../.test-build/lib/submission.js')
let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`))
}

// cleanUrl: adds https, rejects dangerous or bogus schemes
eq('bare domain gets https', s.cleanUrl('example.com/open-mic'), 'https://example.com/open-mic')
eq('keeps http', s.cleanUrl('http://example.com'), 'http://example.com/')
eq('blank is empty string', s.cleanUrl('   '), '')
eq('javascript: rejected', s.cleanUrl('javascript:alert(1)'), null)
eq('data: rejected', s.cleanUrl('data:text/html,hi'), null)
eq('ftp rejected', s.cleanUrl('ftp://example.com'), null)
eq('no dot rejected', s.cleanUrl('localhost'), null)
eq('garbage rejected', s.cleanUrl('not a url at all'), null)

// cleanInstagram
eq('@handle', s.cleanInstagram('@the_tavern'), 'https://www.instagram.com/the_tavern/')
eq('bare handle', s.cleanInstagram('thetavern'), 'https://www.instagram.com/thetavern/')
eq('instagram link', s.cleanInstagram('instagram.com/thetavern'), 'https://instagram.com/thetavern')
eq('non-instagram link rejected', s.cleanInstagram('https://evil.example.com/x'), null)
eq('lookalike host rejected', s.cleanInstagram('https://notinstagram.com/x'), null)
eq('blank ok', s.cleanInstagram(''), '')

// guessTimezone
eq('Hackensack NJ', s.guessTimezone(40.886, -74.043), 'America/New_York')
eq('Chicago', s.guessTimezone(41.88, -87.63), 'America/Chicago')
eq('Denver', s.guessTimezone(39.74, -104.99), 'America/Denver')
eq('LA', s.guessTimezone(34.05, -118.24), 'America/Los_Angeles')
eq('London → null', s.guessTimezone(51.5, -0.12), null)

// validate
const goodVenue = { ...s.EMPTY_VENUE, name: 'The Tavern', address: '1 Main St', city: 'Hackensack', lat: 40.88, lng: -74.04 }
const goodMic = { ...s.EMPTY_MIC, title: 'Tuesday Acoustic', dayOfWeek: 2, startTime: '19:00' }
eq('valid new venue + mic', s.validate(goodVenue, goodMic), {})
eq('empty form reports required fields', Object.keys(s.validate(s.EMPTY_VENUE, s.EMPTY_MIC)).sort(),
  ['address', 'city', 'dayOfWeek', 'location', 'startTime', 'title', 'venueName'])
eq('existing venue skips venue checks', Object.keys(s.validate({ ...s.EMPTY_VENUE, existingVenueId: 'abc' }, goodMic)), [])
eq('slot minutes must be int 1-120', Object.keys(s.validate(goodVenue, { ...goodMic, slotMinutes: '0' })), ['slotMinutes'])
eq('slot minutes decimal rejected', Object.keys(s.validate(goodVenue, { ...goodMic, slotMinutes: '7.5' })), ['slotMinutes'])
eq('slot minutes 15 ok', s.validate(goodVenue, { ...goodMic, slotMinutes: '15' }), {})
eq('bad signup url flagged', Object.keys(s.validate(goodVenue, { ...goodMic, signupUrl: 'javascript:x' })), ['signupUrl'])
eq('out-of-range lat flagged', Object.keys(s.validate({ ...goodVenue, lat: 95 }, goodMic)), ['location'])
eq('over-long notes flagged', Object.keys(s.validate(goodVenue, { ...goodMic, notes: 'x'.repeat(1001) })), ['notes'])

// row mapping
const v = s.venueRow({ ...goodVenue, region: ' NJ ', websiteUrl: 'tavern.com', instagramUrl: '@tavern' }, 'user-1')
eq('venue row status pending + submitter', [v.status, v.submitted_by], ['pending', 'user-1'])
eq('venue row cleans fields', [v.region, v.postal_code, v.website_url, v.instagram_url],
  ['NJ', null, 'https://tavern.com/', 'https://www.instagram.com/tavern/'])
const m = s.micRow({ ...goodMic, weeksOfMonth: [3, 1], slotMinutes: '10', endTime: '', hostName: '  Sam ' }, 'venue-1', 'user-1')
eq('mic row status pending + submitter', [m.status, m.submitted_by, m.venue_id], ['pending', 'user-1', 'venue-1'])
eq('mic row sorts weeks, trims, nulls blanks', [m.weeks_of_month, m.slot_minutes, m.end_time, m.host_name], [[1, 3], 10, null, 'Sam'])
eq('mic row never sets last_verified_at', 'last_verified_at' in m, false)
eq('mic row has no status override fields', Object.keys(m).includes('id'), false)

// edit support
const vf = s.venueFields({ ...goodVenue, websiteUrl: 'tavern.com' })
eq('venueFields has no status/owner', ['status', 'submitted_by'].filter(k => k in vf), [])
const mf = s.micFields(goodMic)
eq('micFields has no status/owner/venue/verification', ['status', 'submitted_by', 'venue_id', 'last_verified_at'].filter(k => k in mf), [])
const saved = { id: 'm1', venueId: 'v1', title: 'Thu Songs', format: 'music', genres: ['Rock'], dayOfWeek: 4, weeksOfMonth: [-1, 1],
  startTime: '19:30:00', endTime: '22:00:00', signupMethod: 'online', signupTime: '19:00:00', signupUrl: 'https://x.example/s', slotMinutes: 10,
  hostName: 'Sam', houseGear: 'PA', costNote: 'Free', ageRestriction: '21_plus', notes: 'n', status: 'approved', createdAt: 'x',
  venue: { id: 'v1', name: 'Tavern', address: '1 Main', city: 'Town', region: 'NJ', country: 'US', lat: 40.1, lng: -74.1, timezone: 'America/New_York',
    websiteUrl: 'https://t.example/', status: 'approved', createdAt: 'x' } }
const dr = s.draftsFromMic(saved)
eq('draft times drop seconds for <input type=time>', [dr.mic.startTime, dr.mic.endTime, dr.mic.signupTime], ['19:30', '22:00', '19:00'])
eq('draft numbers become strings', dr.mic.slotMinutes, '10')
eq('draft missing optionals become empty strings', [dr.venue.postalCode, dr.venue.instagramUrl], ['', ''])
eq('a saved listing converted to a draft validates cleanly', s.validate(dr.venue, dr.mic), {})
const round = s.micFields(dr.mic)
eq('round trip keeps data (weeks sorted)', [round.title, round.weeks_of_month, round.start_time, round.slot_minutes, round.signup_url], ['Thu Songs', [-1, 1], '19:30', 10, 'https://x.example/s'])

// hidden exact location
const hv = { ...goodVenue, locationHidden: true, address: '12 Elm St', postalCode: '07030', lat: 40.745123, lng: -74.031987 }
const town = { lat: 40.743991, lng: -74.032363 }
const hf = s.venueFields(hv, town)
eq('hidden: public address is the placeholder', hf.address, 'Address shared on request')
eq('hidden: public ZIP dropped', hf.postal_code, null)
eq('hidden: public pin is the town centre rounded to 2 decimals', [hf.lat, hf.lng], [40.74, -74.03])
eq('hidden: flag set', hf.location_hidden, true)
const leak = JSON.stringify(s.venueRow(hv, 'user-1', town))
eq('hidden: public row contains neither the street, the ZIP nor the exact pin', ['12 Elm', '07030', '40.745', '74.0319'].filter(x => leak.includes(x)), [])
const fb = s.venueFields(hv, null)
eq('hidden: no town found falls back to a ~11 km snap, never the exact pin', [fb.lat, fb.lng], [40.7, -74])
eq('hidden: private fields carry the exact data', s.privateFields(hv), { address: '12 Elm St', postal_code: '07030', lat: 40.745123, lng: -74.031987 })
eq('visible venue keeps its exact pin and address', [s.venueFields(goodVenue).address, s.venueFields(goodVenue).location_hidden], [goodVenue.address, false])
eq('roundCoord', [s.roundCoord(40.746), s.roundCoord(-74.0319), s.roundCoord(10)], [40.75, -74.03, 10])
const hiddenSaved = { ...saved, venue: { ...saved.venue, locationHidden: true, address: 'Address shared on request', lat: 40.74, lng: -74.03 } }
const hd = s.draftsFromMic(hiddenSaved)
eq('editing a hidden venue starts with a blank address and no pin (real one is loaded privately)', [hd.venue.address, hd.venue.lat, hd.venue.lng, hd.venue.locationHidden], ['', null, null, true])
eq('a hidden draft is incomplete until the private address is loaded', Object.keys(s.validate(hd.venue, hd.mic)).sort(), ['address', 'location'])

// venue-name suggestions
const mkv = (id, name, city, hidden = false) => ({ id, name, city, locationHidden: hidden })
const vs = [mkv('1', 'The Tavern on Main', 'Hackensack'), mkv('2', 'Tavern 33', 'Ridgewood'), mkv('3', 'Joe\'s Cafe', 'Hoboken'), mkv('4', 'Secret Porch', 'Hoboken', true), mkv('5', 'Old Tavern Inn', 'Closter')]
eq('typing "tav" finds names containing it, starts-with first', s.suggestVenues(vs, 'tav').map(v => v.id), ['2', '1', '5'])
eq('ignores "The", case and punctuation', s.suggestVenues(vs, 'THE TAVERN ON MAIN!').map(v => v.id), ['1'])
eq('apostrophes and "&" do not break matching', s.suggestVenues(vs, 'joes').map(v => v.id), ['3'])
eq('one letter is too little to suggest', s.suggestVenues(vs, 't'), [])
eq('hidden venues are never suggested', s.suggestVenues(vs, 'porch'), [])
eq('limit is respected', s.suggestVenues(vs, 'tav', 2).length, 2)
eq('no match is empty', s.suggestVenues(vs, 'zzz'), [])
// city / state tidied on the way to the database
const nyv = s.venueFields({ ...goodVenue, city: 'New York City', region: 'New York' })
eq('venueFields stores the canonical city and state', [nyv.city, nyv.region], ['New York', 'NY'])

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
