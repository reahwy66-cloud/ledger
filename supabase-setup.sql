-- ═══════════════════════════════════════════════════════════════
--  STUDIO LEDGER — database setup
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. who can use the app ──────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'staff',   -- 'owner' | 'staff'
  active      boolean not null default false,  -- owner switches this on
  perms       jsonb  not null default '{"tabs":[],"edit":[],"finance":false,"personal":false}'::jsonb,
  created_at  timestamptz not null default now()
);

-- first person to sign up becomes the owner; everyone after waits for approval
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, email, name, role, active, perms)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when n = 0 then 'owner' else 'staff' end,
    n = 0,
    case when n = 0
      then '{"tabs":["flow","ledger","clients","invoices","funding","team","work","costs","calendar","setup"],
              "edit":["clients","invoices","funding","team","work","costs","calendar","payments","advances","setup"],
              "finance":true,
              "personal":true}'::jsonb
      else '{"tabs":[],"edit":[],"finance":false,"personal":false}'::jsonb
    end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. permission helpers (used by every policy below) ──────────
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'owner' and active);
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.can_edit(sec text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active and perms->'edit' ? sec
  );
$$;

create or replace function public.sees_personal() returns boolean
language sql stable security definer set search_path = public as $
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active and (perms->>'personal')::boolean is true
  );
$;

create or replace function public.can_see_finance() returns boolean
language sql stable security definer set search_path = public as $
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active and coalesce((perms->>'finance')::boolean,false) is true
  );
$;

-- ── 3. the data ─────────────────────────────────────────────────
-- One shape for every collection: an id, a JSON body, a timestamp.
do $$
declare tname text;
begin
  foreach tname in array array[
    'customers','employees','work','payments','invoices','fundings','advances','payouts','costs','shoots','outside','projects',
    'osadvances','debts','transfers','notifications'
  ] loop
    execute format($f$
      create table if not exists public.%I (
        id          text primary key,
        data        jsonb not null,
        updated_at  timestamptz not null default now(),
        updated_by  uuid references auth.users(id)
      );
    $f$, tname);
  end loop;
end $$;

