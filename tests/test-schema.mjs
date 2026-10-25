import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }

// ── Stub the bits of Supabase the schema depends on ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`)

// ── Apply the real schema.sql, twice, to prove it's idempotent ──
const schema = readFileSync(process.env.SCHEMA ?? 'supabase/schema.sql', 'utf8')
await db.exec(schema)
await db.exec(schema)
ok('schema applies twice without error', true)

// Supabase grants these by default; RLS is what actually gates access
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`)

const A = '00000000-0000-0000-0000-00000000000a'   // submitter
const B = '00000000-0000-0000-0000-00000000000b'   // stranger
const C = '00000000-0000-0000-0000-00000000000c'   // admin
await db.exec(`insert into auth.users values ('${A}','a@x.test'),('${B}','b@x.test'),('${C}','c@x.test');
               insert into public.admins values ('${C}');`)

const V1 = '11111111-0000-0000-0000-000000000001'  // approved, by A
const V2 = '11111111-0000-0000-0000-000000000002'  // pending,  by A
const V3 = '11111111-0000-0000-0000-000000000003'  // pending,  by B
await db.exec(`insert into public.venues (id,name,address,city,lat,lng,status,submitted_by) values
  ('${V1}','Cafe One','1 Main St','Hackensack',40.88,-74.04,'approved','${A}'),
  ('${V2}','Cafe Two','2 Main St','Paramus',40.94,-74.07,'pending','${A}'),
  ('${V3}','Cafe Three','3 Main St','Teaneck',40.89,-74.01,'pending','${B}')`)

// Run fn as a Supabase-like role; always reset afterward
async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`) }
}
const rows  = async (sql) => (await db.query(sql)).rows
const names = async (sql) => (await rows(sql)).map(r => r.name).sort()
const throws = async (sql) => { try { await db.query(sql); return false } catch (e) { return e.message } }
const affected = async (sql) => (await db.query(sql)).rows.length   // use with RETURNING

// ═══ VENUES: who can see what ═══
ok('anon sees approved venues only', JSON.stringify(await as('anon', null, () => names('select name from public.venues'))) === '["Cafe One"]')
ok('stranger sees approved only',    JSON.stringify(await as('authenticated', B, () => names('select name from public.venues where id <> \''+V3+'\''))) === '["Cafe One"]')
ok('submitter sees own pending too', JSON.stringify(await as('authenticated', A, () => names('select name from public.venues'))) === '["Cafe One","Cafe Two"]')
ok('admin sees everything',          (await as('authenticated', C, () => rows('select 1 from public.venues'))).length === 3)

// ═══ VENUES: writes ═══
ok('anon cannot submit a venue', !!(await as('anon', null, () => throws(`insert into public.venues (name,address,city,lat,lng,submitted_by) values ('X','x','x',1,1,null)`))))
ok('user can submit pending venue as self', !(await as('authenticated', B, () => throws(`insert into public.venues (name,address,city,lat,lng,submitted_by) values ('B2','x','x',1,1,'${B}')`))))
ok('user cannot self-approve on insert',    !!(await as('authenticated', B, () => throws(`insert into public.venues (name,address,city,lat,lng,status,submitted_by) values ('B3','x','x',1,1,'approved','${B}')`))))
ok('user cannot submit as someone else',    !!(await as('authenticated', B, () => throws(`insert into public.venues (name,address,city,lat,lng,submitted_by) values ('B4','x','x',1,1,'${A}')`))))
ok('bad latitude rejected',                 !!(await as('authenticated', B, () => throws(`insert into public.venues (name,address,city,lat,lng,submitted_by) values ('B5','x','x',95,1,'${B}')`))))
ok('owner can edit own pending venue',      (await as('authenticated', A, () => affected(`update public.venues set name='Cafe Two!' where id='${V2}' returning 1`))) === 1)
ok('owner cannot self-approve via update',  !!(await as('authenticated', A, () => throws(`update public.venues set status='approved' where id='${V2}'`))))
ok('stranger cannot edit others venue',     (await as('authenticated', B, () => affected(`update public.venues set name='hacked' where id='${V2}' returning 1`))) === 0)
ok('owner cannot edit APPROVED venue',      (await as('authenticated', A, () => affected(`update public.venues set name='hacked' where id='${V1}' returning 1`))) === 0)
ok('stranger cannot delete a venue',        (await as('authenticated', B, () => affected(`delete from public.venues where id='${V1}' returning 1`))) === 0)
ok('admin can approve pending venue',       (await as('authenticated', C, () => affected(`update public.venues set status='approved' where id='${V2}' returning 1`))) === 1)
ok('...and the public now sees it',         JSON.stringify(await as('anon', null, () => names('select name from public.venues'))) === '["Cafe One","Cafe Two!"]')

