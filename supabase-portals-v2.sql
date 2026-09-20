-- Riwa Studio Portals V2 — approval workflow + richer client billing
-- Run after supabase-portals-v1.sql. Safe to run repeatedly.

create table if not exists public.portal_submissions (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  work_id text,
  rejection_note text
);

create index if not exists portal_submissions_pending_idx
  on public.portal_submissions(status, created_at desc);

alter table public.portal_submissions enable row level security;
revoke all on public.portal_submissions from anon, authenticated;

create or replace function public.portal_staff_submit_work(p_token text,p_data jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  eid text;
  sid uuid;
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
  if not exists(
    select 1 from public.customers
    where id=cid and coalesce((data->>'active')::boolean,true)
  ) then raise exception 'bad_customer'; end if;

  safe:=jsonb_strip_nulls(jsonb_build_object(
    'date',dt,
    'customerId',cid,
    'type',typ,
    'qty',q,
    'editorId',eid,
    'note',nullif(trim(coalesce(p_data->>'note','')),''),
    'amount','',
    'charge',''
  ));

  insert into public.portal_submissions(employee_id,data,status)
  values(eid,safe,'pending')
  returning id into sid;

  return jsonb_build_object(
    'ok',true,
    'pending',true,
    'submissionId',sid,
    'submission',safe
  );
end $$;

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
    'submissions',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',id::text,
          'status',status,
          'createdAt',created_at,
          'reviewedAt',reviewed_at,
          'rejectionNote',rejection_note
        ) || data
        order by created_at desc
      )
      from public.portal_submissions
      where employee_id=eid
        and created_at >= now()-interval '90 days'
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

create or replace function public.portal_pending_submissions()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id::text,
      'employeeId',s.employee_id,
      'employeeName',coalesce(e.data->>'name','—'),
      'customerId',s.data->>'customerId',
      'customerName',coalesce(c.data->>'name','—'),
      'type',s.data->>'type',
      'qty',s.data->'qty',
      'date',s.data->>'date',
      'note',s.data->>'note',
      'createdAt',s.created_at
    ) order by s.created_at desc)
    from public.portal_submissions s
    left join public.employees e on e.id=s.employee_id
    left join public.customers c on c.id=s.data->>'customerId'
    where s.status='pending'
  ),'[]'::jsonb);
end $$;

create or replace function public.portal_review_submission(
  p_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  s public.portal_submissions%rowtype;
  wid text;
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  if p_action not in ('approve','reject') then raise exception 'bad_action'; end if;

  select * into s
  from public.portal_submissions
  where id=p_id
  for update;

  if s.id is null then raise exception 'submission_not_found'; end if;
  if s.status<>'pending' then
    return jsonb_build_object('ok',true,'status',s.status,'workId',s.work_id);
  end if;

  if p_action='approve' then
    wid:=gen_random_uuid()::text;
    insert into public.work(id,data,updated_at,updated_by)
    values(
      wid,
      s.data || jsonb_build_object('editorId',s.employee_id),
      now(),
      auth.uid()
    );
    update public.portal_submissions
      set status='approved',
          reviewed_at=now(),
          reviewed_by=auth.uid(),
          work_id=wid,
          rejection_note=null
      where id=p_id;
    return jsonb_build_object('ok',true,'status','approved','workId',wid);
  else
    update public.portal_submissions
      set status='rejected',
          reviewed_at=now(),
          reviewed_by=auth.uid(),
          rejection_note=nullif(trim(coalesce(p_note,'')),'')
      where id=p_id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
end $$;

-- Replace generic client service charges with client-safe named service lines.
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
    m := date_trunc(
      'month',
      coalesce(
        start_d,
        to_date(coalesce(c_start,to_char(current_date,'YYYY-MM'))||'-01','YYYY-MM-DD')
      )
    )::date;
    stop_m := date_trunc('month',least(coalesce(end_d,current_date),current_date))::date;

    while m<=stop_m loop
      dim := extract(day from (date_trunc('month',m)+interval '1 month - 1 day'))::integer;
      first_d := 1;
      last_d := dim;
      if start_d is not null and date_trunc('month',start_d)::date=m then
        first_d:=extract(day from start_d)::integer;
      end if;
      if end_d is not null and date_trunc('month',end_d)::date=m then
        last_d:=extract(day from end_d)::integer;
      end if;

      base := coalesce((e.data->>'rate')::numeric,0)
        * greatest(0,last_d-first_d+1) / dim;
      amt := round(base * coalesce((e.data->>'sharedPct')::numeric,0) / 100,2);

      if amt<>0 then
        out := out || jsonb_build_array(jsonb_build_object(
          'date',to_char(m,'YYYY-MM-DD'),
          'month',to_char(m,'YYYY-MM'),
          'amount',amt,
          'serviceName','خدمة ' || coalesce(nullif(e.data->>'name',''),'تشغيل'),
          'description','خدمة ' || coalesce(nullif(e.data->>'name',''),'تشغيل')
        ));
      end if;

      m := (m+interval '1 month')::date;
    end loop;
  end loop;

  return out;
end $portal$;

grant execute on function public.portal_staff_submit_work(text,jsonb) to anon,authenticated;
grant execute on function public.portal_staff_snapshot(text) to anon,authenticated;
grant execute on function public.portal_pending_submissions() to authenticated;
grant execute on function public.portal_review_submission(uuid,text,text) to authenticated;

select 'Portals V2 ready' as status;
