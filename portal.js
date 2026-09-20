(function(){
"use strict";

var SUPA_URL="https://gvnpixjkcmbrdfefbamr.supabase.co";
var SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bnBpeGprY21icmRmZWZiYW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDAyNDAsImV4cCI6MjEwMDQ3NjI0MH0.PPuHBLPRwFPvjMgoIWHCubDTX9at5gSgn4QKxcgsbQI";
var KIND=document.body.getAttribute("data-portal")||"staff";
var PORTAL_API="https://studio-ledger-mcp.reahwy66.workers.dev";
var DRIVE_APP_URL="https://script.google.com/macros/s/AKfycby5AkO98YVGA4Lq1r0NdUm_6gTdtu6aPigPRoFad4qu3EQsPpB5M_8x3snTtGYSLEtrlQ/exec";
var SB=null,DATA=null;
var TOKEN_KEY="riwa_portal_"+KIND+"_token";
var TYPES={video:"فيديو",post:"بوست",design:"تصميم",shoot:"تصوير",voice:"فويس",script:"سكربت",task:"مهمة"};
function roleWorkTypes(role){
  var r=String(role||"").toLowerCase().replace(/[أإآ]/g,"ا").replace(/ة/g,"ه");
  var out=[];
  function add(k){if(out.indexOf(k)<0)out.push(k)}
  if(/مونتير|منتير|editor|video editor|editing/.test(r)) add("video");
  if(/مصور|تصوير|photographer|videographer|camera/.test(r)) add("shoot");
  if(/مصمم|جرافيك|graphic|designer|design/.test(r)) add("design");
  if(/كاتب محتوى|كاتبه محتوى|كاتبة محتوى|content writer|copywriter|writer|سكريبت|سكربت/.test(r)) add("script");
  if(/سوشال|social media|social/.test(r)) add("post");
  if(/فويس|voice|vo /.test(r)) add("voice");
  return out.length?out:Object.keys(TYPES);
}

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
function b64ToBytes(value){
  var padding="=".repeat((4-value.length%4)%4);
  var raw=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,function(c){return c.charCodeAt(0)});
}
function portalPushStatus(){
  if(KIND!=="staff") return "off";
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)) return "unsupported";
  if(Notification.permission==="denied") return "denied";
  if(Notification.permission==="granted"&&localStorage.getItem("riwa_staff_push_enabled")==="1") return "enabled";
  return "off";
}
async function enablePortalPush(){
  if(portalPushStatus()==="unsupported") throw new Error("unsupported");
  var reg=await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  var permission=Notification.permission;
  if(permission!=="granted") permission=await Notification.requestPermission();
  if(permission!=="granted") throw new Error(permission==="denied"?"denied":"not_granted");
  var sub=await reg.pushManager.getSubscription();
  if(!sub){
    var cfg=await fetch(PORTAL_API+"/push/config",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("push_config");return r.json()});
    sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(cfg.publicKey)});
  }
  var res=await fetch(PORTAL_API+"/portal/push/subscribe",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token()},
    body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent})
  });
  var data={};try{data=await res.json()}catch(e){}
  if(!res.ok||!data.ok) throw new Error(data.error||"save_device");
  localStorage.setItem("riwa_staff_push_enabled","1");
  return true;
}
function showError(msg){var e=$("#loginError");if(e)e.textContent=msg||""}

async function init(){
  applyTheme();
  var mod=await import("https://esm.sh/@supabase/supabase-js@2");
  SB=mod.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  bindGlobal();
  if(token()) await load();
  else renderLogin();
  if(KIND==="staff"){
    setInterval(function(){
      var a=document.activeElement,editing=a&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
      var wizardBusy=!!document.querySelector(".delivery-wizard[data-dirty='1']");
      if(token()&&!editing&&!wizardBusy) load().catch(function(){});
    },15000);
  }
}