create table if not exists public.settings (
  id          int primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- Immutable audit trail for changes made by the MCP connector or other trusted services.
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  resource    text not null,
  record_id   text,
  actor       text not null default 'system',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ── 4. row level security ───────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.settings  enable row level security;
alter table public.audit_log enable row level security;
do $$
declare tname text;
begin
  foreach tname in array array[
    'customers','employees','work','payments','invoices','fundings','advances','payouts','costs','shoots','outside','projects',
    'osadvances','debts','transfers','notifications'
  ] loop
    execute format('alter table public.%I enable row level security;', tname);
  end loop;
end $$;

-- profiles: everyone active sees the team; only the owner changes anything
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_self   on public.profiles;
drop policy if exists profiles_owner  on public.profiles;
create policy profiles_read  on public.profiles for select
  using (id = auth.uid() or public.is_active());
create policy profiles_owner on public.profiles for all
  using (public.is_owner()) with check (public.is_owner());

-- settings: everyone active reads, only setup-editors write
drop policy if exists settings_read on public.settings;
drop policy if exists settings_write on public.settings;
create policy settings_read  on public.settings for select using (public.is_active());
create policy settings_write on public.settings for all
  using (public.can_edit('setup')) with check (public.can_edit('setup'));

-- shared company data: active members read; writing needs the matching permission
do $$
declare r record;
begin
  for r in select * from (values
      ('customers','clients'), ('employees','team'),   ('work','work'),
      ('payments','payments'), ('invoices','invoices'), ('fundings','funding'), ('advances','advances'), ('payouts','advances'), ('costs','costs'),
      ('osadvances','outside'), ('debts','outside'), ('transfers','outside'), ('notifications','calendar'),
      ('shoots','calendar')
  ) as t(tbl, sec) loop
    execute format('drop policy if exists %I on public.%I;', r.tbl||'_read',  r.tbl);
    execute format('drop policy if exists %I on public.%I;', r.tbl||'_write', r.tbl);
    execute format(
      'create policy %I on public.%I for select using (public.is_active());',
      r.tbl||'_read', r.tbl);
    execute format(
      'create policy %I on public.%I for all using (public.can_edit(%L)) with check (public.can_edit(%L));',
      r.tbl||'_write', r.tbl, r.sec, r.sec);
  end loop;
end $$;

-- Only the owner can inspect the audit trail. Trusted connector writes use the
-- server-side service role and are therefore not exposed to browsers.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select using (public.is_owner());

-- THE PRIVATE ONES.
-- The owner's outside income and side projects are hidden in the database itself,
-- not just in the interface. A hidden tab can be worked around; this cannot.
do $$
declare tname text;
begin
  foreach tname in array array['outside','projects'] loop
    execute format('drop policy if exists %I on public.%I;', tname||'_read',  tname);
    execute format('drop policy if exists %I on public.%I;', tname||'_write', tname);
    execute format(
      'create policy %I on public.%I for select using (public.sees_personal());',
      tname||'_read', tname);
    execute format(
      'create policy %I on public.%I for all using (public.can_edit(''outside'')) with check (public.can_edit(''outside''));',
      tname||'_write', tname);
  end loop;
end $$;

-- ── 5. live updates for everyone at once ────────────────────────
do $$
declare tname text;
begin
  foreach tname in array array[
    'customers','employees','work','payments','invoices','fundings','advances','payouts','costs','shoots','outside','projects',
    'osadvances','debts','transfers','notifications','settings','profiles','audit_log'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', tname);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── done ────────────────────────────────────────────────────────
select 'رِواء ستوديو is ready. The first account you create becomes the owner.' as status;


-- ═══════════════════════════════════════════════════════════════
-- PERMISSIONS V3 EMBEDDED — finance visibility + safe staff RPCs
-- ═══════════════════════════════════════════════════════════════
create or replace function public.can_see_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active
      and coalesce((perms->>'finance')::boolean,false) is true
  );
$$;

-- A sanitized snapshot for active staff who may operate the app but must not
-- receive financial values in the browser at all.
create or replace function public.staff_safe_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb;
begin
  if not public.is_active() then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'customers', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'name', data->>'name',
        'active', data->'active',
        'note', data->>'note'
      )) order by coalesce(data->>'name',''))
      from public.customers
    ), '[]'::jsonb),

    'employees', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'name', data->>'name',
        'role', data->>'role',
        'active', data->'active'
      )) order by coalesce(data->>'name',''))
      from public.employees
    ), '[]'::jsonb),

    'work', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'date', data->>'date',
        'customerId', data->>'customerId',
        'type', data->>'type',
        'qty', data->'qty',
        'editorId', data->>'editorId',
        'note', data->>'note'
      )) order by coalesce(data->>'date',''))
      from public.work
    ), '[]'::jsonb),

    'payments', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'date', data->>'date',
        'customerId', data->>'customerId',
        'kind', coalesce(data->>'kind','payment'),
        'method', data->>'method',
        'note', data->>'note'
      )) order by coalesce(data->>'date',''))
      from public.payments
    ), '[]'::jsonb),

    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object('id',id) || data order by coalesce(data->>'date',''),coalesce(data->>'time',''))
      from public.shoots
    ), '[]'::jsonb),

    'settings', coalesce((
      select jsonb_strip_nulls(jsonb_build_object(
        'company', data->>'company',
        'dayCapacity', data->'dayCapacity',
        'offDay', data->'offDay'
      ))
      from public.settings where id=1
    ), '{}'::jsonb)
  ) into out;

  return out;
end $$;

grant execute on function public.staff_safe_snapshot() to authenticated;

