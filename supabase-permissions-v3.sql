-- Riwa Studio — Permissions V3
-- Apply once in Supabase SQL Editor.
-- Safe to run more than once.

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

-- Finance-bearing tables: only finance-enabled users can SELECT them directly.
-- Work and payments remain writable to staff through the RPCs above.
do $$
declare r record;
begin
  for r in select * from (values
    ('customers','clients',true),
    ('employees','team',true),
    ('work','work',false),
    ('payments','payments',false),
    ('invoices','invoices',true),
    ('fundings','funding',true),
    ('advances','advances',true),
    ('payouts','advances',true),
    ('costs','costs',true),
    ('transfers','outside',true)
  ) as x(tbl,sec,finance_write) loop
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_read',r.tbl);
    execute format('drop policy if exists %I on public.%I;',r.tbl||'_write',r.tbl);

    execute format(
      'create policy %I on public.%I for select using (public.can_see_finance());',
      r.tbl||'_read',r.tbl
    );

    if r.finance_write then
      execute format(
        'create policy %I on public.%I for all using (public.can_see_finance() and public.can_edit(%L)) with check (public.can_see_finance() and public.can_edit(%L));',
        r.tbl||'_write',r.tbl,r.sec,r.sec
      );
    else
      execute format(
        'create policy %I on public.%I for all using (public.can_edit(%L)) with check (public.can_edit(%L));',
        r.tbl||'_write',r.tbl,r.sec,r.sec
      );
    end if;
  end loop;
end $$;

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

select 'Permissions V3 ready' as status;
