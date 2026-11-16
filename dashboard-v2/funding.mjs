import {money, round, esc} from './core.mjs?v=20261116-funding';
export const fundingStates = {active:'نشط — خارج الحساب',pending:'بانتظار تأكيد الحالة',draft:'مسودة',closed:'منتهي',paused:'منتهي',cancelled:'ملغى'};
export function fundingAmounts(d) {
  const spent = round(d.observed_spend ?? d.spent ?? 0);
  const pct = Number(d.fee_pct ?? d.value ?? 0);
  const completed = ['closed','paused'].includes(d.status);
  const fee = completed ? round(spent*pct/100) : 0;
  return {spent,pct,completed,fee,total:completed ? round(spent+fee) : 0};
}
export function fundingRows(snapshot, filters={}) {
  const reversed=new Set((snapshot.journals||[]).filter(j=>j.reversal_of).map(j=>j.reversal_of));
  const customers=new Map((snapshot.records||[]).filter(r=>r.kind==='customer').map(r=>[r.id,r.data.name]));
  return (snapshot.records||[]).filter(r=>r.kind==='campaign'&&r.data.managed_funding).map(r=>{
    const d=r.data, a=fundingAmounts(d), journals=(snapshot.journals||[]).filter(j=>j.payload?.campaign_id===r.id||(j.lines||[]).some(l=>l.campaign_id===r.id));
    const live=journals.filter(j=>!reversed.has(j.id)&&!j.reversal_of);
    const billed=round(live.filter(j=>j.op==='ad_completed').reduce((s,j)=>s+(j.lines||[]).filter(l=>l.account==='receivable').reduce((t,l)=>t+Number(l.debit)-Number(l.credit),0),0));
    const paid=round(live.filter(j=>j.op==='ad_payment').reduce((s,j)=>s+(j.lines||[]).filter(l=>l.account==='receivable').reduce((t,l)=>t+Number(l.credit)-Number(l.debit),0),0));
    const due=round(journals.reduce((s,j)=>s+(j.lines||[]).filter(l=>l.account==='receivable').reduce((t,l)=>t+Number(l.debit)-Number(l.credit),0),0));
    return {...r,...a,billed,paid,due,customer:customers.get(d.customer_id)||'عميل غير محدد',page:d.page_name||d.page_reference||'اسم الصفحة غير محدد',date:d.ad_date||d.start_date||'',journals:live};
  }).filter(r=>(!filters.customer||r.data.customer_id===filters.customer)&&(!filters.page||r.page===filters.page)&&(!filters.platform||r.data.platform===filters.platform)&&(!filters.status||(filters.status==='closed'?r.completed:r.data.status===filters.status))&&(!filters.month||(filters.month==='unknown'?!r.date:r.date.slice(0,7)===filters.month))&&(!filters.query||[r.customer,r.page,r.data.name,r.data.note,r.data.platform].join(' ').toLowerCase().includes(filters.query.toLowerCase())))
  .sort((a,b)=>a.customer.localeCompare(b.customer,'ar')||a.page.localeCompare(b.page,'ar')||b.date.localeCompare(a.date));
}
export function fundingSummary(rows) {
  const sum=k=>round(rows.reduce((s,r)=>s+Number(r[k]||0),0));
  return {count:rows.length,completed:rows.filter(r=>r.completed).length,active:rows.filter(r=>r.data.status==='active').length,spend:round(rows.filter(r=>r.completed).reduce((s,r)=>s+r.spent,0)),fee:sum('fee'),total:sum('total'),billed:sum('billed'),paid:sum('paid'),due:sum('due'),activeSpend:round(rows.filter(r=>r.data.status==='active').reduce((s,r)=>s+r.spent,0)),pendingSpend:round(rows.filter(r=>['pending','draft'].includes(r.data.status)).reduce((s,r)=>s+r.spent,0))};
}
export function fundingTable(rows, {actions=()=>'', moneyFormat=money}={}) {
 return '<div class="table-wrap"><table class="funding-table"><thead><tr>'+['الإعلان / الصفحة','المنصة','تاريخ الإعلان','انتهاء التمويل','الحالة','الإنفاق $','الأجور','الإجمالي النهائي $','المقبوض $','المتبقي $',''].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>{
 const d=r.data, future=!r.completed;
 return '<tr><td><b>'+esc(d.name)+'</b><small>'+esc(r.page)+'</small>'+(d.page_name?'':'<small class="funding-pending">اسم الصفحة بانتظار التحديد</small>')+'</td><td>'+esc(d.platform||'غير محددة')+'</td><td class="amount">'+esc(r.date||'غير محدد')+'</td><td class="amount">'+esc(d.end_date||(r.completed?'غير موثّق':'—'))+'</td><td><span class="badge '+(future?'warn':'')+'">'+esc(fundingStates[d.status]||d.status)+'</span>'+(d.billing_date?'<small>تسجيل الحساب: '+esc(d.billing_date)+'</small>':'')+'</td><td class="amount">'+moneyFormat(r.spent)+(future?'<small>صرف ظاهر غير نهائي</small>':'')+'</td><td class="amount">'+esc(r.pct)+'%'+(r.completed?'<small>'+moneyFormat(r.fee)+'</small>':'<small>تُحسب عند الانتهاء</small>')+'</td><td class="amount">'+(r.completed?moneyFormat(r.total):'خارج الحساب')+(r.completed&&r.billed===0?'<small>غير مرحّل / قيد معكوس</small>':'')+'</td><td class="amount">'+moneyFormat(r.paid)+'</td><td class="amount">'+moneyFormat(r.due)+'</td><td>'+actions(r)+'</td></tr>';
 }).join('')+'</tbody></table></div>';
}
export function fundingStatement(rows, {customer='كل العملاء',filtersLabel='كل التواريخ والحالات',asOf=''}={}) {
 const t=fundingSummary(rows);
 const groups=new Map();for(const r of rows){const key=r.customer+' — '+r.page+' / '+(r.data.platform||'غير محددة');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const moneyCells=(labels,values)=>'<div class="totals">'+labels.map((x,i)=>'<div><small>'+x+'</small><b>'+money(values[i])+'</b></div>').join('')+'</div>';
 return '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>كشف تمويل — '+esc(customer)+'</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px Tahoma,Arial,sans-serif;color:#18372d;margin:0}header{display:flex;justify-content:space-between;border-bottom:3px solid #205f4c;padding-bottom:15px}h1{margin:0 0 8px}header img{width:62px;height:62px;object-fit:contain}small{display:block;color:#536b61;font-size:10px;margin-top:5px}.totals{display:flex;gap:12px;margin:16px 0}.totals>div{flex:1;border:1px solid #ccd9d1;padding:12px;border-radius:8px}.totals b{display:block;font-size:18px;margin-top:6px}table{border-collapse:collapse;width:100%;margin:8px 0 20px;font-size:10px}th,td{padding:9px 6px;text-align:right;border:1px solid #ccd9d1;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf0ec}thead{display:table-header-group}tr{break-inside:avoid}.amount{direction:ltr;text-align:right;white-space:nowrap}.badge{font-size:10px}.warn{color:#8a6027}.note{padding:10px;background:#f2f5f1;line-height:1.9}h2{font-size:15px;margin:20px 0 8px}footer{margin-top:20px;border-top:1px solid #ccd9d1;padding-top:10px;color:#536b61}.funding-table td:last-child,.funding-table th:last-child{display:none}</style><body><header><div><h1>كشف حساب التمويل</h1><b>رِواء ستوديو | '+esc(customer)+'</b><small>'+esc(filtersLabel)+' · تاريخ الكشف: '+esc(asOf)+'</small></div><img src="/dashboard/riwa-logo.png" alt="رِواء"></header>'+moneyCells(['التمويل المنتهي','أجور التمويل','الإجمالي المنتهي','المقبوض المسجل','المتبقي المعتمد'],[t.spend,t.fee,t.total,t.paid,t.due])+'<p class="note">الإعلانات النشطة والمسودات خارج المبلغ المستحق. صرفها الظاهر قابل للتغير. نسبة الأجور تُضاف فوق الإنفاق النهائي، وتُقرّب لكل إعلان إلى منزلتين. تاريخ الإعلان من المصدر؛ تاريخ الانتهاء غير المعروف يبقى غير موثّق.</p>'+[...groups].map(([key,list])=>'<h2>'+esc(key)+'</h2>'+fundingTable(list)).join('')+'<h2>الدفعات المسجلة</h2><table><thead><tr><th>التاريخ</th><th>الإعلان</th><th>البيان</th><th>القيمة</th></tr></thead><tbody>'+rows.flatMap(r=>r.journals.filter(j=>j.op==='ad_payment').map(j=>'<tr><td>'+esc(j.date)+'</td><td>'+esc(r.data.name)+'</td><td>'+esc(j.note)+'</td><td>'+money((j.lines||[]).filter(l=>l.account==='receivable').reduce((s,l)=>s+Number(l.credit)-Number(l.debit),0))+'</td></tr>')).join('')+'</tbody></table><footer>الإنفاق النشط للمتابعة فقط: '+money(t.activeSpend)+' · مبالغ بانتظار تأكيد الحالة: '+money(t.pendingSpend)+'<br>لا يُعد هذا الكشف إيصال قبض. أي دفعة تظهر فقط بعد تسجيل استلامها فعلياً.</footer></body></html>';
}
