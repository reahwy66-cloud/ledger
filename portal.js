(function(){
"use strict";

var SUPA_URL="https://gvnpixjkcmbrdfefbamr.supabase.co";
var SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bnBpeGprY21icmRmZWZiYW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDAyNDAsImV4cCI6MjEwMDQ3NjI0MH0.PPuHBLPRwFPvjMgoIWHCubDTX9at5gSgn4QKxcgsbQI";
var KIND=document.body.getAttribute("data-portal")||"staff";
var PORTAL_API="https://studio-ledger-mcp.reahwy66.workers.dev";
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
function txDate(x){return String((x&&x.transaction_date)||(x&&x.date)||"")}
function acctMonth(x){return String((x&&x.accounting_month)||ym(txDate(x)))}
function countsInPackage(w){return !(w&&w.archived===true&&w.countInPackage===false)}
function today(){return new Date().toISOString().slice(0,10)}
function currentMonth(){return today().slice(0,7)}
function inMonth(d,m){return ym(d)===m}
function inAccountingMonth(x,m){return acctMonth(x)===m}
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
    if(act==="archivevideo"&&KIND==="client") openArchiveVideo(a.dataset.url||"",a.dataset.name||"فيديو");
    if(act==="designprev"&&KIND==="client") moveDesignCarousel(a.closest("[data-design-carousel]"),-1);
    if(act==="designnext"&&KIND==="client") moveDesignCarousel(a.closest("[data-design-carousel]"),1);
    if(act==="designslide"&&KIND==="client") setDesignCarousel(a.closest("[data-design-carousel]"),Number(a.dataset.index||0));
    if(act==="designopen"&&KIND==="client") openDesignViewer(a.closest("[data-design-carousel]"),Number(a.dataset.index||0));
  });
  var swipeStart=null;
  document.addEventListener("touchstart",function(e){
    if(KIND!=="client")return;
    var root=e.target.closest&&e.target.closest("[data-design-carousel]");
    if(!root||!e.touches||e.touches.length!==1)return;
    swipeStart={root:root,x:e.touches[0].clientX,y:e.touches[0].clientY};
  },{passive:true});
  document.addEventListener("touchend",function(e){
    if(!swipeStart||!e.changedTouches||!e.changedTouches.length){swipeStart=null;return;}
    var s=swipeStart;swipeStart=null;
    var dx=e.changedTouches[0].clientX-s.x,dy=e.changedTouches[0].clientY-s.y;
    if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.2) moveDesignCarousel(s.root,dx<0?1:-1);
  },{passive:true});
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
  return (DATA.work||[]).filter(function(w){return countsInPackage(w)&&inAccountingMonth(w,m)&&(e.payType!=="per_video"||w.type==="video")}).reduce(function(a,w){
    if(w.amount!==""&&w.amount!=null)return a+(+w.amount||0);
    return a+(+w.qty||0)*(+e.rate||0)
  },0)
}
function staffBalance(){
  var e=DATA.employee,m=currentMonth(),earned=staffEarned(e,m);
  if(earned==null)return null;
  var adv=(DATA.advances||[]).filter(function(x){return inAccountingMonth(x,m)}).reduce(function(a,x){return a+(+x.amount||0)},0);
  var paid=(DATA.payouts||[]).filter(function(x){return inAccountingMonth(x,m)}).reduce(function(a,x){return a+(+x.amount||0)},0);
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
function uploadBytesLabel(bytes){
  var n=Number(bytes||0),u=["B","KB","MB","GB"],i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}
  return (i===0?Math.round(n):n.toFixed(n>=10?1:2))+" "+u[i];
}
function uploadMegabytes(bytes){
  return (Math.max(0,Number(bytes||0))/1048576).toFixed(2)+" MB";
}
function driveFileMeta(meta,file,archivePath){
  meta=meta||{};
  var id=meta.id||"";
  return {
    driveFileId:id,
    name:meta.name||file.name,
    mimeType:meta.mimeType||file.type||"application/octet-stream",
    size:Number(meta.size||file.size||0),
    webViewLink:meta.webViewLink||("https://drive.google.com/file/d/"+id+"/view"),
    webContentLink:meta.webContentLink||("https://drive.google.com/uc?export=download&id="+encodeURIComponent(id)),
    thumbnailLink:meta.thumbnailLink||"",
    previewUrl:"https://drive.google.com/file/d/"+id+"/preview",
    archivePath:archivePath||""
  };
}
async function createDriveUploadSession(file,d){
  var r=await fetch(PORTAL_API+"/portal/drive/upload-session",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "authorization":"Bearer "+token()
    },
    body:JSON.stringify({
      customerId:d.customerId,
      fileName:file.name,
      mimeType:file.type||"application/octet-stream",
      size:file.size,
      workType:d.type||"task",
      date:d.date||today(),
      origin:location.origin
    })
  });
  var data={};try{data=await r.json()}catch(_e){}
  if(!r.ok||!data.ok||!data.uploadUrl){
    throw new Error(data.error||("upload_session_"+r.status));
  }
  return data;
}
function putDriveChunk(url,blob,start,end,total,mime,onProgress){
  return new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();
    window.__RIWA_UPLOAD_XHR=xhr;
    xhr.open("PUT",url,true);
    xhr.setRequestHeader("Content-Type",mime||"application/octet-stream");
    xhr.setRequestHeader("Content-Range","bytes "+start+"-"+(end-1)+"/"+total);
    xhr.upload.onprogress=function(ev){
      if(ev.lengthComputable&&onProgress) onProgress(ev.loaded,ev.total);
    };
    xhr.onerror=function(){reject(new Error("network_upload_failed"))};
    xhr.onabort=function(){reject(new Error("upload_cancelled"))};
    xhr.onload=function(){
      var body={};
      if(xhr.responseText){try{body=JSON.parse(xhr.responseText)}catch(_e){}}
      if(xhr.status===308||xhr.status===200||xhr.status===201){
        resolve({status:xhr.status,body:body});
      }else{
        reject(new Error((body&&body.error&&body.error.message)||("drive_upload_"+xhr.status)));
      }
    };
    xhr.send(blob);
  });
}
async function uploadDirectToDrive(file,d,onProgress){
  var session=await createDriveUploadSession(file,d);
  var chunkSize=8*1024*1024;
  var offset=0,attempts=0,lastBody=null;

  while(offset<file.size){
    var end=Math.min(offset+chunkSize,file.size);
    var blob=file.slice(offset,end);
    try{
      var result=await putDriveChunk(
        session.uploadUrl,blob,offset,end,file.size,
        file.type||"application/octet-stream",
        function(loaded){
          if(onProgress) onProgress(Math.min(file.size,offset+loaded),file.size);
        }
      );
      attempts=0;
      lastBody=result.body||{};
      offset=end;
      if(onProgress) onProgress(offset,file.size);
      if(result.status===200||result.status===201) break;
    }catch(err){
      if(String(err&&err.message||err)==="upload_cancelled") throw err;
      throw err;
    }
  }

  window.__RIWA_UPLOAD_XHR=null;
  if(!lastBody||!lastBody.id) throw new Error("drive_upload_missing_file");
  return driveFileMeta(lastBody,file,session.archivePath||"");
}
function wizardTypeLabel(k){return TYPES[k]||k||"—"}
function wizardCustomerName(id){
  var c=(DATA.customers||[]).filter(function(x){return x.id===id})[0];
  return c&&c.name||"—";
}
function staffDraftFiles(d){
  var out=[],seen={};
  function add(f){
    var id=String(f&&f.driveFileId||"");
    if(!id||seen[id])return;
    seen[id]=1;out.push(f);
  }
  add(d&&d.file);
  if(d&&Array.isArray(d.files))d.files.forEach(add);
  return out;
}
function renderDeliveryWizard(e){
  var d=staffDraft(),types=roleWorkTypes(e.role),uploaded=staffDraftFiles(d);
  var step=window.__RIWA_WIZARD_STEP||(uploaded.length?3:1);
  if(!d.date)d.date=today();
  if(!d.qty)d.qty=1;
  if(!d.type)d.type=types[0]||"video";
  var designMode=d.type==="design";

  var customerOpts='<option value="">اختر العميل</option>'+(DATA.customers||[]).map(function(c){
    return '<option value="'+esc(c.id)+'"'+(d.customerId===c.id?' selected':'')+'>'+esc(c.name)+'</option>';
  }).join("");
  var typeOpts=types.map(function(k){
    return '<option value="'+k+'"'+(d.type===k?' selected':'')+'>'+esc(TYPES[k]||k)+'</option>';
  }).join("");

  var html='<section class="card delivery-wizard'+(d.customerId||d.note||uploaded.length?' dirty':'')+'" data-dirty="'+((d.customerId||d.note||uploaded.length)?'1':'0')+'" id="deliveryWizard">'
    +'<div class="wizard-head"><div><h2>تسليم عمل</h2><p class="sub">ثلاث خطوات فقط، والبيانات تبقى محفوظة حتى لو صار تحديث.</p></div>'
    +'<span class="wizard-step-count">0'+step+' / 03</span></div>'
    +'<div class="wizard-steps">'
    +'<button type="button" class="wizard-step '+(step===1?'active':step>1?'done':'')+'" data-wstep="1"><span>1</span><b>العميل والعمل</b></button>'
    +'<button type="button" class="wizard-step '+(step===2?'active':step>2?'done':'')+'" data-wstep="2"><span>2</span><b>'+(designMode?'رفع الصور':'رفع الملف')+'</b></button>'
    +'<button type="button" class="wizard-step '+(step===3?'active':'')+'" data-wstep="3"><span>3</span><b>إتمام العمل</b></button>'
    +'</div>'
    +'<form id="workForm" class="delivery-wizard-form">';

  html+='<div class="wizard-panel '+(step===1?'active':'')+'" data-panel="1">'
    +'<div class="wizard-grid">'
    +'<div class="field wizard-equal-field"><label>العميل</label><select name="customerId" required>'+customerOpts+'</select><small class="field-hint-spacer">&nbsp;</small></div>'
    +'<div class="field wizard-equal-field"><label>نوع العمل</label><select name="type">'+typeOpts+'</select><small>حسب المسمى الوظيفي: '+esc(e.role||"—")+'</small></div>'
    +'<div class="field"><label>الكمية</label><input name="qty" type="number" min="1" max="100" value="'+esc(d.qty||1)+'"></div>'
    +'<div class="field"><label>التاريخ</label><input name="date" type="date" value="'+esc(d.date||today())+'"></div>'
    +'<div class="field full"><label>ملاحظة</label><textarea name="note" placeholder="تفاصيل اختيارية…">'+esc(d.note||"")+'</textarea></div>'
    +'</div>'
    +'<div class="wizard-actions"><button type="button" class="btn primary wizard-next" data-next="2">التالي: '+(designMode?'رفع الصور':'رفع الملف')+'</button></div>'
    +'</div>';

  html+='<div class="wizard-panel '+(step===2?'active':'')+'" data-panel="2"><div class="upload-stage">';
  if(uploaded.length){
    html+='<div class="uploaded-file-stack">'+uploaded.map(function(file,i){
      return '<div class="uploaded-file-card"><div><b>'+(designMode?'الصورة '+(i+1)+' — ':'')+esc(file.name||"تم رفع الملف")+'</b><small>'+esc(file.archivePath||"Google Drive")+'</small></div><span>تم الرفع ✓</span></div>';
    }).join("")+'</div>';
  }
  if(designMode||!uploaded.length){
    html+='<label class="direct-upload-zone" id="directUploadZone">'
      +'<input id="directDriveFile" type="file" '+(designMode?'accept="image/*" multiple':'accept="video/*,image/*,.pdf,.doc,.docx"')+'>'
      +'<div class="direct-upload-copy"><span class="direct-upload-icon">↥</span><div><h3>'+(designMode?(uploaded.length?'أضف صوراً أخرى':'اسحب صور التصميم وأفلتها هنا'):'اسحب الملف وأفلته هنا')+'</h3><p>'
      +(designMode?'يمكنك اختيار عدة صور دفعة واحدة. ترتيب العرض سيكون حسب ترتيب الرفع، وأول صورة ستكون الغلاف.':'أو اضغط لاختيار الملف. الرفع مباشر إلى Google Drive مع نسبة حقيقية.')+'</p></div></div>'
      +'<div class="direct-upload-progress" id="directUploadProgress">'
      +'<div class="direct-upload-progress-head"><div><b id="directUploadName">—</b><small id="directUploadSize"></small></div><strong id="directUploadPercent">0.00 MB</strong></div>'
      +'<div class="direct-upload-track"><i id="directUploadBar"></i></div>'
      +'<small class="direct-upload-status" id="directUploadStatus">جاري تجهيز الرفع…</small>'
      +'</div></label>'
      +'<button type="button" class="btn ghost direct-upload-cancel" id="directUploadCancel" hidden>إلغاء الرفع</button>';
  }
  html+='</div><div class="wizard-actions split upload-step-actions"><button type="button" class="btn ghost" data-next="1">رجوع</button>'
    +(uploaded.length?'<button type="button" class="btn primary" data-next="3">التالي: إتمام العمل</button>':'')+'</div></div>';

  html+='<div class="wizard-panel '+(step===3?'active':'')+'" data-panel="3">'
    +'<div class="review-card">'
    +'<div><span>العميل</span><b>'+esc(wizardCustomerName(d.customerId))+'</b></div>'
    +'<div><span>نوع العمل</span><b>'+esc(wizardTypeLabel(d.type))+'</b></div>'
    +'<div><span>الكمية</span><b>'+esc(d.qty||1)+'×</b></div>'
    +'<div><span>التاريخ</span><b>'+esc(d.date||today())+'</b></div>'
    +'<div class="full"><span>'+(designMode?'الصور':'الملف')+'</span><b>'+(uploaded.length?(designMode?uploaded.length+' صورة':esc(uploaded[0].name||"ملف")):"—")+'</b></div>'
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
      if(window.__RIWA_UPLOAD_XHR){$("#workError").textContent="انتظر حتى يكتمل رفع الملف أو ألغِ الرفع أولاً.";return}
      var d=collect(),next=+btn.dataset.next,files=staffDraftFiles(d);
      if(next>1&&!d.customerId){$("#workError").textContent="اختَر العميل أولاً.";return}
      if(next===3&&!files.length){$("#workError").textContent=d.type==="design"?"ارفع صورة واحدة على الأقل.":"ارفع الملف أولاً.";return}
      window.__RIWA_WIZARD_STEP=next;
      renderStaff();
    };
  });
  form.querySelectorAll("[data-wstep]").forEach(function(btn){
    btn.onclick=function(){
      if(window.__RIWA_UPLOAD_XHR)return;
      var d=collect(),next=+btn.dataset.wstep,files=staffDraftFiles(d);
      if(next>1&&!d.customerId)return;
      if(next===3&&!files.length)return;
      window.__RIWA_WIZARD_STEP=next;
      renderStaff();
    };
  });

  var input=$("#directDriveFile"),zone=$("#directUploadZone"),cancel=$("#directUploadCancel");
  function setUploadUi(file,loaded,total,statusText,isError){
    var progress=$("#directUploadProgress"),copy=zone&&zone.querySelector(".direct-upload-copy");
    if(progress)progress.classList.add("show");
    if(copy)copy.style.display="none";
    if(input)input.disabled=true;
    if(cancel)cancel.hidden=false;
    var pct=total?Math.max(0,Math.min(100,(loaded/total)*100)):0;
    var bar=$("#directUploadBar"),percent=$("#directUploadPercent"),name=$("#directUploadName"),size=$("#directUploadSize"),status=$("#directUploadStatus");
    if(bar)bar.style.width=pct.toFixed(2)+"%";
    if(percent)percent.textContent=uploadMegabytes(loaded)+" / "+uploadMegabytes(total||file.size);
    if(name)name.textContent=file.name;
    if(size)size.textContent="الحجم الكلي: "+uploadMegabytes(file.size);
    if(status){status.textContent=statusText||"جاري الرفع…";status.classList.toggle("error",!!isError)}
  }
  async function startUploadFiles(files){
    var d=collect();
    if(!d.customerId){$("#workError").textContent="اختَر العميل أولاً.";return}
    files=Array.prototype.slice.call(files||[]).filter(Boolean);
    if(!files.length)return;
    if(d.type!=="design")files=files.slice(0,1);
    if(d.type==="design"&&files.some(function(file){return String(file.type||"").indexOf("image/")!==0})){
      $("#workError").textContent="التصميم يقبل صوراً فقط.";
      return;
    }
    $("#workError").textContent="";
    var latest=staffDraft(),existing=staffDraftFiles(latest),added=[];
    try{
      for(var i=0;i<files.length;i++){
        var file=files[i];
        setUploadUi(file,0,file.size,(d.type==="design"?"الصورة "+(i+1)+" من "+files.length+" — ":"")+"جاري إنشاء جلسة رفع آمنة…",false);
        var meta=await uploadDirectToDrive(file,d,function(loaded,total){
          setUploadUi(file,loaded,total,(d.type==="design"?"الصورة "+(i+1)+" من "+files.length+" — ":"")+"جاري الرفع مباشرة إلى Google Drive…",false);
        });
        added.push(meta);
      }
      var all=existing.concat(added),seen={},ordered=[];
      all.forEach(function(file){var id=String(file&&file.driveFileId||"");if(id&&!seen[id]){seen[id]=1;ordered.push(file)}});
      latest.file=ordered[0]||null;
      latest.files=ordered;
      saveStaffDraft(latest);
      window.__RIWA_UPLOAD_XHR=null;
      window.__RIWA_WIZARD_STEP=3;
      renderStaff();
      setTimeout(function(){
        var submit=document.querySelector("#workForm button[type='submit']");
        if(submit)submit.scrollIntoView({behavior:"smooth",block:"center"});
      },100);
    }catch(ex){
      window.__RIWA_UPLOAD_XHR=null;
      var msg=String(ex&&ex.message||ex);
      if(msg==="upload_cancelled"){
        if(files[0])setUploadUi(files[0],0,files[0].size,"تم إلغاء الرفع.",false);
      }else{
        if(files[0])setUploadUi(files[0],0,files[0].size,"تعذّر رفع الملف: "+msg,true);
        $("#workError").textContent="تعذّر رفع الملف — "+msg;
      }
      if(input)input.disabled=false;
      if(cancel)cancel.hidden=true;
      var copy=zone&&zone.querySelector(".direct-upload-copy");
      if(copy)copy.style.display="";
    }
  }
  if(input){
    input.onchange=function(){
      if(input.files&&input.files.length)startUploadFiles(input.files);
    };
  }
  if(zone){
    ["dragenter","dragover"].forEach(function(name){
      zone.addEventListener(name,function(ev){ev.preventDefault();zone.classList.add("drag")});
    });
    ["dragleave","drop"].forEach(function(name){
      zone.addEventListener(name,function(ev){ev.preventDefault();zone.classList.remove("drag")});
    });
    zone.addEventListener("drop",function(ev){
      var files=ev.dataTransfer&&ev.dataTransfer.files;
      if(files&&files.length)startUploadFiles(files);
    });
  }
  if(cancel){
    cancel.onclick=function(){
      if(window.__RIWA_UPLOAD_XHR)window.__RIWA_UPLOAD_XHR.abort();
    };
  }

  form.onsubmit=async function(ev){
    ev.preventDefault();
    var d=collect(),files=staffDraftFiles(d);
    if(!d.customerId){$("#workError").textContent="اختَر العميل أولاً.";return}
    if(!files.length){window.__RIWA_WIZARD_STEP=2;renderStaff();return}
    var btn=form.querySelector('button[type="submit"]');
    btn.disabled=true;btn.textContent="جاري الإرسال…";$("#workError").textContent="";
    try{
      var payload={
        customerId:d.customerId,type:d.type,qty:+d.qty||1,date:d.date||today(),
        note:d.note||"",file:files[0],files:files
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
  var e=DATA.employee||{},m=currentMonth(),bal=staffBalance(),monthWork=(DATA.work||[]).filter(function(w){return countsInPackage(w)&&inAccountingMonth(w,m)});
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
  (DATA.work||[]).filter(function(w){return countsInPackage(w)&&acctMonth(w)<=thru&&!invoicedMonth(acctMonth(w))}).forEach(function(w){
    var amt=0;if(c.billing==="per_design"&&w.type==="design")amt=(+w.qty||0)*dr;
    else if(c.billing!=="package"&&w.type==="video")amt=(+w.qty||0)*vr;
    else if(c.billing!=="package"&&w.type==="design"&&dr)amt=(+w.qty||0)*dr;
    else if(c.billing==="package"&&w.type==="design"&&dr)amt=(+w.qty||0)*dr;
    if(amt){billed+=amt;lines.push({date:w.date,desc:(w.qty||1)+" × "+(TYPES[w.type]||w.type),charge:amt,paid:0})}
    if((+w.charge||0)>0){billed+=+w.charge;lines.push({date:w.date,desc:(TYPES[w.type]||w.type)+(w.note?" — "+w.note:""),charge:+w.charge,paid:0})}
  });
  explicit.forEach(function(inv){(inv.items||[]).forEach(function(i){var a=+i.amount||0;if(a){billed+=a;lines.push({date:inv.date||((inv.period||thru)+"-01"),desc:(inv.number?inv.number+" · ":"")+(i.description||"بند فاتورة"),charge:a,paid:0})}})});
  (DATA.fundings||[]).filter(function(x){return x.status!=="cancelled"&&acctMonth(x)<=thru}).forEach(function(x){
    var covered=explicit.some(function(inv){return (inv.items||[]).some(function(item){
      return item&&((item.fundingId&&item.fundingId===x.id)||(item.kind==="funding"&&(!item.fundingId||item.fundingId===x.id)));
    })});
    if(covered)return;
    var a=fundingTotal(x);billed+=a;lines.push({date:txDate(x),desc:"تمويل "+(x.platform||"Meta"),charge:a,paid:0})
  });
  (DATA.salaryCharges||[]).forEach(function(x){var a=+x.amount||0;if(a&&!invoicedMonth(ym(x.date))){billed+=a;lines.push({date:x.date,desc:x.description||"حصة تشغيل",charge:a,paid:0})}});
  (DATA.payments||[]).filter(function(x){return acctMonth(x)<=thru}).forEach(function(x){var a=+x.amount||0;paid+=a;lines.push({date:txDate(x),desc:(x.kind==="funding"?"دفعة تمويل":"دفعة")+(x.note?" — "+x.note:""),charge:0,paid:a})});
  lines.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0});var run=0;lines.forEach(function(l){run+=l.charge-l.paid;l.run=run});
  return {lines:lines,billed:billed,paid:paid,balance:billed-paid}
}
function deliveredSummary(){
  var o={};Object.keys(TYPES).forEach(function(k){o[k]=0});(DATA.work||[]).filter(countsInPackage).forEach(function(w){o[w.type]=(o[w.type]||0)+(+w.qty||0)});return o
}
function clientPricingSection(){
  var c=DATA.customer||{},m=currentMonth(),work=(DATA.work||[]).filter(function(w){return countsInPackage(w)&&inAccountingMonth(w,m);});
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
function workFilesList(w){
  var out=[],seen={};
  function add(f){
    var id=String(f&&f.driveFileId||"");
    if(!id||seen[id])return;
    seen[id]=1;out.push(f);
  }
  add(w&&w.file);
  if(w&&Array.isArray(w.files))w.files.forEach(add);
  return out;
}
function archiveMediaUrl(w,index,download){
  return PORTAL_API+"/portal/client/file?token="+encodeURIComponent(token())+"&workId="+encodeURIComponent(w.id||"")+"&fileIndex="+index+(download?"&download=1":"");
}
function designPostCard(w,files){
  var imageEntries=files.map(function(f,index){return {f:f,index:index}}).filter(function(entry){
    return String(entry.f&&entry.f.mimeType||"").indexOf("image/")===0;
  });
  if(!imageEntries.length)return "";
  var count=imageEntries.length;
  var slides=imageEntries.map(function(entry,i){
    var src=archiveMediaUrl(w,entry.index,false),download=archiveMediaUrl(w,entry.index,true);
    return '<div class="design-slide'+(i===0?' active':'')+'" data-design-slide="'+i+'" data-download="'+esc(download)+'" data-act="designopen" data-index="'+i+'" role="button" tabindex="0">'
      +'<img src="'+esc(src)+'" alt="'+esc(entry.f.name||("تصميم "+(i+1)))+'" loading="lazy"></div>';
  }).join("");
  var dots=count>1?'<div class="design-dots">'+imageEntries.map(function(_entry,i){
    return '<button type="button" class="'+(i===0?'active':'')+'" data-act="designslide" data-index="'+i+'" aria-label="الصورة '+(i+1)+'"></button>';
  }).join("")+'</div>':'';
  return '<article class="archive-item design-post" data-design-carousel data-index="0">'
    +'<div class="design-post-head"><div class="design-avatar">رِ</div><div><b>رِواء ستوديو</b><small>'+esc(w.date||"")+'</small></div><span class="design-count">1/'+count+'</span></div>'
    +'<div class="design-stage">'+slides
    +(count>1?'<button type="button" class="design-nav prev" data-act="designprev" aria-label="السابق">‹</button><button type="button" class="design-nav next" data-act="designnext" aria-label="التالي">›</button>':'')
    +'</div>'+dots
    +'<div class="design-post-foot"><div><b>'+(count>1?'كاروسيل':'تصميم')+'</b><small>'+count+' '+(count===1?'صورة':'صور')+' · '+esc(w.note||"")+'</small></div>'
    +'<a class="btn primary design-download" href="'+esc(archiveMediaUrl(w,imageEntries[0].index,true))+'" target="_blank" rel="noopener">تحميل الصورة</a></div>'
    +'</article>';
}
function setDesignCarousel(root,index){
  if(!root)return;
  var slides=Array.prototype.slice.call(root.querySelectorAll("[data-design-slide]"));
  if(!slides.length)return;
  index=((index%slides.length)+slides.length)%slides.length;
  root.dataset.index=String(index);
  slides.forEach(function(slide,i){slide.classList.toggle("active",i===index)});
  Array.prototype.forEach.call(root.querySelectorAll(".design-dots button"),function(dot,i){dot.classList.toggle("active",i===index)});
  var count=root.querySelector(".design-count");if(count)count.textContent=(index+1)+"/"+slides.length;
  var dl=root.querySelector(".design-download"),active=slides[index];
  if(dl&&active&&active.dataset.download)dl.href=active.dataset.download;
}
function moveDesignCarousel(root,delta){
  if(!root)return;
  setDesignCarousel(root,Number(root.dataset.index||0)+delta);
}
function openDesignViewer(root,startIndex){
  if(!root)return;
  var slides=Array.prototype.slice.call(root.querySelectorAll("[data-design-slide]"));
  if(!slides.length)return;
  var entries=slides.map(function(slide){
    var img=slide.querySelector("img");
    return {src:img?img.src:"",alt:img?img.alt:"",download:slide.dataset.download||""};
  }).filter(function(x){return x.src});
  if(!entries.length)return;
  var old=document.querySelector(".archive-viewer-overlay");if(old)old.remove();
  var wrap=document.createElement("div"),index=Math.max(0,Math.min(entries.length-1,Number(startIndex||0)));
  wrap.className="archive-viewer-overlay design-viewer-overlay";
  wrap.innerHTML='<div class="archive-viewer-modal design-viewer-modal"><div class="archive-viewer-head"><div><b>التصاميم</b><small class="design-viewer-count"></small></div><button type="button" class="archive-viewer-close">×</button></div>'
    +'<div class="design-viewer-body"><button type="button" class="design-viewer-nav prev" aria-label="السابق">‹</button><img alt=""><button type="button" class="design-viewer-nav next" aria-label="التالي">›</button></div>'
    +'<div class="design-viewer-dots"></div><div class="design-viewer-actions"><a class="btn primary" target="_blank" rel="noopener">تحميل الصورة</a></div></div>';
  document.body.appendChild(wrap);
  var img=wrap.querySelector(".design-viewer-body img"),count=wrap.querySelector(".design-viewer-count"),dots=wrap.querySelector(".design-viewer-dots"),dl=wrap.querySelector(".design-viewer-actions a");
  function paint(){
    index=((index%entries.length)+entries.length)%entries.length;
    var item=entries[index];img.src=item.src;img.alt=item.alt||"";
    count.textContent=(index+1)+" / "+entries.length;
    dl.href=item.download||item.src;
    dots.innerHTML=entries.length>1?entries.map(function(_x,i){return '<button type="button" data-vi="'+i+'" class="'+(i===index?'active':'')+'"></button>';}).join(""):"";
    wrap.querySelectorAll(".design-viewer-nav").forEach(function(b){b.style.display=entries.length>1?"grid":"none"});
  }
  function close(){wrap.remove()}
  wrap.querySelector(".archive-viewer-close").onclick=close;
  wrap.querySelector(".design-viewer-nav.prev").onclick=function(){index--;paint()};
  wrap.querySelector(".design-viewer-nav.next").onclick=function(){index++;paint()};
  dots.addEventListener("click",function(e){var b=e.target.closest("[data-vi]");if(b){index=Number(b.dataset.vi||0);paint()}});
  wrap.addEventListener("click",function(e){if(e.target===wrap)close()});
  var sx=0,sy=0;
  wrap.addEventListener("touchstart",function(e){if(e.touches&&e.touches[0]){sx=e.touches[0].clientX;sy=e.touches[0].clientY}},{passive:true});
  wrap.addEventListener("touchend",function(e){if(!e.changedTouches||!e.changedTouches[0])return;var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.2){index+=dx<0?1:-1;paint()}},{passive:true});
  paint();
}
function clientArchiveSection(){
  var cards=[],totalFiles=0;
  (DATA.work||[]).forEach(function(w){
    var files=workFilesList(w);
    totalFiles+=files.length;
    var designImages=[];
    if(w.type==="design"||w.type==="post"){
      files.forEach(function(f,index){
        if(String(f&&f.mimeType||"").indexOf("image/")===0)designImages.push(f);
      });
      if(designImages.length)cards.push(designPostCard(w,files));
    }
    files.forEach(function(f,index){
      var mime=String(f&&f.mimeType||"");
      if((w.type==="design"||w.type==="post")&&mime.indexOf("image/")===0)return;
      var mediaUrl=archiveMediaUrl(w,index,false),downloadUrl=archiveMediaUrl(w,index,true),preview="",itemClass="";
      if(mime.indexOf("video/")===0){
        itemClass=" video-item";
        preview='<button type="button" class="archive-preview video video-poster" data-act="archivevideo" data-url="'+esc(mediaUrl)+'" data-name="'+esc(f.name||"فيديو")+'">'
          +'<span class="video-poster-shade"></span><span class="video-play">▶</span><small>تشغيل الفيديو</small></button>';
      }else if(mime.indexOf("image/")===0){
        preview='<div class="archive-preview image"><img src="'+esc(mediaUrl)+'" alt="'+esc(f.name||"")+'" loading="lazy"></div>';
      }else if(mime.indexOf("pdf")>=0){
        preview='<div class="archive-preview document embedded"><iframe src="'+esc(mediaUrl)+'" loading="lazy" title="'+esc(f.name||"ملف")+'"></iframe></div>';
      }else{
        preview='<div class="archive-preview file"><span>▤</span><small>'+esc(fileKindLabel(f))+'</small></div>';
      }
      var viewAction=mime.indexOf("video/")===0
        ?'<button type="button" class="btn" data-act="archivevideo" data-url="'+esc(mediaUrl)+'" data-name="'+esc(f.name||"فيديو")+'">مشاهدة</button>'
        :'<a class="btn" href="'+esc(mediaUrl)+'" target="_blank" rel="noopener">مشاهدة</a>';
      cards.push('<article class="archive-item'+itemClass+'">'+preview+'<div class="archive-meta"><div><b>'+esc(f.name||"ملف")+'</b><small>'+esc([TYPES[w.type]||w.type,w.date].filter(Boolean).join(" · "))+'</small></div>'
        +'<div class="archive-actions">'+viewAction+'<a class="btn primary" href="'+esc(downloadUrl)+'" target="_blank" rel="noopener">تحميل</a></div></div></article>');
    });
  });
  return '<section class="card full archive-card"><div class="card-head-actions"><div><h2>أرشيف الملفات</h2><p class="sub">كل الملفات المعتمدة متاحة للمشاهدة والتحميل بأي وقت.</p></div><span class="pill">'+totalFiles+'</span></div>'
    +(cards.length?'<div class="archive-grid">'+cards.join("")+'</div>':'<div class="empty">ما في ملفات معتمدة بالأرشيف بعد.</div>')
    +'</section>';
}
function openArchiveVideo(url,name){
  var old=document.querySelector(".archive-viewer-overlay");if(old)old.remove();
  var wrap=document.createElement("div");
  wrap.className="archive-viewer-overlay";
  wrap.innerHTML='<div class="archive-viewer-modal video-portrait"><div class="archive-viewer-head"><div><b>'+esc(name||"فيديو")+'</b><small>المشاهدة من أرشيف رِواء ستوديو</small></div><button type="button" class="archive-viewer-close">×</button></div>'
    +'<div class="archive-viewer-body"><video controls playsinline autoplay preload="metadata" src="'+esc(url)+'"></video></div></div>';
  document.body.appendChild(wrap);
  function close(){
    var v=wrap.querySelector("video");if(v){try{v.pause()}catch(_e){}}
    wrap.remove();
  }
  wrap.querySelector(".archive-viewer-close").onclick=close;
  wrap.addEventListener("click",function(e){if(e.target===wrap)close()});
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