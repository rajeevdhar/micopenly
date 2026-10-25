-- ═══ Phase 2a: hidden exact locations + address requests ═══
-- A host can keep a venue's exact address private (house shows, vetted rooms).
-- The public venues row then carries only a town-level pin and a placeholder address;
-- the real address lives in venue_private, readable only by the person who submitted the
-- venue, admins, and people the host has approved. Additive and safe to re-run.

alter table public.venues add column if not exists location_hidden boolean not null default false;

-- The database itself guarantees a hidden venue's PUBLIC row is coarse: placeholder address,
-- no ZIP, coordinates rounded to 2 decimals (~1 km). A buggy or hostile client can't put a
-- street address or a precise pin into the public table when location_hidden is true.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'venues_hidden_is_coarse') then
    alter table public.venues add constraint venues_hidden_is_coarse check (
      not location_hidden or (
        address = 'Address shared on request'
        and postal_code is null
        and round(lat::numeric, 2)::double precision = lat
        and round(lng::numeric, 2)::double precision = lng
      )
    );
  end if;
end $$;

-- ── The real address (private) ─────────────────────────────────────────────
create table if not exists public.venue_private (
  venue_id    uuid primary key references public.venues(id) on delete cascade,
  address     text not null check (char_length(address) between 1 and 200),
  postal_code text,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  updated_at  timestamptz not null default now()
);

drop trigger if exists venue_private_updated_at on public.venue_private;
create trigger venue_private_updated_at before update on public.venue_private
  for each row execute function public.set_updated_at();

-- ── Address requests: "may I come?" ────────────────────────────────────────
-- One request per person per venue, ever (a decline is final, which also stops badgering).
create table if not exists public.address_requests (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  note          text not null check (char_length(note) between 10 and 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (venue_id, requester_id)
);
create index if not exists address_requests_venue_idx on public.address_requests (venue_id, status);

alter table public.venue_private    enable row level security;
alter table public.address_requests enable row level security;

-- venue_private ─────────────────────────────────────────────────────────────
drop policy if exists venue_private_select on public.venue_private;
drop policy if exists venue_private_insert on public.venue_private;
drop policy if exists venue_private_update on public.venue_private;
drop policy if exists venue_private_delete on public.venue_private;

-- Who can read the real address: admins, the person who submitted the venue, and anyone the host approved.
create policy venue_private_select on public.venue_private for select
  using (
    public.is_admin()
    or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid())
    or exists (
      select 1
      from public.address_requests r
      join public.venues v on v.id = r.venue_id
      where r.venue_id = venue_private.venue_id and r.requester_id = auth.uid()
        and r.status = 'approved' and v.status = 'approved' and v.location_hidden
    )
  );

-- Written by the submitter while the venue is still pending (like the venue itself), or by an admin.
create policy venue_private_insert on public.venue_private for insert
  with check (
    public.is_admin()
    or (auth.uid() is not null and exists (
      select 1 from public.venues v
      where v.id = venue_id and v.submitted_by = auth.uid() and v.status = 'pending' and v.location_hidden))
  );
create policy venue_private_update on public.venue_private for update
  using (
    public.is_admin()
    or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid() and v.status = 'pending')
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid() and v.status = 'pending' and v.location_hidden)
  );
create policy venue_private_delete on public.venue_private for delete
  using (
    public.is_admin()
    or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid() and v.status = 'pending')
  );

-- address_requests ──────────────────────────────────────────────────────────
drop policy if exists address_requests_select on public.address_requests;
drop policy if exists address_requests_insert on public.address_requests;
drop policy if exists address_requests_decide on public.address_requests;

-- You see your own requests; the host (venue submitter) sees requests for their venues; admins see all.
create policy address_requests_select on public.address_requests for select
  using (
    requester_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid())
  );

-- Ask as yourself, as 'pending', about an approved hidden venue that isn't yours.
create policy address_requests_insert on public.address_requests for insert
  with check (
    auth.uid() is not null
    and requester_id = auth.uid()
    and status = 'pending'
    and decided_at is null
    and exists (
      select 1 from public.venues v
      where v.id = venue_id and v.status = 'approved' and v.location_hidden
        and v.submitted_by is distinct from auth.uid())
  );

-- Only the host or an admin decides, and only to 'approved' or 'declined'.
create policy address_requests_decide on public.address_requests for update
  using (public.is_admin() or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid()))
  with check (
    status in ('approved', 'declined')
    and (public.is_admin() or exists (select 1 from public.venues v where v.id = venue_id and v.submitted_by = auth.uid()))
  );

-- A decision may change status only; who asked, what they wrote, and the venue are frozen.
create or replace function public.guard_address_request()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if new.venue_id <> old.venue_id or new.requester_id <> old.requester_id
     or new.note <> old.note or new.created_at <> old.created_at then
    raise exception 'Only the decision can be changed.' using errcode = '42501';
  end if;
  new.decided_at := now();
  return new;
end;
$$;

drop trigger if exists address_requests_guard on public.address_requests;
create trigger address_requests_guard before update on public.address_requests
  for each row execute function public.guard_address_request();

-- Daily limit for requests (10 per 24h), added to the shared limiter.
create or replace function public.enforce_daily_limit()
returns trigger language plpgsql as $$
declare
  uid uuid;
  n   int := 0;
  lim int;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;

  if tg_table_name = 'venues' then
    lim := 5;  uid := new.submitted_by;
    select count(*) into n from public.venues where submitted_by = uid and created_at > now() - interval '24 hours';
  elsif tg_table_name = 'open_mics' then
    lim := 10; uid := new.submitted_by;
    select count(*) into n from public.open_mics where submitted_by = uid and created_at > now() - interval '24 hours';
  elsif tg_table_name = 'reports' then
    lim := 10; uid := new.reporter_id;
    select count(*) into n from public.reports where reporter_id = uid and created_at > now() - interval '24 hours';
  elsif tg_table_name = 'open_mic_confirmations' then
    lim := 30; uid := new.user_id;
    select count(*) into n from public.open_mic_confirmations where user_id = uid and created_at > now() - interval '24 hours';
  elsif tg_table_name = 'address_requests' then
    lim := 10; uid := new.requester_id;
    select count(*) into n from public.address_requests where requester_id = uid and created_at > now() - interval '24 hours';
  else
    return new;
  end if;

  if uid is not null and n >= lim then
    raise exception 'Daily limit reached (% per 24 hours). Please try again tomorrow.', lim using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists address_requests_daily_limit on public.address_requests;
create trigger address_requests_daily_limit before insert on public.address_requests
  for each row execute function public.enforce_daily_limit();
