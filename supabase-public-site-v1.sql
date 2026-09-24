-- Rewaa Studio public website bridge
-- Run once in Supabase SQL Editor.
-- Exposes ONLY explicitly approved public client fields; no finance/contact/internal data.

create or replace function public.public_site_clients()
returns table (
  id text,
  name text,
  logo text,
  website text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(c.data->>'name','') as name,
    nullif(c.data->>'logo','') as logo,
    nullif(c.data->>'website','') as website
  from public.customers c
  where coalesce((c.data->>'active')::boolean,true)
    and coalesce((c.data->>'websiteVisible')::boolean,false)
    and coalesce(c.data->>'name','') <> ''
  order by lower(coalesce(c.data->>'name',''));
$$;

revoke all on function public.public_site_clients() from public;
grant execute on function public.public_site_clients() to anon, authenticated;

comment on function public.public_site_clients() is
  'Safe public client showcase for Rewaa website. Returns only id, name, logo and optional website for clients explicitly marked websiteVisible.';

-- Optional smoke test after running:
-- select * from public.public_site_clients();
