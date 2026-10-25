-- ═══ Optional: refuse sign-ups that didn't pass the 16+ check ═══
-- The sign-up form asks for a date of birth, decides yes/no in the browser, and sends only
-- { age_confirmed_16: true, age_confirmed_at: <time> } with the new account. The date itself is never sent.
-- This trigger makes the database insist on that flag, so a sign-up that skips the form (an old cached copy
-- of the site, or someone calling the API directly) is turned away too. It is self-attestation, not ID
-- verification: anyone determined can still send the flag. It only applies to NEW accounts.
--
-- Side effect to know about: accounts created by hand in the Supabase dashboard ("Add user", "Invite")
-- carry no flag and will be refused until you either pass the flag in their metadata or run:
--   alter table auth.users disable trigger require_age_confirmation;
-- To remove it completely:
--   drop trigger if exists require_age_confirmation on auth.users;
--   drop function if exists public.require_age_confirmation();

create or replace function public.require_age_confirmation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'age_confirmed_16', '') <> 'true' then
    raise exception 'You must confirm you are 16 or older to create an account.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists require_age_confirmation on auth.users;
create trigger require_age_confirmation
  before insert on auth.users
  for each row execute function public.require_age_confirmation();
