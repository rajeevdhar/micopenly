// Email alerts: who gets told what, never twice, and nothing sensitive in the message.
import { readConfig, runOnce } from '../server/notify.js'

let pass = 0, fail = 0
const ok = (name, c, extra = '') => { c ? pass++ : (fail++, console.log(`FAIL ${name} ${extra}`)) }

const KEY = 'service-role-secret-key-123'
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY, RESEND_API_KEY: 're_test', MAIL_FROM: 'MicOpenly <alerts@example.com>', ADMIN_EMAIL: 'boss@example.com', SITE_URL: 'https://site.example' }

function world() {
  const w = {
    mics: [], reports: [], requests: [], sent: [], admins: [], emails: { h1: 'host1@example.com', h2: 'host2@example.com', adm: 'admin@example.com' },
    outbox: [], calls: [], resendStatus: 200,
  }
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
  w.fetch = async (url, opts = {}) => {
    const u = new URL(url); w.calls.push({ url, opts })
    if (u.host === 'api.resend.com') {
      if (w.resendStatus !== 200) return json({ error: 'boom' }, w.resendStatus)
      w.outbox.push({ auth: opts.headers.Authorization, ...JSON.parse(opts.body) }); return json({ id: 'e1' })
    }
    ok_key(opts)
    const p = u.pathname, q = u.searchParams
    if (p === '/rest/v1/open_mics') return json(w.mics.filter(m => m.status === 'pending'))
    if (p === '/rest/v1/reports') return json(w.reports.filter(r => r.status === 'open'))
    if (p === '/rest/v1/address_requests') return json(w.requests.filter(r => r.status === 'pending'))
    if (p === '/rest/v1/admins') return json(w.admins.map(user_id => ({ user_id })))
    if (p.startsWith('/auth/v1/admin/users/')) { const e = w.emails[p.split('/').pop()]; return e ? json({ email: e }) : json({}, 404) }
    if (p === '/rest/v1/notifications_sent' && (opts.method ?? 'GET') === 'GET') {
      const kind = q.get('kind').replace('eq.', ''), ids = q.get('ref_id').replace(/^in\.\(|\)$/g, '').split(',')
      return json(w.sent.filter(s => s.kind === kind && ids.includes(s.ref_id)).map(s => ({ ref_id: s.ref_id })))
    }
    if (p === '/rest/v1/notifications_sent' && opts.method === 'POST') { for (const r of JSON.parse(opts.body)) if (!w.sent.some(s => s.kind === r.kind && s.ref_id === r.ref_id)) w.sent.push(r); return json([], 201) }
    return json({}, 404)
  }
  const ok_key = opts => { if (opts.headers?.apikey !== KEY || opts.headers?.Authorization !== `Bearer ${KEY}`) ok('every database call carries the service key', false, JSON.stringify(opts.headers)) }
  return w
}
const mic = (id, title, extra = {}) => ({ id, title, day_of_week: 4, start_time: '19:30:00', status: 'pending', venue: { name: 'The Tavern', city: 'Hackensack', region: 'NJ' }, ...extra })
const quiet = { log() {}, error() {} }
const run = (cfg, w) => runOnce(cfg, { fetchImpl: w.fetch, log: quiet })

// ── configuration ──
ok('enabled only with database, key, a mail provider and a sender', readConfig(env).enabled === true)
ok('off without the service key', readConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }).enabled === false)
ok('off without a mail provider', readConfig({ ...env, RESEND_API_KEY: '' }).enabled === false)
ok('off without a from address', readConfig({ ...env, MAIL_FROM: '' }).enabled === false)
ok('SMTP counts as a provider', readConfig({ ...env, RESEND_API_KEY: '', SMTP_URL: 'smtp://u:p@h' }).enabled === true)
ok('falls back to the VITE_ database url', readConfig({ ...env, SUPABASE_URL: '', VITE_SUPABASE_URL: 'https://y.supabase.co/' }).url === 'https://y.supabase.co')
{ const w = world(); const s = await run(readConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }), w)
  ok('when off, it does nothing at all (no network calls)', s.skipped === true && w.calls.length === 0) }

