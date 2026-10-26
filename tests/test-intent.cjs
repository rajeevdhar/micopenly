const { wantsToAdd, withoutAddParam, rememberAdd, hasRememberedAdd, clearRememberedAdd } = require('../.test-build/lib/intent.js')
let pass = 0, fail = 0
const ok = (name, c, extra = '') => { c ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }

// ── Reading the link ──
ok('?add=1 asks to add', wantsToAdd('?add=1'))
ok('?add alone asks to add', wantsToAdd('?add'))
ok('?add= (empty) asks to add', wantsToAdd('?add='))
ok('?add=true and ?add=YES ask to add', wantsToAdd('?add=true') && wantsToAdd('?add=YES'))
ok('?add=0 and ?add=no do not', !wantsToAdd('?add=0') && !wantsToAdd('?add=no'))
ok('no query, a different parameter, or a look-alike does not', !wantsToAdd('') && !wantsToAdd('?q=add') && !wantsToAdd('?address=1') && !wantsToAdd('?added=1'))
ok('works alongside other parameters', wantsToAdd('?utm_source=flyer&add=1&x=2'))
ok('works without the leading question mark', wantsToAdd('add=1'))
ok('junk values do not trigger it', !wantsToAdd('?add=<script>') && !wantsToAdd('?add=1;drop'))

// ── Cleaning the address after use ──
ok('removes only the add parameter', withoutAddParam('/', '?add=1&utm_source=flyer', '') === '/?utm_source=flyer')
ok('leaves a bare path when nothing else remains', withoutAddParam('/', '?add=1', '') === '/')
ok('keeps the hash (sign-in tokens live there)', withoutAddParam('/', '?add=1', '#access_token=abc') === '/#access_token=abc')
ok('does nothing when there was no add parameter', withoutAddParam('/map', '?q=jazz', '') === '/map?q=jazz')

// ── Remembering across the email-confirmation round trip ──
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k), _m: m } }
const T0 = 1_800_000_000_000
const s = mem()
ok('nothing remembered at first', !hasRememberedAdd(s, T0))
rememberAdd(s, T0)
ok('remembered right after', hasRememberedAdd(s, T0 + 1000))
ok('still remembered after 23 hours', hasRememberedAdd(s, T0 + 23 * 3600e3))
ok('checking does not use it up', hasRememberedAdd(s, T0 + 23 * 3600e3))
ok('expires after 24 hours', !hasRememberedAdd(s, T0 + 25 * 3600e3))
ok('and an expired entry is cleaned out', s._m.size === 0)
rememberAdd(s, T0); clearRememberedAdd(s)
ok('clearing removes it', !hasRememberedAdd(s, T0 + 1000))
const bad = mem(); bad.setItem('micopenly.add-intent', 'garbage')
ok('garbage in storage is ignored and removed', !hasRememberedAdd(bad, T0) && bad._m.size === 0)
const future = mem(); future.setItem('micopenly.add-intent', String(T0 + 10 * 24 * 3600e3))
ok('a timestamp far in the future is ignored', !hasRememberedAdd(future, T0))

// ── Storage that throws, or is missing, never breaks the page ──
const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
let threw = false
try { rememberAdd(throwing); hasRememberedAdd(throwing); clearRememberedAdd(throwing); rememberAdd(null); hasRememberedAdd(null); clearRememberedAdd(null) } catch { threw = true }
ok('blocked or missing storage is handled quietly', !threw && !hasRememberedAdd(throwing) && !hasRememberedAdd(null))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
