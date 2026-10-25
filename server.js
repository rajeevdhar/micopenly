// Static file server for the built app. No secrets and no service-role key live here:
// all data access goes browser → Supabase, gated by row-level security (supabase/schema.sql).
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const app = express()

app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`micopenly listening on ${port}`))
