const { distanceMiles, formatMiles, sortByDistance } = require('../.test-build/lib/geo.js')
let pass = 0, fail = 0
const ok = (name, c, extra = '') => { c ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }
const near = (a, b, tol) => Math.abs(a - b) <= tol

const nyc = { lat: 40.7128, lng: -74.006 }
const boston = { lat: 42.3601, lng: -71.0589 }
const la = { lat: 34.0522, lng: -118.2437 }

ok('same point is zero miles', distanceMiles(nyc, nyc) === 0)
ok('New York to Boston is about 190 miles', near(distanceMiles(nyc, boston), 190, 5), String(distanceMiles(nyc, boston)))
ok('New York to Los Angeles is about 2,445 miles', near(distanceMiles(nyc, la), 2445, 20), String(distanceMiles(nyc, la)))
ok('distance is symmetric', near(distanceMiles(nyc, la), distanceMiles(la, nyc), 1e-9))
ok('across the date line stays short', distanceMiles({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }) < 20)
ok('one degree of latitude is about 69 miles', near(distanceMiles({ lat: 40, lng: -74 }, { lat: 41, lng: -74 }), 69, 0.5))

ok('formats short distances with one decimal', formatMiles(0.43) === '0.4 mi' && formatMiles(3.24) === '3.2 mi')
ok('formats longer distances as whole miles', formatMiles(27.4) === '27 mi' && formatMiles(120.2) === '120 mi')
ok('tiny distances read as under 0.1 mi', formatMiles(0.02) === 'under 0.1 mi')
ok('bad numbers format as empty', formatMiles(NaN) === '' && formatMiles(Infinity) === '')

const items = [
  { id: 'la', at: la }, { id: 'none', at: null }, { id: 'boston', at: boston }, { id: 'nyc', at: nyc },
]
const sorted = sortByDistance(items, { lat: 40.73, lng: -73.99 }, i => i.at).map(i => i.id)
ok('nearest first, missing positions last', sorted.join() === 'nyc,boston,la,none', sorted.join())
ok('does not change the input order', items.map(i => i.id).join() === 'la,none,boston,nyc')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
