-- Apply once to a NEW Supabase project. Existing app_state tables deliberately cause an error.
-- The client uses an ISO text revision for compare-and-swap; do not replace this with
-- a timestamp column or an automatic updated_at trigger without changing the protocol.
begin;

create table public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at text not null
);

alter table public.app_state enable row level security;
revoke all on table public.app_state from public, anon, authenticated;
grant select, insert, update on table public.app_state to authenticated;

create policy app_state_select_own on public.app_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy app_state_insert_own on public.app_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy app_state_update_own on public.app_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Record deletions are synchronized inside the JSON snapshot as tombstones.
-- The client does not delete the app_state row, so no client DELETE grant is needed.
commit;
