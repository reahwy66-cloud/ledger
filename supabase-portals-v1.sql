-- Riwa Studio — Standalone Portals V1
-- Staff portal + Client portal with numeric access codes and server-side sessions.
-- Apply once in Supabase SQL Editor. Safe to run repeatedly.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.portal_access (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('staff','client')),
  entity_id text not null,
  code_hash text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(kind,entity_id)
);

create table if not exists public.portal_sessions (
  token_hash text primary key,
  access_id uuid not null references public.portal_access(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.portal_access enable row level security;
alter table public.portal_sessions enable row level security;

-- No direct browser access. Everything goes through narrow RPCs.
revoke all on public.portal_access from anon, authenticated;
revoke all on public.portal_sessions from anon, authenticated;

create or replace function public.portal_issue_code(p_kind text, p_entity_id text)
returns text
language plpgsql security definer set search_path=public as $$
declare
  code text;
  exists_ok boolean;
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  if p_kind not in ('staff','client') then raise exception 'bad_kind'; end if;

  if p_kind='staff' then
    select exists(select 1 from public.employees where id=p_entity_id) into exists_ok;
  else
    select exists(select 1 from public.customers where id=p_entity_id) into exists_ok;
  end if;
  if not exists_ok then raise exception 'entity_not_found'; end if;

  code := lpad((floor(random()*90000000)+10000000)::bigint::text,8,'0');

  insert into public.portal_access(kind,entity_id,code_hash,active,updated_at)
  values(p_kind,p_entity_id,encode(extensions.digest(code,'sha256'),'hex'),true,now())
  on conflict(kind,entity_id) do update
    set code_hash=excluded.code_hash,active=true,updated_at=now();

  delete from public.portal_sessions
  where access_id=(select id from public.portal_access where kind=p_kind and entity_id=p_entity_id);

  return code;
end $$;

create or replace function public.portal_login(p_kind text, p_code text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  a public.portal_access%rowtype;
  token text;
  nm text;
  is_active_entity boolean;
begin
  if p_kind not in ('staff','client') then raise exception 'bad_kind'; end if;
  if p_code !~ '^[0-9]{8}$' then raise exception 'invalid_code'; end if;

  select * into a
  from public.portal_access
  where kind=p_kind
    and active
    and code_hash=encode(extensions.digest(p_code,'sha256'),'hex')
  limit 1;

  if a.id is null then raise exception 'invalid_code'; end if;

  if p_kind='staff' then
    select coalesce((data->>'active')::boolean,true),coalesce(data->>'name','')
      into is_active_entity,nm from public.employees where id=a.entity_id;
  else
    select coalesce((data->>'active')::boolean,true),coalesce(data->>'name','')
      into is_active_entity,nm from public.customers where id=a.entity_id;
  end if;
  if not coalesce(is_active_entity,false) then raise exception 'inactive'; end if;

  token := encode(extensions.gen_random_bytes(32),'hex');
  delete from public.portal_sessions where expires_at<now();
  insert into public.portal_sessions(token_hash,access_id,expires_at)
  values(encode(extensions.digest(token,'sha256'),'hex'),a.id,now()+interval '30 days');

  return jsonb_build_object(
    'token',token,
    'kind',a.kind,
    'entityId',a.entity_id,
    'name',nm,
    'expiresAt',(now()+interval '30 days')
  );
end $$;

create or replace function public.portal_entity(p_kind text,p_token text)
returns text
language sql stable security definer set search_path=public as $$
  select a.entity_id
  from public.portal_sessions s
  join public.portal_access a on a.id=s.access_id
  where a.kind=p_kind
    and a.active
    and s.expires_at>now()
    and s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  limit 1
$$;

create or replace function public.portal_logout(p_token text)
returns void
language sql security definer set search_path=public as $$
  delete from public.portal_sessions
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
$$;

create or replace function public.portal_staff_snapshot(p_token text)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  eid text;
  out jsonb;
begin
  eid:=public.portal_entity('staff',p_token);
  if eid is null then raise exception 'session_expired'; end if;

  select jsonb_build_object(
    'employee',(
      select jsonb_build_object('id',id) || jsonb_strip_nulls(jsonb_build_object(
        'name',data->>'name','role',data->>'role','payType',data->>'payType',
        'rate',data->'rate','startDate',data->>'startDate','endDate',data->>'endDate',
        'active',data->'active'
      )) from public.employees where id=eid
    ),
    'customers',coalesce((
      select jsonb_agg(jsonb_build_object('id',id,'name',data->>'name') order by data->>'name')
      from public.customers where coalesce((data->>'active')::boolean,true)
    ),'[]'::jsonb),
    'work',coalesce((
      select jsonb_agg(jsonb_build_object('id',id) || jsonb_strip_nulls(jsonb_build_object(
        'date',data->>'date','customerId',data->>'customerId','type',data->>'type',
        'qty',data->'qty','note',data->>'note','amount',data->'amount'
      )) order by data->>'date' desc)
      from public.work
      where data->>'editorId'=eid
        and coalesce(data->>'date','') >= to_char(current_date-interval '18 months','YYYY-MM-DD')
    ),'[]'::jsonb),
    'advances',coalesce((
      select jsonb_agg(jsonb_build_object('id',id) || data order by data->>'date' desc)
      from public.advances where data->>'employeeId'=eid
    ),'[]'::jsonb),
    'payouts',coalesce((
      select jsonb_agg(jsonb_build_object('id',id) || data order by data->>'date' desc)
      from public.payouts where data->>'employeeId'=eid and coalesce(data->>'kind','wage')<>'reimb'
    ),'[]'::jsonb),
    'company',coalesce((select data->>'company' from public.settings where id=1),'رِواء ستوديو')
  ) into out;

  return out;
end $$;

create or replace function public.portal_staff_submit_work(p_token text,p_data jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  eid text;
  rid text;
  cid text;
  typ text;
  q numeric;
  dt text;
  safe jsonb;
begin
  eid:=public.portal_entity('staff',p_token);
  if eid is null then raise exception 'session_expired'; end if;

  cid:=p_data->>'customerId';
  typ:=p_data->>'type';
  q:=greatest(1,least(100,coalesce((p_data->>'qty')::numeric,1)));
  dt:=coalesce(nullif(p_data->>'date',''),to_char(current_date,'YYYY-MM-DD'));

  if typ not in ('video','post','design','shoot','voice','task') then raise exception 'bad_type'; end if;
  if not exists(select 1 from public.customers where id=cid and coalesce((data->>'active')::boolean,true)) then
    raise exception 'bad_customer';
  end if;

  rid:=gen_random_uuid()::text;
  safe:=jsonb_strip_nulls(jsonb_build_object(
    'date',dt,'customerId',cid,'type',typ,'qty',q,'editorId',eid,
    'note',nullif(trim(coalesce(p_data->>'note','')),''),
    'amount','',
    'charge',''
  ));

  insert into public.work(id,data,updated_at,updated_by)
  values(rid,safe,now(),null);

  return jsonb_build_object('ok',true,'id',rid,'work',jsonb_build_object('id',rid)||safe);
end $$;

create or replace function public.portal_client_salary_charges(p_cid text)
returns jsonb
language plpgsql stable security definer set search_path=public as $portal$
declare
  c_start text;
  e record;
  m date;
  stop_m date;
  start_d date;
  end_d date;
  dim integer;
  first_d integer;
  last_d integer;
  base numeric;
  amt numeric;
  out jsonb := '[]'::jsonb;
begin
  select data->>'startMonth' into c_start from public.customers where id=p_cid;

  for e in
    select data
    from public.employees
    where data->>'sharedCustomerId'=p_cid
      and data->>'payType'='monthly'
      and coalesce((data->>'sharedPct')::numeric,0)>0
  loop
    start_d := nullif(e.data->>'startDate','')::date;
    end_d := nullif(e.data->>'endDate','')::date;
    m := date_trunc('month',coalesce(start_d,to_date(coalesce(c_start,to_char(current_date,'YYYY-MM'))||'-01','YYYY-MM-DD')))::date;
    stop_m := date_trunc('month',least(coalesce(end_d,current_date),current_date))::date;

    while m<=stop_m loop
      dim := extract(day from (date_trunc('month',m)+interval '1 month - 1 day'))::integer;
      first_d := 1;
      last_d := dim;
      if start_d is not null and date_trunc('month',start_d)::date=m then first_d:=extract(day from start_d)::integer; end if;
      if end_d is not null and date_trunc('month',end_d)::date=m then last_d:=extract(day from end_d)::integer; end if;
      base := coalesce((e.data->>'rate')::numeric,0) * greatest(0,last_d-first_d+1) / dim;
      amt := round(base * coalesce((e.data->>'sharedPct')::numeric,0) / 100,2);
      if amt<>0 then
        out := out || jsonb_build_array(jsonb_build_object(
          'date',to_char(m,'YYYY-MM-DD'),
          'amount',amt,
          'description','حصة تشغيل'
        ));
      end if;
      m := (m+interval '1 month')::date;
    end loop;
  end loop;

  return out;
end $portal$;

create or replace function public.portal_client_snapshot(p_token text)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  cid text;
  out jsonb;
begin
  cid:=public.portal_entity('client',p_token);
  if cid is null then raise exception 'session_expired'; end if;

  select jsonb_build_object(
    'customer',(
      select jsonb_build_object('id',id) || data
      from public.customers where id=cid
    ),
    'work',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by data->>'date' desc)
      from public.work where data->>'customerId'=cid
    ),'[]'::jsonb),
    'payments',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by data->>'date' desc)
      from public.payments where data->>'customerId'=cid
    ),'[]'::jsonb),
    'invoices',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by data->>'date' desc)
      from public.invoices where data->>'customerId'=cid
    ),'[]'::jsonb),
    'fundings',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by data->>'date' desc)
      from public.fundings where data->>'customerId'=cid
    ),'[]'::jsonb),
    'salaryCharges',public.portal_client_salary_charges(cid),
    'company',coalesce((select data->>'company' from public.settings where id=1),'رِواء ستوديو')
  ) into out;

  return out;
end $$;

grant execute on function public.portal_login(text,text) to anon,authenticated;
grant execute on function public.portal_logout(text) to anon,authenticated;
grant execute on function public.portal_staff_snapshot(text) to anon,authenticated;
grant execute on function public.portal_staff_submit_work(text,jsonb) to anon,authenticated;
grant execute on function public.portal_client_snapshot(text) to anon,authenticated;
grant execute on function public.portal_issue_code(text,text) to authenticated;

select 'Portals V1 ready' as status;