-- Staff can save delivery metadata while monetary overrides stay server-private.
create or replace function public.staff_save_work(p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  rid text;
  safe jsonb;
begin
  if not public.can_edit('work') then
    raise exception 'not_authorized';
  end if;

  rid := coalesce(nullif(p->>'id',''), gen_random_uuid()::text);
  safe := jsonb_strip_nulls(jsonb_build_object(
    'date', p->>'date',
    'customerId', p->>'customerId',
    'type', p->>'type',
    'qty', p->'qty',
    'editorId', p->>'editorId',
    'note', p->>'note'
  ));

  if exists(select 1 from public.work where id=rid) then
    update public.work
      set data = data || safe,
          updated_at = now(),
          updated_by = auth.uid()
      where id=rid;
  else
    insert into public.work(id,data,updated_at,updated_by)
      values(rid, safe || '{"amount":"","charge":""}'::jsonb, now(), auth.uid());
  end if;

  return rid;
end $$;

create or replace function public.staff_delete_work(p_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('work') then
    raise exception 'not_authorized';
  end if;
  delete from public.work where id=p_id;
end $$;

-- Staff may record a received payment, but the amount is not returned by
-- staff_safe_snapshot afterwards.
create or replace function public.staff_add_payment(p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  rid text;
  safe jsonb;
begin
  if not public.can_edit('payments') then
    raise exception 'not_authorized';
  end if;

  rid := coalesce(nullif(p->>'id',''), gen_random_uuid()::text);
  safe := jsonb_strip_nulls(jsonb_build_object(
    'date', p->>'date',
    'customerId', p->>'customerId',
    'kind', 'payment',
    'amount', p->'amount',
    'method', p->>'method',
    'note', p->>'note'
  ));

  insert into public.payments(id,data,updated_at,updated_by)
    values(rid,safe,now(),auth.uid())
  on conflict(id) do nothing;

  return rid;
end $$;

grant execute on function public.staff_save_work(jsonb) to authenticated;
grant execute on function public.staff_delete_work(text) to authenticated;
grant execute on function public.staff_add_payment(jsonb) to authenticated;

-- Finance-bearing tables: direct browser reads and writes require Finance.
-- Operational staff use the narrow SECURITY DEFINER RPCs above for work/payments.
do $
declare r record;
begin
  for r in select * from (values
    ('customers','clients'),
    ('employees','team'),
    ('work','work'),
    ('payments','payments'),
    ('invoices','invoices'),
    ('fundings','funding'),
    ('advances','advances'),
    ('payouts','advances'),
    ('costs','costs'),
    ('transfers','outside')
  ) as x(tbl,sec) loop
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_read',r.tbl);
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_write',r.tbl);
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_insert',r.tbl);
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_update',r.tbl);
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_delete',r.tbl);

    execute format(
      'create policy %I on public.%I for select using (public.can_see_finance());',
      r.tbl||'_read',r.tbl
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.can_see_finance() and public.can_edit(%L));',
      r.tbl||'_insert',r.tbl,r.sec
    );
    execute format(
      'create policy %I on public.%I for update using (public.can_see_finance() and public.can_edit(%L)) with check (public.can_see_finance() and public.can_edit(%L));',
      r.tbl||'_update',r.tbl,r.sec,r.sec
    );
    execute format(
      'create policy %I on public.%I for delete using (public.can_see_finance() and public.can_edit(%L));',
      r.tbl||'_delete',r.tbl,r.sec
    );
  end loop;
end $;

-- Settings may contain cash/rent configuration, so staff receives only the
-- sanitized subset through staff_safe_snapshot.
drop policy if exists settings_read on public.settings;
drop policy if exists settings_write on public.settings;
create policy settings_read on public.settings for select
  using (public.can_see_finance());
create policy settings_write on public.settings for all
  using (public.can_see_finance() and public.can_edit('setup'))
  with check (public.can_see_finance() and public.can_edit('setup'));

-- Appointments are operational, not financial.
drop policy if exists shoots_read on public.shoots;
drop policy if exists shoots_write on public.shoots;
create policy shoots_read on public.shoots for select using (public.is_active());
create policy shoots_write on public.shoots for all
  using (public.can_edit('calendar')) with check (public.can_edit('calendar'));

