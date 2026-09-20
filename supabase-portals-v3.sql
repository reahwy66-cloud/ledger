-- Riwa Studio Portals V3 — reliable submissions + approval workflow
-- Run once in Supabase SQL Editor after V1. Safe to run repeatedly.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.portal_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  work_id text,
  rejection_note text
);

alter table public.portal_submissions
  alter column id set default extensions.gen_random_uuid();

create index if not exists portal_submissions_pending_idx
  on public.portal_submissions(status, created_at desc);

alter table public.portal_submissions enable row level security;
revoke all on public.portal_submissions from anon, authenticated;

create or replace function public.portal_staff_submit_work(p_token text,p_data jsonb)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
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

  cid:=nullif(trim(coalesce(p_data->>'customerId','')),'');
  typ:=nullif(trim(coalesce(p_data->>'type','')),'');
  q:=greatest(1,least(100,coalesce(nullif(p_data->>'qty','')::numeric,1)));
  dt:=coalesce(nullif(p_data->>'date',''),to_char(current_date,'YYYY-MM-DD'));

  if cid is null then raise exception 'bad_customer'; end if;
  if typ not in ('video','post','design','shoot','voice','script','task') then raise exception 'bad_type'; end if;
  if dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_date'; end if;

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
    'file',case when jsonb_typeof(p_data->'file')='object' then p_data->'file' else null end,
    'amount','',
    'charge',''
  ));

  insert into public.portal_submissions(id,employee_id,data,status)
  values(extensions.gen_random_uuid(),eid,safe,'pending')
  returning id into sid;

  return jsonb_build_object(
    'ok',true,
    'pending',true,
    'submissionId',sid::text,
    'submission',safe
  );
exception
  when others then
    raise exception 'portal_submit_failed:%', SQLERRM;
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
        'qty',data->'qty','note',data->>'note','file',data->'file','amount',data->'amount'
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
language plpgsql security definer set search_path=public,extensions as $$
declare
  s public.portal_submissions%rowtype;
  wid text;
begin
  if not public.is_owner() then raise exception 'not_authorized'; end if;
  if p_action not in ('approve','reject') then raise exception 'bad_action'; end if;

  select * into s from public.portal_submissions where id=p_id for update;
  if s.id is null then raise exception 'submission_not_found'; end if;

  if s.status<>'pending' then
    return jsonb_build_object('ok',true,'status',s.status,'workId',s.work_id);
  end if;

  if p_action='approve' then
    wid:=extensions.gen_random_uuid()::text;
    insert into public.work(id,data,updated_at,updated_by)
    values(wid,s.data || jsonb_build_object('editorId',s.employee_id),now(),auth.uid());

    update public.portal_submissions
      set status='approved',reviewed_at=now(),reviewed_by=auth.uid(),
          work_id=wid,rejection_note=null
      where id=p_id;

    return jsonb_build_object('ok',true,'status','approved','workId',wid);
  else
    update public.portal_submissions
      set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),
          rejection_note=nullif(trim(coalesce(p_note,'')),'')
      where id=p_id;

    return jsonb_build_object('ok',true,'status','rejected');
  end if;
end $$;

grant execute on function public.portal_staff_submit_work(text,jsonb) to anon,authenticated;
grant execute on function public.portal_staff_snapshot(text) to anon,authenticated;
grant execute on function public.portal_pending_submissions() to authenticated;
grant execute on function public.portal_review_submission(uuid,text,text) to authenticated;

select 'Portals V3 ready' as status;
