-- ═══════════════════════════════════════════════════════════════════════════
-- micopenly.com — schema v1 (Supabase / Postgres)
--
-- Design rules (learned from musicianmapper):
--   1. Everything in the public tables is safe for ANYONE to read. No emails,
--      phones or account details live here. Nothing private is ever added to
--      venues / open_mics.
--   2. Listings are community-submitted and moderated: new rows are 'pending'
--      and invisible to the public until an admin approves them.
--   3. Clients always select an explicit column list, never select('*').
--   4. Staleness is a first-class problem: last_verified_at + user
--      confirmations + reports.
--
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Admins ──────────────────────────────────────────────────────────────────
-- RLS is on with NO policies, so clients can't read or write this table at all.
-- Add yourself once, from the SQL editor:
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Venues ──────────────────────────────────────────────────────────────────
create table if not exists public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  address       text not null check (char_length(address) between 1 and 200),
  city          text not null check (char_length(city) between 1 and 100),
  region        text,                              -- state / province
  postal_code   text,
  country       text not null default 'US',
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  timezone      text not null default 'America/New_York',   -- IANA name; "tonight" is computed here
  website_url   text,
  instagram_url text,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'closed')),
  submitted_by  uuid references auth.users(id) on delete set null,  -- a random UUID; no profile table exists
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists venues_geo_idx
  on public.venues (lat, lng) where status = 'approved';

drop trigger if exists venues_updated_at on public.venues;
create trigger venues_updated_at before update on public.venues
  for each row execute function public.set_updated_at();

-- ── Open mics (one row per recurring night at a venue) ─────────────────────
-- Recurrence model (option A): day_of_week + weeks_of_month.
--   weeks_of_month = '{}'          → every week
--   weeks_of_month = '{1,3}'       → 1st and 3rd of the month
--   weeks_of_month = '{-1}'        → last one of the month
-- Anything odder ("every other week") goes in `notes`.
create table if not exists public.open_mics (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues(id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 120),
  format           text not null default 'music'
                     check (format in ('music', 'comedy', 'poetry', 'variety', 'other')),
  genres           text[] not null default '{}',
  day_of_week      smallint not null check (day_of_week between 0 and 6),   -- 0 = Sunday
  weeks_of_month   smallint[] not null default '{}'
                     check (weeks_of_month <@ array[-1, 1, 2, 3, 4, 5]::smallint[]),
  start_time       time not null,                                           -- local time at the venue
  end_time         time,
  signup_method    text not null default 'other'
                     check (signup_method in ('list_at_door', 'sheet_in_advance', 'online', 'message_host', 'walk_in', 'other')),
  signup_time      time,                                                    -- when the list opens
  signup_url       text,
  slot_minutes     smallint check (slot_minutes between 1 and 120),
  host_name        text check (char_length(host_name) <= 100),
  house_gear       text check (char_length(house_gear) <= 300),             -- "PA, 2 mics, keyboard"
  cost_note        text check (char_length(cost_note) <= 200),
  age_restriction  text not null default 'all_ages'
                     check (age_restriction in ('all_ages', '18_plus', '21_plus')),
  notes            text check (char_length(notes) <= 1000),
  starts_on        date,                                                    -- optional seasonal window
  ends_on          date,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'closed')),
  last_verified_at timestamptz,
  submitted_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists open_mics_venue_idx on public.open_mics (venue_id);
create index if not exists open_mics_day_idx   on public.open_mics (day_of_week) where status = 'approved';
-- Stop duplicate submissions of the same night
create unique index if not exists open_mics_no_dupes_idx
  on public.open_mics (venue_id, day_of_week, start_time, weeks_of_month)
  where status in ('pending', 'approved');

drop trigger if exists open_mics_updated_at on public.open_mics;
create trigger open_mics_updated_at before update on public.open_mics
  for each row execute function public.set_updated_at();

-- Only admins / the server / the confirmation trigger may set last_verified_at.
-- (RLS already stops normal users setting `status`.)
create or replace function public.guard_listing_columns()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1
     or current_user in ('postgres', 'service_role', 'supabase_admin')
     or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.last_verified_at := null;
  else
    new.last_verified_at := old.last_verified_at;
  end if;
  return new;
end;
$$;

drop trigger if exists open_mics_guard on public.open_mics;
create trigger open_mics_guard before insert or update on public.open_mics
  for each row execute function public.guard_listing_columns();

