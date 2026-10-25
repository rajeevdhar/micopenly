// End-to-end check of the submit → review → approve loop at the database level, using the
// exact rows the submit form builds (src/lib/submission.ts), under real row-level security.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const sub = createRequire(import.meta.url)('../.test-build/lib/submission.js')
const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`)
await db.exec(readFileSync(process.env.SCHEMA ?? 'supabase/schema.sql', 'utf8'))
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`)
const U = '00000000-0000-0000-0000-00000000000a', ADMIN = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users values ('${U}','u@x.test'),('${ADMIN}','admin@x.test'); insert into public.admins values ('${ADMIN}');`)

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
}
const pgv = v => Array.isArray(v) ? '{' + v.map(x => typeof x === 'string' ? '"' + x.replace(/(["\\])/g, '\\$1') + '"' : x).join(',') + '}' : v
async function insert(table, row) {
  const cols = Object.keys(row)
  return (await db.query(`insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, cols.map(c => pgv(row[c])))).rows[0].id
}
const tryInsert = async (table, row) => { try { return { id: await insert(table, row) } } catch (e) { return { err: e } } }
const count = async sql => (await db.query(sql)).rows.length

// Fill the form like a real user would (including awkward genre names with slashes)
const venue = { ...sub.EMPTY_VENUE, name: 'The Example Tavern', address: '1 Main St', city: 'Hackensack', region: 'NJ',
  lat: 40.8859, lng: -74.0435, timezone: 'America/New_York', websiteUrl: 'tavern.example.com', instagramUrl: '@tavern' }
const mic = { ...sub.EMPTY_MIC, title: 'Thursday Songwriters', genres: ['Folk / Acoustic', 'Original songs'], dayOfWeek: 4,
  weeksOfMonth: [3, 1], startTime: '19:30', endTime: '22:00', signupMethod: 'sheet_in_advance', signupTime: '19:00',
  signupUrl: 'tavern.example.com/signup', slotMinutes: '12', hostName: 'Sam', houseGear: 'PA, 2 mics', costNote: 'Free', notes: 'Bring a capo' }
ok('draft passes validation', Object.keys(sub.validate(venue, mic)).length === 0)

// 1. Submit as a signed-in user: venue then mic, both land as pending
const venueId = await as('authenticated', U, async () => insert('venues', sub.venueRow(venue, U)))
ok('submitter can create the venue', !!venueId)
const micId = await as('authenticated', U, async () => insert('open_mics', sub.micRow(mic, venueId, U)))
ok('submitter can create the open mic on their own pending venue', !!micId)
ok('submitter can read back their own pending venue (needed for .select("id"))',
  (await as('authenticated', U, () => count(`select 1 from public.venues where id='${venueId}'`))) === 1)

// 2. Invisible to the public until approved
ok('anon sees nothing yet (venues)', (await as('anon', null, () => count('select 1 from public.venues'))) === 0)
ok('anon sees nothing yet (open mics)', (await as('anon', null, () => count('select 1 from public.open_mics'))) === 0)

// 3. Duplicate submission is blocked with the code the app translates (23505)
const dup = await as('authenticated', U, () => tryInsert('open_mics', sub.micRow(mic, venueId, U)))
ok('duplicate night rejected with unique-violation 23505', dup.err?.code === '23505', dup.err?.message)
const sameTimeOtherWeeks = await as('authenticated', U, () => tryInsert('open_mics', sub.micRow({ ...mic, weeksOfMonth: [2, 4] }, venueId, U)))
ok('same day/time but different weeks is allowed', !!sameTimeOtherWeeks.id, sameTimeOtherWeeks.err?.message)

// 4. Submitter cannot approve or fake verification
ok('submitter cannot self-approve the mic', !!(await as('authenticated', U, async () => { try { await db.query(`update public.open_mics set status='approved' where id='${micId}'`); return false } catch { return true } })))
await as('authenticated', U, () => db.query(`update public.open_mics set last_verified_at=now() where id='${micId}'`))
ok('submitter cannot fake last_verified_at on own pending mic',
  (await db.query(`select last_verified_at from public.open_mics where id='${micId}'`)).rows[0].last_verified_at === null)

// 5. Admin review: sees pending, approves venue then mic exactly as api.ts does
ok('admin sees both pending mics', (await as('authenticated', ADMIN, () => count(`select 1 from public.open_mics where status='pending'`))) === 2)
ok('admin sees the pending venue with the mic embedded', (await as('authenticated', ADMIN, () => count(`select m.id, v.name from public.open_mics m join public.venues v on v.id=m.venue_id where m.status='pending'`))) === 2)
ok('admin approves venue', (await as('authenticated', ADMIN, () => count(`update public.venues set status='approved' where id='${venueId}' returning 1`))) === 1)
ok('admin approves mic and stamps last_verified_at', (await as('authenticated', ADMIN, () => count(`update public.open_mics set status='approved', last_verified_at=now() where id='${micId}' returning 1`))) === 1)
ok('last_verified_at was stamped', (await db.query(`select last_verified_at from public.open_mics where id='${micId}'`)).rows[0].last_verified_at !== null)

// 6. Now public; the unapproved sibling is still hidden
ok('anon now sees the venue', (await as('anon', null, () => count('select 1 from public.venues'))) === 1)
ok('anon sees exactly the approved mic, not the other pending one', (await as('anon', null, () => count('select 1 from public.open_mics'))) === 1)
const pub = (await as('anon', null, () => db.query(`select m.title, m.genres, m.weeks_of_month, v.name as venue from public.open_mics m join public.venues v on v.id=m.venue_id`))).rows[0]
ok('public row has the right content', pub.title === 'Thursday Songwriters' && pub.venue === 'The Example Tavern' && pub.genres.includes('Folk / Acoustic') && JSON.stringify(pub.weeks_of_month) === '[1,3]', JSON.stringify(pub))

// 7. Reject path: rejecting frees the slot so it can be resubmitted
const sibling = sameTimeOtherWeeks.id
ok('admin rejects the other mic', (await as('authenticated', ADMIN, () => count(`update public.open_mics set status='rejected' where id='${sibling}' returning 1`))) === 1)
ok('rejected mic stays hidden from the public', (await as('anon', null, () => count('select 1 from public.open_mics'))) === 1)
const again = await as('authenticated', U, () => tryInsert('open_mics', sub.micRow({ ...mic, weeksOfMonth: [2, 4] }, venueId, U)))
ok('after rejection the same night can be resubmitted', !!again.id, again.err?.message)

// 8. Existing-venue path: a different user can add a mic to an APPROVED venue; cannot to someone else's pending venue
const U2 = '00000000-0000-0000-0000-0000000000d2'
await db.exec(`insert into auth.users values ('${U2}','u2@x.test')`)
const onApproved = await as('authenticated', U2, () => tryInsert('open_mics', sub.micRow({ ...mic, title: 'Other night', dayOfWeek: 1 }, venueId, U2)))
ok('another user can add a mic at an approved venue', !!onApproved.id, onApproved.err?.message)
const pendingVenue = await as('authenticated', U, () => insert('venues', sub.venueRow({ ...venue, name: 'Pending Place' }, U)))
const onOthersPending = await as('authenticated', U2, () => tryInsert('open_mics', sub.micRow({ ...mic, title: 'Sneaky', dayOfWeek: 2 }, pendingVenue, U2)))
ok('cannot attach a mic to someone else’s pending venue', !!onOthersPending.err)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
