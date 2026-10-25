// The optional database-side age check: new accounts need the flag; existing accounts are untouched.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }
const rejects = async sql => { try { await db.exec(sql); return null } catch (e) { return e } }

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'old@x.test', null);   -- existed before the rule
`)
const migration = readFileSync('supabase/migrations/2026-10-25_age_gate.sql', 'utf8')
await db.exec(migration); await db.exec(migration)
ok('the migration applies twice without error', true)

const id = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const ins = (n, meta) => `insert into auth.users values ('${id(n)}', 'u${n}@x.test', ${meta})`

ok('a sign-up with the flag goes through', (await rejects(ins(1, `'{"age_confirmed_16": true, "age_confirmed_at": "2026-10-25T00:00:00Z"}'`))) === null)
const noMeta = await rejects(ins(2, 'null'))
ok('a sign-up with no metadata is refused', noMeta && /16 or older/.test(noMeta.message), noMeta?.message)
ok('a sign-up with empty metadata is refused', (await rejects(ins(3, `'{}'`))) !== null)
ok('the flag set to false is refused', (await rejects(ins(4, `'{"age_confirmed_16": false}'`))) !== null)
ok('the flag as the word "no" is refused', (await rejects(ins(5, `'{"age_confirmed_16": "no"}'`))) !== null)
ok('an unrelated field does not count', (await rejects(ins(6, `'{"age_confirmed": true}'`))) !== null)
ok('the string "true" is accepted (JSON true and "true" read the same)', (await rejects(ins(7, `'{"age_confirmed_16": "true"}'`))) === null)

const before = (await db.query('select count(*)::int n from auth.users')).rows[0].n
ok('only the accepted sign-ups were created', before === 3, String(before))   // old + two accepted

// Existing accounts keep working: the rule is about new sign-ups only
ok('an existing account without the flag can still be updated', (await rejects(`update auth.users set email = 'old2@x.test' where id = '${id(10).replace(/..$/, '0a')}'`)) === null)
ok('and its metadata can be changed', (await rejects(`update auth.users set raw_user_meta_data = '{"x":1}' where email = 'old2@x.test'`)) === null)

// Escape hatch documented in the migration
await db.exec('alter table auth.users disable trigger require_age_confirmation')
ok('with the trigger disabled, a manual account is allowed', (await rejects(ins(8, 'null'))) === null)
await db.exec('alter table auth.users enable trigger require_age_confirmation')
ok('and refused again once re-enabled', (await rejects(ins(9, 'null'))) !== null)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
