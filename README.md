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
`npm test` runs: recurrence logic (40), submit-form helpers (60), place names (36), pin spreading (10), the age check (30), distance helpers (12), the schema's access rules on a real Postgres (57), the submit → review → approve loop (23), the Phase 1 trust rules: confirmations, reports, daily limits, closing (32), private addresses (57), email alerts (45), and the optional database age check (13).

## Rules this codebase follows
- Nothing private in public tables. Select explicit column lists (`src/types.ts`), never `select('*')`.
- New listings are `pending` until an admin approves them. No scraping; listings come from users.
- "Tonight" is computed in the venue's timezone.
- Accounts are for people 16 and older. The sign-up form asks for a date of birth, checks it in the browser (`src/lib/age.ts`), and sends only `age_confirmed_16: true` with the new account. The date itself is never sent or stored. After a failed check the form stays closed in that browser. It is self-attestation, not ID verification.
- "Near me" runs entirely in the browser (`src/lib/geo.ts`). The visitor's position is kept in memory only and is never sent or saved.
- Abuse limits live in the database (`enforce_daily_limit`), not just the UI: 5 venues, 10 open mics, 10 reports, 30 confirmations per user per 24 hours; admins exempt.

## Migrations
Files in `supabase/migrations/` are additive and idempotent. `supabase/schema.sql` always contains everything, so a fresh project needs only that file.

**Optional, not in `schema.sql`:** `2026-10-25_age_gate.sql` makes the database refuse any new sign-up that lacks the `age_confirmed_16` flag (old cached copies of the site, direct API calls). Accounts created by hand in the Supabase dashboard also lack the flag and are refused while it is on; the file explains how to disable or remove it. Run it only if you want that.

## Status
Done: map, list, filters (tonight / day / type / search), sign-in, submit form (OpenStreetMap lookup, draggable pin), admin review (approve / edit first / reject), "Still running" confirmations, problem reports with an admin queue, admin edit and close on live listings, "My submissions" with editing while pending, daily limits.
Also done: near-me (sort by distance), "Tonight / Coming up" grouping, a first-visit introduction, a 16+ age check at sign-up.
Next (Phase 2): saved mics, shareable links and link previews, seeded real listings.


## Email alerts (separate worker service)

A second Railway service, "worker", runs `node server/worker.js` from this same repo (branch `v1`) with config file `railway.worker.json`. It checks every 2 minutes and emails the admin one digest per new submission or problem report, and each host once per batch of new address requests. It keeps the public web service free of the service-role key, which bypasses row-level security.

Set these on the **worker only**: `VITE_SUPABASE_URL` (same value as the web service), `SUPABASE_SERVICE_ROLE_KEY`, `MAIL_FROM`, `ADMIN_EMAIL`, and either `RESEND_API_KEY` or `SMTP_URL`. Run `supabase/migrations/2026-10-25_notification_log.sql` once. If anything is missing the worker exits with a message naming it. See `.env.local.example`.
