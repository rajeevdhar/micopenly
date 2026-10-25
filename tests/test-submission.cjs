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

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
