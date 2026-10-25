const p = require('../.test-build/lib/places.js')
let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`))
}
const NY = { city: 'New York', region: 'NY' }

// The cases from the request: all of these are the same place
for (const [c, r] of [['New York City', 'NY'], ['New York', 'NY'], ['NY', 'NY'], ['NYC', 'NY'], ['nyc', ''], ['new york city', 'New York'],
  ['New York, NY', ''], ['NY, NY', ''], ['New York City, NY', ''], ['N.Y.C.', 'ny'], ['Manhattan', 'NY'], ['New York', '']])
  eq(`"${c}" + "${r}" is New York, NY`, p.normalizePlace(c, r), NY)

// other nicknames
eq('philly', p.normalizePlace('Philly', 'PA'), { city: 'Philadelphia', region: 'PA' })
eq('SF no state fills CA', p.normalizePlace('SF', ''), { city: 'San Francisco', region: 'CA' })
eq('LA means Los Angeles when state is CA or blank', [p.normalizePlace('LA', 'CA'), p.normalizePlace('LA', '')], [{ city: 'Los Angeles', region: 'CA' }, { city: 'Los Angeles', region: 'CA' }])
eq('NOLA', p.normalizePlace('NOLA', 'LA'), { city: 'New Orleans', region: 'LA' })
eq('saint/st variants agree', [p.normalizePlace('Saint Louis', 'MO'), p.normalizePlace('St Louis', 'MO'), p.normalizePlace('st. louis', 'missouri')], Array(3).fill({ city: 'St. Louis', region: 'MO' }))
eq('ft/fort', p.normalizePlace('Ft Worth', 'TX'), { city: 'Fort Worth', region: 'TX' })
eq('washington dc', [p.normalizePlace('Washington DC', ''), p.normalizePlace('DC', ''), p.normalizePlace('Washington', 'DC')], Array(3).fill({ city: 'Washington', region: 'DC' }))

// must NOT be rewritten
eq('Washington, NJ is not Washington, DC', p.normalizePlace('Washington', 'NJ'), { city: 'Washington', region: 'NJ' })
eq('bare Washington with no state is left alone', p.normalizePlace('Washington', ''), { city: 'Washington', region: '' })
eq('New York with a different state is left alone (e.g. New York Mills, MN is another place)', p.normalizePlace('New York', 'MN'), { city: 'New York', region: 'MN' })
eq('Hoboken untouched', p.normalizePlace('Hoboken', 'NJ'), { city: 'Hoboken', region: 'NJ' })
eq('mixed case kept', p.normalizePlace('McAllen', 'TX'), { city: 'McAllen', region: 'TX' })

// states and case
eq('state names', [p.normalizeRegion('New Jersey'), p.normalizeRegion('new jersey'), p.normalizeRegion('N.J.'), p.normalizeRegion('nj'), p.normalizeRegion(' Nj ')], Array(5).fill('NJ'))
eq('District of Columbia', p.normalizeRegion('District of Columbia'), 'DC')
eq('unknown two-letter codes upper-cased (e.g. Canadian provinces)', p.normalizeRegion('on'), 'ON')
eq('blank stays blank', p.normalizeRegion('  '), '')
eq('unknown long text left as typed', p.normalizeRegion('Narnia'), 'Narnia')
eq('shouting and whispering fixed', [p.normalizePlace('HOBOKEN', 'nj'), p.normalizePlace('jersey city', 'NJ')], [{ city: 'Hoboken', region: 'NJ' }, { city: 'Jersey City', region: 'NJ' }])
eq('city, state typed in the city box', p.normalizePlace('Hoboken, NJ', ''), { city: 'Hoboken', region: 'NJ' })
eq('city, state in the box with matching state box', p.normalizePlace('Hoboken, New Jersey', 'NJ'), { city: 'Hoboken', region: 'NJ' })
eq('a comma that is not a state is kept', p.normalizePlace('Winston, Salem', 'NC'), { city: 'Winston, Salem', region: 'NC' })
eq('extra spaces collapsed', p.normalizePlace('  Jersey   City ', 'NJ'), { city: 'Jersey City', region: 'NJ' })
eq('a short all-caps name with a conflicting state is not mangled', p.normalizePlace('NYC', 'NJ'), { city: 'NYC', region: 'NJ' })
eq('idempotent', p.normalizePlace(NY.city, NY.region), NY)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
