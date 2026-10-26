// The first real listings: apply cleanly, can be re-run, are visible to the public, and stay "unverified".
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { nextOccurrence, describeRecurrence } = require('../.test-build/lib/schedule.js')

const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }
const q = async sql => (await db.query(sql)).rows

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`)
await db.exec(readFileSync('supabase/schema.sql', 'utf8'))
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`)

// A venue that already exists must be reused, not duplicated
await db.exec(`insert into public.venues (name, address, city, region, lat, lng, status) values ('Otto''s Shrunken Head', '538 E 14th St', 'New York', 'NY', 40.7295, -73.9786, 'approved')`)

const seed = readFileSync('supabase/seed/2026-10-25_first_listings.sql', 'utf8')
await db.exec(seed)
await db.exec(seed)
ok('the seed applies twice without error', true)

ok('exactly three venues (the existing one was reused)', (await q('select count(*)::int n from public.venues'))[0].n === 3)
ok('exactly three open mics, none duplicated by the second run', (await q('select count(*)::int n from public.open_mics'))[0].n === 3)
ok('all are approved, none hidden, none pinned to a person', (await q(`select count(*)::int n from public.open_mics m join public.venues v on v.id = m.venue_id
  where m.status = 'approved' and v.status = 'approved' and not v.location_hidden and m.submitted_by is null and v.submitted_by is null`))[0].n === 3)
ok('all are left unverified', (await q('select count(*)::int n from public.open_mics where last_verified_at is not null'))[0].n === 0)

await db.exec(`reset role; set role anon;`)
const pub = await q(`select m.title, m.format, m.day_of_week, m.weeks_of_month, to_char(m.start_time,'HH24:MI') t, m.age_restriction, v.name, v.city, v.postal_code
  from public.open_mics m join public.venues v on v.id = m.venue_id where m.status = 'approved' order by v.name`)
await db.exec('reset role')
ok('a signed-out visitor can see all three', pub.length === 3, JSON.stringify(pub))
const by = n => pub.find(p => p.name === n)
ok("Pete's is Sunday 17:00 music, 21+, Brooklyn 11211", by("Pete's Candy Store")?.day_of_week === 0 && by("Pete's Candy Store").t === '17:00' && by("Pete's Candy Store").age_restriction === '21_plus' && by("Pete's Candy Store").postal_code === '11211')
ok("Otto's is Wednesday 18:00 every week", by("Otto's Shrunken Head")?.day_of_week === 3 && by("Otto's Shrunken Head").t === '18:00' && by("Otto's Shrunken Head").weeks_of_month.length === 0)
ok('the Nuyorican mic is Wednesday 18:30 on weeks 2 to 5 at the Loisaida Center', by('Loisaida Center')?.t === '18:30' && by('Loisaida Center').weeks_of_month.join() === '2,3,4,5' && by('Loisaida Center').format === 'poetry')
ok('Pete\'s sign-up opens at 4pm per the venue, with the conflict flagged in the notes', (await q(`select to_char(signup_time,'HH24:MI') s, notes from public.open_mics where title = 'Sunday Open Mic'`))[0].s === '16:00'
  && /3pm/.test((await q(`select notes from public.open_mics where title = 'Sunday Open Mic'`))[0].notes))
ok('every listing with a guessed field says so in its public notes', (await q(`select count(*)::int n from public.open_mics where title in ('Wednesday Open Mic','The Nuyorican Open Mic') and notes ~* 'not confirmed'`))[0].n === 2)

// The recurrence is read correctly by the app's own schedule code
const nuy = { dayOfWeek: 3, weeksOfMonth: [2, 3, 4, 5], startTime: '18:30:00' }
ok('the Nuyorican mic skips the first Wednesday of November 2026 (the 4th)', nextOccurrence(nuy, '2026-11-01') === '2026-11-11', String(nextOccurrence(nuy, '2026-11-01')))
ok('and is on the next ordinary Wednesday after that', nextOccurrence(nuy, '2026-11-12') === '2026-11-18')
ok('the first Wednesday of December (the 2nd) is skipped too', nextOccurrence(nuy, '2026-11-26') === '2026-12-09', String(nextOccurrence(nuy, '2026-11-26')))
ok('Pete\'s next Sunday after Sunday 25 Oct is 1 Nov', nextOccurrence({ dayOfWeek: 0, weeksOfMonth: [], startTime: '17:00:00' }, '2026-10-26') === '2026-11-01')
ok('the Nuyorican recurrence reads sensibly', /Wednesdays/.test(describeRecurrence(nuy)), describeRecurrence(nuy))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
