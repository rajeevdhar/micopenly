// Phase 1 database rules: "still running" confirmations, problem reports, daily limits, closing listings.
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
const schema = readFileSync(process.env.SCHEMA ?? 'supabase/schema.sql', 'utf8')
await db.exec(schema)
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`)
const U1 = '00000000-0000-0000-0000-0000000000a1', U2 = '00000000-0000-0000-0000-0000000000a2', ADMIN = '00000000-0000-0000-0000-0000000000ad'
await db.exec(`insert into auth.users values ('${U1}','1@x.test'),('${U2}','2@x.test'),('${ADMIN}','ad@x.test'); insert into public.admins values ('${ADMIN}');`)
const V = '11111111-0000-0000-0000-000000000001', M = '22222222-0000-0000-0000-000000000001', M2 = '22222222-0000-0000-0000-000000000002'
await db.exec(`
  insert into public.venues (id,name,address,city,lat,lng,status,submitted_by) values ('${V}','Cafe','1 Main','Town',40,-74,'approved',null);
  insert into public.open_mics (id,venue_id,title,day_of_week,start_time,status) values ('${M}','${V}','x',1,'19:00','approved')`)
await db.exec(`insert into public.open_mics (id,venue_id,title,day_of_week,start_time,status) values ('${M2}','${V}','y',2,'19:00','approved')`)

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
}
const q = async sql => (await db.query(sql)).rows
const code = async sql => { try { await db.query(sql); return null } catch (e) { return e.code ?? e.message } }
const verified = async id => (await q(`select last_verified_at from public.open_mics where id='${id}'`))[0].last_verified_at

// ── Confirmations ("still running") ──
ok('mic starts unverified', (await verified(M)) === null)
ok('signed-in user can confirm', (await as('authenticated', U1, () => code(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M}','${U1}')`))) === null)
ok('confirming stamps last_verified_at (via trigger)', (await verified(M)) !== null)
ok('same user same day: duplicate rejected (23505)', (await as('authenticated', U1, () => code(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M}','${U1}')`))) === '23505')
ok('cannot confirm as someone else', (await as('authenticated', U2, () => code(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M}','${U1}')`))) !== null)
ok('anon cannot confirm', (await as('anon', null, () => code(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M2}',null)`))) !== null)
ok('user sees only own confirmations', (await as('authenticated', U2, async () => (await q('select 1 from public.open_mic_confirmations')).length)) === 0)

// ── Reports ──
ok('signed-in user can report', (await as('authenticated', U1, () => code(`insert into public.reports (open_mic_id,reporter_id,kind,note) values ('${M}','${U1}','closed','Saw a closed sign')`))) === null)
ok('second OPEN report by same user on same mic rejected (23505)', (await as('authenticated', U1, () => code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M}','${U1}','wrong_time')`))) === '23505')
ok('same user can report a different mic', (await as('authenticated', U1, () => code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M2}','${U1}','moved')`))) === null)
ok('cannot file a report as someone else', (await as('authenticated', U2, () => code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M}','${U1}','spam')`))) !== null)
ok('cannot file a pre-resolved report', (await as('authenticated', U2, () => code(`insert into public.reports (open_mic_id,reporter_id,kind,status) values ('${M}','${U2}','spam','resolved')`))) !== null)
ok('reporter sees own reports only', (await as('authenticated', U2, async () => (await q('select 1 from public.reports')).length)) === 0)
ok('anon sees no reports', (await as('anon', null, async () => (await q('select 1 from public.reports')).length)) === 0)
ok('reporter cannot resolve own report', (await as('authenticated', U1, async () => (await q(`update public.reports set status='resolved' where reporter_id='${U1}' returning 1`)).length)) === 0)
ok('admin sees all reports', (await as('authenticated', ADMIN, async () => (await q('select 1 from public.reports')).length)) === 2)
ok('admin can read reports with the mic and venue embedded (joins)', (await as('authenticated', ADMIN, async () => (await q('select r.kind, m.title, v.name from public.reports r join public.open_mics m on m.id=r.open_mic_id join public.venues v on v.id=m.venue_id')).length)) === 2)
ok('admin resolves a report', (await as('authenticated', ADMIN, async () => (await q(`update public.reports set status='resolved', resolved_by='${ADMIN}', resolved_at=now() where open_mic_id='${M}' returning 1`)).length)) === 1)
ok('after resolution the same user may report again', (await as('authenticated', U1, () => code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M}','${U1}','wrong_info')`))) === null)

// ── Admin closing a listing ──
ok('public sees both mics before closing', (await as('anon', null, async () => (await q('select 1 from public.open_mics')).length)) === 2)
ok('admin marks a mic closed', (await as('authenticated', ADMIN, async () => (await q(`update public.open_mics set status='closed' where id='${M}' returning 1`)).length)) === 1)
ok('closed mic disappears from the public', (await as('anon', null, async () => (await q('select 1 from public.open_mics')).length)) === 1)
const closedAttempts = await as('authenticated', U2, async () => [
  await code(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M}','${U2}')`),
  await code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M}','${U2}','closed')`)])
ok('nobody can confirm or report a closed mic', closedAttempts.every(c => c !== null), JSON.stringify(closedAttempts))
ok('regular user cannot close a mic', (await as('authenticated', U2, async () => (await q(`update public.open_mics set status='closed' where id='${M2}' returning 1`)).length)) === 0)

// ── Daily limits ──
const insertVenue = (uid, i) => code(`insert into public.venues (name,address,city,lat,lng,submitted_by) values ('V${i}','a','c',1,1,'${uid}')`)
const insertMicFor = (uid, v, i) => code(`insert into public.open_mics (venue_id,title,day_of_week,start_time,submitted_by) values ('${v}','T${i}',${i % 7},'${10 + (i % 10)}:00','${uid}')`)
const results = []
await as('authenticated', U2, async () => { for (let i = 0; i < 6; i++) results.push(await insertVenue(U2, i)) })
ok('5 venues in a day allowed', results.slice(0, 5).every(r => r === null), JSON.stringify(results))
ok('6th venue in a day blocked with SQLSTATE 54000', results[5] === '54000', JSON.stringify(results))
const ownVenue = (await q(`select id from public.venues where submitted_by='${U2}' limit 1`))[0].id
const micResults = []
await as('authenticated', U2, async () => { for (let i = 0; i < 11; i++) micResults.push(await insertMicFor(U2, ownVenue, i)) })
ok('10 open mics in a day allowed', micResults.slice(0, 10).every(r => r === null), JSON.stringify(micResults))
ok('11th open mic blocked with 54000', micResults[10] === '54000', JSON.stringify(micResults))
ok('limit is per user (another user is unaffected)', (await as('authenticated', U1, () => insertVenue(U1, 99))) === null)
ok('admin is exempt from the limits', (await as('authenticated', ADMIN, async () => { const r = []; for (let i = 0; i < 7; i++) r.push(await insertVenue(ADMIN, 200 + i)); return r.every(x => x === null) })))
await db.exec(`update public.venues set created_at = now() - interval '25 hours' where submitted_by='${U2}'`)
ok('old submissions fall out of the 24-hour window', (await as('authenticated', U2, () => insertVenue(U2, 300))) === null)
const repResults = []
await db.exec(`insert into public.open_mics (venue_id,title,day_of_week,start_time,status) select '${V}','R'||g,3,(g||':00')::time,'approved' from generate_series(1,11) g`)
const many = (await q(`select id from public.open_mics where title like 'R%'`)).map(r => r.id)
await as('authenticated', U2, async () => { for (const id of many) repResults.push(await code(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${id}','${U2}','wrong_info')`)) })
ok('10 reports in a day allowed, 11th blocked', repResults.slice(0, 10).every(r => r === null) && repResults[10] === '54000', JSON.stringify(repResults))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
