// Static file server for the built app. All browser data access goes browser → Supabase, gated by
// row-level security (supabase/schema.sql). The one server-side job is the email notifier
// (server/notify.js), which uses the service-role key ONLY if SUPABASE_SERVICE_ROLE_KEY is set here.
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startNotifier } from './server/notify.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const app = express()

app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`micopenly listening on ${port}`)
  startNotifier()
})
