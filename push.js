/* رِواء ستوديو — Web Push client + mobile UI bootstrap */
(function(){
"use strict";
var PUSH_API="https://studio-ledger-mcp.reahwy66.workers.dev";

(function mobileUiBootstrap(){
  var link=document.createElement("link");
  link.rel="stylesheet";
  link.href="mobile.css?v=20260920-v45";
  document.head.appendChild(link);
  var desktopLink=document.createElement("link");
  desktopLink.rel="stylesheet";
  desktopLink.href="desktop.css?v=20260920-v45";
  document.head.appendChild(desktopLink);

  var ICONS={
    flow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-12h6V4h-6v4Z"/></svg>',
    clients:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 1c-3.3 0-6 1.8-6 4v3h12v-3c0-2.2-2.7-4-6-4ZM8 14c-3.3 0-6 1.5-6 3.5V20h6v-3c0-1.1.5-2.1 1.4-3H8Z"/></svg>',
    ledger:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h10V6H7v2Zm0 5h4v-2H7v2Zm6 0h4v-2h-4v2Zm-6 5h4v-2H7v2Zm6 0h4v-2h-4v2Z"/></svg>',
    calendar:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V2Zm12 8H5v9h14v-9ZM7 12h3v3H7v-3Z"/></svg>',
    invoices:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15l-3-2-3 2-3-2-3 2-3-2-3 2V4a2 2 0 0 1 2-2h2Zm8 2v4h4l-4-4ZM6 11v2h10v-2H6Zm0 4v2h8v-2H6Z"/></svg>',
    funding:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11h18v2H3v-2Zm2-4h14v2H5V7Zm2-4h10v2H7V3Zm0 12h10v2H7v-2Zm2 4h6v2H9v-2Z"/></svg>',
    team:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-4 0-7 2-7 4.5V21h14v-3.5C16 15 13 13 9 13Zm7.5 0c-.8 0-1.6.1-2.3.3 2.3 1 3.8 2.5 3.8 4.2V21h4v-3c0-2.8-2.4-5-5.5-5Z"/></svg>',
    costs:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4V4Zm3 4v2h10V8H7Zm0 4v2h6v-2H7Zm0 4v2h10v-2H7Z"/></svg>',
    outside:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>',
    users:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"/></svg>',
    account:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9v-2c0-3.3 3.1-5 7-5s7 1.7 7 5v2H5Zm14-9h2v2h-2v-2Zm0 4h2v5h-2v-5Z"/></svg>',
    signout:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm4.6 4.6L13.2 9l2 2H8v2h7.2l-2 2 1.4 1.4L19 12l-4.4-4.4Z"/></svg>',
    setup:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19.4 13 .1-1-.1-1 2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11l-.1 1 .1 1-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.2-1.5ZM13 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg>',
    notifications:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.35-1.65h-4.7A2.5 2.5 0 0 0 12 22Zm7-5v-5a7 7 0 0 0-5-6.7V4a2 2 0 1 0-4 0v1.3A7 7 0 0 0 5 12v5l-2 2v1h18v-1l-2-2Zm-12 1v-6a5 5 0 0 1 10 0v6H7Z"/></svg>'
  };

  function scheduledTheme(now){
    now=now||new Date();
    var h=now.getHours();
    return (h>=7&&h<19)?"light":"dark";
  }

  function nextThemeBoundary(now){
    now=now||new Date();
    var next=new Date(now);
    if(now.getHours()<7){
      next.setHours(7,0,0,0);
    }else if(now.getHours()<19){
      next.setHours(19,0,0,0);
    }else{
      next.setDate(next.getDate()+1);
      next.setHours(7,0,0,0);
    }
    return next.getTime();
  }

  function applyScheduledTheme(){
    var now=Date.now(), manual="", until=0;
    try{
      manual=localStorage.getItem("riwa_manual_theme")||"";
      until=+(localStorage.getItem("riwa_manual_theme_until")||0);
    }catch(_e){}
    if(manual && until>now){
      document.documentElement.setAttribute("data-theme",manual);
      document.documentElement.setAttribute("data-auto-theme","manual");
      return;
    }
    if(manual||until){
      try{
        localStorage.removeItem("riwa_manual_theme");
        localStorage.removeItem("riwa_manual_theme_until");
      }catch(_e){}
    }
    var th=scheduledTheme(new Date(now));
    document.documentElement.setAttribute("data-theme",th);
    document.documentElement.setAttribute("data-auto-theme",th);
  }

  function toggleManualTheme(){
    var current=document.documentElement.getAttribute("data-theme")||scheduledTheme();
    var next=current==="dark"?"light":"dark";
    try{
      localStorage.setItem("riwa_manual_theme",next);
      localStorage.setItem("riwa_manual_theme_until",String(nextThemeBoundary(new Date())));
    }catch(_e){}
    document.documentElement.setAttribute("data-theme",next);
    document.documentElement.setAttribute("data-auto-theme","manual");
    return next;
  }
  window.RiwaTheme={toggle:toggleManualTheme,apply:applyScheduledTheme};

  function decorateDesktopTabs(){
    var tabs=document.querySelector(".tabs");
    if(!tabs) return;
    Array.from(tabs.querySelectorAll("[data-tab]")).forEach(function(b){
      if(b.querySelector(".desktop-tab-icon")) return;
      var k=b.dataset.tab;
      var label=(b.textContent||"").trim();
      b.innerHTML='<span class="desktop-tab-icon">'+(ICONS[k]||"")+'</span><span class="desktop-tab-label">'+label+'</span>';
    });

    if(!tabs.querySelector(".desktop-notifications")){
      var notify=document.createElement("button");
      notify.type="button";
      notify.className="desktop-notifications";
      notify.setAttribute("data-act","notifications");
      notify.innerHTML='<span class="desktop-tab-icon">'+(ICONS.notifications||"")+'</span><span class="desktop-tab-label">'+(document.documentElement.lang==="en"?"Notifications":"التنبيهات")+'</span><b class="desktop-notify-badge"></b>';
      tabs.insertBefore(notify,tabs.firstChild);
    }

    if(!tabs.querySelector(".desktop-signout")){
      var sep=document.createElement("div");
      sep.className="desktop-nav-separator";
      tabs.appendChild(sep);

      var out=document.createElement("button");
      out.type="button";
      out.className="desktop-signout";
      out.setAttribute("data-act","signout");
      out.innerHTML='<span class="desktop-tab-icon">'+(ICONS.signout||"")+'</span><span class="desktop-tab-label">'+(document.documentElement.lang==="en"?"Sign out":"تسجيل الخروج")+'</span>';
      tabs.appendChild(out);
    }
  }

  function syncNotificationControls(){
    var mast=document.querySelector(".mast");
    var count=(mast&&mast.querySelector(".portal-notify-chip .notify-count")||{}).textContent||"";
    var db=document.querySelector(".desktop-notify-badge");
    if(db){
      db.textContent=count;
      db.style.display=count?"grid":"none";
    }

    var old=document.querySelector(".mobile-header .mobile-quick-btn");
    if(old){
      old.className="mobile-head-btn mobile-notify-btn";
      old.removeAttribute("data-tab");
      old.setAttribute("data-act","notifications");
      old.setAttribute("aria-label",document.documentElement.lang==="en"?"Notifications":"التنبيهات");
      old.innerHTML=(ICONS.notifications||"")+(count?'<b class="mobile-notify-count">'+count+'</b>':'');
    }
    var mb=document.querySelector(".mobile-header .mobile-notify-btn");
    if(mb && !old){
      var badge=mb.querySelector(".mobile-notify-count");
      if(count){
        if(!badge){badge=document.createElement("b");badge.className="mobile-notify-count";mb.appendChild(badge);}
        badge.textContent=count;
      }else if(badge){badge.remove();}
    }
  }

  function activeTab(){
    var b=document.querySelector(".tabs [aria-selected=true]");
    return b&&b.dataset.tab||"flow";
  }

  function quickButton(tab,wrap){
    var map={clients:"newclient",team:"newemp",ledger:"newwork",calendar:"newshoot"};
    var act=map[tab];
    if(act && wrap.querySelector('[data-act="'+act+'"]')){
      return 'data-act="'+act+'"';
    }
    return 'data-tab="calendar"';
  }

  function closeDrawer(){
    var d=document.querySelector(".mobile-drawer");
    var s=document.querySelector(".mobile-drawer-scrim");
    if(d)d.classList.remove("open");
    if(s)s.classList.remove("open");
    document.body.classList.remove("mobile-menu-open");
  }

  function buildMobileShell(){
    var wrap=document.querySelector("#app > .wrap");
    var tabs=wrap&&wrap.querySelector(":scope > .tabs");
    var mast=wrap&&wrap.querySelector(":scope > .mast");
    if(!wrap||!tabs||!mast) return;
    if(wrap.querySelector(":scope > .mobile-header")) return;

    var tab=activeTab();
    document.body.setAttribute("data-mobile-tab",tab);
    var view=tabs.nextElementSibling;
    if(view) view.classList.add("mobile-view");

    var old=wrap.querySelector(":scope > .mobile-header");
    if(old) old.remove();
    var oldBottom=wrap.querySelector(":scope > .mobile-bottom-nav");
    if(oldBottom) oldBottom.remove();
    var oldDrawer=document.querySelector(".mobile-drawer");
    if(oldDrawer) oldDrawer.remove();
    var oldScrim=document.querySelector(".mobile-drawer-scrim");
    if(oldScrim) oldScrim.remove();

    var header=document.createElement("div");
    header.className="mobile-header";
    var notifyCount=(mast.querySelector(".portal-notify-chip .notify-count")||{}).textContent||"";
    header.innerHTML=
      '<button class="mobile-head-btn mobile-menu-btn" type="button" aria-label="Menu"><span></span><span></span><span></span></button>'+
      '<div class="mobile-logo">'+(mast.querySelector(".stamp")?mast.querySelector(".stamp").outerHTML:"")+'</div>'+
      '<button class="mobile-head-btn mobile-notify-btn" type="button" data-act="notifications" aria-label="'+(document.documentElement.lang==="en"?"Notifications":"التنبيهات")+'">'+
        (ICONS.notifications||"")+(notifyCount?'<b class="mobile-notify-count">'+notifyCount+'</b>':'')+
      '</button>';
    wrap.insertBefore(header,mast);

    var main=["flow","clients","ledger","calendar"];
    var labels={};
    Array.from(tabs.querySelectorAll("[data-tab]")).forEach(function(b){labels[b.dataset.tab]=(b.textContent||"").trim();});

    var bottom=document.createElement("nav");
    bottom.className="mobile-bottom-nav";
    bottom.setAttribute("aria-label","Primary");
    var primary=main.filter(function(k){return labels[k];});
    bottom.style.setProperty("--nav-count",String(Math.max(1,primary.length)));
    bottom.innerHTML=primary.map(function(k){
      return '<button type="button" data-tab="'+k+'" class="'+(tab===k?"active":"")+'" aria-current="'+(tab===k?"page":"false")+'">'+
        (ICONS[k]||"")+'<span>'+labels[k]+'</span></button>';
    }).join("");
    wrap.appendChild(bottom);

    var extras=Array.from(tabs.querySelectorAll("[data-tab]")).filter(function(b){return main.indexOf(b.dataset.tab)<0;});
    var extraMap={}; extras.forEach(function(b){extraMap[b.dataset.tab]=b;});
    function drawerTab(k){
      var b=extraMap[k]; if(!b) return "";
      return '<button type="button" data-tab="'+k+'" class="'+(tab===k?"active":"")+'">'+(ICONS[k]||"")+'<span>'+((b.textContent||"").trim())+'</span><i>‹</i></button>';
    }
    var workLinks=["team","invoices","funding","costs"].map(drawerTab).join("");
    var appLinks=["setup"].map(drawerTab).join("");
    var drawer=document.createElement("aside");
    drawer.className="mobile-drawer";
    drawer.setAttribute("aria-hidden","true");
    drawer.innerHTML=
      '<div class="mobile-drawer-head"><div class="mobile-drawer-brand">'+
        (mast.querySelector(".stamp")?mast.querySelector(".stamp").outerHTML:"")+
        '<div><b>'+(document.documentElement.lang==="en"?"Riwa Studio":"رِواء ستوديو")+'</b><small>'+(document.documentElement.lang==="en"?"Workspace":"مساحة العمل")+'</small></div></div>'+
        '<button type="button" class="mobile-drawer-close" aria-label="Close">×</button></div>'+
      '<div class="mobile-drawer-links">'+
        (workLinks?'<div class="drawer-section-title">'+(document.documentElement.lang==="en"?"WORK":"العمل")+'</div>'+workLinks:"")+
        '<div class="drawer-section-title">'+(document.documentElement.lang==="en"?"APP":"التطبيق")+'</div>'+
        appLinks+
        '<button type="button" data-act="logout" class="mobile-account-entry">'+(ICONS.account||ICONS.users||"")+'<span>'+(document.documentElement.lang==="en"?"Account":"الحساب")+'</span><i>‹</i></button>'+
        '<button type="button" data-act="signout" class="mobile-signout-entry">'+(ICONS.signout||"")+'<span>'+(document.documentElement.lang==="en"?"Sign out":"تسجيل الخروج")+'</span><i>‹</i></button>'+
      '</div><div class="mobile-drawer-tools"></div>';

    var drawerTools=drawer.querySelector(".mobile-drawer-tools");
    var tools=mast.querySelector(".tools");
    if(tools){
      Array.from(tools.children).forEach(function(node,index){
        if(index===0 || (node.matches&&node.matches('[data-act="logout"]')) || (node.matches&&node.matches('[data-act="notifications"]'))) return;
        var clone=node.cloneNode(true);
        if(clone.matches&&clone.matches('[data-act="theme"]')){
          clone.classList.add("drawer-utility");
          clone.innerHTML='<span class="drawer-util-icon">◐</span><span>'+(document.documentElement.lang==="en"?"Light / Dark":"فاتح / داكن")+'</span>';
        }else if(clone.matches&&clone.matches('[data-act="lang"]')){
          clone.classList.add("drawer-utility");
          clone.innerHTML='<span class="drawer-util-icon">文</span><span>'+(document.documentElement.lang==="en"?"العربية":"English")+'</span>';
        }
        drawerTools.appendChild(clone);
      });
    }

    var scrim=document.createElement("button");
    scrim.type="button";
    scrim.className="mobile-drawer-scrim";
    scrim.setAttribute("aria-label","Close menu");

    document.body.appendChild(scrim);
    document.body.appendChild(drawer);

    header.querySelector(".mobile-menu-btn").onclick=function(){
      drawer.classList.add("open");
      scrim.classList.add("open");
      drawer.setAttribute("aria-hidden","false");
      document.body.classList.add("mobile-menu-open");
    };
    drawer.querySelector(".mobile-drawer-close").onclick=closeDrawer;
    scrim.onclick=closeDrawer;
    drawer.addEventListener("click",function(e){
      if(e.target.closest("[data-tab]")||e.target.closest(".mobile-account-entry")||e.target.closest(".mobile-signout-entry")) setTimeout(closeDrawer,0);
    });
  }

  function prepareTables(){
    var tab=activeTab();
    document.querySelectorAll("table").forEach(function(table,tableIndex){
      var headers=Array.from(table.querySelectorAll("thead th")).map(function(th){
        return (th.textContent||"").trim();
      });
      var rows=table.querySelectorAll("tbody tr");
      if(!rows.length) return;
      table.classList.add("mobile-card-table");
      table.setAttribute("data-mobile-section",tab);

      rows.forEach(function(row){
        var cells=Array.from(row.children).filter(function(cell){return cell.tagName==="TD";});
        if(row.classList.contains("sum")){
          row.setAttribute("data-mobile-summary","1");
        }
        var visibleCount=0;
        cells.forEach(function(cell,index){
          cell.removeAttribute("data-mobile-primary");
          cell.removeAttribute("data-mobile-action");
          cell.removeAttribute("data-mobile-empty");
          var label=headers[index]||"";
          var text=(cell.textContent||"").trim();
          var hasControl=!!cell.querySelector("button,.btn");
          var empty=!text&&!hasControl;
          cell.setAttribute("data-mobile-label",label);
          if(empty){cell.setAttribute("data-mobile-empty","1");return;}
          visibleCount++;
          if(hasControl) cell.setAttribute("data-mobile-action","1");
        });

        var primaryIndex=0;
        if(tab==="ledger" && tableIndex===0 && cells.length>2) primaryIndex=2;
        var primary=cells[primaryIndex];
        if(primary && primary.getAttribute("data-mobile-empty")!=="1") primary.setAttribute("data-mobile-primary","1");
        row.setAttribute("data-mobile-count",String(visibleCount));
      });
    });
  }

  function bindScrollHeader(){
    if(document.documentElement.dataset.scrollHeader==="1") return;
    document.documentElement.dataset.scrollHeader="1";
    var lastY=Math.max(0,window.scrollY||0);
    var ticking=false;
    window.addEventListener("scroll",function(){
      if(ticking) return;
      ticking=true;
      requestAnimationFrame(function(){
        ticking=false;
        var y=Math.max(0,window.scrollY||0);
        var dy=y-lastY;
        var header=document.querySelector(".mobile-header");
        if(header){
          if(y<18){
            header.classList.remove("mobile-header-hidden");
          }else if(dy>4){
            header.classList.add("mobile-header-hidden");
          }else if(dy<0){
            header.classList.remove("mobile-header-hidden");
          }
        }
        lastY=y;
      });
    },{passive:true});
  }

  function prepareCalendar(){
    if(document.body.getAttribute("data-mobile-tab")!=="calendar") return;
    document.querySelectorAll(".cal .day").forEach(function(day){
      var old=day.querySelector(".mobile-cal-count");
      var oldDots=day.querySelector(".mobile-cal-dots");
      if(old) old.remove();
      if(oldDots) oldDots.remove();
      var evs=Array.from(day.querySelectorAll(".ev")).filter(function(ev){
        return !ev.classList.contains("cancelled");
      });
      if(!evs.length) return;
      if(evs.length<=3){
        var dots=document.createElement("span");
        dots.className="mobile-cal-dots";
        for(var i=0;i<evs.length;i++){
          var dot=document.createElement("i");
          dots.appendChild(dot);
        }
        day.appendChild(dots);
      }else{
        var count=document.createElement("span");
        count.className="mobile-cal-count";
        count.textContent=String(evs.length);
        day.appendChild(count);
      }
      day.setAttribute("aria-label",(day.textContent||"").trim()+" · "+evs.length);
    });
  }

  function bindGlassGestures(){
    if(document.documentElement.dataset.glassGestures==="1") return;
    document.documentElement.dataset.glassGestures="1";

    var startX=0,startY=0,tracking=false,edgeOpen=false,drawerStart=false;

    document.addEventListener("pointerdown",function(e){
      if(e.pointerType==="mouse"&&e.button!==0) return;
      var drawer=document.querySelector(".mobile-drawer");
      var rtl=document.body.dir==="rtl";
      var edge=22;
      startX=e.clientX;startY=e.clientY;tracking=true;
      edgeOpen=rtl?(startX>=window.innerWidth-edge):(startX<=edge);
      drawerStart=!!(drawer&&drawer.classList.contains("open")&&drawer.contains(e.target));
    },{passive:true});

    document.addEventListener("pointerup",function(e){
      if(!tracking) return;
      tracking=false;
      var dx=e.clientX-startX,dy=e.clientY-startY;
      if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.15) return;
      var rtl=document.body.dir==="rtl";
      var drawer=document.querySelector(".mobile-drawer");
      var scrim=document.querySelector(".mobile-drawer-scrim");
      if(edgeOpen && drawer && ((rtl&&dx<0)||(!rtl&&dx>0))){
        drawer.classList.add("open");
        if(scrim)scrim.classList.add("open");
        drawer.setAttribute("aria-hidden","false");
        document.body.classList.add("mobile-menu-open");
      }else if(drawerStart && drawer && ((rtl&&dx>0)||(!rtl&&dx<0))){
        closeDrawer();
      }
    },{passive:true});
  }

  function refresh(){
    applyScheduledTheme();
    decorateDesktopTabs();
    buildMobileShell();
    syncNotificationControls();
    prepareTables();
    prepareCalendar();
    bindGlassGestures();
    bindScrollHeader();
  }

  function run(){requestAnimationFrame(refresh);}
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",run,{once:true});
  else run();
  setInterval(applyScheduledTheme,60000);

  var host=document.getElementById("app")||document.body;
  var queued=false;
  new MutationObserver(function(){
    if(queued) return;
    queued=true;
    requestAnimationFrame(function(){
      queued=false;
      refresh();
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