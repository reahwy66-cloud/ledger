-- Riwa Studio — accounting months + portal carousel/archive safety
-- Safe/idempotent migration. Existing transaction dates remain untouched.

do $$
declare tname text;
begin
  foreach tname in array array[
    'work','payments','invoices','fundings','advances','payouts','costs','transfers','osadvances','debts'
  ] loop
    execute format($f$
      update public.%I
      set data = data || jsonb_strip_nulls(jsonb_build_object(
        'transaction_date',
          coalesce(nullif(data->>'transaction_date',''), nullif(data->>'date','')),
        'accounting_month',
          coalesce(
            nullif(data->>'accounting_month',''),
            nullif(data->>'period',''),
            left(coalesce(nullif(data->>'transaction_date',''), nullif(data->>'date','')),7)
          )
      ))
      where
        coalesce(nullif(data->>'transaction_date',''), nullif(data->>'date','')) is not null
        and (
          nullif(data->>'transaction_date','') is null
          or nullif(data->>'accounting_month','') is null
        );
    $f$, tname);
  end loop;
end $$;

-- Preserve every uploaded file for a design/carousel submission instead of keeping only the first.
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
  am text;
  safe jsonb;
  file_obj jsonb;
  files_arr jsonb;
begin
  eid:=public.portal_entity('staff',p_token);
  if eid is null then raise exception 'session_expired'; end if;

  cid:=nullif(trim(coalesce(p_data->>'customerId','')),'');
  typ:=nullif(trim(coalesce(p_data->>'type','')),'');
  q:=greatest(1,least(100,coalesce(nullif(p_data->>'qty','')::numeric,1)));
  dt:=coalesce(nullif(p_data->>'date',''),to_char(current_date,'YYYY-MM-DD'));
  am:=coalesce(nullif(p_data->>'accounting_month',''),left(dt,7));

  if cid is null then raise exception 'bad_customer'; end if;
  if typ not in ('video','post','design','shoot','voice','script','task') then raise exception 'bad_type'; end if;
  if dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_date'; end if;
  if am !~ '^\d{4}-\d{2}$' then raise exception 'bad_accounting_month'; end if;

  if not exists(
    select 1 from public.customers
    where id=cid and coalesce((data->>'active')::boolean,true)
  ) then raise exception 'bad_customer'; end if;

  files_arr:=case when jsonb_typeof(p_data->'files')='array' then p_data->'files' else null end;
  file_obj:=case
    when jsonb_typeof(p_data->'file')='object' then p_data->'file'
    when files_arr is not null and jsonb_array_length(files_arr)>0 and jsonb_typeof(files_arr->0)='object' then files_arr->0
    else null
  end;

  safe:=jsonb_strip_nulls(jsonb_build_object(
    'date',dt,
    'transaction_date',dt,
    'accounting_month',am,
    'customerId',cid,
    'type',typ,
    'qty',q,
    'editorId',eid,
    'note',nullif(trim(coalesce(p_data->>'note','')),''),
    'file',file_obj,
    'files',files_arr,
    'amount','',
    'charge','',
    'archived',false,
    'portalVisible',true,
    'countInPackage',true
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
    raise exception 'portal_submit_failed:%',SQLERRM;
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
      select jsonb_agg(
        jsonb_build_object('id',id) ||
        jsonb_strip_nulls(jsonb_build_object(
          'date',data->>'date',
          'transaction_date',data->>'transaction_date',
          'accounting_month',data->>'accounting_month',
          'customerId',data->>'customerId',
          'type',data->>'type',
          'qty',data->'qty',
          'note',data->>'note',
          'file',data->'file',
          'files',data->'files',
          'amount',data->'amount',
          'archived',data->'archived',
          'countInPackage',data->'countInPackage'
        ))
        order by coalesce(data->>'transaction_date',data->>'date') desc
      )
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
      select jsonb_agg(jsonb_build_object('id',id)||data order by coalesce(data->>'transaction_date',data->>'date') desc)
      from public.advances where data->>'employeeId'=eid
    ),'[]'::jsonb),
    'payouts',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by coalesce(data->>'transaction_date',data->>'date') desc)
      from public.payouts where data->>'employeeId'=eid and coalesce(data->>'kind','wage')<>'reimb'
    ),'[]'::jsonb),
    'company',coalesce((select data->>'company' from public.settings where id=1),'رِواء ستوديو')
  ) into out;

  return out;
end $$;

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
      select jsonb_build_object('id',id)||data
      from public.customers where id=cid
    ),
    'work',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by coalesce(data->>'transaction_date',data->>'date') desc)
      from public.work
      where data->>'customerId'=cid
        and coalesce((data->>'portalVisible')::boolean,true)
    ),'[]'::jsonb),
    'payments',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by coalesce(data->>'transaction_date',data->>'date') desc)
      from public.payments where data->>'customerId'=cid
    ),'[]'::jsonb),
    'invoices',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by data->>'date' desc)
      from public.invoices where data->>'customerId'=cid
    ),'[]'::jsonb),
    'fundings',coalesce((
      select jsonb_agg(jsonb_build_object('id',id)||data order by coalesce(data->>'transaction_date',data->>'date') desc)
      from public.fundings where data->>'customerId'=cid
    ),'[]'::jsonb),
    'salaryCharges',public.portal_client_salary_charges(cid),
    'company',coalesce((select data->>'company' from public.settings where id=1),'رِواء ستوديو')
  ) into out;

  return out;
end $$;

grant execute on function public.portal_staff_submit_work(text,jsonb) to anon,authenticated;
grant execute on function public.portal_staff_snapshot(text) to anon,authenticated;
grant execute on function public.portal_client_snapshot(text) to anon,authenticated;

select 'Accounting month + portal carousel migration ready' as status;
