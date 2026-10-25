// Hidden exact locations + address requests: who can read the real address, and how it is granted.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

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
// Applying the whole schema twice must work (idempotent), including the new section.
await db.exec(readFileSync(process.env.SCHEMA ?? 'supabase/schema.sql', 'utf8'))
ok('schema applies twice without error', true)

const HOST = '00000000-0000-0000-0000-0000000000a1', GUEST = '00000000-0000-0000-0000-0000000000a2',
  OTHER = '00000000-0000-0000-0000-0000000000a3', ADMIN = '00000000-0000-0000-0000-0000000000ad'
await db.exec(`insert into auth.users values ('${HOST}','h@x.test'),('${GUEST}','g@x.test'),('${OTHER}','o@x.test'),('${ADMIN}','ad@x.test');
  insert into public.admins values ('${ADMIN}');`)

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
}
const q = async sql => (await db.query(sql)).rows
const code = async sql => { try { await db.query(sql); return null } catch (e) { return e.code ?? e.message } }
const count = (role, uid, sql) => as(role, uid, async () => (await q(sql)).length)

const HIDE = `'Address shared on request'`
const H = '33333333-0000-0000-0000-000000000001'      // hidden venue, will be approved
const PUBV = '33333333-0000-0000-0000-000000000002'   // ordinary venue
const PEND = '33333333-0000-0000-0000-000000000003'   // hidden but still pending

// ── Submitting a hidden venue ──
ok('host submits a hidden venue (coarse public row)',
  (await as('authenticated', HOST, () => code(`insert into public.venues (id,name,address,city,region,lat,lng,status,submitted_by,location_hidden)
    values ('${H}','The Porch',${HIDE},'Hoboken','NJ',40.74,-74.03,'pending','${HOST}',true)`))) === null)
ok('host stores the real address privately',
  (await as('authenticated', HOST, () => code(`insert into public.venue_private (venue_id,address,postal_code,lat,lng)
    values ('${H}','12 Elm St','07030',40.745123,-74.031987)`))) === null)

// The public row cannot carry a street address, a ZIP, or a precise pin when hidden.
const bad = async (cols, vals) => code(`insert into public.venues (name,${cols},city,status,location_hidden) values ('x',${vals},'Town','pending',true)`)
ok('hidden venue with a real street address is rejected', (await bad('address,lat,lng', `'12 Elm St',40.74,-74.03`)) === '23514')
ok('hidden venue with a precise pin is rejected', (await bad('address,lat,lng', `${HIDE},40.745123,-74.031987`)) === '23514')
ok('hidden venue with a ZIP is rejected', (await bad('address,lat,lng,postal_code', `${HIDE},40.74,-74.03,'07030'`)) === '23514')
ok('hidden venue with a coarse pin is accepted', (await bad('address,lat,lng', `${HIDE},40.74,-74.03`)) === null)
ok('ordinary venues are unaffected', (await code(`insert into public.venues (id,name,address,city,lat,lng,status,location_hidden) values ('${PUBV}','Cafe','1 Main','Town',40.123456,-74.654321,'approved',false)`)) === null)

// ── While pending ──
ok('pending hidden venue: stranger cannot read private row', (await count('authenticated', GUEST, `select 1 from public.venue_private`)) === 0)
ok('host can read their own private row', (await count('authenticated', HOST, `select 1 from public.venue_private`)) === 1)
ok('admin can read the private row (to review)', (await count('authenticated', ADMIN, `select 1 from public.venue_private`)) === 1)
ok('host can still correct the private address while pending',
  (await as('authenticated', HOST, async () => (await q(`update public.venue_private set address='14 Elm St' where venue_id='${H}' returning 1`)).length)) === 1)
ok('a stranger cannot add a private row to someone else\'s venue',
  (await as('authenticated', GUEST, () => code(`insert into public.venue_private (venue_id,address,lat,lng) values ('${H}','x',1,1)`))) !== null)
