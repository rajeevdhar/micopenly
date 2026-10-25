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
`npm test` runs the recurrence logic (40 checks) and the schema's access rules against a real Postgres (57 checks).

## Rules this codebase follows
- Nothing private in public tables. Select explicit column lists (`src/types.ts`), never `select('*')`.
- New listings are `pending` until an admin approves them. No scraping; listings come from users.
- "Tonight" is computed in the venue's timezone.

## Status
Done: schema and tests, map, list, filters (tonight / day / type / search), sign-in.
Next: submit-a-venue form, admin approval screen, confirm and report buttons.
