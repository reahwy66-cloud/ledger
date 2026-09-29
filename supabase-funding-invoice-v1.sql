-- Riwa Studio — make ad funding a visible receivable and invoice item
-- Idempotent: rebuilds only funding invoice lines for existing non-cancelled invoices.

do $$
declare
  inv record;
  base_items jsonb;
  funding_items jsonb;
  ads_total numeric;
  funding_total_sum numeric;
  fund_count integer;
begin
  for inv in
    select id,data
    from public.invoices
    where coalesce(data->>'status','draft') <> 'cancelled'
      and nullif(data->>'customerId','') is not null
      and nullif(data->>'period','') is not null
  loop
    base_items := coalesce(inv.data->'items','[]'::jsonb);

    select
      count(*),
      coalesce(sum(
        coalesce((f.data->>'budget')::numeric,0) +
        case when f.data->>'feeMode'='percent'
          then coalesce((f.data->>'budget')::numeric,0) * coalesce((f.data->>'feeValue')::numeric,0) / 100
          else coalesce((f.data->>'feeValue')::numeric,0)
        end
      ),0),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'kind','funding',
          'fundingId',f.id,
          'description','تمويل ' || coalesce(nullif(f.data->>'platform',''),'Meta'),
          'amount',
            coalesce((f.data->>'budget')::numeric,0) +
            case when f.data->>'feeMode'='percent'
              then coalesce((f.data->>'budget')::numeric,0) * coalesce((f.data->>'feeValue')::numeric,0) / 100
              else coalesce((f.data->>'feeValue')::numeric,0)
            end
        )
        order by coalesce(f.data->>'transaction_date',f.data->>'date'), f.id
      ),'[]'::jsonb)
    into fund_count,funding_total_sum,funding_items
    from public.fundings f
    where f.data->>'customerId'=inv.data->>'customerId'
      and coalesce(nullif(f.data->>'accounting_month',''),left(coalesce(f.data->>'transaction_date',f.data->>'date'),7))=inv.data->>'period'
      and coalesce(f.data->>'status','active')<>'cancelled';

    select coalesce(sum(coalesce((item->>'amount')::numeric,0)),0)
    into ads_total
    from jsonb_array_elements(base_items) item
    where item->>'kind'='ads';

    -- Remove previous auto funding rows so the migration is repeatable.
    select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into base_items
    from jsonb_array_elements(base_items) with ordinality as x(item,ord)
    where item->>'kind'<>'funding';

    -- If a single legacy generic ads total exactly mirrors the funding records,
    -- replace that generic line with explicit funding lines rather than duplicating it.
    if fund_count>0 and ads_total>0 and abs(ads_total-funding_total_sum)<0.005 then
      select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
      into base_items
      from jsonb_array_elements(base_items) with ordinality as x(item,ord)
      where item->>'kind'<>'ads';
    end if;

    if fund_count>0 then
      update public.invoices
      set data=jsonb_set(inv.data,'{items}',base_items || funding_items,true),
          updated_at=now()
      where id=inv.id;
    end if;
  end loop;
end $$;

select 'Funding invoice lines synced' as status;