// ═══ OPEN MICS ═══
const M1 = '22222222-0000-0000-0000-000000000001'
const ins = (id, venue, uid, extra = '') => `insert into public.open_mics (id,venue_id,title,day_of_week,start_time,submitted_by${extra ? ',' + extra.split('=')[0] : ''}) values ('${id}','${venue}','Tuesday Mic',2,'19:00','${uid}'${extra ? ',' + extra.split('=')[1] : ''})`
ok('user can submit open mic on approved venue', !(await as('authenticated', B, () => throws(ins(M1, V1, B)))))
ok('pending open mic invisible to public',        (await as('anon', null, () => rows('select 1 from public.open_mics'))).length === 0)
ok('pending open mic visible to its submitter',   (await as('authenticated', B, () => rows('select 1 from public.open_mics'))).length === 1)
ok('pending open mic invisible to other users',   (await as('authenticated', A, () => rows('select 1 from public.open_mics'))).length === 0)
ok('cannot attach mic to someone elses pending venue', !!(await as('authenticated', A, () => throws(ins('22222222-0000-0000-0000-000000000009', V3, A)))))
ok('can attach mic to OWN pending venue',               !(await as('authenticated', B, () => throws(ins('22222222-0000-0000-0000-000000000008', V3, B)))))
ok('cannot self-approve open mic on insert', !!(await as('authenticated', B, () => throws(`insert into public.open_mics (venue_id,title,day_of_week,start_time,status,submitted_by) values ('${V1}','x',1,'19:00','approved','${B}')`))))
ok('weeks_of_month {6} rejected',            !!(await as('authenticated', B, () => throws(`insert into public.open_mics (venue_id,title,day_of_week,start_time,weeks_of_month,submitted_by) values ('${V1}','x',1,'20:00','{6}','${B}')`))))
ok('day_of_week 7 rejected',                 !!(await as('authenticated', B, () => throws(`insert into public.open_mics (venue_id,title,day_of_week,start_time,submitted_by) values ('${V1}','x',7,'20:00','${B}')`))))
ok('exact duplicate night rejected',         !!(await as('authenticated', B, () => throws(ins('22222222-0000-0000-0000-000000000007', V1, B)))))
ok('same night, different weeks allowed',    !(await as('authenticated', B, () => throws(`insert into public.open_mics (venue_id,title,day_of_week,start_time,weeks_of_month,submitted_by) values ('${V1}','Tue 1st',2,'19:00','{1}','${B}')`))))

// last_verified_at spoofing
const mv = (await as('authenticated', B, () => rows(`select last_verified_at from public.open_mics where id='${M1}'`)))[0]
ok('new mic starts unverified', mv.last_verified_at === null)
await as('authenticated', B, () => db.query(`update public.open_mics set last_verified_at = now() where id='${M1}'`))
ok('user cannot spoof last_verified_at (update)', (await rows(`select last_verified_at from public.open_mics where id='${M1}'`))[0].last_verified_at === null)
await as('authenticated', B, () => db.query(`insert into public.open_mics (id,venue_id,title,day_of_week,start_time,weeks_of_month,last_verified_at,submitted_by) values ('22222222-0000-0000-0000-000000000006','${V1}','spoof',3,'19:00','{2}',now(),'${B}')`))
ok('user cannot spoof last_verified_at (insert)', (await rows(`select last_verified_at from public.open_mics where id='22222222-0000-0000-0000-000000000006'`))[0].last_verified_at === null)

