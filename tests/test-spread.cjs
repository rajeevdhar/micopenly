const { spreadOverlaps } = require('../.test-build/lib/spread.js')
let pass = 0, fail = 0
const ok = (name, c, extra = '') => { c ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }
const H = (id, lat = 40.74, lng = -74.03) => ({ id, lat, lng, hidden: true })
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180))

const one = spreadOverlaps([H('a')])
ok('a lone hidden venue stays put', one.get('a').lat === 40.74 && one.get('a').lng === -74.03)

const three = spreadOverlaps([H('c'), H('a'), H('b')])
const pts = ['a', 'b', 'c'].map(i => three.get(i))
ok('three hidden venues in one town all get different spots', new Set(pts.map(p => `${p.lat},${p.lng}`)).size === 3)
ok('each is 100 to 600 m from the shared centre', pts.every(p => { const d = dist(p, { lat: 40.74, lng: -74.03 }); return d > 100 && d < 600 }), JSON.stringify(pts.map(p => dist(p, { lat: 40.74, lng: -74.03 }))))
ok('neighbours are at least 150 m apart (labels do not stack at street zoom)', dist(pts[0], pts[1]) > 150 && dist(pts[1], pts[2]) > 150 && dist(pts[0], pts[2]) > 150)
const again = spreadOverlaps([H('b'), H('c'), H('a')])
ok('same result whatever order the venues arrive in', ['a', 'b', 'c'].every(i => JSON.stringify(again.get(i)) === JSON.stringify(three.get(i))))

const many = spreadOverlaps(Array.from({ length: 12 }, (_, i) => H('v' + String(i).padStart(2, '0'))))
const mp = [...many.values()]
ok('twelve venues: all distinct and none more than ~520 m from the town point', new Set(mp.map(p => `${p.lat},${p.lng}`)).size === 12 && mp.every(p => dist(p, { lat: 40.74, lng: -74.03 }) < 520))

const mixed = spreadOverlaps([H('x'), H('y'), { id: 'real1', lat: 40.74, lng: -74.03, hidden: false }, { id: 'real2', lat: 40.74, lng: -74.03, hidden: false }, H('z', 40.8, -74.1)])
ok('visible venues are never moved, even at the same point', JSON.stringify(mixed.get('real1')) === JSON.stringify({ lat: 40.74, lng: -74.03 }) && JSON.stringify(mixed.get('real2')) === JSON.stringify({ lat: 40.74, lng: -74.03 }))
ok('a hidden venue in a different town is not moved', mixed.get('z').lat === 40.8 && mixed.get('z').lng === -74.1)
ok('hidden venues sharing a spot with visible ones still spread among themselves', JSON.stringify(mixed.get('x')) !== JSON.stringify(mixed.get('y')))
ok('every id gets a position', mixed.size === 5)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
