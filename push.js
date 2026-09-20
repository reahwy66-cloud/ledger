/* رِواء ستوديو — Web Push client + mobile UI bootstrap */
(function(){
"use strict";
var PUSH_API="https://studio-ledger-mcp.reahwy66.workers.dev";

(function mobileUiBootstrap(){
  var link=document.createElement("link");
  link.rel="stylesheet";
  link.href="mobile.css?v=20260920b";
  document.head.appendChild(link);

  function prepareTables(){
    document.querySelectorAll("table").forEach(function(table){
      var headers=Array.from(table.querySelectorAll("thead th")).map(function(th){
        return (th.textContent||"").trim();
      });
      var rows=table.querySelectorAll("tbody tr");
      if(!rows.length) return;

      table.classList.add("mobile-card-table");

      rows.forEach(function(row){
        var cells=Array.from(row.children).filter(function(cell){return cell.tagName==="TD";});
        var visibleCount=0;
        var primarySet=false;

        cells.forEach(function(cell,index){
          var label=headers[index]||"";
          var text=(cell.textContent||"").trim();
          var hasControl=!!cell.querySelector("button,.btn,a,input,select");
          var empty=!text && !hasControl;

          cell.setAttribute("data-mobile-label",label);
          if(empty){
            cell.setAttribute("data-mobile-empty","1");
            return;
          }

          visibleCount++;

          if(hasControl){
            cell.setAttribute("data-mobile-action","1");
          }else if(!primarySet){
            cell.setAttribute("data-mobile-primary","1");
            primarySet=true;
          }
        });

        row.setAttribute("data-mobile-count",String(visibleCount));
      });
    });
  }

  function run(){ requestAnimationFrame(prepareTables); }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",run,{once:true});
  }else{
    run();
  }

  var host=document.getElementById("app")||document.body;
  var queued=false;
  new MutationObserver(function(){
    if(queued) return;
    queued=true;
    requestAnimationFrame(function(){
      queued=false;
      prepareTables();
    });
  }).observe(host,{childList:true,subtree:true});
})();

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

function status(){
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)) return "unsupported";
  if(Notification.permission==="denied") return "denied";
  if(Notification.permission==="granted" && localStorage.getItem("riwa_push_enabled")==="1") return "enabled";
  return "off";
}

async function enable(){
  if(status()==="unsupported") throw new Error("Web Push is not supported on this device.");
  var reg=await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;

  var permission=Notification.permission;
  if(permission!=="granted") permission=await Notification.requestPermission();
  if(permission!=="granted") throw new Error(permission==="denied"?"denied":"not_granted");

  var current=await reg.pushManager.getSubscription();
  if(!current){
    var cfg=await fetch(PUSH_API+"/push/config",{cache:"no-store"}).then(function(r){
      if(!r.ok) throw new Error("push_config");
      return r.json();
    });
    current=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:b64ToBytes(cfg.publicKey)
    });
  }

  var token=sessionToken();
  if(!token) throw new Error("sign_in");

  var response=await fetch(PUSH_API+"/push/subscribe",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({subscription:current.toJSON(),userAgent:navigator.userAgent})
  });
  if(!response.ok) throw new Error("save_device");

  localStorage.setItem("riwa_push_enabled","1");
  return true;
}

async function testPush(){
  var token=sessionToken();
  if(!token) throw new Error("sign_in");
  var reg=await navigator.serviceWorker.ready;
  try{ await reg.update(); }catch(_e){}

  await reg.showNotification("رِواء ستوديو — اختبار محلي",{
    body:"إذا ظهر هذا التنبيه فصلاحيات الآيفون وService Worker شغّالة ✓",
    icon:"./icon-192.png",
    badge:"./icon-192.png",
    tag:"riwa-local-test",
    dir:"rtl",
    lang:"ar"
  });

  var current=await reg.pushManager.getSubscription();
  if(!current){
    await enable();
    current=await reg.pushManager.getSubscription();
  }
  if(!current) throw new Error("no_subscription");

  var response=await fetch(PUSH_API+"/push/test",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({subscription:current.toJSON(),userAgent:navigator.userAgent})
  });
  var data={};
  try{ data=await response.json(); }catch(_e){}
  if(!response.ok || !data.ok){
    var detail=[data.error,data.statusCode,data.providerMessage,data.providerBody].filter(Boolean).join(" | ");
    var err=new Error(detail||("HTTP "+response.status));
    err.code=data.error||"test_failed";
    err.status=response.status;
    throw err;
  }
  return {local:true,remote:data};
}

window.RiwaPush={enable:enable,status:status,test:testPush};
})();