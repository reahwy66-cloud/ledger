
begin;
select set_config('request.jwt.claim.sub','0d031567-ef3a-427f-b929-b5a52b78c8e4',true);
do $test$
declare cid uuid:=gen_random_uuid(); cp uuid:=gen_random_uuid(); d jsonb; v integer; j uuid; n integer; cash_before numeric;
begin
 select coalesce(sum(debit-credit),0) into cash_before from rwa2.lines where account in ('cash_usd','cash_syp','bank_usd');
 perform public.rwa2_save_record(jsonb_build_object('id',cid,'kind','customer','data',jsonb_build_object('name','TEST funding rollback')));
 d:=jsonb_build_object('name','TEST funding rollback','customer_id',cid,'managed_funding',true,'status','active','observed_spend',14.85,'fee_pct',25,'ad_date','2026-11-12','observed_on','2026-11-16');
 perform public.rwa2_save_funding_campaign(jsonb_build_object('id',cp,'version',0,'data',d));
 if exists(select 1 from rwa2.journals where payload->>'campaign_id'=cp::text) then raise exception 'Active created a financial entry';end if;
 select version into v from rwa2.records where id=cp;
 begin
  perform public.rwa2_post(jsonb_build_object('id',gen_random_uuid(),'op','ad_invoice','date','2026-11-16','note','blocked active billing','campaign_id',cp));
  raise exception 'generic active billing bypassed';
 exception when others then if sqlerrm='generic active billing bypassed' then raise;end if;end;
 d:=d||jsonb_build_object('status','paused','billing_date','2026-11-16');
 perform public.rwa2_save_funding_campaign(jsonb_build_object('id',cp,'version',v,'data',d));
 select data,version into d,v from rwa2.records where id=cp;
 if d->>'status'<>'closed' or (d->>'fee')::numeric<>3.71 or (d->>'total')::numeric<>18.56 then raise exception 'Completion amounts wrong';end if;
 j:=(d->>'completion_journal_id')::uuid;
 if (select sum(debit-credit) from rwa2.lines where journal_id=j)<>0 then raise exception 'Unbalanced completion';end if;
 if (select sum(debit-credit) from rwa2.lines where campaign_id=cp and account='receivable')<>18.56 then raise exception 'Wrong due';end if;
 perform public.rwa2_save_funding_campaign(jsonb_build_object('id',cp,'version',v,'data',d||jsonb_build_object('page_name','TEST metadata')));
 if (select count(*) from rwa2.journals where payload->>'campaign_id'=cp::text)<>1 then raise exception 'Duplicate completion invoice';end if;
 select version into v from rwa2.records where id=cp;
 begin
  perform public.rwa2_save_funding_campaign(jsonb_build_object('id',cp,'version',v,'data',d||jsonb_build_object('observed_spend',20)));
  raise exception 'Financial mutation allowed';
 exception when others then if sqlerrm='Financial mutation allowed' then raise;end if;end;
 begin
  perform public.rwa2_save_record(jsonb_build_object('id',cp,'kind','campaign','version',v,'data',d));
  raise exception 'generic record bypassed';
 exception when others then if sqlerrm='generic record bypassed' then raise;end if;end;
 if (select coalesce(sum(debit-credit),0) from rwa2.lines where account in ('cash_usd','cash_syp','bank_usd'))<>cash_before then raise exception 'Unexpected cash movement';end if;
 perform set_config('request.jwt.claim.sub','575ac263-2962-4519-a46d-21ff98e3cfb3',true);
 begin
  perform public.rwa2_save_funding_campaign(jsonb_build_object('data',d));
  raise exception 'Partner write allowed';
 exception when others then if sqlerrm='Partner write allowed' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.rwa2_save_funding_campaign(jsonb_build_object('data',d));
  raise exception 'Anonymous write allowed';
 exception when others then if sqlerrm='Anonymous write allowed' then raise;end if;end;
end $test$;
rollback;