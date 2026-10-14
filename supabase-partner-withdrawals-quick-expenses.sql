-- Partner view-only access, controlled withdrawal requests, and quick expense categories.
insert into rwa2.accounts(code,name,kind,currency) values
('transport_cost','مواصلات وتنقل','expense',null),
('hospitality_cost','قهوة وضيافة العملاء','expense',null),
('outsourced_service_cost','خدمات خارجية ومستقلون','expense',null)
on conflict(code) do update set name=excluded.name,kind=excluded.kind,currency=excluded.currency;

-- Extend the existing guarded posting RPC without duplicating its accounting engine.
do $$
declare function_sql text;
begin
 select pg_get_functiondef('public.rwa2_post(jsonb)'::regprocedure) into function_sql;
 if position('transport_cost' in function_sql)=0 then
  function_sql:=replace(function_sql,
   '(''production_cost'',''operating_cost'',''commission_cost'',''rent_cost'')',
   '(''production_cost'',''operating_cost'',''transport_cost'',''hospitality_cost'',''outsourced_service_cost'',''commission_cost'',''rent_cost'')');
  if position('transport_cost' in function_sql)=0 then raise exception 'تعذر تحديث تصنيفات المصروف في rwa2_post';end if;
  execute function_sql;
 end if;
end $$;

create or replace function public.rwa2_request_withdrawal(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r text:=rwa2.role();
 rid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
 person uuid;
 amt numeric:=rwa2.amount(p->>'amount');
 request_month text:=coalesce(nullif(p->>'month',''),to_char(timezone('Asia/Damascus',now()),'YYYY-MM'));
 available numeric;
 pending numeric;
 existing rwa2.records;
begin
 if auth.uid() is null or r<>'partner' then raise exception 'هذه العملية متاحة للشريك فقط';end if;
 select person_id into person from rwa2.members where user_id=auth.uid() and active;
 if person is null or not exists(select 1 from rwa2.records where id=person and kind='partner') then raise exception 'حساب الشريك غير مربوط بسجل الشراكة';end if;
 if request_month!~'^\d{4}-\d{2}$' then raise exception 'الشهر غير صالح';end if;
 select * into existing from rwa2.records where id=rid;
 if found then
  if existing.kind='withdrawal_request' and existing.created_by=auth.uid() then return jsonb_build_object('ok',true,'id',rid,'duplicate',true);end if;
  raise exception 'معرف الطلب مستخدم';
 end if;
 perform pg_advisory_xact_lock(72622026);
 select coalesce(sum(credit-debit),0) into available from rwa2.lines where account='distribution_due' and party_id=person;
 select coalesce(sum((data->>'amount')::numeric),0) into pending from rwa2.records where kind='withdrawal_request' and data->>'partner_id'=person::text and data->>'status'='pending';
 if amt>available-pending then raise exception 'المتاح للسحب بعد الطلبات المعلقة هو % دولار',round(greatest(0,available-pending),2);end if;
 insert into rwa2.records(id,kind,data,created_by) values(rid,'withdrawal_request',jsonb_build_object(
  'name','طلب سحب حصة '||request_month,'partner_id',person,'amount',amt,'month',request_month,
  'status','pending','note',coalesce(p->>'note',''),'requested_at',now(),'requested_by',auth.uid()),auth.uid());
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'request_withdrawal',rid,jsonb_build_object('partner_id',person,'amount',amt,'month',request_month));
 return jsonb_build_object('ok',true,'id',rid);
end $$;

create or replace function public.rwa2_approve_withdrawal(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r text:=rwa2.role();
 request_id uuid:=nullif(p->>'request_id','')::uuid;
 request_record rwa2.records;
 journal_id uuid:=coalesce(nullif(p->>'journal_id','')::uuid,gen_random_uuid());
 cash_account text:=coalesce(nullif(p->>'cash_account',''),'cash_usd');
 dt date:=coalesce(nullif(p->>'date','')::date,timezone('Asia/Damascus',now())::date);
 result jsonb;
begin
 if auth.uid() is null or r not in ('owner','finance') then raise exception 'اعتماد السحب للمالك أو المالية فقط';end if;
 if cash_account not in ('cash_usd','bank_usd') then raise exception 'دفع الحصة يكون من صندوق الدولار أو البنك';end if;
 perform pg_advisory_xact_lock(72622026);
 select * into request_record from rwa2.records where id=request_id and kind='withdrawal_request' for update;
 if not found then raise exception 'طلب السحب غير موجود';end if;
 if request_record.data->>'status'='paid' then return jsonb_build_object('ok',true,'id',request_id,'duplicate',true);end if;
 if request_record.data->>'status'<>'pending' then raise exception 'طلب السحب ليس معلقاً';end if;
 result:=public.rwa2_post(jsonb_build_object(
  'id',journal_id,'op','distribution_payment','date',dt,'note','دفع حصة الشريك — '||(request_record.data->>'month'),
  'amount',request_record.data->>'amount','cash_account',cash_account,'rate',1,
  'party_id',request_record.data->>'partner_id','withdrawal_request_id',request_id));
 update rwa2.records set data=data||jsonb_build_object('status','paid','paid_at',now(),'paid_by',auth.uid(),'journal_id',journal_id,'cash_account',cash_account),version=version+1,updated_at=now() where id=request_id;
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'approve_withdrawal',request_id,jsonb_build_object('journal_id',journal_id,'amount',request_record.data->>'amount','cash_account',cash_account));
 return jsonb_build_object('ok',true,'id',request_id,'journal_id',journal_id);
end $$;

revoke all on function public.rwa2_request_withdrawal(jsonb),public.rwa2_approve_withdrawal(jsonb) from public,anon;
grant execute on function public.rwa2_request_withdrawal(jsonb),public.rwa2_approve_withdrawal(jsonb) to authenticated;
notify pgrst,'reload schema';
