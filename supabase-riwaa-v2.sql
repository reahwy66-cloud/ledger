-- Riwaa v2: isolated operational records and immutable double-entry ledger.
-- Legacy public tables and policies are unchanged. All writes pass through guarded RPCs.
create schema if not exists rwa2;
revoke all on schema rwa2 from public, anon, authenticated;
create table if not exists rwa2.accounts(code text primary key,name text not null,kind text not null check(kind in ('asset','liability','equity','income','expense')),currency text);
create table if not exists rwa2.records(id uuid primary key default gen_random_uuid(),kind text not null,data jsonb not null default '{}',version integer not null default 1,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists rwa2_records_kind on rwa2.records(kind);
create table if not exists rwa2.members(user_id uuid primary key references auth.users(id),role text not null check(role in ('finance','partner','sales','staff')),person_id uuid references rwa2.records(id),active boolean not null default true);
create table if not exists rwa2.periods(month text primary key check(month~'^\d{4}-\d{2}$'),closed boolean not null default false,closed_by uuid,closed_at timestamptz);
create table if not exists rwa2.journals(id uuid primary key,op text not null,date date not null,note text not null,payload jsonb not null,created_by uuid not null,created_at timestamptz not null default now(),reversal_of uuid unique references rwa2.journals(id));
create table if not exists rwa2.lines(id bigint generated always as identity primary key,journal_id uuid not null references rwa2.journals(id),account text not null references rwa2.accounts(code),debit numeric(18,2) not null default 0,credit numeric(18,2) not null default 0,party_id uuid,contract_id uuid,campaign_id uuid,asset_id uuid,native_amount numeric(18,4),currency text,check(debit>=0 and credit>=0 and (debit>0)<>(credit>0)));
alter table rwa2.lines add column if not exists funding_account_id uuid;
create index if not exists rwa2_lines_journal on rwa2.lines(journal_id);
create index if not exists rwa2_lines_party on rwa2.lines(party_id);
create index if not exists rwa2_lines_funding_account on rwa2.lines(funding_account_id);
create table if not exists rwa2.audit(id bigint generated always as identity primary key,user_id uuid,action text not null,record_id uuid,at timestamptz not null default now(),data jsonb not null default '{}');
alter table rwa2.accounts enable row level security;
alter table rwa2.records enable row level security;
alter table rwa2.members enable row level security;
alter table rwa2.periods enable row level security;
alter table rwa2.journals enable row level security;
alter table rwa2.lines enable row level security;
alter table rwa2.audit enable row level security;
-- Private tables intentionally have no client policies or grants; RPCs check identity and role.
insert into rwa2.accounts(code,name,kind,currency) values
('cash_usd','صندوق الدولار','asset','USD'),('cash_syp','صندوق السوري','asset','SYP'),('bank_usd','بنك / بطاقة العمل','asset','USD'),
('receivable','ذمم العملاء','asset',null),('advance','سلف الموظفين','asset',null),('prepaid_rent','إيجار مدفوع مقدماً','asset',null),('equipment','معدات الشركة','asset',null),('depreciation_acc','مجمع إهلاك المعدات','asset',null),
('deferred','إيرادات خدمات مؤجلة','liability',null),('customer_credit','دفعات عملاء غير مخصصة','liability',null),('wages_due','أجور مستحقة','liability',null),('supplier_due','مستحقات الموردين','liability',null),('ad_funds','أموال حملات العملاء','liability',null),('funder_due','مستحقات أصحاب بطاقات التمويل','liability',null),('partner_due','تمويل وتكاليف مستحقة للشركاء','liability',null),('distribution_due','توزيعات أرباح معتمدة','liability',null),
('capital','رأس مال الشركاء','equity',null),('drawings','سحوبات الشركاء','equity',null),('retained','أرباح محتجزة / افتتاحي','equity',null),('migration_clearing','أرصدة افتتاحية قيد استكمال التصنيف','equity',null),
('video_income','إيرادات الفيديو','income',null),('design_income','إيرادات التصميم','income',null),('content_income','إيرادات المحتوى','income',null),('service_income','إيرادات خدمات إضافية','income',null),('ad_income','أتعاب إدارة الحملات','income',null),
('production_cost','تكاليف الإنتاج والوجوه','expense',null),('salary_cost','أجور ورواتب','expense',null),('payroll_recovery','استرداد حصة رواتب مشتركة','expense',null),('commission_cost','عمولات مبيعات','expense',null),('operating_cost','تشغيل ومواصلات','expense',null),('rent_cost','مصروف الإيجار','expense',null),('depreciation_cost','إهلاك المعدات','expense',null),('fx_gain','أرباح فروق الصرف','income',null),('fx_loss','خسائر فروق الصرف','expense',null)
on conflict(code) do nothing;
create or replace function rwa2.role() returns text language sql stable security definer set search_path='' as $$
 select case when public.is_owner() then 'owner' else (select m.role from rwa2.members m join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and m.active and p.active) end;
$$;
create or replace function rwa2.amount(v text) returns numeric language plpgsql immutable set search_path='' as $$ declare a numeric; begin
 a:=round(coalesce(nullif(v,''),'0')::numeric,2); if a<=0 or a>100000000 then raise exception 'المبلغ يجب أن يكون موجباً وضمن الحد المسموح'; end if; return a; end $$;
drop function if exists rwa2.add_line(uuid,text,numeric,numeric,uuid,uuid,uuid,uuid,numeric,text);
create or replace function rwa2.add_line(j uuid,a text,d numeric,c numeric,p uuid default null,ct uuid default null,cp uuid default null,ast uuid default null,n numeric default null,cur text default null,fa uuid default null) returns void language plpgsql set search_path='' as $$
declare book numeric; native numeric; carrying numeric; dt date;
begin
 if a='cash_syp' and c>0 and n<0 then
  select date into dt from rwa2.journals where id=j;
  select coalesce(sum(l.debit-l.credit),0),coalesce(sum(l.native_amount),0) into book,native from rwa2.lines l join rwa2.journals jj on jj.id=l.journal_id where l.account='cash_syp' and jj.date<=dt;
  if native<abs(n) or native<=0 then raise exception 'رصيد السوري غير كاف';end if;
  carrying:=round(book*abs(n)/native,2);
  insert into rwa2.lines(journal_id,account,debit,credit,party_id,contract_id,campaign_id,asset_id,native_amount,currency,funding_account_id) values(j,a,d,carrying,p,ct,cp,ast,n,cur,fa);
  if c>carrying then insert into rwa2.lines(journal_id,account,debit,credit) values(j,'fx_gain',0,c-carrying);elsif c<carrying then insert into rwa2.lines(journal_id,account,debit,credit) values(j,'fx_loss',carrying-c,0);end if;
 else insert into rwa2.lines(journal_id,account,debit,credit,party_id,contract_id,campaign_id,asset_id,native_amount,currency,funding_account_id) values(j,a,d,c,p,ct,cp,ast,n,cur,fa);end if;
end $$;
create or replace function rwa2.immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'القيود المرحلة ثابتة؛ استخدم قيداً عكسياً'; end $$;
drop trigger if exists rwa2_no_journal_edit on rwa2.journals;
create trigger rwa2_no_journal_edit before update or delete on rwa2.journals for each row execute function rwa2.immutable();
drop trigger if exists rwa2_no_line_edit on rwa2.lines;
create trigger rwa2_no_line_edit before update or delete on rwa2.lines for each row execute function rwa2.immutable();
create or replace function rwa2.check_balance() returns trigger language plpgsql security definer set search_path='' as $$ declare j uuid; d numeric;c numeric; begin
 j:=new.id;
 select coalesce(sum(debit),0),coalesce(sum(credit),0) into d,c from rwa2.lines where journal_id=j;
 if d=0 or d<>c then raise exception 'قيد غير متوازن: % / %',d,c; end if;return new;
end $$;
drop trigger if exists rwa2_balanced on rwa2.journals;
create constraint trigger rwa2_balanced after insert on rwa2.journals deferrable initially deferred for each row execute function rwa2.check_balance();
create or replace function public.rwa2_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text:=rwa2.role(); fin boolean; person uuid; out jsonb;
begin
 if auth.uid() is null or r is null then raise exception 'حسابك يحتاج صلاحية للنسخة الجديدة'; end if;
 fin:=r in ('owner','finance','partner'); select person_id into person from rwa2.members where user_id=auth.uid();
 select jsonb_build_object('role',r,'user_id',auth.uid(),'person_id',person,'name',(select name from public.profiles where id=auth.uid()),
 'records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'version',version,'data',case when fin then data when r='sales' then data-'rate'-'salary'-'cost'-'capital'-'migration_review'-'opening_history' else data-'price'-'items'-'rate'-'salary'-'cost'-'capital'-'fee'-'budget'-'migration_review'-'opening_history' end)) from rwa2.records where fin or (r='sales' and kind in ('customer','lead','appointment','quote','contract')) or (r='staff' and ((kind='task' and data->>'employee_id'=person::text) or (kind='employee' and id=person)))),'[]'),
 'accounts',case when fin then coalesce((select jsonb_agg(to_jsonb(a)) from rwa2.accounts a),'[]') else '[]'::jsonb end,
 'journals',case when fin then coalesce((select jsonb_agg(to_jsonb(j)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l)-'id'-'journal_id') from rwa2.lines l where l.journal_id=j.id)) order by j.date,j.created_at) from rwa2.journals j),'[]') else '[]'::jsonb end,
 'periods',coalesce((select jsonb_agg(to_jsonb(p)) from rwa2.periods p),'[]'),
 'members',case when r='owner' then coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.name,'email',p.email,'active',p.active,'role',m.role,'person_id',m.person_id,'enabled',m.active)) from public.profiles p left join rwa2.members m on m.user_id=p.id),'[]') else '[]'::jsonb end,
 'own_wages',case when r='staff' then jsonb_build_object('owed',-(select coalesce(sum(debit-credit),0) from rwa2.lines where account='wages_due' and party_id=person),'advance',(select coalesce(sum(debit-credit),0) from rwa2.lines where account='advance' and party_id=person)) else null end,
 'revision',(select coalesce(max(id),0) from rwa2.audit),
 'audit',case when r='owner' then coalesce((select jsonb_agg(to_jsonb(a)) from (select * from rwa2.audit order by id desc limit 50) a),'[]') else '[]'::jsonb end) into out;
 return out;