-- ── "Still running" confirmations (staleness) ──────────────────────────────
create table if not exists public.open_mic_confirmations (
  id            uuid primary key default gen_random_uuid(),
  open_mic_id   uuid not null references public.open_mics(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  confirmed_on  date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (open_mic_id, user_id, confirmed_on)
);

create or replace function public.apply_confirmation()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  update public.open_mics set last_verified_at = now() where id = new.open_mic_id;
  return new;
end;
$$;

drop trigger if exists confirmations_apply on public.open_mic_confirmations;
create trigger confirmations_apply after insert on public.open_mic_confirmations
  for each row execute function public.apply_confirmation();

-- ── Reports (closed / moved / wrong info / spam) ───────────────────────────
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  open_mic_id  uuid not null references public.open_mics(id) on delete cascade,
  reporter_id  uuid references auth.users(id) on delete set null,
  kind         text not null check (kind in ('closed', 'moved', 'wrong_time', 'wrong_info', 'spam', 'other')),
  note         text check (char_length(note) <= 1000),
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by  uuid references auth.users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists reports_open_idx on public.reports (status, created_at);

-- ── Saved open mics (a real foreign key, unlike musicianmapper's TEXT id) ──
create table if not exists public.saved_open_mics (
  user_id      uuid not null references auth.users(id) on delete cascade,
  open_mic_id  uuid not null references public.open_mics(id) on delete cascade,
  note         text not null default '' check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  primary key (user_id, open_mic_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.venues                 enable row level security;
alter table public.open_mics              enable row level security;
alter table public.open_mic_confirmations enable row level security;
alter table public.reports                enable row level security;
alter table public.saved_open_mics        enable row level security;

-- Venues ────────────────────────────────────────────────────────────────────
drop policy if exists venues_select        on public.venues;
drop policy if exists venues_insert        on public.venues;
drop policy if exists venues_update_owner  on public.venues;
drop policy if exists venues_update_admin  on public.venues;
drop policy if exists venues_delete_admin  on public.venues;

-- Public sees approved only; submitters also see their own pending ones; admins see all.
create policy venues_select on public.venues for select
  using (status = 'approved' or submitted_by = auth.uid() or public.is_admin());

-- Signed-in users can submit, always as 'pending', always as themselves.
create policy venues_insert on public.venues for insert
  with check (auth.uid() is not null and submitted_by = auth.uid() and status = 'pending');

-- Submitters can fix their own listing only while it's still pending (they can't self-approve).
create policy venues_update_owner on public.venues for update
  using (submitted_by = auth.uid() and status = 'pending')
  with check (submitted_by = auth.uid() and status = 'pending');

create policy venues_update_admin on public.venues for update
  using (public.is_admin()) with check (public.is_admin());

create policy venues_delete_admin on public.venues for delete
  using (public.is_admin());

-- Open mics ─────────────────────────────────────────────────────────────────
drop policy if exists open_mics_select        on public.open_mics;
drop policy if exists open_mics_insert        on public.open_mics;
drop policy if exists open_mics_update_owner  on public.open_mics;
drop policy if exists open_mics_update_admin  on public.open_mics;
drop policy if exists open_mics_delete_admin  on public.open_mics;

create policy open_mics_select on public.open_mics for select
  using (
    (status = 'approved'
       and exists (select 1 from public.venues v where v.id = venue_id and v.status = 'approved'))
    or submitted_by = auth.uid()
    or public.is_admin()
  );

create policy open_mics_insert on public.open_mics for insert
  with check (
    auth.uid() is not null
    and submitted_by = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.venues v
                where v.id = venue_id and (v.status = 'approved' or v.submitted_by = auth.uid()))
  );

create policy open_mics_update_owner on public.open_mics for update
  using (submitted_by = auth.uid() and status = 'pending')
  with check (submitted_by = auth.uid() and status = 'pending');

create policy open_mics_update_admin on public.open_mics for update
  using (public.is_admin()) with check (public.is_admin());

create policy open_mics_delete_admin on public.open_mics for delete
  using (public.is_admin());

-- Confirmations ─────────────────────────────────────────────────────────────
drop policy if exists confirmations_insert on public.open_mic_confirmations;
drop policy if exists confirmations_select on public.open_mic_confirmations;

create policy confirmations_insert on public.open_mic_confirmations for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.open_mics m where m.id = open_mic_id and m.status = 'approved')
  );
create policy confirmations_select on public.open_mic_confirmations for select
  using (user_id = auth.uid() or public.is_admin());

-- Reports ───────────────────────────────────────────────────────────────────
drop policy if exists reports_insert       on public.reports;
drop policy if exists reports_select       on public.reports;
drop policy if exists reports_update_admin on public.reports;

create policy reports_insert on public.reports for insert
  with check (
    auth.uid() is not null
    and reporter_id = auth.uid()
    and status = 'open'
    and exists (select 1 from public.open_mics m where m.id = open_mic_id and m.status = 'approved')
  );
create policy reports_select on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());
create policy reports_update_admin on public.reports for update
  using (public.is_admin()) with check (public.is_admin());

-- Saved ─────────────────────────────────────────────────────────────────────
drop policy if exists saved_owner_all on public.saved_open_mics;
create policy saved_owner_all on public.saved_open_mics for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
