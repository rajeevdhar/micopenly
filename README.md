# MicOpenly (micopenly.com)

Community-maintained map of open mics. React + Vite + Tailwind + Zustand + Leaflet on the front end, Supabase (auth + Postgres + row-level security) for data, a tiny Express server to serve the build on Railway.

> The `master` branch holds an unrelated 2014 Rails prototype. This app lives on `v1`.

## Run locally
```bash
cp .env.local.example .env.local   # add your Supabase URL + publishable key
npm install
npm run dev                        # http://localhost:5173
```
No Supabase yet? Dev-only sample listings (clearly labelled DEMO): `VITE_DEMO_DATA=1 npm run dev`.

## Database
Run `supabase/schema.sql` in the Supabase SQL editor (idempotent). Make yourself an admin:
```sql
insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
```

## Tests
`npm test` runs: recurrence logic (40), submit-form helpers (41), the schema's access rules on a real Postgres (57), the submit → review → approve loop (23), and the Phase 1 trust rules: confirmations, reports, daily limits, closing (32).

## Rules this codebase follows
- Nothing private in public tables. Select explicit column lists (`src/types.ts`), never `select('*')`.
- New listings are `pending` until an admin approves them. No scraping; listings come from users.
- "Tonight" is computed in the venue's timezone.
- Abuse limits live in the database (`enforce_daily_limit`), not just the UI: 5 venues, 10 open mics, 10 reports, 30 confirmations per user per 24 hours; admins exempt.

## Migrations
Files in `supabase/migrations/` are additive and idempotent. `supabase/schema.sql` always contains everything, so a fresh project needs only that file.

## Status
Done: map, list, filters (tonight / day / type / search), sign-in, submit form (OpenStreetMap lookup, draggable pin), admin review (approve / edit first / reject), "Still running" confirmations, problem reports with an admin queue, admin edit and close on live listings, "My submissions" with editing while pending, daily limits.
Next (Phase 2): saved mics, more filters, shareable links and link previews, near-me.


## Email alerts (separate worker service)

A second Railway service, "worker", runs `node server/worker.js` from this same repo (branch `v1`) with config file `railway.worker.json`. It checks every 2 minutes and emails the admin one digest per new submission or problem report, and each host once per batch of new address requests. It keeps the public web service free of the service-role key, which bypasses row-level security.

Set these on the **worker only**: `VITE_SUPABASE_URL` (same value as the web service), `SUPABASE_SERVICE_ROLE_KEY`, `MAIL_FROM`, `ADMIN_EMAIL`, and either `RESEND_API_KEY` or `SMTP_URL`. Run `supabase/migrations/2026-10-25_notification_log.sql` once. If anything is missing the worker exits with a message naming it. See `.env.local.example`.