// confirmations need an APPROVED mic
ok('cannot confirm a pending mic', !!(await as('authenticated', A, () => throws(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M1}','${A}')`))))
ok('admin approves the open mic',  (await as('authenticated', C, () => affected(`update public.open_mics set status='approved' where id='${M1}' returning 1`))) === 1)
ok('public sees approved mic on approved venue', (await as('anon', null, () => rows('select 1 from public.open_mics where id=\''+M1+'\''))).length === 1)

// ═══ CONFIRMATIONS ═══
ok('stranger can confirm approved mic', !(await as('authenticated', A, () => throws(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M1}','${A}')`))))
ok('confirmation sets last_verified_at', (await rows(`select last_verified_at from public.open_mics where id='${M1}'`))[0].last_verified_at !== null)
ok('same-day duplicate confirmation rejected', !!(await as('authenticated', A, () => throws(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M1}','${A}')`))))
ok('cannot confirm as someone else', !!(await as('authenticated', A, () => throws(`insert into public.open_mic_confirmations (open_mic_id,user_id) values ('${M1}','${B}')`))))
ok('anon cannot read confirmations', (await as('anon', null, () => rows('select 1 from public.open_mic_confirmations'))).length === 0)
ok('other user cannot read confirmations', (await as('authenticated', B, () => rows('select 1 from public.open_mic_confirmations'))).length === 0)

// ═══ REPORTS ═══
ok('user can report approved mic',     !(await as('authenticated', A, () => throws(`insert into public.reports (open_mic_id,reporter_id,kind,note) values ('${M1}','${A}','closed','shut down in June')`))))
ok('cannot report as someone else',    !!(await as('authenticated', A, () => throws(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M1}','${B}','closed')`))))
ok('anon cannot report',               !!(await as('anon', null, () => throws(`insert into public.reports (open_mic_id,reporter_id,kind) values ('${M1}',null,'closed')`))))
ok('cannot pre-resolve a report',      !!(await as('authenticated', A, () => throws(`insert into public.reports (open_mic_id,reporter_id,kind,status) values ('${M1}','${A}','moved','resolved')`))))
ok('reporter sees own report',         (await as('authenticated', A, () => rows('select 1 from public.reports'))).length === 1)
ok('others cannot see the report',     (await as('authenticated', B, () => rows('select 1 from public.reports'))).length === 0)
ok('anon cannot see reports',          (await as('anon', null, () => rows('select 1 from public.reports'))).length === 0)
ok('reporter cannot resolve it',       (await as('authenticated', A, () => affected(`update public.reports set status='dismissed' returning 1`))) === 0)
ok('admin sees and resolves it',       (await as('authenticated', C, () => affected(`update public.reports set status='resolved', resolved_by='${C}' returning 1`))) === 1)

// ═══ SAVED ═══
ok('user can save a mic',          !(await as('authenticated', A, () => throws(`insert into public.saved_open_mics (user_id,open_mic_id) values ('${A}','${M1}')`))))
ok('cannot save as someone else',  !!(await as('authenticated', B, () => throws(`insert into public.saved_open_mics (user_id,open_mic_id) values ('${A}','${M1}')`))))
ok('others cannot read saved',     (await as('authenticated', B, () => rows('select 1 from public.saved_open_mics'))).length === 0)
ok('anon cannot read saved',       (await as('anon', null, () => rows('select 1 from public.saved_open_mics'))).length === 0)

// ═══ ADMINS TABLE is invisible and untouchable ═══
ok('clients cannot read admins',   (await as('authenticated', B, () => rows('select 1 from public.admins'))).length === 0)
ok('clients cannot make themselves admin', !!(await as('authenticated', B, () => throws(`insert into public.admins values ('${B}')`))))
ok('is_admin() true only for admin', (await as('authenticated', C, () => rows('select public.is_admin() as a')))[0].a === true
   && (await as('authenticated', B, () => rows('select public.is_admin() as a')))[0].a === false
   && (await as('anon', null, () => rows('select public.is_admin() as a')))[0].a === false)

// ═══ Closing a venue hides its mics from the public ═══
await db.exec(`update public.venues set status='closed' where id='${V1}'`)
ok('mics of a closed venue disappear from public', (await as('anon', null, () => rows('select 1 from public.open_mics'))).length === 0)

// ═══ Known / documented: what an anonymous visitor CAN read on approved rows ═══
await db.exec(`update public.venues set status='approved' where id='${V1}'`)
const anonCols = Object.keys((await as('anon', null, () => rows('select * from public.venues limit 1')))[0] ?? {})
console.log('INFO anon can read venue columns:', anonCols.join(', '))
console.log('INFO submitted_by readable by anon:', anonCols.includes('submitted_by'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