ok('private row cannot be attached to an ordinary (not hidden) venue by its owner',
  (await as('authenticated', HOST, () => code(`insert into public.venue_private (venue_id,address,lat,lng) values ('${PUBV}','x',1,1)`))) !== null)
await db.exec(`update public.venues set status='approved' where id='${H}'`)
ok('after approval the host can no longer change the real address',
  (await as('authenticated', HOST, async () => (await q(`update public.venue_private set address='99 Other St' where venue_id='${H}' returning 1`)).length)) === 0)
ok('admin can change the real address any time',
  (await as('authenticated', ADMIN, async () => (await q(`update public.venue_private set address='12 Elm St' where venue_id='${H}' returning 1`)).length)) === 1)

// ── Public view ──
const pub = await as('anon', null, () => q(`select address, lat, lng, postal_code from public.venues where id='${H}'`))
ok('public sees the hidden venue with only the placeholder + town-level pin',
  pub.length === 1 && pub[0].address === 'Address shared on request' && pub[0].lat === 40.74 && pub[0].lng === -74.03 && pub[0].postal_code === null, JSON.stringify(pub))
ok('anonymous visitors cannot read any private address', (await count('anon', null, `select 1 from public.venue_private`)) === 0)
ok('a stranger cannot read the private address', (await count('authenticated', GUEST, `select 1 from public.venue_private`)) === 0)

// ── Requests ──
const note = 'Hi! I play fingerstyle guitar and would love to come.'
const req = (uid, venue, n = note, extra = '') => code(`insert into public.address_requests (venue_id,requester_id,note${extra ? ',' + extra.split('=')[0] : ''}) values ('${venue}','${uid}','${n}'${extra ? ',' + extra.split('=')[1] : ''})`)
ok('anonymous cannot request', (await as('anon', null, () => code(`insert into public.address_requests (venue_id,requester_id,note) values ('${H}',null,'${note}')`))) !== null)
ok('signed-in user can request the address', (await as('authenticated', GUEST, () => req(GUEST, H))) === null)
ok('the same person cannot ask twice (23505)', (await as('authenticated', GUEST, () => req(GUEST, H))) === '23505')
ok('cannot request as someone else', (await as('authenticated', OTHER, () => req(GUEST, H))) !== null)
ok('too-short note rejected', (await as('authenticated', OTHER, () => req(OTHER, H, 'hi'))) !== null)
ok('host cannot request their own venue', (await as('authenticated', HOST, () => req(HOST, H))) !== null)
ok('cannot request a venue that is not hidden', (await as('authenticated', OTHER, () => req(OTHER, PUBV))) !== null)
await db.exec(`insert into public.venues (id,name,address,city,lat,lng,status,submitted_by,location_hidden) values ('${PEND}','Pending Porch',${HIDE},'Town',40.1,-74.1,'pending','${HOST}',true)`)
ok('cannot request a venue that is not approved yet', (await as('authenticated', OTHER, () => req(OTHER, PEND))) !== null)
ok('cannot file a pre-approved request', (await as('authenticated', OTHER, () => req(OTHER, H, note, `status='approved'`))) !== null)

ok('a pending requester cannot read the address', (await count('authenticated', GUEST, `select 1 from public.venue_private`)) === 0)
ok('requester sees their own request', (await count('authenticated', GUEST, `select 1 from public.address_requests`)) === 1)
ok('another user cannot see that request', (await count('authenticated', OTHER, `select 1 from public.address_requests`)) === 0)
ok('anonymous cannot see requests', (await count('anon', null, `select 1 from public.address_requests`)) === 0)
ok('host sees the request for their venue', (await count('authenticated', HOST, `select 1 from public.address_requests`)) === 1)
ok('admin sees all requests', (await count('authenticated', ADMIN, `select 1 from public.address_requests`)) === 1)

// ── Deciding ──
const decide = (uid, sql) => as('authenticated', uid, async () => (await q(sql)).length)
ok('requester cannot approve themselves', (await decide(GUEST, `update public.address_requests set status='approved' where requester_id='${GUEST}' returning 1`)) === 0)
ok('a stranger cannot approve it', (await decide(OTHER, `update public.address_requests set status='approved' returning 1`)) === 0)
ok('host cannot rewrite who asked or what they said',
  (await as('authenticated', HOST, () => code(`update public.address_requests set note='something else entirely', status='approved'`))) === '42501')
