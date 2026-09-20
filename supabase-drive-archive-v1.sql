-- Riwa Studio — Google Drive Archive V1
-- Run once after portal submissions repair.

create or replace function public.portal_staff_submit_work(
  p_token text,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  eid text;
  sid uuid;
  cid text;
  typ text;
  q numeric;
  dt text;
  safe jsonb;
begin
  eid := public.portal_entity('staff', p_token);
  if eid is null then raise exception 'session_expired'; end if;

  cid := nullif(trim(coalesce(p_data->>'customerId','')), '');
  typ := nullif(trim(coalesce(p_data->>'type','')), '');
  q := greatest(1, least(100, coalesce(nullif(p_data->>'qty','')::numeric, 1)));
  dt := coalesce(nullif(p_data->>'date',''), to_char(current_date,'YYYY-MM-DD'));

  if cid is null then raise exception 'bad_customer'; end if;
  if typ not in ('video','post','design','shoot','voice','script','task') then raise exception 'bad_type'; end if;
  if dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_date'; end if;

  if not exists (
    select 1
    from public.customers
    where id = cid
      and coalesce((data->>'active')::boolean, true)
  ) then raise exception 'bad_customer'; end if;

  safe := jsonb_strip_nulls(jsonb_build_object(
    'date', dt,
    'customerId', cid,
    'type', typ,
    'qty', q,
    'editorId', eid,
    'note', nullif(trim(coalesce(p_data->>'note','')), ''),
    'file', case
      when jsonb_typeof(p_data->'file') = 'object' then p_data->'file'
      else null
    end,
    'amount', '',
    'charge', ''
  ));

  insert into public.portal_submissions(
    id, employee_id, data, status
  )
  values(
    extensions.gen_random_uuid(), eid, safe, 'pending'
  )
  returning id into sid;

  return jsonb_build_object(
    'ok', true,
    'pending', true,
    'submissionId', sid::text,
    'submission', safe
  );
end $$;

create or replace function public.portal_staff_snapshot(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
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

grant execute on function public.portal_staff_submit_work(text,jsonb) to anon,authenticated;
grant execute on function public.portal_staff_snapshot(text) to anon,authenticated;

select 'Drive archive metadata ready' as status;
