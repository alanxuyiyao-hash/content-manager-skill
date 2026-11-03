-- Run only in a disposable test project after the migration. Everything rolls back.
begin;
insert into auth.users (id) values
  ('d0c00000-0000-4000-8000-000000000001'),
  ('d0c00000-0000-4000-8000-000000000002');
insert into public.app_state(user_id, data, updated_at) values
  ('d0c00000-0000-4000-8000-000000000002', '{"projects":[]}', '2026-11-03T00:00:00.000Z');

do $$ begin
  if has_table_privilege('anon', 'public.app_state', 'SELECT')
     or has_table_privilege('anon', 'public.app_state', 'INSERT')
     or has_table_privilege('anon', 'public.app_state', 'UPDATE')
     or has_table_privilege('anon', 'public.app_state', 'DELETE') then
    raise exception 'Anonymous role unexpectedly has access';
  end if;
  if has_table_privilege('authenticated', 'public.app_state', 'DELETE') then
    raise exception 'Client can unexpectedly delete a snapshot';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0c00000-0000-4000-8000-000000000001', true);
do $$ declare affected integer; begin
  if (select count(*) from public.app_state) <> 0 then
    raise exception 'User A can read user B';
  end if;
  insert into public.app_state(user_id, data, updated_at) values
    ('d0c00000-0000-4000-8000-000000000001', '{"projects":[]}', '2026-11-03T00:00:00.000Z');
  if (select count(*) from public.app_state) <> 1 then
    raise exception 'User A cannot read own inserted row';
  end if;
  update public.app_state set updated_at = '2026-11-03T00:00:01.000Z'
    where user_id = 'd0c00000-0000-4000-8000-000000000001'
      and updated_at = '2026-11-03T00:00:00.000Z';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own CAS update failed'; end if;
  update public.app_state set data = '{"unexpected":true}'
    where user_id = 'd0c00000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'User A updated user B'; end if;
  begin
    insert into public.app_state(user_id, data, updated_at) values
      ('d0c00000-0000-4000-8000-000000000002', '{}', 'test');
    raise exception 'Cross-user insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.app_state set user_id = 'd0c00000-0000-4000-8000-000000000002';
    raise exception 'Ownership transfer unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0c00000-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from public.app_state) <> 1
     or exists(select 1 from public.app_state where user_id <> 'd0c00000-0000-4000-8000-000000000002') then
    raise exception 'User B visibility is incorrect';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.app_state;
    raise exception 'Anonymous SELECT unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