end $$;
create or replace function public.rwa2_save_record(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rwa2.role(); rid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); k text:=p->>'kind'; d jsonb:=p->'data'; old rwa2.records; person uuid; x jsonb; totals numeric:=0;
begin
 if r is null or auth.uid() is null then raise exception 'غير مصرح';end if;
 if k not in ('customer','employee','contract','task','lead','appointment','quote','asset','campaign','funding_account','lease','agreement','valuation','config','partner') or jsonb_typeof(d)<>'object' then raise exception 'نوع سجل غير صالح';end if;
 if r='partner' then raise exception 'حساب الشريك للعرض فقط';end if;
 if r='sales' and k not in ('customer','lead','appointment','quote') then raise exception 'ليس ضمن صلاحيات المبيعات';end if;
 if r='staff' and k<>'task' then raise exception 'ليس ضمن صلاحيات الموظف';end if;
 if k in ('employee','asset','funding_account','lease','agreement','valuation','config','partner') and r<>'owner' then raise exception 'للمالك فقط';end if;
 perform pg_advisory_xact_lock(72622026);
 select * into old from rwa2.records where id=rid for update;
 if found then
  if old.kind<>k or coalesce((p->>'version')::int,0)<>old.version then raise exception 'السجل تغير على جهاز آخر؛ أعد التحميل';end if;
  if r='staff' then
   select person_id into person from rwa2.members where user_id=auth.uid();
   if old.data->>'employee_id' is distinct from person::text or old.data->>'status'='approved' then raise exception 'المهمة ليست متاحة لك';end if;
   d:=old.data||jsonb_build_object('status','review','url',d->>'url','note',d->>'note','completed_date',d->>'completed_date');
  end if;
  if k='contract' and exists(select 1 from rwa2.journals where payload->>'contract_id'=rid::text) and (d-'note'-'status')<>(old.data-'note'-'status') then raise exception 'بنود العقد المفوتر ثابتة؛ أنشئ تعديل عقد مستقل';end if;
 else
  if r='staff' then raise exception 'المهام يحددها المدير';end if;
 end if;
 if k in ('customer','employee','lead','asset','lease','campaign','funding_account','agreement','valuation') and length(trim(coalesce(d->>'name','')))=0 then raise exception 'الاسم مطلوب';end if;
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
  if coalesce((d->>'commission_pct')::numeric,0)<0 or coalesce((d->>'commission_pct')::numeric,0)>100 then raise exception 'نسبة عمولة غير صالحة';end if;
  d:=d||jsonb_build_object('price',totals);
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
 if k='appointment' then
  if nullif(d->>'assignee','') is not null and exists(select 1 from rwa2.records where kind='appointment' and id<>rid and data->>'status'<>'cancelled' and data->>'date'=d->>'date' and data->>'assignee'=d->>'assignee' and (data->>'time')::time < (d->>'time')::time+make_interval(mins=>coalesce((d->>'minutes')::int,60)) and (data->>'time')::time+make_interval(mins=>coalesce((data->>'minutes')::int,60))>(d->>'time')::time) then raise exception 'الموعد يتعارض مع حجز المسؤول';end if;
 end if;
 if k='agreement' then
  if coalesce((d->>'owner_pct')::numeric,0)+coalesce((d->>'partner_pct')::numeric,0)<>100 or least((d->>'owner_pct')::numeric,(d->>'partner_pct')::numeric)<0 then raise exception 'مجموع النسب يجب أن يكون100%%';end if;
 end if;
 insert into rwa2.records(id,kind,data,created_by) values(rid,k,d,auth.uid()) on conflict(id) do update set data=excluded.data,version=rwa2.records.version+1,updated_at=now();
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'save_'||k,rid,jsonb_build_object('version',coalesce(old.version,0)+1));
 return jsonb_build_object('ok',true,'id',rid);
