-- Riwaa Studio — Sales workspace V1
-- Sales data sheets, signed pending contracts, targets and receipt-based commissions.

create or replace function public.rwa2_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=rwa2.role(); fin boolean; person uuid; out jsonb;
begin
 if auth.uid() is null or r is null then raise exception 'حسابك يحتاج صلاحية للنسخة الجديدة'; end if;
 fin:=r in ('owner','finance','partner');
 select person_id into person from rwa2.members where user_id=auth.uid();
 select jsonb_build_object(
  'role',r,'user_id',auth.uid(),'person_id',person,
  'name',(select name from public.profiles where id=auth.uid()),
  'records',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'kind',kind,'version',version,
      'data',case
        when fin then data
        when r='sales' and kind='employee' then jsonb_build_object(
          'name',data->>'name','role',data->>'role','pay_type',data->>'pay_type',
          'rate',data->'rate','sales_target',data->'sales_target',
          'commission_pct',coalesce(data->'commission_pct','10'::jsonb),
          'start_date',data->>'start_date','end_date',data->>'end_date','status',data->>'status')
        when r='sales' then data-'salary'-'cost'-'capital'-'migration_review'-'opening_history'
        else data-'price'-'items'-'rate'-'salary'-'cost'-'capital'-'fee'-'budget'-'migration_review'-'opening_history'
      end))
    from rwa2.records
    where fin
      or (r='sales' and (kind in ('customer','lead','appointment','quote','contract') or (kind='employee' and id=person)))
      or (r='staff' and ((kind='task' and data->>'employee_id'=person::text) or (kind='employee' and id=person)))
  ),'[]'::jsonb),
  'accounts',case when fin then coalesce((select jsonb_agg(to_jsonb(a)) from rwa2.accounts a),'[]'::jsonb) else '[]'::jsonb end,
  'journals',case when fin then coalesce((select jsonb_agg(to_jsonb(j)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l)-'id'-'journal_id') from rwa2.lines l where l.journal_id=j.id)) order by j.date,j.created_at) from rwa2.journals j),'[]'::jsonb) else '[]'::jsonb end,
  'periods',coalesce((select jsonb_agg(to_jsonb(p)) from rwa2.periods p),'[]'::jsonb),
  'members',case when r='owner' then coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.name,'email',p.email,'active',p.active,'role',m.role,'person_id',m.person_id,'enabled',m.active)) from public.profiles p left join rwa2.members m on m.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end,
  'own_wages',case when r='staff' then jsonb_build_object(
    'owed',-(select coalesce(sum(debit-credit),0) from rwa2.lines where account='wages_due' and party_id=person),
    'advance',(select coalesce(sum(debit-credit),0) from rwa2.lines where account='advance' and party_id=person)) else null end,
  'sales_summary',case when r in ('owner','finance','sales') then coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee_id',e.id,'month',to_char(m.mon,'YYYY-MM'),
      'salary',case when e.data->>'pay_type'='monthly' then coalesce((e.data->>'rate')::numeric,0) else 0 end,
      'target',coalesce((e.data->>'sales_target')::numeric,0),
      'commission_pct',coalesce((e.data->>'commission_pct')::numeric,10),
      'signed_sales',coalesce((select sum((c.data->>'price')::numeric) from rwa2.records c where c.kind='contract' and c.data->>'sales_employee_id'=e.id::text and c.data->>'status' in ('pending','active','closed') and to_char(coalesce(nullif(c.data->>'signed_at','')::timestamptz,(c.data->>'start_date')::date::timestamptz),'YYYY-MM')=to_char(m.mon,'YYYY-MM')),0),
      'collected_sales',coalesce((select sum(l.credit-l.debit) from rwa2.lines l join rwa2.journals j on j.id=l.journal_id join rwa2.records c on c.id=l.contract_id and c.kind='contract' where j.op='receipt' and l.account='receivable' and c.data->>'sales_employee_id'=e.id::text and to_char(j.date,'YYYY-MM')=to_char(m.mon,'YYYY-MM') and not exists(select 1 from rwa2.journals rv where rv.reversal_of=j.id)),0),
      'commission_expected',round(coalesce((select sum((l.credit-l.debit)*coalesce((c.data->>'commission_pct')::numeric,10)/100) from rwa2.lines l join rwa2.journals j on j.id=l.journal_id join rwa2.records c on c.id=l.contract_id and c.kind='contract' where j.op='receipt' and l.account='receivable' and c.data->>'sales_employee_id'=e.id::text and to_char(j.date,'YYYY-MM')=to_char(m.mon,'YYYY-MM') and not exists(select 1 from rwa2.journals rv where rv.reversal_of=j.id)),0),2),
      'commission_booked',coalesce((select sum(l.debit-l.credit) from rwa2.lines l join rwa2.journals j on j.id=l.journal_id where l.account='commission_cost' and l.party_id=e.id and to_char(j.date,'YYYY-MM')=to_char(m.mon,'YYYY-MM')),0)
    ) order by e.data->>'name',m.mon)
    from rwa2.records e
    cross join generate_series(date_trunc('month',current_date)-interval '12 months',date_trunc('month',current_date)+interval '12 months',interval '1 month') m(mon)
    where e.kind='employee' and coalesce((e.data->>'sales_enabled')::boolean,false) and (r<>'sales' or e.id=person)
  ),'[]'::jsonb) else '[]'::jsonb end,
  'revision',(select coalesce(max(id),0) from rwa2.audit),
  'audit',case when r='owner' then coalesce((select jsonb_agg(to_jsonb(a)) from (select * from rwa2.audit order by id desc limit 50) a),'[]'::jsonb) else '[]'::jsonb end
 ) into out;
 return out;
