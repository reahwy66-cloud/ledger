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
  perms       jsonb  not null default '{"tabs":[],"edit":[],"personal":false}'::jsonb,
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
      then '{"tabs":["flow","clients","team","work","costs","calendar","outside","users","setup"],
              "edit":["clients","team","work","costs","calendar","payments","advances","outside","setup","users"],
              "personal":true}'::jsonb
      else '{"tabs":[],"edit":[],"personal":false}'::jsonb
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
language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active and (perms->>'personal')::boolean is true
  );
$$;

-- ── 3. the data ─────────────────────────────────────────────────
-- One shape for every collection: an id, a JSON body, a timestamp.
do $$
declare tname text;
begin
  foreach tname in array array[
    'customers','employees','work','payments','advances','costs','shoots','outside','projects'
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

-- ── 4. row level security ───────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.settings  enable row level security;
do $$
declare tname text;
begin
  foreach tname in array array[
    'customers','employees','work','payments','advances','costs','shoots','outside','projects'
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
      ('payments','payments'), ('advances','advances'), ('costs','costs'),
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
    'customers','employees','work','payments','advances','costs','shoots','outside','projects','settings','profiles'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', tname);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── done ────────────────────────────────────────────────────────
select 'Studio Ledger is ready. The first account you create becomes the owner.' as status;