function bindGlobal(){
  document.addEventListener("click",function(e){
    var a=e.target.closest("[data-act]"); if(!a)return;
    var act=a.dataset.act;
    if(act==="logout") logout();
    if(act==="staffpush"){
      (async function(){
        var btn=a;btn.disabled=true;
        try{
          await enablePortalPush();
          btn.textContent="التنبيهات مفعّلة ✓";
          setTimeout(function(){load()},700);
        }catch(err){
          var msg=String(err&&err.message||err);
          alert(msg==="denied"?"التنبيهات محظورة من إعدادات الجهاز.":"تعذّر تفعيل التنبيهات: "+msg);
        }finally{btn.disabled=false}
      })();
    }
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
    +'<div class="top-actions">'+(KIND==="staff"?'<button class="btn staff-push-btn" data-act="staffpush">'+(portalPushStatus()==="enabled"?"التنبيهات مفعّلة ✓":"تفعيل التنبيهات")+'</button>':'')+'<button class="icon-btn" data-act="theme" aria-label="تغيير النمط">◐</button><button class="btn danger" data-act="logout">خروج</button></div>'
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
var STAFF_DRAFT_KEY="riwa_staff_delivery_draft_v2";
function staffDraft(){
  try{
    var d=JSON.parse(localStorage.getItem(STAFF_DRAFT_KEY)||"{}");
    return d&&typeof d==="object"?d:{};
  }catch(e){return {}}
}
function saveStaffDraft(d){
  try{
    var clean=Object.assign({},d||{});
    delete clean.step;
    localStorage.setItem(STAFF_DRAFT_KEY,JSON.stringify(clean));
  }catch(e){}
}
function clearStaffDraft(){
  try{localStorage.removeItem(STAFF_DRAFT_KEY)}catch(e){}
}
function driveUploaderUrl(payload){
  var customer=(DATA.customers||[]).filter(function(c){return c.id===payload.customerId})[0];
  var q=new URLSearchParams({
    mode:"upload",
    customerId:payload.customerId||"",
    customerName:customer&&customer.name||"Client",
    workType:payload.type||"task",
    date:payload.date||today()
  });
  return DRIVE_APP_URL+"?"+q.toString();
}
function wizardTypeLabel(k){return TYPES[k]||k||"—"}
function wizardCustomerName(id){
  var c=(DATA.customers||[]).filter(function(x){return x.id===id})[0];
  return c&&c.name||"—";
}
function renderDeliveryWizard(e){
  var d=staffDraft(),types=roleWorkTypes(e.role),step=window.__RIWA_WIZARD_STEP|| (d.file?3:1);
  if(!d.date)d.date=today();
  if(!d.qty)d.qty=1;
  if(!d.type)d.type=types[0]||"video";

  var customerOpts='<option value="">اختر العميل</option>'+(DATA.customers||[]).map(function(c){
    return '<option value="'+esc(c.id)+'"'+(d.customerId===c.id?' selected':'')+'>'+esc(c.name)+'</option>';
  }).join("");
  var typeOpts=types.map(function(k){
    return '<option value="'+k+'"'+(d.type===k?' selected':'')+'>'+esc(TYPES[k]||k)+'</option>';
  }).join("");

  var html='<section class="card delivery-wizard'+(d.customerId||d.note||d.file?' dirty':'')+'" data-dirty="'+((d.customerId||d.note||d.file)?'1':'0')+'" id="deliveryWizard">'
    +'<div class="wizard-head"><div><h2>تسليم عمل</h2><p class="sub">ثلاث خطوات فقط، والبيانات تبقى محفوظة حتى لو صار تحديث.</p></div>'
    +'<span class="wizard-step-count">0'+step+' / 03</span></div>'
    +'<div class="wizard-steps">'
    +'<button type="button" class="wizard-step '+(step===1?'active':step>1?'done':'')+'" data-wstep="1"><span>1</span><b>العميل والعمل</b></button>'
    +'<button type="button" class="wizard-step '+(step===2?'active':step>2?'done':'')+'" data-wstep="2"><span>2</span><b>رفع الملف</b></button>'
    +'<button type="button" class="wizard-step '+(step===3?'active':'')+'" data-wstep="3"><span>3</span><b>إتمام العمل</b></button>'
    +'</div>'
    +'<form id="workForm" class="delivery-wizard-form">';

  html+='<div class="wizard-panel '+(step===1?'active':'')+'" data-panel="1">'
    +'<div class="wizard-grid">'
    +'<div class="field"><label>العميل</label><select name="customerId" required>'+customerOpts+'</select></div>'
    +'<div class="field"><label>نوع العمل</label><select name="type">'+typeOpts+'</select><small>حسب المسمى الوظيفي: '+esc(e.role||"—")+'</small></div>'
    +'<div class="field"><label>الكمية</label><input name="qty" type="number" min="1" max="100" value="'+esc(d.qty||1)+'"></div>'
    +'<div class="field"><label>التاريخ</label><input name="date" type="date" value="'+esc(d.date||today())+'"></div>'
    +'<div class="field full"><label>ملاحظة</label><textarea name="note" placeholder="تفاصيل اختيارية…">'+esc(d.note||"")+'</textarea></div>'
    +'</div>'
    +'<div class="wizard-actions"><button type="button" class="btn primary wizard-next" data-next="2">التالي: رفع الملف</button></div>'
    +'</div>';

  var iframeSrc=d.customerId?driveUploaderUrl(d):"";
  html+='<div class="wizard-panel '+(step===2?'active':'')+'" data-panel="2">'
    +'<div class="upload-stage">'
    +(d.file?'<div class="uploaded-file-card"><div><b>'+esc(d.file.name||"تم رفع الملف")+'</b><small>'+esc(d.file.archivePath||"Google Drive")+'</small></div><span>تم الرفع ✓</span></div>':'')
    +(iframeSrc?'<iframe class="drive-inline-frame drive-inline-clean" id="driveInlineFrame" src="'+esc(iframeSrc)+'" allow="clipboard-write"></iframe>':'<div class="wizard-warning">ارجع للخطوة الأولى واختر العميل.</div>')
    +'</div>'
    +'<div class="wizard-actions split upload-step-actions"><button type="button" class="btn ghost" data-next="1">رجوع</button></div></div>';

  html+='<div class="wizard-panel '+(step===3?'active':'')+'" data-panel="3">'
    +'<div class="review-card">'
    +'<div><span>العميل</span><b>'+esc(wizardCustomerName(d.customerId))+'</b></div>'
    +'<div><span>نوع العمل</span><b>'+esc(wizardTypeLabel(d.type))+'</b></div>'
    +'<div><span>الكمية</span><b>'+esc(d.qty||1)+'×</b></div>'
    +'<div><span>التاريخ</span><b>'+esc(d.date||today())+'</b></div>'
    +'<div class="full"><span>الملف</span><b>'+esc(d.file&&d.file.name||"—")+'</b></div>'
    +(d.note?'<div class="full"><span>ملاحظة</span><b>'+esc(d.note)+'</b></div>':'')
    +'</div>'
    +'<div class="wizard-actions split"><button type="button" class="btn ghost" data-next="2">رجوع</button><button class="btn primary" type="submit">رفع التسليم</button></div>'
    +'</div>'
    +'<div class="error" id="workError"></div>'
    +'</form></section>';
  return html;
}
function bindDeliveryWizard(){
  var form=$("#workForm"); if(!form)return;
  function collect(){
    var fd=new FormData(form),d=staffDraft();
    fd.forEach(function(v,k){d[k]=v});
    d.qty=+d.qty||1;
    saveStaffDraft(d);
    var w=$("#deliveryWizard"); if(w)w.dataset.dirty="1";
    return d;
  }
  form.addEventListener("input",collect);
  form.addEventListener("change",collect);

  form.querySelectorAll("[data-next]").forEach(function(btn){
    btn.onclick=function(){
      var d=collect(),next=+btn.dataset.next;
      if(next>1&&!d.customerId){$("#workError").textContent="اختَر العميل أولاً.";return}
      var w=$("#deliveryWizard"); if(w)w.dataset.runtimeStep=String(next);
      window.__RIWA_WIZARD_STEP=next;
      renderStaff();
    };
  });
  form.querySelectorAll("[data-wstep]").forEach(function(btn){
    btn.onclick=function(){
      var d=collect(),next=+btn.dataset.wstep;
      if(next>1&&!d.customerId)return;
      if(next===3&&!d.file)return;
      window.__RIWA_WIZARD_STEP=next;
      renderStaff();
    };
  });

  function onMessage(ev){
    var data=ev.data||{};
    if(typeof data==="string"){
      try{data=JSON.parse(data)}catch(_e){}
    }
    if(data&&data.type==="riwa-drive-uploaded"&&data.file){
      var d=collect();
      d.file=data.file;
      saveStaffDraft(d);
      window.__RIWA_WIZARD_STEP=3;
      window.removeEventListener("message",onMessage);
      renderStaff();
      setTimeout(function(){
        var submit=document.querySelector("#workForm button[type='submit']");
        if(submit) submit.scrollIntoView({behavior:"smooth",block:"center"});
      },120);
    }else if(data&&data.type==="riwa-drive-upload-error"){
      $("#workError").textContent="تعذّر رفع الملف — "+String(data.error||"خطأ غير معروف");
    }
  }
  window.addEventListener("message",onMessage);

  form.onsubmit=async function(ev){
    ev.preventDefault();
    var d=collect();
    if(!d.customerId){$("#workError").textContent="اختَر العميل أولاً.";return}
    if(!d.file){window.__RIWA_WIZARD_STEP=2;renderStaff();return}
    var btn=form.querySelector('button[type="submit"]');
    btn.disabled=true;btn.textContent="جاري الإرسال…";$("#workError").textContent="";
    try{
      var payload={
        customerId:d.customerId,type:d.type,qty:+d.qty||1,date:d.date||today(),
        note:d.note||"",file:d.file
      };
      var r=await SB.rpc("portal_staff_submit_work",{p_token:token(),p_data:payload});
      if(r.error) throw new Error(String(r.error.message||r.error.details||r.error.hint||"unknown_error"));
      clearStaffDraft();
      window.__RIWA_WIZARD_STEP=1;
      btn.textContent="تم الإرسال ✓";
      await load();
    }catch(ex){
      $("#workError").textContent="تعذّر إرسال التسليم للمراجعة — "+String(ex&&ex.message||ex);
      btn.disabled=false;btn.textContent="رفع التسليم";
    }
  };
}

function fileKindLabel(file){
  var mime=String(file&&file.mimeType||"");
  if(mime.indexOf("video/")===0) return "فيديو";
  if(mime.indexOf("image/")===0) return "تصميم";
  if(mime.indexOf("pdf")>=0) return "PDF";
  return "ملف";
}
function renderStaff(){
  var e=DATA.employee||{},m=currentMonth(),bal=staffBalance(),monthWork=(DATA.work||[]).filter(function(w){return inMonth(w.date,m)});
  var customerMap={};(DATA.customers||[]).forEach(function(c){customerMap[c.id]=c.name});
  var delivered=monthWork.reduce(function(a,w){return a+(+w.qty||0)},0);
  var submissions=DATA.submissions||[],pending=submissions.filter(function(x){return x.status==="pending"}).length;
  var statusLabel={pending:"بانتظار الموافقة",approved:"تمت الموافقة",rejected:"مرفوض"};
  var statusClass={pending:"wait",approved:"ok",rejected:"bad"};

  var inner='<section class="hero"><span class="eyebrow">'+esc(e.role||"الفريق")+'</span><h1>أهلاً، '+esc(e.name||"")+'</h1>'
    +'<div class="hero-value '+(bal&&bal.balance<0?"neg":"")+'">'+(bal?money(bal.balance):"—")+'</div>'
    +'<div class="hero-note">'+(bal?"رصيدك الحالي من الأعمال التي تمت الموافقة عليها":"الرصيد للشركاء بالنسبة يحتاج مراجعة الإدارة")+'</div></section>'
    +'<section class="stats"><div class="stat"><small>المكتسب</small><b>'+(bal?money(bal.earned):"—")+'</b></div>'
    +'<div class="stat"><small>بانتظار الموافقة</small><b>'+pending+'</b></div>'
    +'<div class="stat"><small>التسليمات المعتمدة</small><b>'+delivered+'</b></div></section>'
    +'<div class="grid">'+renderDeliveryWizard(e)
    +'<section class="card"><h2>طلبات التسليم</h2><p class="sub">تابع حالة الأعمال التي أرسلتها للإدارة.</p><div class="list">'
    +(submissions.length?submissions.slice(0,14).map(function(x){return '<div class="row"><div class="row-main"><b>'+esc(customerMap[x.customerId]||"عميل")+' · '+esc(TYPES[x.type]||x.type)+'</b><small>'+esc(x.note||"")+'</small><span class="status-pill '+statusClass[x.status]+'">'+statusLabel[x.status]+'</span>'+(x.rejectionNote?'<small class="neg">'+esc(x.rejectionNote)+'</small>':'')+'</div><div class="row-side"><b>'+esc(x.qty||1)+'×</b><small>'+esc(x.date||"")+'</small></div></div>'}).join(""):'<div class="empty">ما أرسلت أي طلب بعد.</div>')
    +'</div></section>'
    +'<section class="card full"><h2>الأعمال المعتمدة</h2><p class="sub">هاي الأعمال دخلت بالحساب بعد موافقة الإدارة.</p><div class="list">'
    +((DATA.work||[]).length?(DATA.work||[]).slice(0,16).map(function(w){return '<div class="row"><div class="row-main"><b>'+esc(customerMap[w.customerId]||"عميل")+' · '+esc(TYPES[w.type]||w.type)+'</b><small>'+esc(w.note||"بدون ملاحظة")+'</small></div><div class="row-side"><b>'+esc(w.qty||1)+'×</b><small>'+esc(w.date||"")+'</small></div></div>'}).join(""):'<div class="empty">ما في أعمال معتمدة بعد.</div>')
    +'</div></section></div>';

  shell(inner,e.name,DATA.company||"رِواء ستوديو");
  bindDeliveryWizard();
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
function clientPricingSection(){
  var c=DATA.customer||{},m=currentMonth(),work=(DATA.work||[]).filter(function(w){return inMonth(w.date,m);});
  var services=(DATA.salaryCharges||[]).filter(function(x){return ym(x.date||x.month)===m;});
  var h='<section class="card full pricing-card"><h2>تفاصيل التسعير</h2><p class="sub">كيف عم ينحسب حسابك لهذا الشهر.</p>';

  if(c.billing==="package"){
    var targets={
      video:+c.videos||0,
      post:+c.posts||0,
      design:+c.designs||0
    };
    var done={video:0,post:0,design:0};
    work.forEach(function(w){
      if(done[w.type]!=null) done[w.type]+=(+w.qty||0);
    });

    var totalTarget=targets.video+targets.post+targets.design;
    var totalDone=Math.min(done.video,targets.video||done.video)
      +Math.min(done.post,targets.post||done.post)
      +Math.min(done.design,targets.design||done.design);
    var pct=totalTarget?Math.min(100,totalDone/totalTarget*100):(totalDone?100:0);

    var packageParts=[];
    if(targets.video) packageParts.push({key:"video",label:"فيديو",target:targets.video,done:done.video});
    if(targets.post) packageParts.push({key:"post",label:"بوست",target:targets.post,done:done.post});
    if(targets.design) packageParts.push({key:"design",label:"تصميم",target:targets.design,done:done.design});

    h+='<div class="pricing-head"><div><span class="pill">باقة شهرية</span><b>'+money(+c.monthlyFee||0)+' / شهر</b></div>'
      +'<div class="package-count"><b>'+totalDone+'</b><span>/ '+totalTarget+' عنصر</span></div></div>'
      +'<div class="package-progress"><i style="width:'+pct.toFixed(1)+'%"></i></div>'
      +'<div class="package-progress-meta"><span>المنجز '+pct.toFixed(0)+'%</span><span>'+m+'</span></div>';

    if(packageParts.length){
      h+='<div class="package-breakdown">'
        +packageParts.map(function(p){
          var pp=p.target?Math.min(100,p.done/p.target*100):0;
          return '<div class="package-part"><div class="package-part-head"><span>'+p.label+'</span><b class="num">'+p.done+' / '+p.target+'</b></div>'
            +'<div class="package-part-bar"><i style="width:'+pp.toFixed(1)+'%"></i></div></div>';
        }).join("")
        +'</div>';
    }

    h+='<div class="delivery-dates"><small>تواريخ الإنجاز</small><div>'
      +(work.length?work.filter(function(w){return ["video","post","design"].indexOf(w.type)>=0;}).map(function(w){
        return '<span class="date-chip">'+esc(TYPES[w.type]||w.type)+' · '+esc(w.date)+' · '+esc(w.qty||1)+'×</span>';
      }).join(""):'<span class="mut">ما في أعمال معتمدة بهذا الشهر بعد.</span>')
      +'</div></div>';
  }else if(c.billing==="per_design"){
    h+='<div class="price-lines"><div class="price-line"><span>التصميم</span><b>'+money(+c.drate||+c.rate||0)+'</b></div></div>';
  }else{
    h+='<div class="price-lines"><div class="price-line"><span>الفيديو</span><b>'+money(+c.rate||0)+'</b></div>'
      +((+c.drate||0)?'<div class="price-line"><span>التصميم</span><b>'+money(+c.drate||0)+'</b></div>':'')+'</div>';
  }

  if(services.length){
    h+='<div class="service-lines"><h3>الخدمات</h3>'
      +services.map(function(x){return '<div class="service-line"><div><b>'+esc(x.serviceName||x.description||"خدمة تشغيل")+'</b><small>'+esc(x.month||ym(x.date)||m)+'</small></div><strong>'+money(+x.amount||0)+'</strong></div>'}).join("")
      +'</div>';
  }
  return h+'</section>';
}
function clientDeliverySection(){
  var c=DATA.customer||{},work=DATA.work||[];
  return '<section class="card"><h2>شو تسلّم</h2><p class="sub">كل الأعمال المعتمدة والمسجلة على حسابك.</p><div class="list">'
    +(work.length?work.slice(0,40).map(function(w){
      var rate=0,label=TYPES[w.type]||w.type;
      if(c.billing!=="package"){
        if(w.type==="video")rate=+c.rate||0;
        else if(w.type==="design")rate=+c.drate||(c.billing==="per_design"?+c.rate:0)||0;
      }
      return '<div class="row"><div class="row-main"><b>'+esc(label)+' · '+esc(w.qty||1)+'×</b><small>'+esc(w.note||"")+'</small>'
        +(rate?'<small class="unit-price">'+money(rate)+' لكل '+esc(label)+'</small>':'')+'</div><div class="row-side">'+(rate?'<b>'+money((+w.qty||0)*rate)+'</b>':'')+'<small>'+esc(w.date||"")+'</small></div></div>';
    }).join(""):'<div class="empty">ما في تسليمات معتمدة بعد.</div>')+'</div></section>';
}
function clientArchiveSection(){
  var files=(DATA.work||[]).filter(function(w){return w.file&&w.file.driveFileId;});
  return '<section class="card full archive-card"><div class="card-head-actions"><div><h2>أرشيف الملفات</h2><p class="sub">كل الملفات المعتمدة متاحة للمشاهدة والتحميل بأي وقت.</p></div><span class="pill">'+files.length+'</span></div>'
    +(files.length?'<div class="archive-grid">'+files.map(function(w){
      var f=w.file||{},mime=String(f.mimeType||""),preview="";
      if(mime.indexOf("video/")===0&&f.previewUrl){
        preview='<div class="archive-preview video embedded"><iframe src="'+esc(f.previewUrl)+'" allow="autoplay; fullscreen" allowfullscreen loading="lazy" title="'+esc(f.name||"فيديو")+'"></iframe></div>';
      }else if(mime.indexOf("image/")===0){
        preview='<div class="archive-preview image"><img src="'+esc(f.thumbnailLink||f.webViewLink||"")+'" alt="'+esc(f.name||"")+'" loading="lazy"></div>';
      }else if((mime.indexOf("pdf")>=0||mime.indexOf("document")>=0)&&f.previewUrl){
        preview='<div class="archive-preview document embedded"><iframe src="'+esc(f.previewUrl)+'" loading="lazy" title="'+esc(f.name||"ملف")+'"></iframe></div>';
      }else{
        preview='<div class="archive-preview file"><span>▤</span><small>'+esc(fileKindLabel(f))+'</small></div>';
      }
      return '<article class="archive-item">'+preview+'<div class="archive-meta"><div><b>'+esc(f.name||"ملف")+'</b><small>'+esc([TYPES[w.type]||w.type,w.date].filter(Boolean).join(" · "))+'</small></div>'
        +'<div class="archive-actions">'+(f.webViewLink?'<a class="btn" href="'+esc(f.webViewLink)+'" target="_blank" rel="noopener">مشاهدة</a>':'')
        +(f.webContentLink?'<a class="btn primary" href="'+esc(f.webContentLink)+'" target="_blank" rel="noopener">تحميل</a>':'')+'</div></div></article>';
    }).join("")+'</div>':'<div class="empty">ما في ملفات معتمدة بالأرشيف بعد.</div>')
    +'</section>';
}
function renderClient(){
  var c=DATA.customer||{},st=clientStatement(),del=deliveredSummary(),totalDelivered=Object.keys(del).reduce(function(a,k){return a+(del[k]||0)},0);
  var inner='<section class="hero"><span class="eyebrow">حساب العميل</span><h1>'+esc(c.name||"")+'</h1><div class="hero-value '+(st.balance>0?"neg":"pos")+'">'+money(Math.abs(st.balance))+'</div>'
    +'<div class="hero-note">'+(st.balance>0?"المبلغ المتبقي عليك":st.balance<0?"رصيد دائن إلك":"الحساب مسدّد")+'</div></section>'
    +'<section class="stats"><div class="stat"><small>إجمالي الحساب</small><b>'+money(st.billed)+'</b></div><div class="stat"><small>المدفوع</small><b class="pos">'+money(st.paid)+'</b></div><div class="stat"><small>التسليمات المعتمدة</small><b>'+totalDelivered+'</b></div></section>'
    +'<div class="grid">'+clientPricingSection()+clientDeliverySection()+clientArchiveSection()
    +'<section class="card"><h2>التمويل</h2><p class="sub">الحملات والميزانيات المسجلة على حسابك.</p><div class="funding-grid">'
    +((DATA.fundings||[]).length?(DATA.fundings||[]).map(function(x){return '<div class="funding"><b>'+esc(x.platform||"Meta")+'</b><small>'+esc(x.date||"")+' · '+esc(x.status||"")+'</small><strong>'+money(fundingTotal(x))+'</strong><small>ميزانية '+money(+x.budget||0)+' · أتعاب '+money(fundingFee(x))+'</small></div>'}).join(""):'<div class="empty">ما في تمويل مسجل.</div>')+'</div></section>'
    +'<section class="card full"><div class="card-head-actions"><div><h2>الفواتير</h2><p class="sub">اطبع أي فاتورة مباشرة من هون.</p></div><button class="btn no-print" data-act="printstatement">طباعة كشف الحساب</button></div>'
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