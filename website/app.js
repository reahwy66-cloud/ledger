(function(){
  "use strict";

  var SUPA_URL="https://gvnpixjkcmbrdfefbamr.supabase.co";
  var SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bnBpeGprY21icmRmZWZiYW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDAyNDAsImV4cCI6MjEwMDQ3NjI0MH0.PPuHBLPRwFPvjMgoIWHCubDTX9at5gSgn4QKxcgsbQI";

  var I18N={
    ar:{
      "nav.services":"الخدمات","nav.packages":"الباقات","nav.clients":"عملاؤنا","nav.contact":"تواصل","nav.start":"ابدأ مشروعك",
      "hero.eyebrow":"رِواء ستوديو","hero.title":"كل ما يحتاجه مشروعك. بفريق واحد.","hero.body":"من صناعة المحتوى والتصوير، إلى الإعلانات والهوية والمواقع والتطبيقات.","hero.cta":"ابدأ مشروعك","hero.secondary":"اكتشف خدماتنا","hero.note1":"محتوى سريع ومرن","hero.note2":"تنفيذ بصري موحّد","hero.note3":"حلول من السوشال إلى الويب","hero.card1k":"CONTENT","hero.card1v":"تصوير + Reels","hero.card2k":"DESIGN","hero.card2v":"هوية + Listing","hero.card3k":"GROWTH","hero.card3v":"إعلانات + إدارة","hero.card4k":"DIGITAL","hero.card4v":"مواقع + تطبيقات",
      "services.kicker":"ما الذي نفعله","services.title":"كل ما تحتاجه علامتك، تحت سقف واحد.","services.body":"نركّب الخدمة حسب هدفك: حضور مستمر، إطلاق منتج، حملة، أو بناء تجربة رقمية كاملة.",
      "services.s1t":"إدارة السوشال ميديا","services.s1b":"خطة محتوى، نشر، إدارة الصفحة والرد على الجمهور.","services.s2t":"تصوير سينمائي","services.s2b":"تصوير منتجات، أشخاص ومساحات بصياغة بصرية تناسب المنصة.","services.s3t":"مونتاج Reels","services.s3b":"إيقاع، صوت، ألوان وحركة مصممة للمحتوى القصير.","services.s4t":"تصميم وصناعة محتوى","services.s4b":"بوستات، أفكار، نصوص وحملات متناسقة مع هوية العلامة.","services.s5t":"إعلانات ممولة","services.s5b":"إعداد الحملات، المتابعة والتحسين على منصات Meta.","services.s6t":"Branding","services.s6b":"هوية بصرية ونظام تصميم قابل للتطبيق على كل نقاط التواصل.","services.s7t":"Listing Images","services.s7b":"صور متاجر احترافية توضّح المنتج ومزاياه بشكل مقنع.","services.s8t":"3D و AI Video","services.s8b":"مشاهد ثلاثية الأبعاد وفيديوهات مدعومة بالذكاء الاصطناعي.","services.s9t":"مواقع وتطبيقات ومتاجر","services.s9b":"تجارب رقمية سريعة ومتجاوبة من الفكرة حتى الإطلاق.","services.s10t":"حل مشاكل Meta","services.s10b":"مساعدة تقنية في إعداد الحسابات، الربط ومشاكل الإعلانات.",
      "packages.kicker":"باقات الإدارة الشهرية","packages.title":"اختر حجم الحضور الذي يناسبك.","packages.body":"كل الباقات تشمل إدارة الصفحة والرد. ميزانية التمويل على Meta غير مشمولة بالسعر.","packages.p1t":"بداية ثابتة","packages.p1a":"4 Reels شهريًا","packages.p1b":"4 بوستات شهريًا","packages.p2t":"نمو مستمر","packages.p2a":"6 Reels شهريًا","packages.p2b":"6 بوستات شهريًا","packages.p3t":"حضور مكثّف","packages.p3a":"8 Reels شهريًا","packages.p3b":"8 بوستات شهريًا","packages.manage":"إدارة الصفحة والرد","packages.meta":"تمويل Meta غير مشمول","packages.popular":"الأكثر توازنًا",
      "photo.kicker":"جلسة تصوير","photo.title":"30 صورة بجلسة مركّزة","photo.body":"15 صورة معدّلة بعناية ضمن الجلسة، مع تسليم مجموعة من 30 صورة.",
      "clients.kicker":"شركاء النجاح","clients.title":"علامات نعمل معها.","clients.body":"هذه القائمة مرتبطة مباشرة بالداشبورد، ولا يظهر هنا إلا العميل الذي تفعّل له خيار الظهور العام.","clients.loading":"جارٍ تحميل العملاء…","clients.empty":"سيظهر العملاء هنا بعد تفعيلهم من الداشبورد.","clients.visit":"زيارة الرابط",
      "process.kicker":"طريقة العمل","process.title":"واضحة من أول خطوة.","process.s1t":"نفهم الهدف","process.s1b":"نحدد الجمهور، العرض والمنصة قبل أن نبدأ الإنتاج.","process.s2t":"نبني الخطة","process.s2b":"نحوّل الهدف إلى محتوى وتصميم وتصوير بجدول واضح.","process.s3t":"ننفّذ ونحسّن","process.s3b":"ننتج، ننشر ونطوّر التنفيذ حسب النتائج وردود الفعل.",
      "contact.kicker":"خلّينا نبدأ","contact.title":"عندك مشروع؟ أعطينا الفكرة والباقي علينا.","contact.body":"اختر الخدمة أو الباقة المناسبة، وسنحوّلها لخطة تنفيذ واضحة.","contact.cta":"اختيار الباقة","footer.copy":"رِواء ستوديو — محتوى، تصميم وحلول رقمية."
    },
    en:{
      "nav.services":"Services","nav.packages":"Packages","nav.clients":"Clients","nav.contact":"Contact","nav.start":"Start a project",
      "hero.eyebrow":"Rewaa Studio","hero.title":"Everything your project needs. One team.","hero.body":"From content and production to advertising, branding, websites and apps.","hero.cta":"Start a project","hero.secondary":"Explore services","hero.note1":"Fast, flexible content","hero.note2":"One visual direction","hero.note3":"Social to web solutions","hero.card1k":"CONTENT","hero.card1v":"Production + Reels","hero.card2k":"DESIGN","hero.card2v":"Brand + Listing","hero.card3k":"GROWTH","hero.card3v":"Ads + Management","hero.card4k":"DIGITAL","hero.card4v":"Web + Apps",
      "services.kicker":"What we do","services.title":"Everything your brand needs, under one roof.","services.body":"We shape the service around your goal: ongoing presence, a product launch, a campaign, or a complete digital experience.",
      "services.s1t":"Social media management","services.s1b":"Content plan, publishing, page management and community replies.","services.s2t":"Cinematic production","services.s2b":"Products, people and spaces shot for the platform and the message.","services.s3t":"Reels editing","services.s3b":"Pacing, sound, color and motion designed for short-form content.","services.s4t":"Design & content","services.s4b":"Posts, ideas, copy and campaigns aligned with your brand.","services.s5t":"Paid campaigns","services.s5b":"Campaign setup, monitoring and optimization across Meta.","services.s6t":"Branding","services.s6b":"A visual identity and design system that works across every touchpoint.","services.s7t":"Listing Images","services.s7b":"Professional marketplace visuals that explain and sell the product.","services.s8t":"3D & AI Video","services.s8b":"3D scenes and AI-assisted video for standout concepts.","services.s9t":"Web, apps & e-commerce","services.s9b":"Fast responsive digital experiences from concept to launch.","services.s10t":"Meta troubleshooting","services.s10b":"Technical help with accounts, connections and advertising issues.",
      "packages.kicker":"Monthly management packages","packages.title":"Choose the level of presence that fits you.","packages.body":"Every package includes page management and replies. Meta ad spend is not included in the package price.","packages.p1t":"Steady start","packages.p1a":"4 Reels / month","packages.p1b":"4 posts / month","packages.p2t":"Consistent growth","packages.p2a":"6 Reels / month","packages.p2b":"6 posts / month","packages.p3t":"High presence","packages.p3a":"8 Reels / month","packages.p3b":"8 posts / month","packages.manage":"Page management & replies","packages.meta":"Meta ad spend not included","packages.popular":"Balanced choice",
      "photo.kicker":"Photo session","photo.title":"30 photos in a focused session","photo.body":"15 carefully edited photos, with a 30-photo set delivered from the session.",
      "clients.kicker":"Selected partners","clients.title":"Brands we work with.","clients.body":"This list is connected to the dashboard. Only clients you explicitly mark for public display appear here.","clients.loading":"Loading clients…","clients.empty":"Clients will appear here after you enable them in the dashboard.","clients.visit":"Open link",
      "process.kicker":"How we work","process.title":"Clear from the first step.","process.s1t":"Understand the goal","process.s1b":"We define the audience, offer and platform before production starts.","process.s2t":"Build the plan","process.s2b":"We turn the goal into content, design and production with a clear schedule.","process.s3t":"Create & improve","process.s3b":"We produce, publish and refine the execution based on results and feedback.",
      "contact.kicker":"Let’s start","contact.title":"Have a project? Give us the idea and we’ll shape the execution.","contact.body":"Choose the service or package that fits, and we’ll turn it into a clear production plan.","contact.cta":"Choose a package","footer.copy":"Rewaa Studio — content, design and digital solutions."
    },
    tr:{
      "nav.services":"Hizmetler","nav.packages":"Paketler","nav.clients":"Müşteriler","nav.contact":"İletişim","nav.start":"Projeyi başlat",
      "hero.eyebrow":"Rewaa Studio","hero.title":"Projenizin ihtiyacı olan her şey. Tek ekip.","hero.body":"İçerik ve çekimden reklama, markalaşmaya, web sitelerine ve uygulamalara kadar.","hero.cta":"Projeyi başlat","hero.secondary":"Hizmetleri keşfet","hero.note1":"Hızlı ve esnek içerik","hero.note2":"Tek görsel yön","hero.note3":"Sosyal medyadan web’e çözümler","hero.card1k":"CONTENT","hero.card1v":"Çekim + Reels","hero.card2k":"DESIGN","hero.card2v":"Marka + Listing","hero.card3k":"GROWTH","hero.card3v":"Reklam + Yönetim","hero.card4k":"DIGITAL","hero.card4v":"Web + Uygulama",
      "services.kicker":"Neler yapıyoruz","services.title":"Markanızın ihtiyacı olan her şey tek çatı altında.","services.body":"Hizmeti hedefinize göre şekillendiriyoruz: sürekli görünürlük, ürün lansmanı, kampanya veya eksiksiz dijital deneyim.",
      "services.s1t":"Sosyal medya yönetimi","services.s1b":"İçerik planı, yayınlama, sayfa yönetimi ve topluluk yanıtları.","services.s2t":"Sinematik çekim","services.s2b":"Ürün, insan ve mekân çekimlerini platforma uygun şekilde üretiriz.","services.s3t":"Reels kurgusu","services.s3b":"Kısa içerik için ritim, ses, renk ve hareket tasarımı.","services.s4t":"Tasarım & içerik","services.s4b":"Markanızla uyumlu postlar, fikirler, metinler ve kampanyalar.","services.s5t":"Ücretli reklamlar","services.s5b":"Meta üzerinde kampanya kurulumu, takip ve optimizasyon.","services.s6t":"Markalaşma","services.s6b":"Tüm temas noktalarında çalışan görsel kimlik ve tasarım sistemi.","services.s7t":"Listing Images","services.s7b":"Ürünü açıklayan ve satışa destek olan profesyonel mağaza görselleri.","services.s8t":"3D & AI Video","services.s8b":"Öne çıkan fikirler için 3D sahneler ve yapay zekâ destekli videolar.","services.s9t":"Web, uygulama & e-ticaret","services.s9b":"Fikirden yayına hızlı ve duyarlı dijital deneyimler.","services.s10t":"Meta sorun çözümleri","services.s10b":"Hesaplar, bağlantılar ve reklam sorunları için teknik destek.",
      "packages.kicker":"Aylık yönetim paketleri","packages.title":"Size uygun görünürlük seviyesini seçin.","packages.body":"Tüm paketlere sayfa yönetimi ve yanıtlar dahildir. Meta reklam bütçesi paket fiyatına dahil değildir.","packages.p1t":"Sağlam başlangıç","packages.p1a":"Ayda 4 Reels","packages.p1b":"Ayda 4 gönderi","packages.p2t":"Sürekli büyüme","packages.p2a":"Ayda 6 Reels","packages.p2b":"Ayda 6 gönderi","packages.p3t":"Yoğun görünürlük","packages.p3a":"Ayda 8 Reels","packages.p3b":"Ayda 8 gönderi","packages.manage":"Sayfa yönetimi ve yanıtlar","packages.meta":"Meta reklam bütçesi dahil değil","packages.popular":"Dengeli seçim",
      "photo.kicker":"Fotoğraf çekimi","photo.title":"Odaklı bir seansta 30 fotoğraf","photo.body":"15 fotoğraf özenle düzenlenir ve seanstan toplam 30 fotoğraf teslim edilir.",
      "clients.kicker":"Seçili iş ortakları","clients.title":"Birlikte çalıştığımız markalar.","clients.body":"Bu liste doğrudan kontrol paneline bağlıdır. Yalnızca herkese açık olarak işaretlediğiniz müşteriler burada görünür.","clients.loading":"Müşteriler yükleniyor…","clients.empty":"Kontrol panelinden etkinleştirdiğiniz müşteriler burada görünecek.","clients.visit":"Bağlantıyı aç",
      "process.kicker":"Nasıl çalışıyoruz","process.title":"İlk adımdan itibaren net.","process.s1t":"Hedefi anlarız","process.s1b":"Üretimden önce kitleyi, teklifi ve platformu netleştiririz.","process.s2t":"Planı kurarız","process.s2b":"Hedefi net bir takvimle içerik, tasarım ve çekime dönüştürürüz.","process.s3t":"Üretir ve geliştiririz","process.s3b":"Üretir, yayınlar ve sonuçlara göre uygulamayı iyileştiririz.",
      "contact.kicker":"Başlayalım","contact.title":"Bir projeniz mi var? Fikri paylaşın, uygulamayı birlikte şekillendirelim.","contact.body":"Uygun hizmeti veya paketi seçin; bunu net bir üretim planına dönüştürelim.","contact.cta":"Paket seç","footer.copy":"Rewaa Studio — içerik, tasarım ve dijital çözümler."
    }
  };

  var current="ar";
  function tr(key){return (I18N[current]&&I18N[current][key])||I18N.ar[key]||key;}
  function applyLang(lang){
    current=I18N[lang]?lang:"ar";
    document.documentElement.lang=current;
    document.documentElement.dir=current==="ar"?"rtl":"ltr";
    document.body.dir=document.documentElement.dir;
    document.querySelectorAll("[data-i18n]").forEach(function(node){
      var key=node.getAttribute("data-i18n");node.textContent=tr(key);
    });
    document.querySelectorAll("[data-lang]").forEach(function(btn){
      btn.classList.toggle("active",btn.getAttribute("data-lang")===current);
    });
    try{localStorage.setItem("rewaa_site_lang",current);}catch(e){}
    renderClients(window.__rewaaClients||[]);
  }

  function safeLink(v){
    try{
      var u=new URL(v);
      return (u.protocol==="http:"||u.protocol==="https:")?u.href:"";
    }catch(e){return "";}
  }
  function safeLogo(v){
    v=String(v||"");
    if(/^data:image\/(png|jpe?g|webp);base64,/i.test(v))return v;
    return safeLink(v);
  }
  function renderClients(rows){
    var grid=document.getElementById("clientGrid");if(!grid)return;
    if(!rows||!rows.length){grid.innerHTML='<div class="client-loading">'+tr("clients.empty")+'</div>';return;}
    grid.innerHTML="";
    rows.forEach(function(c){
      var a=document.createElement("a"),link=safeLink(c.website||"");
      a.className="client-card";a.href=link||"#clients";
      if(link){a.target="_blank";a.rel="noopener noreferrer";}
      var logo=document.createElement("span");logo.className="client-logo";
      var src=safeLogo(c.logo||"");
      if(src){var img=document.createElement("img");img.src=src;img.alt="";logo.appendChild(img);}
      else logo.textContent=(String(c.name||"•").trim().charAt(0)||"•").toUpperCase();
      var meta=document.createElement("span");meta.className="client-meta";
      var b=document.createElement("b");b.textContent=c.name||"";
      var small=document.createElement("span");small.textContent=link?tr("clients.visit"):"REWAA";
      meta.appendChild(b);meta.appendChild(small);a.appendChild(logo);a.appendChild(meta);grid.appendChild(a);
    });
  }
  async function loadClients(){
    var grid=document.getElementById("clientGrid");
    try{
      var res=await fetch(SUPA_URL+"/rest/v1/rpc/public_site_clients",{
        method:"POST",
        headers:{"apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY,"Content-Type":"application/json"},
        body:"{}"
      });
      if(!res.ok)throw new Error("RPC "+res.status);
      var rows=await res.json();window.__rewaaClients=Array.isArray(rows)?rows:[];
      renderClients(window.__rewaaClients);
    }catch(e){
      window.__rewaaClients=[];
      if(grid)grid.innerHTML='<div class="client-loading">'+tr("clients.empty")+'</div>';
      try{console.warn("[Rewaa site] public clients unavailable",e);}catch(_){}
    }
  }

  document.addEventListener("click",function(e){
    var btn=e.target.closest("[data-lang]");if(btn)applyLang(btn.getAttribute("data-lang"));
  });

  document.getElementById("year").textContent=new Date().getFullYear();

  var saved="";
  try{saved=localStorage.getItem("rewaa_site_lang")||"";}catch(e){}
  var browser=(navigator.language||"").toLowerCase();
  applyLang(saved||(browser.indexOf("tr")===0?"tr":browser.indexOf("en")===0?"en":"ar"));

  if("IntersectionObserver" in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add("visible");io.unobserve(entry.target);}});
    },{threshold:.12});
    document.querySelectorAll(".reveal").forEach(function(node){io.observe(node);});
  }else document.querySelectorAll(".reveal").forEach(function(node){node.classList.add("visible");});

  loadClients();
})();