end $$;

create or replace function public.rwa2_save_record(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r text:=rwa2.role(); rid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); k text:=p->>'kind'; d jsonb:=p->'data'; old rwa2.records; person uuid; x jsonb; totals numeric:=0; pct numeric;
begin
 if r is null or auth.uid() is null then raise exception 'غير مصرح';end if;
 if k not in ('customer','employee','contract','task','lead','appointment','quote','asset','campaign','funding_account','lease','agreement','valuation','config','partner') or jsonb_typeof(d)<>'object' then raise exception 'نوع سجل غير صالح';end if;
 if r='partner' then raise exception 'حساب الشريك للعرض فقط';end if;
 if r='sales' and k not in ('customer','lead','appointment','quote','contract') then raise exception 'ليس ضمن صلاحيات المبيعات';end if;
 if r='staff' and k<>'task' then raise exception 'ليس ضمن صلاحيات الموظف';end if;
 if k in ('employee','asset','funding_account','lease','agreement','valuation','config','partner') and r<>'owner' then raise exception 'للمالك فقط';end if;
 perform pg_advisory_xact_lock(72622026);
 select person_id into person from rwa2.members where user_id=auth.uid();
 select * into old from rwa2.records where id=rid for update;
 if found then
  if old.kind<>k or coalesce((p->>'version')::int,0)<>old.version then raise exception 'السجل تغير على جهاز آخر؛ أعد التحميل';end if;
  if r='staff' then
   if old.data->>'employee_id' is distinct from person::text or old.data->>'status'='approved' then raise exception 'المهمة ليست متاحة لك';end if;
   d:=old.data||jsonb_build_object('status','review','url',d->>'url','note',d->>'note','completed_date',d->>'completed_date');
  end if;
  if r='sales' and k='contract' and (old.data->>'sales_employee_id' is distinct from person::text or old.data->>'status' in ('active','closed')) then raise exception 'العقد بعد الاعتماد تعدله الإدارة فقط';end if;
  if k='contract' and exists(select 1 from rwa2.journals where payload->>'contract_id'=rid::text) and (d-'note'-'status')<>(old.data-'note'-'status') then raise exception 'بنود العقد المفوتر ثابتة؛ أنشئ تعديل عقد مستقل';end if;
 else
  if r='staff' then raise exception 'المهام يحددها المدير';end if;
 end if;
 if k in ('customer','employee','lead','asset','lease','campaign','funding_account','agreement','valuation') and length(trim(coalesce(d->>'name','')))=0 then raise exception 'الاسم مطلوب';end if;
 if k in ('customer','lead') and nullif(d->>'latitude','') is not null and ((d->>'latitude')::numeric not between -90 and 90 or (d->>'longitude')::numeric not between -180 and 180) then raise exception 'إحداثيات الموقع غير صالحة';end if;
 if k='employee' then
  if coalesce((d->>'commission_pct')::numeric,0) not between 0 and 100 then raise exception 'نسبة المبيعات غير صالحة';end if;
  if coalesce((d->>'sales_target')::numeric,0)<0 then raise exception 'التارغت لا يمكن أن يكون سالباً';end if;
 end if;
 if k='contract' then
  if not exists(select 1 from rwa2.records where id=(d->>'customer_id')::uuid and kind='customer') then raise exception 'حدد العميل';end if;
  if (d->>'end_date')::date<(d->>'start_date')::date then raise exception 'تاريخ نهاية العقد غير صالح';end if;
  if (d->>'end_date') is null or (d->>'start_date') is null or jsonb_array_length(d->'items')=0 then raise exception 'حدد الفترة وبنود العقد';end if;
  for x in select * from jsonb_array_elements(d->'items') loop
   if coalesce((x->>'qty')::numeric,0)<=0 or coalesce((x->>'rate')::numeric,0)<0 or (x->>'service') not in ('video','design','content','service') then raise exception 'بنود الخدمة غير صالحة';end if;
   if (select count(*) from jsonb_array_elements(d->'items') y where y->>'service'=x->>'service')>1 then raise exception 'نوع الخدمة يجب أن يكون بنداً واحداً';end if;
   totals:=totals+round((x->>'qty')::numeric*(x->>'rate')::numeric,2);
  end loop;
  if totals<=0 then raise exception 'قيمة العقد يجب أن تكون موجبة';end if;
  if coalesce((d->>'declared_payment')::numeric,0)<0 or coalesce((d->>'declared_payment')::numeric,0)>totals then raise exception 'الدفعة المصرح بها تتجاوز قيمة العقد';end if;
  if r='sales' then
   if person is null or not exists(select 1 from rwa2.records where id=person and kind='employee' and coalesce((data->>'sales_enabled')::boolean,false)) then raise exception 'اربط الحساب بموظف مبيعات مفعّل أولاً';end if;
   select coalesce((data->>'commission_pct')::numeric,10) into pct from rwa2.records where id=person;
   if nullif(d->>'signature_data','') is not null and (d->>'signature_data' not like 'data:image/png;base64,%' or length(d->>'signature_data')>150000) then raise exception 'صيغة التوقيع غير صالحة';end if;
   d:=d||jsonb_build_object('sales_employee_id',person,'commission_pct',pct,'sales_origin',true,'status',case when nullif(d->>'signature_data','') is null then 'draft' else 'pending' end);
  end if;
  if coalesce((d->>'commission_pct')::numeric,0) not between 0 and 100 then raise exception 'نسبة عمولة غير صالحة';end if;
  d:=d||jsonb_build_object('price',totals);
  if coalesce((d->>'sales_origin')::boolean,false) and d->>'status' in ('pending','active') and nullif(d->>'signature_data','') is null then raise exception 'توقيع العميل مطلوب';end if;
  if d->>'type'='package' and d->>'status'='active' and exists(select 1 from rwa2.records where kind='contract' and id<>rid and data->>'customer_id'=d->>'customer_id' and data->>'type'='package' and data->>'status'='active' and (data->>'start_date')::date<=(d->>'end_date')::date and (data->>'end_date')::date>=(d->>'start_date')::date) then raise exception 'يوجد تداخل مع باقة فعالة لهذا العميل';end if;
 end if;
 if k='asset' and (coalesce((d->>'life_months')::numeric,0)<=0 or coalesce((d->>'residual')::numeric,0)<0) then raise exception 'عمر المعدات أو القيمة المتبقية غير صالح';end if;
 if k='lease' and coalesce((d->>'months')::numeric,0)<=0 then raise exception 'عدد الأشهر يجب أن يكون موجباً';end if;
 if k='task' then
  if not exists(select 1 from rwa2.records where kind='employee' and id=(d->>'employee_id')::uuid) then raise exception 'حدد منفذ المهمة';end if;
  if r<>'staff' and d->>'status'='approved' and coalesce((d->>'pay')::numeric,0)>0 then raise exception 'اعتماد المهمة المدفوعة من عملية اعتماد الأجر';end if;
 end if;
 if k='campaign' then
  perform rwa2.amount(d->>'budget');
  if coalesce((d->>'fee')::numeric,0)<0 then raise exception 'الأتعاب سالبة';end if;
  if exists(select 1 from rwa2.journals where payload->>'campaign_id'=rid::text) and (d-'note'-'status')<>(old.data-'note'-'status') then raise exception 'الحملة المالية ثابتة؛ عالج الفرق بتسوية';end if;
 end if;
 if k='funding_account' then
  if not exists(select 1 from rwa2.records where id=(d->>'owner_party_id')::uuid and kind in ('customer','partner')) then raise exception 'حدد صاحب بطاقة التمويل';end if;
  if coalesce((d->>'default_fee_value')::numeric,0)<0 then raise exception 'أتعاب التمويل غير صالحة';end if;
  if coalesce(d->>'default_fee_mode','percent') not in ('percent','fixed','markup_total','share_total','fixed_total') then raise exception 'طريقة أتعاب التمويل غير صالحة';end if;
 end if;
 if k='appointment' and nullif(d->>'assignee','') is not null and exists(select 1 from rwa2.records where kind='appointment' and id<>rid and data->>'status'<>'cancelled' and data->>'date'=d->>'date' and data->>'assignee'=d->>'assignee' and (data->>'time')::time < (d->>'time')::time+make_interval(mins=>coalesce((d->>'minutes')::int,60)) and (data->>'time')::time+make_interval(mins=>coalesce((data->>'minutes')::int,60))>(d->>'time')::time) then raise exception 'الموعد يتعارض مع حجز المسؤول';end if;
 if k='agreement' and (coalesce((d->>'owner_pct')::numeric,0)+coalesce((d->>'partner_pct')::numeric,0)<>100 or least((d->>'owner_pct')::numeric,(d->>'partner_pct')::numeric)<0) then raise exception 'مجموع النسب يجب أن يكون100%%';end if;
 insert into rwa2.records(id,kind,data,created_by) values(rid,k,d,auth.uid()) on conflict(id) do update set data=excluded.data,version=rwa2.records.version+1,updated_at=now();
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'save_'||k,rid,jsonb_build_object('version',coalesce(old.version,0)+1));
 return jsonb_build_object('ok',true,'id',rid);
