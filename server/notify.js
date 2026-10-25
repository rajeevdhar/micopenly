// Email alerts. Runs as its OWN Railway service (server/worker.js), separate from the public web server,
// and uses the Supabase SERVICE-ROLE key. That key must exist only in the worker's environment: never
// in VITE_ variables, never on the web service.
//
//   • Admin(s): one digest for new submissions waiting for review and new problem reports.
//   • A host:   one email per batch of new address requests for their hidden-location venues.
//
// It polls instead of trusting the browser to say "I just submitted something", so alerts can't be
// forged or skipped, and a failed email is simply retried on the next pass. The `notifications_sent`
// table (server-only) makes every alert at-most-once per item.

import nodemailer from 'nodemailer'

const clean = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()           // header-safe
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const REPORT_LABEL = { closed: 'No longer running', moved: 'Moved', wrong_time: 'Wrong day or time', wrong_info: 'Wrong info', spam: 'Spam', other: 'Other' }
const hhmm = t => { const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

// Keys never contain spaces, line breaks or quotes. A value pasted wrapped over two lines (or with stray
// quotes) would otherwise be rejected by fetch as an invalid header, so strip anything that isn't printable ASCII.
export const secret = s => String(s ?? '').replace(/[^\x21-\x7e]/g, '').replace(/^["'`]+|["'`]+$/g, '')

// Error text can echo a header value back. Never let a key reach the logs.
export const redact = s => String(s ?? '')
  .replace(/sb_secret_[\s\S]*?(?=["']|$)/g, 'sb_secret_[hidden]')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt hidden]')
  .replace(/\bre_[A-Za-z0-9_]{8,}/g, 're_[hidden]')

export function readConfig(env = process.env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey = secret(env.SUPABASE_SERVICE_ROLE_KEY)
  const mailReady = !!(env.RESEND_API_KEY || env.SMTP_URL) && !!env.MAIL_FROM
  return {
    url, serviceKey, mailReady,
    enabled: !!(url && serviceKey && mailReady),
    from: env.MAIL_FROM || '',
    adminEmails: (env.ADMIN_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean),
    siteUrl: (env.SITE_URL || 'https://micopenly-production.up.railway.app').replace(/\/$/, ''),
    resendKey: secret(env.RESEND_API_KEY),
    smtpUrl: env.SMTP_URL || '',
    intervalMs: Number(env.NOTIFY_INTERVAL_MS) || 120000,
  }
}

/** Returns async ({to, subject, text}) that sends one email, or null if no provider is configured. */
export function makeSender(cfg, fetchImpl = fetch) {
  if (cfg.resendKey) {
    return async ({ to, subject, text }) => {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: cfg.from, to: [to], subject: clean(subject), text }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
  }
  if (cfg.smtpUrl) {
    const transport = nodemailer.createTransport(cfg.smtpUrl)
    return async ({ to, subject, text }) => { await transport.sendMail({ from: cfg.from, to, subject: clean(subject), text }) }
  }
  return null
}

function api(cfg, fetchImpl) {
  // Legacy service_role keys are JWTs and go in both headers. New sb_secret_ keys aren't JWTs: apikey only.
  const headers = { apikey: cfg.serviceKey, 'Content-Type': 'application/json' }
  if (!cfg.serviceKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${cfg.serviceKey}`
  const get = async path => {
    const res = await fetchImpl(`${cfg.url}${path}`, { headers })
    if (!res.ok) throw new Error(`GET ${path.split('?')[0]} ${res.status}`)
    return res.json()
  }
  return {
    get,
    async markSent(kind, ids) {
      if (!ids.length) return
      const res = await fetchImpl(`${cfg.url}/rest/v1/notifications_sent?on_conflict=kind,ref_id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(ids.map(ref_id => ({ kind, ref_id }))),
      })
      if (!res.ok) throw new Error(`log ${kind} ${res.status}`)
    },
    async newOnly(kind, rows) {
      if (!rows.length) return []
      const sent = await get(`/rest/v1/notifications_sent?kind=eq.${kind}&ref_id=in.(${rows.map(r => r.id).join(',')})&select=ref_id`)
      const done = new Set(sent.map(r => r.ref_id))
      return rows.filter(r => !done.has(r.id))
    },
    async emailOf(userId) {
      const res = await fetchImpl(`${cfg.url}/auth/v1/admin/users/${userId}`, { headers })
      if (!res.ok) return null
      return (await res.json()).email ?? null
    },
  }
}

const venueLine = v => (v ? `${clean(v.name)} (${clean(v.city)}${v.region ? `, ${clean(v.region)}` : ''})` : 'a venue')

/** One pass. Safe to call repeatedly. Returns a summary (used by tests and logs). */
export async function runOnce(cfg, { fetchImpl = fetch, send = makeSender(cfg, fetchImpl), log = console } = {}) {
  const summary = { adminEmails: 0, hostEmails: 0, errors: 0 }
  if (!cfg.enabled || !send) return { ...summary, skipped: true }
  const db = api(cfg, fetchImpl)
  const attempt = async (what, fn) => { try { await fn() } catch (e) { summary.errors++; log.error?.(`[notify] ${what}: ${redact(e.message)}`) } }

  // ── Admin digest: new submissions + new problem reports ──
  await attempt('admin digest', async () => {
    const mics = await db.newOnly('submission', await db.get(
      '/rest/v1/open_mics?status=eq.pending&select=id,title,day_of_week,start_time,venue:venues(name,city,region)&order=created_at'))
    const reports = await db.newOnly('report', await db.get(
      '/rest/v1/reports?status=eq.open&select=id,kind,note,open_mic:open_mics(title,venue:venues(name,city,region))&order=created_at'))
    if (!mics.length && !reports.length) return

    let to = cfg.adminEmails
    if (!to.length) {
      const admins = await db.get('/rest/v1/admins?select=user_id')
      to = (await Promise.all(admins.map(a => db.emailOf(a.user_id)))).filter(Boolean)
    }
    if (!to.length) throw new Error('no admin email (set ADMIN_EMAIL)')

    const parts = []
    if (mics.length) parts.push(`${mics.length} new submission${mics.length > 1 ? 's' : ''}`)
    if (reports.length) parts.push(`${reports.length} problem report${reports.length > 1 ? 's' : ''}`)
    const lines = []
    if (mics.length) {
      lines.push('NEW SUBMISSIONS WAITING FOR REVIEW')
      for (const m of mics) lines.push(`• ${clean(m.title)}: ${DAYS[m.day_of_week]} ${hhmm(m.start_time)} at ${venueLine(m.venue)}`)
      lines.push('')
    }
    if (reports.length) {
      lines.push('PROBLEM REPORTS')
      for (const r of reports) lines.push(`• ${REPORT_LABEL[r.kind] ?? r.kind}: ${clean(r.open_mic?.title)} at ${venueLine(r.open_mic?.venue)}${r.note ? ` — "${clean(r.note).slice(0, 200)}"` : ''}`)
      lines.push('')
    }
    lines.push(`Review them: ${cfg.siteUrl}  (sign in, then tap Review)`)
    const subject = `MicOpenly: ${parts.join(' and ')}`
    let delivered = 0
    for (const addr of to) await attempt(`send admin ${addr}`, async () => { await send({ to: addr, subject, text: lines.join('\n') }); delivered++ })
    if (delivered) {
      await db.markSent('submission', mics.map(m => m.id))
      await db.markSent('report', reports.map(r => r.id))
      summary.adminEmails = delivered
    }
  })

  // ── Hosts: new address requests, one email per host ──
  await attempt('host emails', async () => {
    const reqs = await db.newOnly('address_request', await db.get(
      '/rest/v1/address_requests?status=eq.pending&select=id,note,venue:venues(name,city,region,submitted_by)&order=created_at'))
    const byHost = new Map()
    for (const r of reqs) {
      const host = r.venue?.submitted_by
      if (!host) continue
      byHost.set(host, [...(byHost.get(host) ?? []), r])
    }
    for (const [hostId, list] of byHost) {
      await attempt(`host ${hostId}`, async () => {
        const to = await db.emailOf(hostId)
        if (!to) return
        const lines = [`${list.length === 1 ? 'Someone has' : `${list.length} people have`} asked for the exact address of a venue you host on MicOpenly.`, '']
        for (const r of list) lines.push(`• ${venueLine(r.venue)}: "${clean(r.note).slice(0, 500)}"`, '')
        lines.push('Only you and site moderators can see these notes. They are written by the person asking, so treat any links with care.',
          `Approve or decline: ${cfg.siteUrl}  (sign in, then tap My submissions)`)
        await send({ to, subject: `MicOpenly: ${list.length === 1 ? 'a request' : `${list.length} requests`} for your venue's address`, text: lines.join('\n') })
        await db.markSent('address_request', list.map(r => r.id))
        summary.hostEmails++
      })
    }
  })
  return summary
}

/** Names of the settings still needed before alerts can run (empty when ready). */
export function missingSettings(env = process.env) {
  const cfg = readConfig(env)
  return [!cfg.url && 'SUPABASE_URL (or VITE_SUPABASE_URL)', !cfg.serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !(env.RESEND_API_KEY || env.SMTP_URL) && 'RESEND_API_KEY or SMTP_URL', !env.MAIL_FROM && 'MAIL_FROM'].filter(Boolean)
}

/** Starts the timer (the caller keeps the process alive). Does nothing, and says why, if not configured. */
export function startNotifier(env = process.env, log = console) {
  const cfg = readConfig(env)
  if (!cfg.enabled) {
    log.log(`[notify] email alerts off (missing: ${missingSettings(env).join(', ')})`)
    return null
  }
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { const s = await runOnce(cfg, { log }); if (s.adminEmails || s.hostEmails) log.log(`[notify] sent admin:${s.adminEmails} host:${s.hostEmails}`) }
    catch (e) { log.error(`[notify] ${redact(e.message)}`) }
    finally { running = false }
  }
  log.log(`[notify] email alerts on, every ${Math.round(cfg.intervalMs / 1000)}s`)
  setTimeout(tick, Number(env.NOTIFY_FIRST_DELAY_MS ?? 20000))
  return setInterval(tick, cfg.intervalMs)
}
