/* رِواء ستوديو — Web Push client */
(function(){
"use strict";
var PUSH_API="https://studio-ledger-mcp.reahwy66.workers.dev";
function b64ToBytes(value){
  var pad="=".repeat((4-value.length%4)%4);
  var raw=atob((value+pad).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,function(c){return c.charCodeAt(0);});
}
function sessionToken(){
  try{
    var raw=localStorage.getItem("sb-gvnpixjkcmbrdfefbamr-auth-token");
    if(!raw) return "";
    var data=JSON.parse(raw);
    return data.access_token || (data.currentSession&&data.currentSession.access_token) || "";
  }catch(_e){ return ""; }
}
async function subscribe(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))
    throw new Error("Web Push is not supported.");
  var reg=await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  var permission=Notification.permission;
  if(permission!=="granted") permission=await Notification.requestPermission();
  if(permission!=="granted") throw new Error("Notification permission was not granted.");
  var current=await reg.pushManager.getSubscription();
  if(!current){
    var cfg=await fetch(PUSH_API+"/push/config",{cache:"no-store"}).then(function(r){
      if(!r.ok) throw new Error("Could not load push configuration.");
      return r.json();
    });
    current=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(cfg.publicKey)});
  }
  var token=sessionToken();
  if(!token) throw new Error("Sign in first.");
  var response=await fetch(PUSH_API+"/push/subscribe",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({subscription:current.toJSON(),userAgent:navigator.userAgent})
  });
  if(!response.ok) throw new Error("Could not save this device.");
  localStorage.setItem("riwa_push_enabled","1");
}
function standalone(){
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
}
function ar(){
  return (document.body&&document.body.dir==="rtl") || /^ar\b/i.test(navigator.language||"");
}
function addButton(){
  if(document.getElementById("riwaPushBtn")) return;
  var btn=document.createElement("button");
  btn.id="riwaPushBtn"; btn.type="button";
  btn.textContent=ar()?"🔔 فعّل التنبيهات":"🔔 Enable notifications";
  btn.style.cssText="position:fixed;right:14px;bottom:14px;z-index:120;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:10px 14px;background:#232C28;color:#F5F2EA;font:600 13px system-ui;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:pointer;max-width:calc(100vw - 28px)";
  btn.onclick=async function(){
    var old=btn.textContent;
    try{
      btn.disabled=true; btn.textContent=ar()?"جاري التفعيل…":"Enabling…";
      await subscribe();
      btn.textContent=ar()?"✓ التنبيهات مفعّلة":"✓ Notifications enabled";
      setTimeout(function(){btn.remove();},1500);
    }catch(e){
      btn.disabled=false;
      if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!standalone()&&Notification.permission==="default")
        btn.textContent=ar()?"أضف رِواء للشاشة الرئيسية ثم فعّل التنبيهات":"Add Riwa to Home Screen, then enable notifications";
      else btn.textContent=ar()?"تعذّر التفعيل — اضغط للمحاولة":"Couldn’t enable — tap to retry";
      console.warn("[Riwa Push]",e);
      setTimeout(function(){if(btn.isConnected)btn.textContent=old;},4500);
    }
  };
  document.body.appendChild(btn);
}
async function boot(){
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)) return;
  if(Notification.permission==="granted"){
    try{await subscribe();return;}catch(e){console.warn("[Riwa Push]",e);}
  }
  addButton();
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();