end $$;
create or replace function public.rwa2_post(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rwa2.role(); j uuid:=(p->>'id')::uuid; v_op text:=p->>'op'; dt date:=(p->>'date')::date; note text:=p->>'note'; amt numeric; native numeric; rate numeric; ca text; party uuid:=nullif(p->>'party_id','')::uuid; source_party uuid:=nullif(p->>'source_party_id','')::uuid; ct uuid:=nullif(p->>'contract_id','')::uuid; cp uuid:=nullif(p->>'campaign_id','')::uuid; ast uuid:=nullif(p->>'asset_id','')::uuid; fa uuid:=nullif(p->>'funding_account_id','')::uuid; ref uuid:=nullif(p->>'reference_id','')::uuid; doc rwa2.records; funding_doc rwa2.records; x jsonb; qty numeric; total numeric; used numeric; expected numeric; acct text; orig rwa2.journals; ln record; service text; period text; paydate date;
begin
 if auth.uid() is null or r not in ('owner','finance') or r is null then raise exception 'لا توجد صلاحية مالية';end if;
 if j is null or dt is null or nullif(trim(note),'') is null then raise exception 'التاريخ والوصف ومعرف العملية مطلوبون';end if;
 perform pg_advisory_xact_lock(72622026);
 select * into orig from rwa2.journals where id=j;
 if found then
  if orig.payload<>p then raise exception 'معرف العملية مستخدم ببيانات مختلفة';end if;
  return jsonb_build_object('ok',true,'id',j,'duplicate',true);
 end if;
 period:=to_char(dt,'YYYY-MM');
 if exists(select 1 from rwa2.periods where month=period and closed) then raise exception 'الفترة مقفلة';end if;
 ca:=coalesce(p->>'cash_account','cash_usd');
 if ca not in ('cash_usd','cash_syp','bank_usd') then raise exception 'حساب النقد غير صالح';end if;
 native:=coalesce(nullif(p->>'amount','')::numeric,0);rate:=coalesce(nullif(p->>'rate','')::numeric,1);
 if ca='cash_syp' and rate<=0 then raise exception 'سعر الصرف مطلوب';end if;
 amt:=round(case when ca='cash_syp' then native/rate else native end,2);
 if amt<0 or amt>100000000 then raise exception 'مبلغ غير صالح';end if;
 if party is not null and not exists(select 1 from rwa2.records where id=party and kind in ('customer','employee','partner')) then raise exception 'الطرف غير موجود';end if;
 if v_op='reverse' then
  if r<>'owner' then raise exception 'العكس للمالك فقط';end if;
  select * into orig from rwa2.journals where id=ref;
  if not found or orig.op='reverse' then raise exception 'القيد غير متاح للعكس';end if;
  if exists(select 1 from rwa2.journals where reversal_of=ref) then raise exception 'القيد معكوس سابقاً';end if;
  if orig.op in ('invoice','recognize') and exists(select 1 from rwa2.journals a where a.id<>j and a.id<>ref and a.payload->>'contract_id'=orig.payload->>'contract_id' and a.op in ('recognize','time_accrual','receipt','allocate_credit','credit_note') and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'اعكس الحركات التابعة أولاً';end if;
  if orig.op in ('ad_receipt','salary_accrual','task_approve') and exists(select 1 from rwa2.journals a where a.id<>ref and a.op in ('ad_spend','ad_fee','ad_refund','salary_payment','advance_apply') and (a.payload->>'campaign_id'=orig.payload->>'campaign_id' or a.payload->>'party_id'=orig.payload->>'party_id') and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'اعكس التسديدات التابعة أولاً';end if;
  if orig.op='receipt' and exists(select 1 from rwa2.journals a where a.op='commission_accrual' and a.payload->>'reference_id'=ref::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'اعكس عمولة القبض أولاً';end if;
  insert into rwa2.journals values(j,v_op,dt,note,p,auth.uid(),now(),ref);
  if orig.op='task_approve' then update rwa2.records set data=data||'{"status":"review"}',version=version+1 where id=(orig.payload->>'reference_id')::uuid;end if;
  for ln in select * from rwa2.lines where journal_id=ref loop
   perform rwa2.add_line(j,ln.account,ln.credit,ln.debit,ln.party_id,ln.contract_id,ln.campaign_id,ln.asset_id,-ln.native_amount,ln.currency,ln.funding_account_id);
  end loop;
 else
  insert into rwa2.journals(id,op,date,note,payload,created_by) values(j,v_op,dt,note,p,auth.uid());
  if v_op='invoice' then
   select * into doc from rwa2.records where id=ct and kind='contract';if not found or doc.data->>'status' in ('draft','cancelled') then raise exception 'حدد عقداً معتمداً';end if;
   if exists(select 1 from rwa2.journals a where a.id<>j and id<>j and op='invoice' and payload->>'contract_id'=ct::text and (coalesce((doc.data->>'monthly_recurring')::boolean,false)=false or to_char(a.date,'YYYY-MM')=period) and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception '%',case when coalesce((doc.data->>'monthly_recurring')::boolean,false) then 'عقد الخدمة مفوتر لهذا الشهر' else 'العقد مفوتر سابقاً' end;end if;
   party:=(doc.data->>'customer_id')::uuid;amt:=rwa2.amount(doc.data->>'price');
   perform rwa2.add_line(j,'receivable',amt,0,party,ct);perform rwa2.add_line(j,'deferred',0,amt,party,ct);
  elsif v_op='recognize' then
   select * into doc from rwa2.records where id=ct and kind='contract';if not found then raise exception 'العقد غير موجود';end if;
   if doc.data->>'type'='retainer' then raise exception 'عقد الإدارة المستمرة يستخدم إثبات الإيراد الزمني';end if;
   if not exists(select 1 from rwa2.journals a where a.id<>j and op='invoice' and payload->>'contract_id'=ct::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'فوتر العقد أولاً';end if;
   party:=(doc.data->>'customer_id')::uuid;service:=p->>'service';qty:=coalesce((p->>'qty')::numeric,0);
   select value into x from jsonb_array_elements(doc.data->'items') where value->>'service'=service;
   if exists(select 1 from rwa2.journals a where a.id<>j and a.op='recognize' and a.payload->>'deliverable_id'=p->>'deliverable_id' and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'مرجع المخرج مستخدم سابقاً';end if;
   if x is null or qty<=0 then raise exception 'حدد الخدمة والكمية';end if;
   select coalesce(sum((a.payload->>'qty')::numeric),0) into used from rwa2.journals a where a.id<>j and op='recognize' and payload->>'contract_id'=ct::text and payload->>'service'=service and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id);
   if used+qty>(x->>'qty')::numeric then raise exception 'الكمية تتجاوز المتبقي في العقد';end if;
   if dt<(doc.data->>'start_date')::date then raise exception 'التسليم قبل بداية العقد';end if;
   if dt>(doc.data->>'end_date')::date and coalesce(p->>'late_reason','')='' then raise exception 'حدد سبب التسليم بعد نهاية الفترة';end if;
   amt:=round(qty*(x->>'rate')::numeric,2);if amt<=0 then raise exception 'قيمة التسليم صفر';end if;
   acct:=case service when 'video' then 'video_income' when 'design' then 'design_income' when 'content' then 'content_income' else 'service_income' end;
   perform rwa2.add_line(j,'deferred',amt,0,party,ct);perform rwa2.add_line(j,acct,0,amt,party,ct);
  elsif v_op='credit_note' then
   select * into doc from rwa2.records where id=ct and kind='contract';if not found then raise exception 'حدد العقد';end if;
   party:=(doc.data->>'customer_id')::uuid;amt:=rwa2.amount(p->>'amount');
   select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='deferred' and contract_id=ct;
   if amt>used then raise exception 'التخفيض يتجاوز قيمة الخدمات غير المنفذة؛ تصحيح خدمة منفذة يحتاج قيد عكسي';end if;
   select greatest(0,coalesce(sum(debit-credit),0)) into expected from rwa2.lines where account='receivable' and contract_id=ct;
   perform rwa2.add_line(j,'deferred',amt,0,party,ct);
   if least(amt,expected)>0 then perform rwa2.add_line(j,'receivable',0,least(amt,expected),party,ct);end if;
   if amt>expected then perform rwa2.add_line(j,'customer_credit',0,amt-expected,party);end if;
  elsif v_op='time_accrual' then
   select * into doc from rwa2.records where id=ct and kind='contract' and data->>'type'='retainer';if not found then raise exception 'حدد عقد إدارة مستمرة';end if;
   if not exists(select 1 from rwa2.journals a where a.op='invoice' and a.payload->>'contract_id'=ct::text and (coalesce((doc.data->>'monthly_recurring')::boolean,false)=false or to_char(a.date,'YYYY-MM')=period) and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'فوتر عقد الخدمة لهذا الشهر أولاً';end if;
   if exists(select 1 from rwa2.journals a where a.id<>j and a.op='time_accrual' and a.payload->>'contract_id'=ct::text and to_char(a.date,'YYYY-MM')=period and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'إيراد الفترة مثبت';end if;
   if coalesce((doc.data->>'monthly_recurring')::boolean,false) then
    if dt<(date_trunc('month',dt)+interval '1 month -1 day')::date then raise exception 'اعتمد إيراد الخدمة الشهرية في نهاية الشهر';end if;
    amt:=rwa2.amount(coalesce(doc.data->>'monthly_target',doc.data->>'price'));
    select coalesce(sum(l.credit-l.debit),0) into total from rwa2.lines l join rwa2.journals jj on jj.id=l.journal_id where l.account='deferred' and l.contract_id=ct and to_char(jj.date,'YYYY-MM')=period;
    amt:=least(amt,total);
   else
    expected:=(doc.data->>'end_date')::date-(doc.data->>'start_date')::date+1;
    used:=least((doc.data->>'end_date')::date,(date_trunc('month',dt)+interval '1 month -1 day')::date)-greatest((doc.data->>'start_date')::date,date_trunc('month',dt)::date)+1;
    if used<=0 then raise exception 'خارج فترة الخدمة';end if;
    if dt<least((doc.data->>'end_date')::date,(date_trunc('month',dt)+interval '1 month -1 day')::date) then raise exception 'اعتمد الخدمة في نهاية فترة أدائها';end if;
    amt:=round((doc.data->>'price')::numeric*used/expected,2);
    select coalesce(sum(credit-debit),0) into total from rwa2.lines where account='deferred' and contract_id=ct;
    if dt>=(doc.data->>'end_date')::date then amt:=total;end if;
   end if;
   if amt<=0 or amt>total then raise exception 'قيمة مؤجلة غير كافية';end if;
   party:=(doc.data->>'customer_id')::uuid;
   perform rwa2.add_line(j,'deferred',amt,0,party,ct);perform rwa2.add_line(j,'service_income',0,amt,party,ct);
  elsif v_op in ('receipt','allocate_credit') then
   if amt<=0 or party is null then raise exception 'حدد العميل والمبلغ';end if;
   if ct is not null then
    select * into doc from rwa2.records where id=ct and kind='contract';if not found or doc.data->>'customer_id'<>party::text then raise exception 'العقد لا يخص العميل';end if;
    select coalesce(sum(debit-credit),0) into used from rwa2.lines where account='receivable' and contract_id=ct;
    if amt>used then raise exception 'الدفعة تتجاوز المتبقي؛ سجل الزائد رصيداً غير مخصص';end if;
    acct:='receivable';
   elsif p->>'allocation'='opening' then
    select coalesce(sum(debit-credit),0) into used from rwa2.lines where account='receivable' and party_id=party and contract_id is null;
    if amt>used then raise exception 'يتجاوز الرصيد الافتتاحي المطلوب';end if;acct:='receivable';
   else acct:='customer_credit';end if;
   if v_op='allocate_credit' then
    if ct is null then raise exception 'حدد عقد التخصيص';end if;
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='customer_credit' and party_id=party;
    if amt>used then raise exception 'الرصيد المقدم غير كافٍ';end if;
    perform rwa2.add_line(j,'customer_credit',amt,0,party);
   else perform rwa2.add_line(j,ca,amt,0,party,ct,null,null,native,case when ca='cash_syp' then 'SYP' else 'USD' end);end if;
   perform rwa2.add_line(j,acct,0,amt,party,ct);
  elsif v_op in ('expense','asset_purchase','rent_prepay','advance','draw','contribution','partner_loan','partner_repay','customer_refund') then
   if amt<=0 then raise exception 'المبلغ مطلوب';end if;
   acct:=case v_op when 'asset_purchase' then 'equipment' when 'rent_prepay' then 'prepaid_rent' when 'advance' then 'advance' when 'draw' then 'drawings' when 'contribution' then 'capital' when 'partner_loan' then 'partner_due' when 'partner_repay' then 'partner_due' when 'customer_refund' then 'customer_credit' else coalesce(p->>'expense_account','operating_cost') end;
   if v_op='expense' and acct not in ('production_cost','operating_cost','commission_cost','rent_cost') then raise exception 'تصنيف مصروف غير صالح';end if;
   if v_op in ('advance','draw','contribution','partner_loan','partner_repay') and party is null then raise exception 'حدد الشخص';end if;
   if v_op='asset_purchase' then
    select * into doc from rwa2.records where id=ast and kind='asset';if not found then raise exception 'أضف قطعة المعدات أولاً';end if;
    if exists(select 1 from rwa2.lines where account='equipment' and asset_id=ast) then raise exception 'القطعة مقيدة سابقاً';end if;
   end if;
   if v_op='partner_repay' then select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='partner_due' and party_id=party;if amt>used then raise exception 'يتجاوز مستحق الشريك';end if;end if;
   if v_op='customer_refund' then
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='customer_credit' and party_id=party;if amt>used then raise exception 'المبلغ يتجاوز الرصيد المقدم';end if;
   end if;
   if v_op in ('contribution','partner_loan') then
    perform rwa2.add_line(j,ca,amt,0,party,null,null,null,native,case when ca='cash_syp' then 'SYP' else 'USD' end);perform rwa2.add_line(j,acct,0,amt,party);
   else
    perform rwa2.add_line(j,acct,amt,0,party,ct,null,ast);
    if v_op='expense' and p->>'payer'='partner' then
     if party is null then raise exception 'حدد الشريك الذي دفع';end if;
     perform rwa2.add_line(j,'partner_due',0,amt,party);
    elsif v_op='expense' and p->>'payer'='supplier' then perform rwa2.add_line(j,'supplier_due',0,amt,party,ct);
    else perform rwa2.add_line(j,ca,0,amt,party,ct,null,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end);end if;
   end if;
  elsif v_op='supplier_payment' then
   if amt<=0 then raise exception 'حدد المبلغ';end if;
   select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='supplier_due' and (party is null or party_id=party) and (ct is null or contract_id=ct);
   if amt>used then raise exception 'الدفع يتجاوز مستحق المورد';end if;
   perform rwa2.add_line(j,'supplier_due',amt,0,party,ct);perform rwa2.add_line(j,ca,0,amt,party,ct,null,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end);
  elsif v_op='commission_accrual' then
   select * into orig from rwa2.journals where id=ref and op='receipt';if not found or orig.payload->>'contract_id' is null then raise exception 'حدد قبض عقد خدمات مخصصاً';end if;
   if exists(select 1 from rwa2.journals rv where rv.reversal_of=ref) then raise exception 'القبض معكوس';end if;
   select * into doc from rwa2.records where id=(orig.payload->>'contract_id')::uuid;
   if coalesce(doc.data->>'sales_employee_id','')='' or coalesce((doc.data->>'commission_pct')::numeric,0)<=0 then raise exception 'لا عمولة مقررة في العقد';end if;
   if exists(select 1 from rwa2.journals a where a.id<>j and a.op='commission_accrual' and a.payload->>'reference_id'=ref::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'عمولة القبض مثبتة';end if;
   select coalesce(sum(credit-debit),0) into expected from rwa2.lines where journal_id=ref and account='receivable';
   amt:=round(expected*(doc.data->>'commission_pct')::numeric/100,2);party:=(doc.data->>'sales_employee_id')::uuid;ct:=doc.id;
   perform rwa2.add_line(j,'commission_cost',amt,0,party,ct);perform rwa2.add_line(j,'wages_due',0,amt,party,ct);
  elsif v_op in ('salary_accrual','task_approve','salary_payment','advance_apply') then
   select * into doc from rwa2.records where id=party and kind='employee';if not found then raise exception 'حدد الموظف';end if;
   if v_op='task_approve' then
    select * into doc from rwa2.records where id=ref and kind='task';if not found or doc.data->>'employee_id'<>party::text then raise exception 'المهمة لا تخص الموظف';end if;
    if doc.data->>'status'<>'review' then raise exception 'المهمة يجب أن تكون للمراجعة';end if;
    if doc.data->>'status'='approved' then raise exception 'المهمة معتمدة سابقاً';end if;
    amt:=rwa2.amount(doc.data->>'pay');
    update rwa2.records set data=data||'{"status":"approved"}',version=version+1,updated_at=now() where id=ref;
   elsif v_op='salary_accrual' then
    if doc.data->>'pay_type'<>'monthly' then raise exception 'هذا الموظف ليس براتب شهري';end if;
    if exists(select 1 from rwa2.journals a where a.id<>j and op='salary_accrual' and date_trunc('month',date)=date_trunc('month',dt) and payload->>'party_id'=party::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'الراتب مثبت لهذه الفترة';end if;
    if coalesce(doc.data->>'start_date','')='' then raise exception 'حدد تاريخ بدء الموظف';end if;
    paydate:=greatest(date_trunc('month',dt)::date,(doc.data->>'start_date')::date);
    used:=extract(day from (date_trunc('month',dt)+interval '1 month -1 day'));
    expected:=least((date_trunc('month',dt)+interval '1 month -1 day')::date,coalesce(nullif(doc.data->>'end_date','')::date,(date_trunc('month',dt)+interval '1 month -1 day')::date))-paydate+1;
    if expected<=0 then raise exception 'لا استحقاق في هذه الفترة';end if;
    amt:=round((doc.data->>'rate')::numeric*expected/used,2);
   end if;
   if amt<=0 then raise exception 'المبلغ مطلوب';end if;
   if v_op in ('salary_accrual','task_approve') then perform rwa2.add_line(j,'salary_cost',amt,0,party,ct);perform rwa2.add_line(j,'wages_due',0,amt,party,ct);
   else
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='wages_due' and party_id=party;if amt>used then raise exception 'يتجاوز الأجر المستحق؛ للسلفة استخدم تسجيل سلفة';end if;
    perform rwa2.add_line(j,'wages_due',amt,0,party);
    if v_op='advance_apply' then
     select coalesce(sum(debit-credit),0) into used from rwa2.lines where account='advance' and party_id=party;if amt>used then raise exception 'يتجاوز السلفة المتبقية';end if;
     perform rwa2.add_line(j,'advance',0,amt,party);
    else perform rwa2.add_line(j,ca,0,amt,party,null,null,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end);end if;
   end if;
  elsif v_op in ('ad_invoice','ad_payment','ad_spend_funded') then
   select * into doc from rwa2.records where id=cp and kind='campaign';if not found then raise exception 'حدد الحملة';end if;
   party:=(doc.data->>'customer_id')::uuid;
   if v_op='ad_invoice' then
    if exists(select 1 from rwa2.journals a where a.id<>j and a.op='ad_invoice' and a.payload->>'campaign_id'=cp::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'مطالبة الحملة مثبتة سابقاً';end if;
    expected:=rwa2.amount(doc.data->>'budget');amt:=round(expected+coalesce((doc.data->>'fee')::numeric,0),2);
    perform rwa2.add_line(j,'receivable',amt,0,party,null,cp);
    perform rwa2.add_line(j,'ad_funds',0,expected,party,null,cp);
    if amt>expected then perform rwa2.add_line(j,'deferred',0,amt-expected,party,null,cp);end if;
   elsif v_op='ad_payment' then
    if amt<=0 then raise exception 'حدد المبلغ المقبوض';end if;
    select coalesce(sum(debit-credit),0) into used from rwa2.lines where account='receivable' and campaign_id=cp;
    if amt>used then raise exception 'القبض يتجاوز المطلوب على الحملة';end if;
    perform rwa2.add_line(j,ca,amt,0,party,null,cp,null,native,case when ca='cash_syp' then 'SYP' else 'USD' end);
    perform rwa2.add_line(j,'receivable',0,amt,party,null,cp);
   else
    select * into funding_doc from rwa2.records where id=fa and kind='funding_account' and data->>'status'='active';if not found then raise exception 'حدد حساب تمويل فعال';end if;
    source_party:=(funding_doc.data->>'owner_party_id')::uuid;
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='ad_funds' and campaign_id=cp;
    if amt<=0 or amt>used then raise exception 'المبلغ يتجاوز ميزانية المنصة المتبقية';end if;
    perform rwa2.add_line(j,'ad_funds',amt,0,party,null,cp,null,null,null,fa);
    perform rwa2.add_line(j,'funder_due',0,amt,source_party,null,cp,null,null,null,fa);
   end if;
  elsif v_op in ('funded_expense','funder_payment','funder_transfer') then
   select * into funding_doc from rwa2.records where id=fa and kind='funding_account' and data->>'status'='active';if not found then raise exception 'حدد حساب تمويل فعال';end if;
   source_party:=(funding_doc.data->>'owner_party_id')::uuid;
   if amt<=0 then raise exception 'حدد المبلغ';end if;
   if v_op='funded_expense' then
    acct:=coalesce(p->>'expense_account','operating_cost');if acct not in ('production_cost','operating_cost','commission_cost','rent_cost') then raise exception 'تصنيف مصروف غير صالح';end if;
    perform rwa2.add_line(j,acct,amt,0,source_party,null,null,null,null,null,fa);
    perform rwa2.add_line(j,'funder_due',0,amt,source_party,null,null,null,null,null,fa);
   elsif v_op='funder_payment' then
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='funder_due' and funding_account_id=fa;
    if amt>used then raise exception 'الدفع يتجاوز رصيد صاحب البطاقة';end if;
    perform rwa2.add_line(j,'funder_due',amt,0,source_party,null,null,null,null,null,fa);
    perform rwa2.add_line(j,ca,0,amt,source_party,null,null,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end,fa);
   else
    if party is null or not exists(select 1 from rwa2.records where id=party and kind='customer') then raise exception 'حدد العميل المستفيد';end if;
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='funder_due' and funding_account_id=fa;
    if amt>used then raise exception 'التحويل يتجاوز رصيد التمويل';end if;
    if ct is not null then
     select * into doc from rwa2.records where id=ct and kind='contract';if not found or doc.data->>'customer_id'<>party::text then raise exception 'العقد لا يخص العميل المستفيد';end if;
     select coalesce(sum(debit-credit),0) into expected from rwa2.lines where account='receivable' and contract_id=ct;if amt>expected then raise exception 'التحويل يتجاوز المطلوب على العقد';end if;
     acct:='receivable';
    else acct:='customer_credit';end if;
    perform rwa2.add_line(j,'funder_due',amt,0,source_party,null,null,null,null,null,fa);
    perform rwa2.add_line(j,acct,0,amt,party,ct,null,null,null,null,fa);
   end if;
  elsif v_op='distribution_transfer' then
   if source_party is null or not exists(select 1 from rwa2.records where id=source_party and kind='partner') then raise exception 'حدد الشريك صاحب الحصة';end if;
   if party is null or not exists(select 1 from rwa2.records where id=party and kind='customer') then raise exception 'حدد العميل المستفيد';end if;
   if amt<=0 then raise exception 'حدد المبلغ';end if;
   select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='distribution_due' and party_id=source_party;if amt>used then raise exception 'التحويل يتجاوز حصة الأرباح المستحقة';end if;
   if ct is not null then
    select * into doc from rwa2.records where id=ct and kind='contract';if not found or doc.data->>'customer_id'<>party::text then raise exception 'العقد لا يخص العميل المستفيد';end if;
    select coalesce(sum(debit-credit),0) into expected from rwa2.lines where account='receivable' and contract_id=ct;if amt>expected then raise exception 'التحويل يتجاوز المطلوب على العقد';end if;
    acct:='receivable';
   else acct:='customer_credit';end if;
   perform rwa2.add_line(j,'distribution_due',amt,0,source_party);
   perform rwa2.add_line(j,acct,0,amt,party,ct);
  elsif v_op in ('ad_receipt','ad_spend','ad_fee','ad_refund') then
   select * into doc from rwa2.records where id=cp and kind='campaign';if not found then raise exception 'حدد الحملة';end if;
   party:=(doc.data->>'customer_id')::uuid;
   if v_op='ad_receipt' then
    if exists(select 1 from rwa2.journals a where a.id<>j and op='ad_receipt' and payload->>'campaign_id'=cp::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'قبض الحملة مسجل؛ استخدم التخصيص/تسوية مستقلة';end if;
    amt:=round((doc.data->>'budget')::numeric+(doc.data->>'fee')::numeric,2);
    if ca='cash_syp' then native:=amt*rate;else native:=amt;end if;
    perform rwa2.add_line(j,ca,amt,0,party,null,cp,null,native,case when ca='cash_syp' then 'SYP' else 'USD' end);
    perform rwa2.add_line(j,'ad_funds',0,(doc.data->>'budget')::numeric,party,null,cp);
    if (doc.data->>'fee')::numeric>0 then perform rwa2.add_line(j,'deferred',0,(doc.data->>'fee')::numeric,party,null,cp);end if;
   elsif v_op='ad_fee' then
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='deferred' and campaign_id=cp;
    amt:=rwa2.amount(p->>'amount');if amt>used then raise exception 'يتجاوز الأتعاب المؤجلة؛ سجل قبض الحملة أولاً';end if;
    perform rwa2.add_line(j,'deferred',amt,0,party,null,cp);perform rwa2.add_line(j,'ad_income',0,amt,party,null,cp);
   else
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='ad_funds' and campaign_id=cp;
    if amt<=0 or amt>used then raise exception 'المبلغ يتجاوز أموال الحملة المتبقية';end if;
    perform rwa2.add_line(j,'ad_funds',amt,0,party,null,cp);perform rwa2.add_line(j,ca,0,amt,party,null,cp,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end);
   end if;
  elsif v_op in ('rent_accrual','depreciation') then
   select * into doc from rwa2.records where id=ref and kind=case v_op when 'rent_accrual' then 'lease' else 'asset' end;
   if not found then raise exception 'حدد سجل الإيجار أو القطعة';end if;
   if exists(select 1 from rwa2.journals a where a.id<>j and a.op=v_op and to_char(a.date,'YYYY-MM')=period and payload->>'reference_id'=ref::text and not exists(select 1 from rwa2.journals rv where rv.reversal_of=a.id)) then raise exception 'الاستهلاك مثبت لهذه الفترة';end if;
   if v_op='rent_accrual' then
    if dt<(doc.data->>'start_date')::date or dt>(doc.data->>'end_date')::date then raise exception 'خارج فترة الإيجار';end if;
    expected:=rwa2.amount(doc.data->>'remaining');
    amt:=round(expected/(doc.data->>'months')::numeric,2);
    select coalesce(sum(debit-credit),0) into used from rwa2.lines where account='prepaid_rent';
    if to_char(dt,'YYYY-MM')=to_char((doc.data->>'end_date')::date,'YYYY-MM') then amt:=used;elsif amt>used and used>0 then amt:=used;end if;if used<=0 then raise exception 'اعتمد رصيد الإيجار الافتتاحي أولاً';end if;
    perform rwa2.add_line(j,'rent_cost',amt,0);perform rwa2.add_line(j,'prepaid_rent',0,amt);
   else
    select coalesce(sum(debit-credit),0) into expected from rwa2.lines where account='equipment' and asset_id=ref;
    select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='depreciation_acc' and asset_id=ref;
    if expected<=0 or coalesce((doc.data->>'life_months')::numeric,0)<=0 then raise exception 'ثبت قيمة القطعة وعمرها النافع';end if;
    if dt<coalesce(nullif(doc.data->>'ready_date','')::date,dt) then raise exception 'قبل جاهزية القطعة';end if;
    amt:=least(round((expected-coalesce((doc.data->>'residual')::numeric,0))/(doc.data->>'life_months')::numeric,2),expected-used-coalesce((doc.data->>'residual')::numeric,0));
    if amt<=0 then raise exception 'القطعة مستهلكة';end if;
    perform rwa2.add_line(j,'depreciation_cost',amt,0,null,null,null,ref);perform rwa2.add_line(j,'depreciation_acc',0,amt,null,null,null,ref);
   end if;
  elsif v_op='opening' then
   if r<>'owner' then raise exception 'الافتتاحي للمالك';end if;
   if jsonb_array_length(p->'lines')<2 then raise exception 'حدد طرفي القيد الافتتاحي';end if;
   for x in select * from jsonb_array_elements(p->'lines') loop
    acct:=x->>'account';if acct='cash_syp' and (nullif(x->>'native_amount','') is null or (x->>'native_amount')::numeric=0) then raise exception 'نقد السوري يحتاج المبلغ الأصلي';end if;
    if acct in ('receivable','customer_credit','wages_due','advance','capital','funder_due','partner_due','drawings','distribution_due') and nullif(x->>'party_id','') is null then raise exception 'حدد صاحب الرصيد الافتتاحي';end if;
    if acct='funder_due' and nullif(x->>'funding_account_id','') is null then raise exception 'حدد حساب التمويل في الرصيد الافتتاحي';end if;
    if acct='equipment' and nullif(x->>'asset_id','') is null then raise exception 'حدد القطعة في افتتاح المعدات';end if;
    if not exists(select 1 from rwa2.accounts where code=acct and kind not in ('income','expense')) then raise exception 'الافتتاحي لحسابات المركز المالي فقط';end if;
    perform rwa2.add_line(j,acct,round(coalesce((x->>'debit')::numeric,0),2),round(coalesce((x->>'credit')::numeric,0),2),nullif(x->>'party_id','')::uuid,nullif(x->>'contract_id','')::uuid,nullif(x->>'campaign_id','')::uuid,nullif(x->>'asset_id','')::uuid,nullif(x->>'native_amount','')::numeric,x->>'currency',nullif(x->>'funding_account_id','')::uuid);
   end loop;
  elsif v_op='fx_transfer' then
   if native<=0 or rate<=0 then raise exception 'حدد المبلغ وسعر الصرف';end if;
   amt:=round(native/rate,2);
   if p->>'direction'='usd_to_syp' then perform rwa2.add_line(j,'cash_syp',amt,0,null,null,null,null,native,'SYP');perform rwa2.add_line(j,'cash_usd',0,amt,null,null,null,null,-amt,'USD');
   else
    select coalesce(sum(debit-credit),0),coalesce(sum(native_amount),0) into expected,used from rwa2.lines where account='cash_syp';
    if used<native or used<=0 then raise exception 'رصيد السوري غير كاف';end if;
    total:=round(expected*native/used,2);
    perform rwa2.add_line(j,'cash_usd',amt,0,null,null,null,null,amt,'USD');perform rwa2.add_line(j,'cash_syp',0,total,null,null,null,null,-native,'SYP');
    if amt>total then perform rwa2.add_line(j,'fx_gain',0,amt-total);elsif amt<total then perform rwa2.add_line(j,'fx_loss',total-amt,0);end if;
   end if;
  elsif v_op='distribution' then
   if r<>'owner' then raise exception 'توزيع الربح للمالك';end if;
   select * into doc from rwa2.records where kind='agreement' and data->>'status'='active' and (data->>'start_date')::date<=dt order by data->>'start_date' desc limit 1;
   if not found then raise exception 'اعتمد اتفاق الشراكة';end if;
   if amt<=0 then raise exception 'حدد مبلغ التوزيع المعتمد';end if;
   select coalesce(sum(case when a.kind='income' then l.credit-l.debit when a.kind='expense' then l.credit-l.debit when l.account='retained' then l.credit-l.debit else 0 end),0) into used from rwa2.lines l join rwa2.accounts a on a.code=l.account join rwa2.journals jj on jj.id=l.journal_id where jj.date<=dt and (a.kind not in ('income','expense') or exists(select 1 from rwa2.periods where month=to_char(jj.date,'YYYY-MM') and closed));
   if amt>used then raise exception 'التوزيع يتجاوز الربح المقفل المتبقي بعد الخسائر والتوزيعات';end if;
   perform rwa2.add_line(j,'retained',amt,0);
   expected:=round(amt*(doc.data->>'partner_pct')::numeric/100,2);
   perform rwa2.add_line(j,'distribution_due',0,expected,(doc.data->>'partner_id')::uuid);
   perform rwa2.add_line(j,'distribution_due',0,amt-expected,(doc.data->>'owner_id')::uuid);
  elsif v_op='distribution_payment' then
   select coalesce(sum(credit-debit),0) into used from rwa2.lines where account='distribution_due' and party_id=party;
   if amt<=0 or amt>used then raise exception 'يتجاوز التوزيعات المعتمدة';end if;
   perform rwa2.add_line(j,'distribution_due',amt,0,party);perform rwa2.add_line(j,ca,0,amt,party,null,null,null,-native,case when ca='cash_syp' then 'SYP' else 'USD' end);
  else raise exception 'عملية غير مدعومة';end if;
 end if;
 select coalesce(sum(debit),0),coalesce(sum(credit),0) into total,used from rwa2.lines where journal_id=j;
 if total<=0 or total<>used then raise exception 'القيد غير متوازن';end if;
 if exists(select 1 from (select account,sum(sum(debit-credit)) over(partition by account order by jj.date) as book,sum(sum(coalesce(native_amount,debit-credit))) over(partition by account order by jj.date) as native from rwa2.lines l join rwa2.journals jj on jj.id=l.journal_id where account in ('cash_usd','cash_syp','bank_usd') group by account,jj.date) balances where balances.book<-0.005 or balances.native<-0.005) then raise exception 'رصيد النقد غير كافٍ؛ راجع الجرد أو سجل التمويل أولاً';end if;
 if exists(select 1 from rwa2.lines where account='funder_due' group by funding_account_id having sum(credit-debit)<-0.005) then raise exception 'رصيد حساب التمويل لا يمكن أن يصبح سالباً';end if;
 insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'post_'||v_op,j,jsonb_build_object('amount',total));
 return jsonb_build_object('ok',true,'id',j);
end $$;
create or replace function public.rwa2_close_period(p_month text,p_close boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not public.is_owner() then raise exception 'للمالك فقط';end if;
 if p_month!~'^\d{4}-\d{2}$' then raise exception 'فترة غير صالحة';end if;
 perform pg_advisory_xact_lock(72622026);
 insert into rwa2.periods(month,closed,closed_by,closed_at) values(p_month,p_close,auth.uid(),now()) on conflict(month) do update set closed=excluded.closed,closed_by=excluded.closed_by,closed_at=excluded.closed_at;
 insert into rwa2.audit(user_id,action,data) values(auth.uid(),case when p_close then 'close_period' else 'reopen_period' end,jsonb_build_object('month',p_month));
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.rwa2_sync_daily() returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=rwa2.role(); e rwa2.records; dt date:=(now() at time zone 'Asia/Damascus')::date; month_start date; active_through date; days_worked integer; gross_expected numeric; share_expected numeric; gross_used numeric; share_used numeric; gross_delta numeric; share_delta numeric; j uuid; changed integer:=0; shared_customer uuid;
begin
 if auth.uid() is null or r not in ('owner','finance') then raise exception 'لا توجد صلاحية مالية';end if;
 perform pg_advisory_xact_lock(72622026);
 month_start:=date_trunc('month',dt)::date;
 for e in select * from rwa2.records where kind='employee' and coalesce((data->>'daily_accrual')::boolean,false) loop
  active_through:=least(dt,month_start+29,coalesce(nullif(e.data->>'end_date','')::date,dt));
  days_worked:=greatest(0,active_through-greatest(month_start,(e.data->>'start_date')::date)+1);
  gross_expected:=round((e.data->>'rate')::numeric*days_worked/30,2);
  share_expected:=round(coalesce((e.data->>'shared_monthly')::numeric,0)*days_worked/30,2);
  gross_used:=case when to_char(nullif(e.data->>'opening_accrued_through','')::date,'YYYY-MM')=to_char(dt,'YYYY-MM') then coalesce((e.data->>'opening_wage_amount')::numeric,0) else 0 end;
  share_used:=case when to_char(nullif(e.data->>'opening_accrued_through','')::date,'YYYY-MM')=to_char(dt,'YYYY-MM') then coalesce((e.data->>'opening_share_amount')::numeric,0) else 0 end;
  select gross_used+coalesce(sum(case when l.account='wages_due' then l.credit-l.debit else 0 end),0),share_used+coalesce(sum(case when l.account='receivable' then l.debit-l.credit else 0 end),0) into gross_used,share_used from rwa2.journals jj join rwa2.lines l on l.journal_id=jj.id where jj.op='daily_payroll' and to_char(jj.date,'YYYY-MM')=to_char(dt,'YYYY-MM') and jj.payload->>'party_id'=e.id::text;
  gross_delta:=round(gross_expected-gross_used,2);share_delta:=round(share_expected-share_used,2);
  if gross_delta>0 or share_delta>0 then
   shared_customer:=nullif(e.data->>'shared_customer_id','')::uuid;j:=gen_random_uuid();
   insert into rwa2.journals(id,op,date,note,payload,created_by) values(j,'daily_payroll',dt,'استحقاق يومي — '||(e.data->>'name'),jsonb_build_object('party_id',e.id,'shared_customer_id',shared_customer,'gross',gross_delta,'shared',share_delta),auth.uid());
   if gross_delta>0 then perform rwa2.add_line(j,'salary_cost',gross_delta,0,e.id);perform rwa2.add_line(j,'wages_due',0,gross_delta,e.id);end if;
   if share_delta>0 then perform rwa2.add_line(j,'receivable',share_delta,0,shared_customer);perform rwa2.add_line(j,'payroll_recovery',0,share_delta,shared_customer);end if;
   insert into rwa2.audit(user_id,action,record_id,data) values(auth.uid(),'sync_daily_payroll',e.id,jsonb_build_object('date',dt,'gross',gross_delta,'shared',share_delta));changed:=changed+1;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'changed',changed>0,'count',changed,'date',dt);
end $$;
create or replace function public.rwa2_set_member(p_user uuid,p_role text,p_person uuid,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not public.is_owner() then raise exception 'للمالك فقط';end if;
 if not exists(select 1 from public.profiles where id=p_user and active and role<>'owner') then raise exception 'يجب أن يكون المستخدم مسجلاً وفعالاً';end if;
 insert into rwa2.members values(p_user,p_role,p_person,p_active) on conflict(user_id) do update set role=excluded.role,person_id=excluded.person_id,active=excluded.active;
 insert into rwa2.audit(user_id,action,data) values(auth.uid(),'set_member',jsonb_build_object('user_id',p_user,'role',p_role,'active',p_active));return jsonb_build_object('ok',true);
end $$;
-- Existing clients and people are directory imports only: no balances or accounting mutations.
insert into rwa2.records(kind,data) select 'customer',jsonb_build_object('name',data->>'name','status',case when coalesce((data->>'active')::boolean,false) then 'active' else 'paused' end,'phone',coalesce(data->>'phone',''),'legacy_id',id,'note','مستورد كدليل؛ الرصيد الافتتاحي يحتاج مراجعة') from public.customers c where not exists(select 1 from rwa2.records r where r.kind='customer' and r.data->>'legacy_id'=c.id);
insert into rwa2.records(kind,data) select 'employee',jsonb_build_object('name',data->>'name','role',data->>'role','pay_type',data->>'payType','rate',coalesce((data->>'rate')::numeric,0),'start_date',coalesce(data->>'startDate',''),'status',case when coalesce((data->>'active')::boolean,false) then 'active' else 'paused' end,'legacy_id',id) from public.employees e where data->>'payType'<>'percent' and not exists(select 1 from rwa2.records r where r.kind='employee' and r.data->>'legacy_id'=e.id);
insert into rwa2.records(kind,data) select 'partner','{"name":"محمد ديب ريحاوي","pct":65,"status":"active"}' where not exists(select 1 from rwa2.records where kind='partner' and data->>'name'='محمد ديب ريحاوي');
insert into rwa2.records(kind,data) select 'partner','{"name":"أيهم شاكر","pct":35,"status":"pending","planned_contribution":4000}' where not exists(select 1 from rwa2.records where kind='partner' and data->>'name'='أيهم شاكر');
insert into rwa2.records(kind,data) select 'lease','{"name":"الإيجار السنوي — الفترة المتبقية","remaining":1600,"months":6,"start_date":"2026-11-01","end_date":"2027-04-30","status":"draft","partner_settlement":560,"note":"الفترة تخطيطية؛ اعتماد الأرصدة والسريان من المالك"}' where not exists(select 1 from rwa2.records where kind='lease');
insert into rwa2.records(kind,data) select 'agreement',jsonb_build_object('name','اتفاق الشراكة — نوفمبر','owner_pct',65,'partner_pct',35,'owner_id',(select id from rwa2.records where kind='partner' and data->>'name'='محمد ديب ريحاوي'),'partner_id',(select id from rwa2.records where kind='partner' and data->>'name'='أيهم شاكر'),'start_date','2026-11-01','status','draft','ownership','company','liquidation','تقييم كل قطعة، سداد الالتزامات وتكاليف التصفية، ثم تقسيم صافي المتبقي حسب الاتفاق') where not exists(select 1 from rwa2.records where kind='agreement');
revoke all on all tables in schema rwa2 from public,anon,authenticated;
revoke all on all functions in schema rwa2 from public,anon,authenticated;
revoke all on function public.rwa2_snapshot(), public.rwa2_save_record(jsonb), public.rwa2_post(jsonb),public.rwa2_sync_daily(),public.rwa2_close_period(text,boolean),public.rwa2_set_member(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.rwa2_snapshot(), public.rwa2_save_record(jsonb), public.rwa2_post(jsonb),public.rwa2_sync_daily(),public.rwa2_close_period(text,boolean),public.rwa2_set_member(uuid,text,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
create table if not exists public.rwa2_revision(id integer primary key check(id=1),revision bigint not null default 0);
insert into public.rwa2_revision values(1,0) on conflict(id) do nothing;
alter table public.rwa2_revision enable row level security;
revoke all on public.rwa2_revision from public,anon,authenticated;
create or replace function public.rwa2_can_read_revision() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and rwa2.role() is not null $$;
revoke all on function public.rwa2_can_read_revision() from public,anon;
grant execute on function public.rwa2_can_read_revision() to authenticated;
drop policy if exists rwa2_revision_read on public.rwa2_revision;
create policy rwa2_revision_read on public.rwa2_revision for select to authenticated using(public.rwa2_can_read_revision());
grant select on public.rwa2_revision to authenticated;
create or replace function rwa2.update_revision() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.rwa2_revision set revision=new.id where id=1;return new;end $$;
revoke all on function rwa2.update_revision() from public,anon,authenticated;
drop trigger if exists rwa2_revision_change on rwa2.audit;
create trigger rwa2_revision_change after insert on rwa2.audit for each row execute function rwa2.update_revision();
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rwa2_revision') then alter publication supabase_realtime add table public.rwa2_revision;end if;end $$;
notify pgrst,'reload schema';
