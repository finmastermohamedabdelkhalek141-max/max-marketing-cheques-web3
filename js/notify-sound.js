/* ============================================================
   ملحق: إشعارات لحظية بين المستخدمين + أصوات للشاشات والأزرار
   أضف هذا الملف بعد js/script.js في index.html:
   <script src="js/notify-sound.js"></script>
   يعتمد على المتغيرات/الدوال الموجودة أصلاً في script.js:
   db, state, currentUser, render, setView, view, toast, esc, fmtDate
   ============================================================ */
(function(){
"use strict";

function whenReady(fn){
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", fn);
  } else fn();
}

/* ============================= الأصوات (Web Audio API — بدون ملفات خارجية) ============================= */
const SoundKit = (function(){
  let ctx = null;
  function getCtx(){
    if(!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC) ctx = new AC();
    }
    if(ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* نغمة بسيطة: تردد + مدة + شكل موجة + مغلف صوت (envelope) */
  function tone(freq, dur, opts){
    opts = opts || {};
    const c = getCtx();
    if(!c) return;
    const t0 = c.currentTime + (opts.delay||0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if(opts.slideTo){
      osc.frequency.exponentialRampToValueAtTime(Math.max(1,opts.slideTo), t0+dur);
    }
    const peak = opts.volume!=null ? opts.volume : 0.14;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0+Math.min(0.02,dur/4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0+dur+0.02);
  }

  /* تشغيل سلسلة نغمات متتابعة: [[تردد, مدة, فجوة_قبل_التالية], ...] */
  function sequence(notes, opts){
    let delay = 0;
    notes.forEach(n=>{
      tone(n[0], n[1], Object.assign({}, opts, {delay}));
      delay += n[2]!=null ? n[2] : n[1];
    });
  }

  return {
    /* ---------- أصوات دخول الشاشات (نغمة مختلفة لكل شاشة) ---------- */
    screens: {
      cheques:       ()=> sequence([[660,0.09,0.07],[880,0.13,0]], {type:"sine",   volume:0.11}),
      collect:       ()=> sequence([[520,0.08,0.06],[780,0.08,0.06],[1040,0.14,0]], {type:"triangle", volume:0.11}),
      clients:       ()=> sequence([[500,0.11,0.09],[700,0.15,0]], {type:"sine",   volume:0.11}),
      reportCheques: ()=> sequence([[440,0.07,0.05],[660,0.07,0.05],[880,0.07,0.05],[660,0.1,0]], {type:"triangle", volume:0.1}),
      reportClients: ()=> sequence([[880,0.07,0.05],[660,0.07,0.05],[440,0.07,0.05],[660,0.1,0]], {type:"triangle", volume:0.1}),
      receipts:      ()=> sequence([[720,0.1,0.08],[960,0.1,0.08],[1200,0.16,0]], {type:"sine",   volume:0.12}),
      users:         ()=> sequence([[380,0.1,0.08],[560,0.16,0]], {type:"square", volume:0.06}),
    },
    playScreen(name){
      const fn = this.screens[name];
      if(fn){ try{ fn(); }catch(e){} }
    },
    /* ---------- أصوات الأزرار (نغمة مختلفة حسب نوع الفعل) ---------- */
    click(){        try{ tone(760, 0.045, {type:"sine",   volume:0.05}); }catch(e){} },
    save(){         try{ sequence([[600,0.06,0.05],[900,0.1,0]],  {type:"sine",   volume:0.13}); }catch(e){} },
    success(){      try{ sequence([[700,0.07,0.06],[1000,0.07,0.06],[1300,0.13,0]], {type:"sine", volume:0.13}); }catch(e){} },
    danger(){       try{ tone(220, 0.16, {type:"sawtooth", volume:0.09, slideTo:140}); }catch(e){} },
    warn(){         try{ sequence([[500,0.09,0.08],[420,0.12,0]], {type:"square", volume:0.08}); }catch(e){} },
    print(){        try{ sequence([[520,0.05,0.04],[520,0.05,0.06],[780,0.1,0]], {type:"triangle", volume:0.09}); }catch(e){} },
    cancel(){       try{ tone(320, 0.09, {type:"sine", volume:0.06, slideTo:220}); }catch(e){} },
    notify(){       try{ sequence([[880,0.09,0.07],[1180,0.16,0]], {type:"sine", volume:0.12}); }catch(e){} },
  };
})();

/* ربط أصوات الأزرار تلقائيًا حسب فئة/سياق كل زر — بدون الحاجة لتعديل بقية الكود */
function classifyButtonSound(btn){
  const id = btn.id||"";
  const ds = btn.dataset||{};
  const cls = btn.className||"";
  const label = (btn.textContent||"").trim();

  if(cls.indexOf("btn-danger")>=0 || ds.delClient || ds.delCheque || label.indexOf("حذف")>=0) return "danger";
  if(ds.bounce || label.indexOf("ارتداد")>=0) return "warn";
  if(ds.collect || ds.printReceipt===undefined && ds.printCollection!==undefined) return "success";
  if(id==="btnSaveCheque" || id==="btnSaveClientForm" || id==="btnQcConfirm" || id==="collectConfirm" || label.indexOf("حفظ")>=0 || label.indexOf("تسجيل")>=0 || label.indexOf("إضافة")>=0) return "save";
  if(id.toLowerCase().indexOf("print")>=0 || label.indexOf("طباعة")>=0) return "print";
  if(id.toLowerCase().indexOf("cancel")>=0 || label.indexOf("إلغاء")>=0 || label.indexOf("إغلاق")>=0) return "cancel";
  if(cls.indexOf("btn-brass")>=0) return "save";
  return "click";
}

whenReady(function(){
  // تفعيل الصوت لأول مرة بعد أول تفاعل من المستخدم (متطلب المتصفحات الحديثة)
  document.addEventListener("click", function(){
    try{ SoundKit._unlocked = true; }catch(e){}
  }, { once:true, capture:true });

  document.addEventListener("click", function(e){
    const btn = e.target.closest ? e.target.closest("button, .nav-item, .btn") : null;
    if(!btn) return;
    // شاشات التنقل الجانبي — نغمة الشاشة تُشغَّل من داخل setView أدناه
    if(btn.classList.contains("nav-item")) return;
    const kind = classifyButtonSound(btn);
    SoundKit[kind] ? SoundKit[kind]() : SoundKit.click();
  }, true);
});

/* تغليف setView الأصلية لتشغيل نغمة الشاشة المناسبة عند كل تنقل */
whenReady(function(){
  if(typeof window.setView === "function"){
    const _origSetView = window.setView;
    window.setView = function(v){
      _origSetView(v);
      SoundKit.playScreen(v);
    };
  } else if(typeof setView === "function"){
    // في حال setView معرّفة داخل IIFE ومتاحة كمرجع محلي فقط، نعتمد على مراقبة تغيّر العنوان بدلاً من ذلك
    observeTitleForSound();
  }
});

/* خطة احتياطية: إن لم تكن setView متاحة على window (لأنها داخل IIFE مغلقة)،
   نراقب تغيّر عنوان الصفحة (#pageTitle) لتحديد الشاشة النشطة وتشغيل نغمتها. */
function observeTitleForSound(){
  const titleMap = {
    "إدارة الشيكات":"cheques", "تحصيل الشيكات":"collect", "العملاء وخطط السداد":"clients",
    "تقرير الشيكات":"reportCheques", "تقرير العملاء":"reportClients",
    "إيصالات استلام الشيكات":"receipts", "إدارة المستخدمين":"users"
  };
  const el = document.getElementById("pageTitle");
  if(!el) return;
  let last = el.textContent;
  const obs = new MutationObserver(()=>{
    const t = el.textContent.trim();
    if(t!==last){
      last = t;
      const key = titleMap[t];
      if(key) SoundKit.playScreen(key);
    }
  });
  obs.observe(el, {childList:true, characterData:true, subtree:true});
}
whenReady(observeTitleForSound);

/* ============================= الإشعارات اللحظية بين المستخدمين (عبر Firestore) ============================= */
whenReady(function(){
  if(typeof firebase === "undefined" || !firebase.firestore){
    console.warn("Firestore غير متاح — تم تعطيل الإشعارات اللحظية");
    return;
  }
  const notifDb = firebase.firestore();
  const NOTIF_COL = notifDb.collection("marketing_cheques_notifications");
  const SESSION_ID = "s_" + Math.random().toString(36).slice(2,10) + "_" + Date.now();
  let notifStarted = false;
  let unread = 0;

  function currentUserCode(){
    try{
      if(typeof currentUser !== "undefined" && currentUser) return currentUser.code;
    }catch(e){}
    return null;
  }
  function currentUserLabel(){
    try{
      if(typeof currentUser !== "undefined" && currentUser) return currentUser.label || currentUser.code;
    }catch(e){}
    return "مستخدم";
  }
  function currentUserRole(){
    try{
      if(typeof currentUser !== "undefined" && currentUser) return currentUser.role;
    }catch(e){}
    return null;
  }

  /* بث حدث جديد لبقية المستخدمين (يُستدعى تلقائيًا بعد أي عملية حفظ ناجحة) */
  function broadcastEvent(action, details){
    const code = currentUserCode();
    if(!code) return;
    NOTIF_COL.add({
      action: action,
      details: details || "",
      byCode: code,
      byLabel: currentUserLabel(),
      sessionId: SESSION_ID,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      tsLocal: Date.now()
    }).catch(function(err){ console.error("تعذر إرسال الإشعار:", err); });
  }
  window.broadcastEvent = broadcastEvent; // متاحة للاستخدام اليدوي عند الحاجة

  /* ---------- شارة عدد الإشعارات غير المقروءة في الشريط الجانبي ---------- */
  function ensureBadge(){
    let badge = document.getElementById("notifBellBadge");
    if(badge) return badge;
    const userBadge = document.getElementById("userBadge");
    if(!userBadge) return null;
    const bell = document.createElement("span");
    bell.id = "notifBell";
    bell.title = "الإشعارات";
    bell.style.cssText = "position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-inline-start:6px;cursor:pointer;font-size:15px;vertical-align:middle;";
    bell.textContent = "🔔";
    badge = document.createElement("span");
    badge.id = "notifBellBadge";
    badge.style.cssText = "position:absolute;top:-4px;insert-inline-end:-4px;left:-4px;background:#c0392b;color:#fff;border-radius:999px;font-size:10px;line-height:1;min-width:16px;height:16px;display:none;align-items:center;justify-content:center;padding:0 3px;font-family:sans-serif;";
    bell.appendChild(badge);
    bell.addEventListener("click", toggleNotifPanel);
    userBadge.appendChild(bell);
    return badge;
  }
  function updateBadge(){
    const badge = ensureBadge();
    if(!badge) return;
    if(unread>0){
      badge.style.display = "flex";
      badge.textContent = unread>99 ? "99+" : String(unread);
    } else {
      badge.style.display = "none";
    }
  }

  /* ---------- لوحة سجل آخر الإشعارات (منسدلة بسيطة) ---------- */
  let notifLog = [];
  function toggleNotifPanel(){
    let panel = document.getElementById("notifPanel");
    if(panel){ panel.remove(); return; }
    unread = 0; updateBadge();
    panel = document.createElement("div");
    panel.id = "notifPanel";
    panel.style.cssText = "position:fixed;z-index:9999;top:56px;inset-inline-end:18px;left:18px;width:320px;max-height:420px;overflow-y:auto;background:#fffaf0;border:1px solid #d8c9a3;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:10px;font-family:inherit;direction:rtl;";
    if(notifLog.length===0){
      panel.innerHTML = '<div style="padding:14px;color:#8a7a5c;font-size:13px;text-align:center;">لا توجد إشعارات بعد</div>';
    } else {
      panel.innerHTML = notifLog.slice().reverse().map(function(n){
        return '<div style="padding:8px 6px;border-bottom:1px solid #eee3c8;font-size:12.5px;line-height:1.7;">'
          + '<strong>' + escHtml(n.byLabel||"مستخدم") + '</strong> — ' + escHtml(n.action)
          + (n.details ? '<div style="color:#6b6b6b;">' + escHtml(n.details) + '</div>' : '')
          + '<div style="color:#a99;font-size:11px;margin-top:2px;">' + timeAgo(n.tsLocal) + '</div>'
          + '</div>';
      }).join("");
    }
    document.body.appendChild(panel);
    setTimeout(function(){
      document.addEventListener("click", function closePanel(e){
        if(panel && !panel.contains(e.target) && e.target.id!=="notifBell"){
          panel.remove();
          document.removeEventListener("click", closePanel);
        }
      });
    }, 30);
  }
  function escHtml(s){
    return String(s==null?"":s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function timeAgo(ts){
    if(!ts) return "";
    const diff = Math.max(0, Date.now()-ts);
    const m = Math.floor(diff/60000);
    if(m<1) return "الآن";
    if(m<60) return "منذ " + m + " د";
    const h = Math.floor(m/60);
    if(h<24) return "منذ " + h + " س";
    return "منذ " + Math.floor(h/24) + " يوم";
  }

  /* ---------- توست إشعار منبثق (بصري + صوتي) ---------- */
  function showNotifToast(n){
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;z-index:9999;bottom:24px;inset-inline-start:24px;left:24px;max-width:320px;background:#1f2937;color:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.28);font-size:13px;line-height:1.7;direction:rtl;opacity:0;transform:translateY(10px);transition:opacity .25s, transform .25s;";
    el.innerHTML = '<div style="font-weight:700;margin-bottom:2px;">🔔 ' + escHtml(n.byLabel||"مستخدم") + '</div>'
      + '<div>' + escHtml(n.action) + '</div>'
      + (n.details ? '<div style="color:#c9c9c9;margin-top:2px;">' + escHtml(n.details) + '</div>' : '');
    document.body.appendChild(el);
    requestAnimationFrame(function(){
      el.style.opacity = "1"; el.style.transform = "translateY(0)";
    });
    setTimeout(function(){
      el.style.opacity = "0"; el.style.transform = "translateY(10px)";
      setTimeout(function(){ el.remove(); }, 300);
    }, 4600);
  }

  /* ---------- الاستماع اللحظي لأحداث المستخدمين الآخرين ---------- */
  function startListening(){
    if(notifStarted) return;
    notifStarted = true;
    ensureBadge();
    const startTime = Date.now();
    NOTIF_COL.orderBy("tsLocal", "desc").limit(50).onSnapshot(function(snap){
      snap.docChanges().forEach(function(change){
        if(change.type !== "added") return;
        const n = change.doc.data();
        if(!n) return;
        // تجاهل إشعارات نفس الجلسة (المستخدم لا يُشعَر بعملياته الخاصة)
        if(n.sessionId === SESSION_ID) return;
        // تجاهل الأحداث القديمة السابقة لبدء الاستماع (تحميل أولي)
        if(n.tsLocal && n.tsLocal < startTime - 5000) return;

        notifLog.push(n);
        if(notifLog.length>50) notifLog.shift();
        unread++;
        updateBadge();
        showNotifToast(n);
        try{ SoundKit.notify(); }catch(e){}
      });
    }, function(err){
      console.error("تعذر الاستماع لإشعارات المستخدمين:", err);
    });
  }

  /* ابدأ الاستماع بمجرد تسجيل الدخول؛ راقب أيضًا تسجيل الدخول المتأخر */
  const startCheck = setInterval(function(){
    if(currentUserCode()){
      startListening();
      clearInterval(startCheck);
    }
  }, 500);

  /* ---------- ربط تلقائي: نشر إشعار بعد أي نجاح حفظ (اعتراض toast() و saveState()) ---------- */
  function wrapToastForBroadcast(){
    if(typeof window.toast !== "function") return false;
    const _origToast = window.toast;
    window.toast = function(msg){
      _origToast(msg);
      maybeBroadcastFromToastMessage(msg);
    };
    return true;
  }

  // خرائط رسائل toast الشائعة إلى وصف إشعار مناسب يُبث للمستخدمين الآخرين
  const BROADCAST_MAP = [
    { match:"تم إضافة العميل", action:"أضاف عميلاً جديدًا" },
    { match:"تم حفظ تعديلات العميل", action:"عدّل بيانات عميل" },
    { match:"تم حذف العميل", action:"حذف عميلاً" },
    { match:"تم حفظ الشيك بنجاح", action:"سجّل شيكًا جديدًا" },
    { match:"تم حذف الشيك", action:"حذف شيكًا" },
    { match:"تم تسجيل تحصيل الشيك", action:"حصّل شيكًا" },
    { match:"تم تسجيل التحصيل بنجاح", action:"حصّل دفعة" },
    { match:"تم تسجيل ارتداد الشيك", action:"سجّل ارتداد شيك" },
    { match:"تم إرجاع الشيك لقيد التحصيل", action:"أعاد شيكًا لقيد التحصيل" },
    { match:"تم تعديل الدفعة", action:"عدّل قيمة/تاريخ دفعة" },
    { match:"تمت استعادة القيمة الافتراضية", action:"استعاد القيمة الافتراضية لدفعة" },
  ];
  function maybeBroadcastFromToastMessage(msg){
    if(!msg) return;
    for(let i=0;i<BROADCAST_MAP.length;i++){
      if(msg.indexOf(BROADCAST_MAP[i].match)===0){
        broadcastEvent(BROADCAST_MAP[i].action, "");
        return;
      }
    }
  }

  const wrapCheck = setInterval(function(){
    if(wrapToastForBroadcast()) clearInterval(wrapCheck);
  }, 300);
});

})();
