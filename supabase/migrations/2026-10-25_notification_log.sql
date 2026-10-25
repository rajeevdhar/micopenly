-- ═══ Phase 2b: email alert log ═══
-- Remembers which submissions / reports / address requests have already been emailed about,
-- so the server's notifier never sends the same alert twice. Row-level security is ON with NO
-- policies: browsers (anon / signed-in users) can neither read nor write it. Only the server's
-- service-role key, which bypasses RLS, touches this table.
create table if not exists public.notifications_sent (
  kind     text not null check (kind in ('submission', 'report', 'address_request')),
  ref_id   uuid not null,
  sent_at  timestamptz not null default now(),
  primary key (kind, ref_id)
);
alter table public.notifications_sent enable row level security;