ok('host cannot set it back to pending', (await as('authenticated', HOST, () => code(`update public.address_requests set status='pending'`))) !== null)
ok('host approves the request', (await decide(HOST, `update public.address_requests set status='approved' returning 1`)) === 1)
ok('decision time is stamped by the database', (await q(`select decided_at from public.address_requests`))[0].decided_at !== null)
ok('approved guest can now read the real address',
  (await as('authenticated', GUEST, async () => (await q(`select address from public.venue_private`))[0]?.address)) === '12 Elm St')
ok('other users still cannot', (await count('authenticated', OTHER, `select 1 from public.venue_private`)) === 0)
ok('approved guest cannot edit the address', (await decide(GUEST, `update public.venue_private set address='x' returning 1`)) === 0)
ok('approved guest cannot delete the address', (await decide(GUEST, `delete from public.venue_private returning 1`)) === 0)
ok('host can revoke access', (await decide(HOST, `update public.address_requests set status='declined' returning 1`)) === 1)
ok('after revoking, the guest can no longer read it', (await count('authenticated', GUEST, `select 1 from public.venue_private`)) === 0)
ok('guest cannot ask again after a decline (23505)', (await as('authenticated', GUEST, () => req(GUEST, H))) === '23505')
await decide(HOST, `update public.address_requests set status='approved' returning 1`)
await db.exec(`update public.venues set status='closed' where id='${H}'`)
ok('closing the venue also shuts off an approved guest', (await count('authenticated', GUEST, `select 1 from public.venue_private`)) === 0)
await db.exec(`update public.venues set status='approved' where id='${H}'`)
ok('admin can decide requests too', (await decide(ADMIN, `update public.address_requests set status='declined' returning 1`)) === 1)

// ── Daily limit ──
const vids = []
for (let i = 0; i < 11; i++) {
  const id = `44444444-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`
  vids.push(id)
  await db.exec(`insert into public.venues (id,name,address,city,lat,lng,status,submitted_by,location_hidden) values ('${id}','HV${i}',${HIDE},'T',40.1,-74.1,'approved','${HOST}',true)`)
}
const lim = []
await as('authenticated', OTHER, async () => { for (const id of vids) lim.push(await req(OTHER, id)) })
ok('10 requests a day allowed', lim.slice(0, 10).every(r => r === null), JSON.stringify(lim))
ok('11th request blocked with SQLSTATE 54000', lim[10] === '54000', JSON.stringify(lim))

// ── Cleanup behaviour ──
await db.exec(`delete from public.venues where id='${H}'`)
ok('deleting a venue removes its private address and requests',
  (await q(`select 1 from public.venue_private where venue_id='${H}'`)).length === 0
  && (await q(`select 1 from public.address_requests where venue_id='${H}'`)).length === 0)

// ── Email-alert log is server-only ──
const NS = `insert into public.notifications_sent (kind, ref_id) values ('submission', '99999999-0000-0000-0000-000000000001')`
ok('service role can record a sent alert', (await as('service_role', null, () => code(NS))) === null)
ok('signed-in users cannot write the alert log', (await as('authenticated', HOST, () => code(NS.replace('0001', '0002')))) !== null)
ok('anonymous visitors cannot write the alert log', (await as('anon', null, () => code(NS.replace('0001', '0003')))) !== null)
ok('nobody but the server can read the alert log',
  (await count('authenticated', ADMIN, 'select 1 from public.notifications_sent')) === 0 && (await count('anon', null, 'select 1 from public.notifications_sent')) === 0
  && (await as('service_role', null, async () => (await q('select 1 from public.notifications_sent')).length)) === 1)
ok('alert kinds are restricted', (await code(`insert into public.notifications_sent (kind, ref_id) values ('whatever', gen_random_uuid())`)) === '23514')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
