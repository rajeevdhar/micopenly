-- Phase 1: abuse limits + duplicate-report protection. Idempotent; safe to re-run.
-- (The same statements are included at the end of supabase/schema.sql.)

-- Daily limits per signed-in user. Runs as the caller (not security definer) so that
-- current_user is the real role, and RLS lets users count their own rows.
-- Admins and server-side roles are exempt. Raises SQLSTATE 54000 which the app turns into a friendly message.
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
  else
    return new;
  end if;

  if uid is not null and n >= lim then
    raise exception 'Daily limit reached (% per 24 hours). Please try again tomorrow.', lim using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists venues_daily_limit on public.venues;
create trigger venues_daily_limit before insert on public.venues
  for each row execute function public.enforce_daily_limit();

drop trigger if exists open_mics_daily_limit on public.open_mics;
create trigger open_mics_daily_limit before insert on public.open_mics
  for each row execute function public.enforce_daily_limit();

drop trigger if exists reports_daily_limit on public.reports;
create trigger reports_daily_limit before insert on public.reports
  for each row execute function public.enforce_daily_limit();

drop trigger if exists confirmations_daily_limit on public.open_mic_confirmations;
create trigger confirmations_daily_limit before insert on public.open_mic_confirmations
  for each row execute function public.enforce_daily_limit();

-- One OPEN report per person per open mic (a resolved one doesn't block a fresh report later).
create unique index if not exists reports_one_open_per_user_idx
  on public.reports (open_mic_id, reporter_id)
  where status = 'open' and reporter_id is not null;