// ── admin digest ──
const cfg = readConfig(env)
{
  const w = world()
  w.mics = [mic('m1', 'Thursday Songs'), mic('m2', 'Sunday Jam', { day_of_week: 0, start_time: '14:00:00' }), mic('m3', 'Already live', { status: 'approved' })]
  w.reports = [{ id: 'r1', kind: 'closed', note: 'Sign says closed', status: 'open', open_mic: { title: 'Old Mic', venue: { name: 'Bar', city: 'Town', region: 'NJ' } } }]
  const s = await run(cfg, w)
  ok('one digest to the admin', s.adminEmails === 1 && w.outbox.length === 1 && w.outbox[0].to[0] === 'boss@example.com', JSON.stringify(w.outbox))
  const m = w.outbox[0]
  ok('subject counts submissions and reports', m.subject === 'MicOpenly: 2 new submissions and 1 problem report', m.subject)
  ok('body lists each submission with day, time and place', /Thursday Songs: Thursday 7:30 PM at The Tavern \(Hackensack, NJ\)/.test(m.text) && /Sunday Jam: Sunday 2:00 PM/.test(m.text))
  ok('body includes the report and a link to review', /No longer running: Old Mic/.test(m.text) && m.text.includes('https://site.example'))
  ok('approved mics are not announced', !m.text.includes('Already live'))
  ok('uses the configured sender and provider key', m.from === 'MicOpenly <alerts@example.com>' && m.auth === 'Bearer re_test')
  ok('the service key never appears in an email', !JSON.stringify(w.outbox).includes(KEY))
  ok('everything announced is logged as sent', w.sent.length === 3)

  const s2 = await run(cfg, w)
  ok('running again sends nothing (no duplicates)', s2.adminEmails === 0 && w.outbox.length === 1)
  w.mics.push(mic('m4', 'Friday Open Stage'))
  await run(cfg, w)
  ok('a new submission triggers a new email mentioning only the new one', w.outbox.length === 2 && w.outbox[1].subject === 'MicOpenly: 1 new submission' && w.outbox[1].text.includes('Friday Open Stage') && !w.outbox[1].text.includes('Thursday Songs'))
}

// ── failure and retry ──
{
  const w = world(); w.mics = [mic('m1', 'Thursday Songs')]; w.resendStatus = 500
  const s = await run(cfg, w)
  ok('a failed send is counted and nothing is marked as sent', s.errors >= 1 && w.sent.length === 0 && w.outbox.length === 0)
  w.resendStatus = 200
  await run(cfg, w)
  ok('the next pass retries and delivers it', w.outbox.length === 1 && w.sent.length === 1)
}

// ── header injection ──
{
  const w = world(); w.mics = [mic('m1', 'Evil\r\nBcc: attacker@example.com')]; w.requests = []
  await run(cfg, w)
  ok('line breaks in user text cannot reach the subject or body lines as new headers', !/[\r\n]/.test(w.outbox[0].subject) && !w.outbox[0].text.includes('\r'))
}

// ── admin address from the admins table when ADMIN_EMAIL is unset ──
{
  const w = world(); w.admins = ['adm']; w.mics = [mic('m1', 'X Mic')]
  await run(readConfig({ ...env, ADMIN_EMAIL: '' }), w)
  ok('falls back to the admins table', w.outbox.length === 1 && w.outbox[0].to[0] === 'admin@example.com')
}