end $$;

create or replace function public.rwa2_accrue_sales_commissions(p_employee uuid,p_month text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r text:=rwa2.role(); rec record; jid uuid; amt numeric; total numeric:=0; added integer:=0;
begin
 if auth.uid() is null or r not in ('owner','finance') then raise exception 'لا توجد صلاحية مالية';end if;
 if p_month!~'^\d{4}-\d{2}$' then raise exception 'الفترة غير صالحة';end if;
 if exists(select 1 from rwa2.periods where month=p_month and closed) then raise exception 'الفترة مقفلة';end if;
 if not exists(select 1 from rwa2.records where id=p_employee and kind='employee') then raise exception 'الموظف غير موجود';end if;
 perform pg_advisory_xact_lock(72622026);
 for rec in
  select j.id,j.date,j.payload,c.id contract_id,coalesce((c.data->>'commission_pct')::numeric,10) pct,
    coalesce((select sum(l.credit-l.debit) from rwa2.lines l where l.journal_id=j.id and l.account='receivable' and l.contract_id=c.id),0) collected
  from rwa2.journals j
  join rwa2.records c on c.id=nullif(j.payload->>'contract_id','')::uuid and c.kind='contract'
  where j.op='receipt' and to_char(j.date,'YYYY-MM')=p_month and c.data->>'sales_employee_id'=p_employee::text
    and not exists(select 1 from rwa2.journals rv where rv.reversal_of=j.id)
    and not exists(select 1 from rwa2.journals a where a.op='commission_accrual' and a.payload->>'reference_id'=j.id::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id))
 loop
  amt:=round(rec.collected*rec.pct/100,2);
  if amt>0 then
   jid:=gen_random_uuid();
   insert into rwa2.journals(id,op,date,note,payload,created_by) values(jid,'commission_accrual',rec.date,'عمولة مبيعات على قبض عقد',jsonb_build_object('reference_id',rec.id,'party_id',p_employee,'contract_id',rec.contract_id,'amount',amt),auth.uid());
   perform rwa2.add_line(jid,'commission_cost',amt,0,p_employee,rec.contract_id);
   perform rwa2.add_line(jid,'wages_due',0,amt,p_employee,rec.contract_id);
   added:=added+1; total:=total+amt;
  end if;
 end loop;
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'accrue_sales_commissions',p_employee,jsonb_build_object('month',p_month,'count',added,'amount',total));
 return jsonb_build_object('ok',true,'count',added,'amount',total);
end $$;

revoke all on function public.rwa2_accrue_sales_commissions(uuid,text) from public,anon;
grant execute on function public.rwa2_accrue_sales_commissions(uuid,text) to authenticated;

notify pgrst,'reload schema';

select 'Sales workspace V1 ready' as status;
