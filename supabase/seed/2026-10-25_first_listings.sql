-- ═══ First real listings (NYC) ═══
-- Entered from the venues' own pages or recent local reporting, then left UNVERIFIED on purpose:
-- last_verified_at stays empty, so the site shows "Not verified yet" until a host or regular taps
-- "Still running". No submitter is recorded (submitted_by is null). Safe to run more than once.
--
-- Where sources disagreed, or a required field had to be a default, the listing's public notes say so.
-- Sources (checked 2026-10-25):
--   Pete's Candy Store   venue weekly schedule post dated 2025-12-31 (petescandystore.substack.com);
--                        city guide updated Nov 2025 (donyc.com/p/top-open-mic-spots-in-nyc)
--   Otto's Shrunken Head EV Grieve, 2025-03-12 (evgrieve.com)
--   Nuyorican Open Mic   nuyorican.org/openmics ("Current Open Mics (2026)"); address from the Loisaida
--                        Center's event listing (710 E 9th St) and The Village Sun, 2024-03-15
-- Coordinates: OpenStreetMap / Nominatim lookups of each street address.

do $$
declare
  v_id uuid;
begin
  -- ── Pete's Candy Store (Williamsburg) ─────────────────────────────────────
  select id into v_id from public.venues where name = 'Pete''s Candy Store' and address = '709 Lorimer St';
  if v_id is null then
    insert into public.venues (name, address, city, region, postal_code, country, lat, lng, timezone, website_url, status)
    values ('Pete''s Candy Store', '709 Lorimer St', 'Brooklyn', 'NY', '11211', 'US', 40.7181, -73.9502,
            'America/New_York', 'https://www.petescandystore.com', 'approved')
    returning id into v_id;
  end if;
  insert into public.open_mics (venue_id, title, format, genres, day_of_week, weeks_of_month, start_time, signup_method, signup_time,
                                host_name, cost_note, age_restriction, notes, status)
  select v_id, 'Sunday Open Mic', 'music', '{singer-songwriter}', 0, '{}', '17:00', 'list_at_door', '16:00',
         'Bruce Martin', 'Free to attend, $10 suggested donation. One-drink minimum to perform.', '21_plus',
         'The sign-up time differs by source: the venue''s weekly schedule says 4pm, a November 2025 city guide says 3pm. Please confirm before you go.',
         'approved'
  where not exists (select 1 from public.open_mics where venue_id = v_id and day_of_week = 0 and start_time = '17:00' and weeks_of_month = '{}');

  -- ── Otto's Shrunken Head (East Village) ───────────────────────────────────
  select id into v_id from public.venues where name = 'Otto''s Shrunken Head' and address = '538 E 14th St';
  if v_id is null then
    insert into public.venues (name, address, city, region, postal_code, country, lat, lng, timezone, website_url, status)
    values ('Otto''s Shrunken Head', '538 E 14th St', 'New York', 'NY', '10009', 'US', 40.7295, -73.9786,
            'America/New_York', 'https://www.ottosshrunkenhead.com', 'approved')
    returning id into v_id;
  end if;
  insert into public.open_mics (venue_id, title, format, genres, day_of_week, weeks_of_month, start_time, signup_method,
                                host_name, age_restriction, notes, status)
  select v_id, 'Wednesday Open Mic', 'music', '{}', 3, '{}', '18:00', 'list_at_door',
         'Dave', '21_plus',
         'Starts at 8pm instead of 6pm on the first Wednesday of each month. Mostly original music with some covers. Details are from a March 2025 local news report, so the host may have changed. The age limit is not confirmed.',
         'approved'
  where not exists (select 1 from public.open_mics where venue_id = v_id and day_of_week = 3 and start_time = '18:00' and weeks_of_month = '{}');

  -- ── The Nuyorican Open Mic, held at the Loisaida Center (East Village) ────
  select id into v_id from public.venues where name = 'Loisaida Center' and address = '710 E 9th St';
  if v_id is null then
    insert into public.venues (name, address, city, region, postal_code, country, lat, lng, timezone, website_url, status)
    values ('Loisaida Center', '710 E 9th St', 'New York', 'NY', '10009', 'US', 40.7249, -73.9775,
            'America/New_York', 'https://www.nuyorican.org/openmics', 'approved')
    returning id into v_id;
  end if;
  insert into public.open_mics (venue_id, title, format, genres, day_of_week, weeks_of_month, start_time, signup_method,
                                cost_note, age_restriction, notes, status)
  select v_id, 'The Nuyorican Open Mic', 'poetry', '{poetry,music,storytelling}', 3, '{2,3,4,5}', '18:30', 'list_at_door',
         '$10 in person. Also livestreamed on YouTube.', 'all_ages',
         'Every Wednesday except the first of the month, when the ticketed Womxn Orator Wednesday (W.o.W.) open mic takes its place. Check in in person; arrive early. The age policy is not confirmed.',
         'approved'
  where not exists (select 1 from public.open_mics where venue_id = v_id and day_of_week = 3 and start_time = '18:30' and weeks_of_month = '{2,3,4,5}');
end $$;