// ── host emails for address requests ──
{
  const w = world()
  const rq = (id, host, note, vname = 'Porch') => ({ id, note, status: 'pending', venue: { name: vname, city: 'Hoboken', region: 'NJ', submitted_by: host } })
  w.requests = [rq('q1', 'h1', 'I play banjo, find me @banjo_ann'), rq('q2', 'h1', 'Poet here, 2 friends'), rq('q3', 'h2', 'Songwriter from Montclair', 'Loft')]
  const s = await run(cfg, w)
  const to1 = w.outbox.find(m => m.to[0] === 'host1@example.com'), to2 = w.outbox.find(m => m.to[0] === 'host2@example.com')
  ok('each host gets exactly one email', s.hostEmails === 2 && w.outbox.length === 2)
  ok('host 1 gets both of their requests and not host 2\'s', /banjo/.test(to1.text) && /Poet here/.test(to1.text) && !/Montclair/.test(to1.text) && to1.subject.includes('2 requests'))
  ok('host 2 gets only theirs', /Montclair/.test(to2.text) && !/banjo/.test(to2.text) && to2.subject.includes('a request'))
  ok('hosts are pointed to My submissions', to1.text.includes('My submissions'))
  ok('requests are logged as sent', w.sent.filter(x => x.kind === 'address_request').length === 3)
  await run(cfg, w)
  ok('no repeat host emails', w.outbox.length === 2)
  w.requests.push(rq('q4', 'h1', 'One more'))
  await run(cfg, w)
  ok('a later request produces a new email with only the new one', w.outbox.length === 3 && /One more/.test(w.outbox[2].text) && !/banjo/.test(w.outbox[2].text))
}
{
  const w = world(); w.requests = [{ id: 'q9', note: 'hello there friend', status: 'pending', venue: { name: 'P', city: 'C', region: 'NJ', submitted_by: 'ghost' } }]
  const s = await run(cfg, w)
  ok('a host with no email on file is skipped without crashing, and retried later', w.outbox.length === 0 && w.sent.length === 0 && s.errors === 0)
}

// ── The worker is separate from the public web server ──
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const web = readFileSync('server.js', 'utf8')
ok('the public web server does not load the notifier or mention the service key', !/notify|SERVICE_ROLE|startNotifier/.test(web.replace(/^\/\/.*$/gm, '')))
const baseEnv = { PATH: process.env.PATH }
{
  const r = spawnSync('node', ['server/worker.js'], { env: baseEnv, encoding: 'utf8', timeout: 8000 })
  ok('the worker refuses to start when unconfigured, naming what is missing', r.status === 1 && /SUPABASE_SERVICE_ROLE_KEY/.test(r.stderr) && /MAIL_FROM/.test(r.stderr), `${r.status} ${r.stderr}`)
  const partial = spawnSync('node', ['server/worker.js'], { env: { ...baseEnv, VITE_SUPABASE_URL: 'https://x.supabase.co', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.co' }, encoding: 'utf8', timeout: 8000 })
  ok('a worker with no service key also refuses', partial.status === 1 && /SUPABASE_SERVICE_ROLE_KEY/.test(partial.stderr) && !/RESEND/.test(partial.stderr))
  const live = spawnSync('node', ['server/worker.js'], { env: { ...baseEnv, VITE_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.co', NOTIFY_FIRST_DELAY_MS: '600000' }, encoding: 'utf8', timeout: 1500, killSignal: 'SIGTERM' })
  ok('a configured worker stays running (keeps the process alive) until told to stop, then exits cleanly', live.error?.code === 'ETIMEDOUT' || live.status === 0, `${live.status} ${live.signal} ${live.stdout}`)
  ok('a configured worker announces itself', /email alerts on/.test(live.stdout), live.stdout)
}
const rj = JSON.parse(readFileSync('railway.worker.json', 'utf8'))
ok('the worker config starts the worker with no health-check port and a bounded restart policy', rj.deploy.startCommand === 'node server/worker.js' && !rj.deploy.healthcheckPath && rj.deploy.restartPolicyMaxRetries === 5)
ok('the web config still starts the web server', JSON.parse(readFileSync('railway.json', 'utf8')).deploy.startCommand === 'node server.js')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
