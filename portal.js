(function(){
"use strict";

var SUPA_URL="https://gvnpixjkcmbrdfefbamr.supabase.co";
var SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bnBpeGprY21icmRmZWZiYW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDAyNDAsImV4cCI6MjEwMDQ3NjI0MH0.PPuHBLPRwFPvjMgoIWHCubDTX9at5gSgn4QKxcgsbQI";
var KIND=document.body.getAttribute("data-portal")||"staff";
var SB=null,DATA=null;
var TOKEN_KEY="riwa_portal_"+KIND+"_token";
var TYPES={video:"فيديو",post:"بوست",design:"تصميم",shoot:"تصوير",voice:"فويس",task:"مهمة"};

function $(q){return document.querySelector(q)}
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
function money(v){return "$"+Number(v||0).toFixed(2)}
function ym(d){return String(d||"").slice(0,7)}
function today(){return new Date().toISOString().slice(0,10)}
function currentMonth(){return today().slice(0,7)}
function inMonth(d,m){return ym(d)===m}
function addMonth(m,n){var p=m.split("-"),d=new Date(+p[0],+p[1]-1+n,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
function daysInMonth(m){var p=m.split("-");return new Date(+p[0],+p[1],0).getDate()}
function applyTheme(){var h=new Date().getHours();document.documentElement.setAttribute("data-theme",(h>=7&&h<19)?"light":"dark")}
function token(){try{return localStorage.getItem(TOKEN_KEY)||""}catch(e){return ""}}
function saveToken(v){try{if(v)localStorage.setItem(TOKEN_KEY,v);else localStorage.removeItem(TOKEN_KEY)}catch(e){}}
function showError(msg){var e=$("#loginError");if(e)e.textContent=msg||""}

async function init(){
  applyTheme();
  var mod=await import("https://esm.sh/@supabase/supabase-js@2");
  SB=mod.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  bindGlobal();
  if(token()) await load();
  else renderLogin();
}

function bindGlobal(){
  document.addEventListener("click",function(e){
    var a=e.target.closest("[data-act]"); if(!a)return;
    var act=a.dataset.act;
    if(act==="logout") logout();
    if(act==="theme"){
      var now=document.documentElement.getAttribute("data-theme");
      document.documentElement.setAttribute("data-theme",now==="dark"?"light":"dark");
    }
    if(act==="printinvoice"&&KIND==="client"){
      var inv=(DATA.invoices||[]).filter(function(x){return x.id===a.dataset.id})[0];
      if(inv) printInvoice(inv);
    }
    if(act==="printstatement"&&KIND==="client") printStatement();
  });
}

function renderLogin(){
  document.body.innerHTML='<div class="login-wrap"><div class="login-card">'
    +'<img src="riwa-logo.png" alt="رِواء ستوديو"><h1>'+(KIND==="staff"?"بوابة الفريق":"بوابة العميل")+'</h1>'
    +'<p>'+(KIND==="staff"?"أدخل رقم الدخول الخاص فيك لعرض رصيدك وتسليم شغلك.":"أدخل رقم الدخول الخاص فيك لمتابعة حسابك وتسليماتك.")+'</p>'
    +'<form id="loginForm"><input class="code-input" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="one-time-code" placeholder="••••••••">'
    +'<button class="btn primary" type="submit">دخول</button><div class="error" id="loginError"></div></form></div></div>';
  $("#loginForm").onsubmit=async function(ev){
    ev.preventDefault();showError("");
    var code=$("#code").value.replace(/\D/g,"");
    if(code.length!==8){showError("رقم الدخول لازم يكون 8 أرقام.");return}
    var btn=this.querySelector("button");btn.disabled=true;btn.textContent="جاري الدخول…";
    var r=await SB.rpc("portal_login",{p_kind:KIND,p_code:code});
    btn.disabled=false;btn.textContent="دخول";
    if(r.error){showError("رقم الدخول غير صحيح أو غير مفعّل.");return}
    saveToken(r.data.token);await load();
  };
  $("#code").focus();
}

async function load(){
  var r=await SB.rpc(KIND==="staff"?"portal_staff_snapshot":"portal_client_snapshot",{p_token:token()});
  if(r.error){saveToken("");renderLogin();return}
  DATA=r.data||{};
  if(KIND==="staff") renderStaff(); else renderClient();
}

async function logout(){
  var t=token();saveToken("");
  try{if(t&&SB)await SB.rpc("portal_logout",{p_token:t})}catch(e){}
  location.reload();
}

function shell(inner,name,sub){
  document.body.innerHTML='<main class="portal"><header class="topbar">'
    +'<div class="brand"><img src="riwa-logo.png" alt=""><div><b>رِواء ستوديو</b><small>'+esc(sub||"")+'</small></div></div>'
    +'<div class="top-actions"><button class="icon-btn" data-act="theme" aria-label="تغيير النمط">◐</button><button class="btn danger" data-act="logout">خروج</button></div>'
    +'</header>'+inner+'</main>';
}

/* STAFF */
function monthlyPay(e,m){
  if(e.payType!=="monthly")return 0;
  var start=e.startDate||"",end=e.endDate||"",pay=+e.rate||0;
  if(start&&start.slice(0,7)>m)return 0;if(end&&end.slice(0,7)<m)return 0;
  if(start&&start.slice(0,7)===m){var first=Math.max(1,+start.slice(8,10)||1),dim=daysInMonth(m);pay=pay*(dim-first+1)/dim}
  if(end&&end.slice(0,7)===m){var last=Math.min(daysInMonth(m),+end.slice(8,10)||daysInMonth(m));var begin=start&&start.slice(0,7)===m?Math.max(1,+start.slice(8,10)||1):1;pay=(+e.rate||0)*Math.max(0,last-begin+1)/daysInMonth(m)}
  return Math.round(pay*100)/100
}
function staffEarned(e,m){
  if(e.payType==="monthly")return monthlyPay(e,m);
  if(e.payType==="percent")return null;
  return (DATA.work||[]).filter(function(w){return inMonth(w.date,m)&&(e.payType!=="per_video"||w.type==="video")}).reduce(function(a,w){
    if(w.amount!==""&&w.amount!=null)return a+(+w.amount||0);
    return a+(+w.qty||0)*(+e.rate||0)
  },0)
}
function staffBalance(){
  var e=DATA.employee,m=currentMonth(),earned=staffEarned(e,m);
  if(earned==null)return null;
  var adv=(DATA.advances||[]).filter(function(x){return inMonth(x.date,m)}).reduce(function(a,x){return a+(+x.amount||0)},0);
  var paid=(DATA.payouts||[]).filter(function(x){return inMonth(x.date,m)}).reduce(function(a,x){return a+(+x.amount||0)},0);
  return {earned:earned,adv:adv,paid:paid,balance:earned-adv-paid}
}
function renderStaff(){
  var e=DATA.employee||{},m=currentMonth(),bal=staffBalance(),monthWork=(DATA.work||[]).filter(function(w){return inMonth(w.date,m)});
  var customerMap={};(DATA.customers||[]).forEach(function(c){customerMap[c.id]=c.name});
  var delivered=monthWork.reduce(function(a,w){return a+(+w.qty||0)},0);
  var inner='<section class="hero"><span class="eyebrow">'+esc(e.role||"الفريق")+'</span><h1>أهلاً، '+esc(e.name||"")+'</h1>'
    +'<div class="hero-value '+(bal&&bal.balance<0?"neg":"")+'">'+(bal?money(bal.balance):"—")+'</div>'
    +'<div class="hero-note">'+(bal?"رصيدك الحالي لهذا الشهر":"الرصيد للشركاء بالنسبة يحتاج مراجعة الإدارة")+'</div></section>'
    +'<section class="stats"><div class="stat"><small>المكتسب</small><b>'+(bal?money(bal.earned):"—")+'</b></div>'
    +'<div class="stat"><small>المدفوع / السلف</small><b>'+(bal?money(bal.paid+bal.adv):"—")+'</b></div>'
    +'<div class="stat"><small>تسليمات الشهر</small><b>'+delivered+'</b></div></section>'
    +'<div class="grid"><section class="card"><h2>تسليم عمل</h2><p class="sub">سجّل أي فيديو، تصميم، بوست أو مهمة خلصتها.</p>'
    +'<form class="form" id="workForm"><div class="field"><label>العميل</label><select name="customerId" required><option value="">اختر العميل</option>'
    +(DATA.customers||[]).map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'}).join("")
    +'</select></div><div class="field"><label>نوع العمل</label><select name="type">'+Object.keys(TYPES).map(function(k){return '<option value="'+k+'">'+TYPES[k]+'</option>'}).join("")+'</select></div>'
    +'<div class="field"><label>الكمية</label><input name="qty" type="number" min="1" max="100" value="1"></div><div class="field"><label>التاريخ</label><input name="date" type="date" value="'+today()+'"></div>'
    +'<div class="field full"><label>ملاحظة</label><textarea name="note" placeholder="تفاصيل اختيارية…"></textarea></div>'
    +'<div class="full"><button class="btn primary" type="submit">تسجيل التسليم</button><div class="error" id="workError"></div></div></form></section>'
    +'<section class="card"><h2>آخر التسليمات</h2><p class="sub">آخر الأعمال المسجلة على حسابك.</p><div class="list">'
    +((DATA.work||[]).length?(DATA.work||[]).slice(0,12).map(function(w){return '<div class="row"><div class="row-main"><b>'+esc(customerMap[w.customerId]||"عميل")+' · '+esc(TYPES[w.type]||w.type)+'</b><small>'+esc(w.note||"بدون ملاحظة")+'</small></div><div class="row-side"><b>'+esc(w.qty||1)+'×</b><small>'+esc(w.date||"")+'</small></div></div>'}).join(""):'<div class="empty">ما في تسليمات بعد.</div>')
    +'</div></section></div>';
  shell(inner,e.name,DATA.company||"رِواء ستوديو");
  $("#workForm").onsubmit=async function(ev){
    ev.preventDefault();var fd=new FormData(this),payload={};fd.forEach(function(v,k){payload[k]=v});payload.qty=+payload.qty||1;
    var btn=this.querySelector("button");btn.disabled=true;btn.textContent="جاري الحفظ…";$("#workError").textContent="";
    var r=await SB.rpc("portal_staff_submit_work",{p_token:token(),p_data:payload});
    btn.disabled=false;btn.textContent="تسجيل التسليم";
    if(r.error){$("#workError").textContent="تعذّر تسجيل التسليم.";return}
    await load();
  };
}

/* CLIENT */
function invoiceTotal(inv){return (inv.items||[]).reduce(function(a,i){return a+(+i.amount||0)},0)}
function fundingFee(f){return f.feeMode==="percent"?(+f.budget||0)*(+f.feeValue||0)/100:(+f.feeValue||0)}
function fundingTotal(f){return (+f.budget||0)+fundingFee(f)}
function salaryMonthly(e,m){
  if(e.payType!=="monthly")return 0;var pay=+e.rate||0,start=e.startDate||"",end=e.endDate||"";
  if(start&&start.slice(0,7)>m)return 0;if(end&&end.slice(0,7)<m)return 0;
  if(start&&start.slice(0,7)===m){var first=Math.max(1,+start.slice(8,10)||1),dim=daysInMonth(m);pay=pay*(dim-first+1)/dim}
  if(end&&end.slice(0,7)===m){var last=Math.min(daysInMonth(m),+end.slice(8,10)||daysInMonth(m));var begin=start&&start.slice(0,7)===m?Math.max(1,+start.slice(8,10)||1):1;pay=(+e.rate||0)*Math.max(0,last-begin+1)/daysInMonth(m)}
  return Math.round(pay*100)/100
}
function clientStatement(){
  var c=DATA.customer||{},thru=currentMonth(),lines=[],billed=0,paid=0;
  var explicit=(DATA.invoices||[]).filter(function(inv){return (inv.status==="sent"||inv.status==="paid")&&ym(inv.period||inv.date)<=thru});
  function invoicedMonth(m){return explicit.some(function(inv){return ym(inv.period||inv.date)===m})}
  var open=+c.openingDue||0,credit=+c.credit||0;if(open){billed+=open;lines.push({date:(c.startMonth||thru)+"-01",desc:"رصيد افتتاحي",charge:open,paid:0})}if(credit){paid+=credit;lines.push({date:(c.startMonth||thru)+"-01",desc:"رصيد دائن",charge:0,paid:credit})}
  if(c.billing==="package"){
    var m=c.startMonth||thru,stop=c.endMonth&&c.endMonth<thru?c.endMonth:thru,guard=0;
    while(m<=stop&&guard++<180){var fee=+c.monthlyFee||0;if(fee&&!invoicedMonth(m)){billed+=fee;lines.push({date:m+"-01",desc:"الاشتراك الشهري",charge:fee,paid:0})}m=addMonth(m,1)}
  }
  var vr=+c.rate||0,dr=+c.drate||0;if(c.billing==="per_design")dr=+c.drate||+c.rate||0;
  (DATA.work||[]).filter(function(w){return ym(w.date)<=thru&&!invoicedMonth(ym(w.date))}).forEach(function(w){
    var amt=0;if(c.billing==="per_design"&&w.type==="design")amt=(+w.qty||0)*dr;
    else if(c.billing!=="package"&&w.type==="video")amt=(+w.qty||0)*vr;
    else if(c.billing!=="package"&&w.type==="design"&&dr)amt=(+w.qty||0)*dr;
    else if(c.billing==="package"&&w.type==="design"&&dr)amt=(+w.qty||0)*dr;
    if(amt){billed+=amt;lines.push({date:w.date,desc:(w.qty||1)+" × "+(TYPES[w.type]||w.type),charge:amt,paid:0})}
    if((+w.charge||0)>0){billed+=+w.charge;lines.push({date:w.date,desc:(TYPES[w.type]||w.type)+(w.note?" — "+w.note:""),charge:+w.charge,paid:0})}
  });
  explicit.forEach(function(inv){(inv.items||[]).forEach(function(i){var a=+i.amount||0;if(a){billed+=a;lines.push({date:inv.date||((inv.period||thru)+"-01"),desc:(inv.number?inv.number+" · ":"")+(i.description||"بند فاتورة"),charge:a,paid:0})}})});
  (DATA.fundings||[]).filter(function(x){return x.status!=="cancelled"&&ym(x.date)<=thru&&!invoicedMonth(ym(x.date))}).forEach(function(x){var a=fundingTotal(x);billed+=a;lines.push({date:x.date,desc:"تمويل "+(x.platform||"Meta"),charge:a,paid:0})});
  (DATA.salaryCharges||[]).forEach(function(x){var a=+x.amount||0;if(a&&!invoicedMonth(ym(x.date))){billed+=a;lines.push({date:x.date,desc:x.description||"حصة تشغيل",charge:a,paid:0})}});
  (DATA.payments||[]).filter(function(x){return ym(x.date)<=thru}).forEach(function(x){var a=+x.amount||0;paid+=a;lines.push({date:x.date,desc:"دفعة"+(x.note?" — "+x.note:""),charge:0,paid:a})});
  lines.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0});var run=0;lines.forEach(function(l){run+=l.charge-l.paid;l.run=run});
  return {lines:lines,billed:billed,paid:paid,balance:billed-paid}
}
function deliveredSummary(){
  var o={};Object.keys(TYPES).forEach(function(k){o[k]=0});(DATA.work||[]).forEach(function(w){o[w.type]=(o[w.type]||0)+(+w.qty||0)});return o
}
function renderClient(){
  var c=DATA.customer||{},st=clientStatement(),del=deliveredSummary(),totalDelivered=Object.keys(del).reduce(function(a,k){return a+(del[k]||0)},0);
  var latest=(DATA.invoices||[])[0];
  var inner='<section class="hero"><span class="eyebrow">حساب العميل</span><h1>'+esc(c.name||"")+'</h1><div class="hero-value '+(st.balance>0?"neg":"pos")+'">'+money(Math.abs(st.balance))+'</div>'
    +'<div class="hero-note">'+(st.balance>0?"المبلغ المتبقي عليك":st.balance<0?"رصيد دائن إلك":"الحساب مسدّد")+'</div></section>'
    +'<section class="stats"><div class="stat"><small>إجمالي الحساب</small><b>'+money(st.billed)+'</b></div><div class="stat"><small>المدفوع</small><b class="pos">'+money(st.paid)+'</b></div><div class="stat"><small>التسليمات</small><b>'+totalDelivered+'</b></div></section>'
    +'<div class="grid"><section class="card"><h2>شو تسلّم</h2><p class="sub">كل الأعمال المسجلة على حسابك.</p><div class="list">'
    +((DATA.work||[]).length?(DATA.work||[]).slice(0,30).map(function(w){return '<div class="row"><div class="row-main"><b>'+esc(TYPES[w.type]||w.type)+' · '+esc(w.qty||1)+'×</b><small>'+esc(w.note||"")+'</small></div><div class="row-side"><small>'+esc(w.date||"")+'</small></div></div>'}).join(""):'<div class="empty">ما في تسليمات بعد.</div>')+'</div></section>'
    +'<section class="card"><h2>التمويل</h2><p class="sub">الحملات والميزانيات المسجلة على حسابك.</p><div class="funding-grid">'
    +((DATA.fundings||[]).length?(DATA.fundings||[]).map(function(x){return '<div class="funding"><b>'+esc(x.platform||"Meta")+'</b><small>'+esc(x.date||"")+' · '+esc(x.status||"")+'</small><strong>'+money(fundingTotal(x))+'</strong><small>ميزانية '+money(+x.budget||0)+' · أتعاب '+money(fundingFee(x))+'</small></div>'}).join(""):'<div class="empty">ما في تمويل مسجل.</div>')+'</div></section>'
    +'<section class="card full"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div><h2>الفواتير</h2><p class="sub">اطبع أي فاتورة مباشرة من هون.</p></div><button class="btn no-print" data-act="printstatement">طباعة كشف الحساب</button></div>'
    +'<div>'+((DATA.invoices||[]).length?(DATA.invoices||[]).map(function(inv){return '<div class="invoice-card"><div class="invoice-card-head"><div><b>'+esc(inv.number||inv.id)+'</b><small>'+esc(inv.date||inv.period||"")+' · '+esc(inv.status||"")+'</small></div><span class="invoice-total">'+money(invoiceTotal(inv))+'</span></div><div class="no-print" style="margin-top:10px"><button class="btn" data-act="printinvoice" data-id="'+esc(inv.id)+'">طباعة الفاتورة</button></div></div>'}).join(""):'<div class="empty">ما في فواتير بعد.</div>')+'</div></section></div>';
  shell(inner,c.name,DATA.company||"رِواء ستوديو");
}

function printInvoice(inv){
  var c=DATA.customer||{},items=inv.items||[],total=invoiceTotal(inv);
  var html='<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>'+esc(inv.number||"فاتورة")+'</title><style>body{font-family:Arial,sans-serif;color:#111;padding:40px;max-width:850px;margin:auto}header{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #111;padding-bottom:18px}h1{margin:0}small{color:#666}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:right}.total{font-size:24px;font-weight:700;text-align:left;margin-top:24px}.mut{color:#666}</style></head><body>'
    +'<header><div><h1>رِواء ستوديو</h1><small>'+esc(DATA.company||"")+'</small></div><div><b>'+esc(inv.number||"فاتورة")+'</b><br><small>'+esc(inv.date||"")+'</small></div></header>'
    +'<h2>'+esc(c.name||"")+'</h2><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>'
    +items.map(function(i){return '<tr><td>'+esc(i.description||"بند")+'</td><td>'+money(i.amount)+'</td></tr>'}).join("")
    +'</tbody></table><div class="total">'+money(total)+'</div><p class="mut">شكراً لثقتكم برِواء ستوديو.</p><script>window.onload=function(){window.print()}<\/script></body></html>';
  var w=window.open("","_blank");if(!w)return;w.document.open();w.document.write(html);w.document.close();
}
function printStatement(){
  var st=clientStatement(),c=DATA.customer||{};
  var html='<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف حساب '+esc(c.name||"")+'</title><style>body{font-family:Arial,sans-serif;color:#111;padding:40px;max-width:900px;margin:auto}header{border-bottom:2px solid #111;padding-bottom:18px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:right}.num{direction:ltr;text-align:left}.total{margin-top:24px;font-size:22px;font-weight:700}</style></head><body><header><h1>كشف حساب — '+esc(c.name||"")+'</h1><div>رِواء ستوديو</div></header><table><thead><tr><th>التاريخ</th><th>البيان</th><th>عليه</th><th>دفع</th><th>الرصيد</th></tr></thead><tbody>'
    +st.lines.map(function(l){return '<tr><td>'+esc(l.date)+'</td><td>'+esc(l.desc)+'</td><td class="num">'+(l.charge?money(l.charge):"")+'</td><td class="num">'+(l.paid?money(l.paid):"")+'</td><td class="num">'+money(l.run)+'</td></tr>'}).join("")
    +'</tbody></table><div class="total">الرصيد: '+money(st.balance)+'</div><script>window.onload=function(){window.print()}<\/script></body></html>';
  var w=window.open("","_blank");if(!w)return;w.document.open();w.document.write(html);w.document.close();
}

init().catch(function(){renderLogin();showError("تعذّر الاتصال. جرّب مرة ثانية.")});
})();