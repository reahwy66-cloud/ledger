begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='owner' and active limit 1),true);
do $$
declare c uuid:=gen_random_uuid();ct uuid:=gen_random_uuid();e uuid:=gen_random_uuid();pay uuid:=gen_random_uuid();d uuid:=gen_random_uuid();income numeric;cash numeric;payload jsonb;failed boolean;
begin
 perform public.rwa2_save_record(jsonb_build_object('id',c,'kind','customer','data',jsonb_build_object('name','اختبار مؤقت','status','active')));
 perform public.rwa2_save_record(jsonb_build_object('id',ct,'kind','contract','data',jsonb_build_object('name','باقة شهرين','customer_id',c,'type','package','start_date','2026-09-15','end_date','2026-10-14','status','active','items',jsonb_build_array(jsonb_build_object('service','video','qty',8,'rate',20),jsonb_build_object('service','design','qty',8,'rate',5)))));
 perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','invoice','date','2026-09-15','note','فاتورة اختبار','contract_id',ct));
 payload:=jsonb_build_object('id',pay,'op','receipt','date','2026-10-01','note','قبض اختبار','contract_id',ct,'party_id',c,'amount',100);
 perform public.rwa2_post(payload);perform public.rwa2_post(payload);
 if (select count(*) from rwa2.journals where id=pay)<>1 then raise exception 'idempotence failed';end if;
 perform public.rwa2_post(jsonb_build_object('id',d,'op','recognize','date','2026-09-28','note','تسليم اختبار','contract_id',ct,'service','video','qty',2,'deliverable_id','test-delivery'));
 select sum(l.credit-l.debit) into income from rwa2.lines l join rwa2.journals j on j.id=l.journal_id where l.account='video_income' and l.contract_id=ct and j.date between '2026-09-01' and '2026-09-30';
 if income<>40 then raise exception 'recognition failed';end if;
 failed:=false;begin perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','recognize','date','2026-09-29','note','تسليم مكرر','contract_id',ct,'service','video','qty',2,'deliverable_id','test-delivery'));exception when others then failed:=true;end;if not failed then raise exception 'duplicate delivery allowed';end if;
 failed:=false;begin perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','recognize','date','2026-09-29','note','كمية زائدة','contract_id',ct,'service','video','qty',20,'deliverable_id','test-excess'));exception when others then failed:=true;end;if not failed then raise exception 'excess delivery allowed';end if;
 perform public.rwa2_save_record(jsonb_build_object('id',e,'kind','employee','data',jsonb_build_object('name','موظف اختبار','pay_type','monthly','rate',100,'start_date','2026-09-01','status','active')));
 perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','salary_accrual','date','2026-09-30','note','راتب سبتمبر','party_id',e));
 perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','salary_payment','date','2026-10-03','note','دفع راتب','party_id',e,'amount',100));
 if (select sum(credit-debit) from rwa2.lines where account='wages_due' and party_id=e)<>0 then raise exception 'wages not settled';end if;
 perform public.rwa2_close_period('2026-09',true);
 failed:=false;begin perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','recognize','date','2026-09-29','note','فترة مقفلة','contract_id',ct,'service','video','qty',1,'deliverable_id','test-closed'));exception when others then failed:=true;end;if not failed then raise exception 'closed period allowed';end if;
 if exists(select 1 from rwa2.lines group by journal_id having sum(debit)<>sum(credit)) then raise exception 'unbalanced ledger';end if;
end $$;
set constraints all immediate;
select 'PASS: invoice, allocation, accrual dates, idempotence, overdelivery, payroll, period locking, journal balance' as result;
rollback;
