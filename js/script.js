/* ================================================================
   إضافة: تأثيرات صوتية (فتح شاشة + الضغط على أي زر)
   ================================================================
   طريقة الدمج:
   الصق محتوى هذا الملف بالكامل في آخر app.js، قبل السطرين الأخيرين:
     initAuth();
     if(currentUser){ setView(firstAllowedView() || "collect"); }

   لا يحتاج أي ملفات صوت خارجية — الأصوات مولّدة برمجيًا (Web Audio API)
   حتى يعمل الملف بدون إنترنت وبدون تحميل أي أصول إضافية.
   ================================================================ */

(function(){
"use strict";

/* ============================= محرك الصوت (Web Audio API) ============================= */
let audioCtx = null;
let soundsEnabled = true;
const SOUND_PREF_KEY = "marketing_cheques_sound_enabled_v1";

try{
  const saved = localStorage.getItem(SOUND_PREF_KEY);
  if(saved !== null) soundsEnabled = saved === "1";
}catch(e){}

function ensureAudioCtx(){
  if(!audioCtx){
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }catch(e){
      audioCtx = null;
    }
  }
  if(audioCtx && audioCtx.state === "suspended"){
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

/* تشغيل نغمة بسيطة: تردد، مدة (ثانية)، نوع الموجة، حجم الصوت */
function playTone(freq, duration, type, gainVal, delay){
  if(!soundsEnabled) return;
  const ctx = ensureAudioCtx();
  if(!ctx) return;
  const startAt = ctx.currentTime + (delay||0);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainVal||0.15, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/* نغمة نقرة زر: نقرة قصيرة وجافة */
function playClickSound(){
  playTone(720, 0.05, "sine", 0.09, 0);
  playTone(980, 0.035, "sine", 0.05, 0.008);
}

/* نغمة فتح شاشة: نغمتان صاعدتان لطيفتان */
function playNavSound(){
  playTone(523.25, 0.09, "sine", 0.10, 0);      // C5
  playTone(659.25, 0.11, "sine", 0.09, 0.06);   // E5
}

/* نغمة نجاح (حفظ/تحصيل) */
function playSuccessSound(){
  playTone(523.25, 0.09, "sine", 0.10, 0);
  playTone(659.25, 0.09, "sine", 0.10, 0.07);
  playTone(783.99, 0.14, "sine", 0.10, 0.14);
}

/* نغمة تحذير/حذف/ارتداد */
function playWarnSound(){
  playTone(300, 0.10, "square", 0.06, 0);
  playTone(220, 0.16, "square", 0.06, 0.09);
}

/* ============================= ربط الصوت بفتح الشاشات ============================= */
/* setView الأصلية موجودة داخل نفس الـ IIFE للتطبيق، فلا يمكن التفافها من هنا مباشرة.
   بديلاً، نراقب نقرات عناصر التنقل (nav-item) نفسها، لأن كل تنقل بين الشاشات
   يمر عبر الضغط على أحد هذه العناصر. */
function hookNavSounds(){
  document.addEventListener("click", function(e){
    const navItem = e.target.closest(".nav-item");
    if(navItem){
      playNavSound();
    }
  }, true);
}

/* ============================= ربط الصوت بأي زر في التطبيق ============================= */
function hookButtonSounds(){
  document.addEventListener("click", function(e){
    const btn = e.target.closest("button");
    if(!btn) return;
    if(btn.disabled) return;
    if(btn.closest(".nav-item")) return; // تم التعامل معه في hookNavSounds بنغمة تنقل مختلفة

    // اختيار نغمة مناسبة حسب نوع الزر
    if(btn.classList.contains("btn-danger") || btn.id==="bounceConfirm" || (btn.dataset && (btn.dataset.delClient || btn.dataset.delCheque || btn.dataset.bounce))){
      playWarnSound();
    } else if(
      btn.classList.contains("btn-brass") ||
      btn.id==="btnSaveClientForm" || btn.id==="btnSaveCheque" ||
      btn.id==="collectConfirm" || btn.id==="btnQcConfirm" ||
      btn.id==="confirmYes"
    ){
      playSuccessSound();
    } else {
      playClickSound();
    }
  }, true);
}

/* ============================= تفعيل الصوت بعد أول تفاعل من المستخدم ============================= */
/* المتصفحات تمنع تشغيل الصوت قبل أول تفاعل من المستخدم (autoplay policy) —
   هذا الاستماع يضمن فتح AudioContext بمجرد أول ضغطة في الصفحة. */
function hookFirstInteractionUnlock(){
  const unlock = ()=>{ ensureAudioCtx(); };
  document.addEventListener("click", unlock, {once:true, capture:true});
  document.addEventListener("keydown", unlock, {once:true, capture:true});
}

/* ============================= زر تفعيل/كتم الصوت (اختياري، يظهر لو العنصر موجود بالصفحة) ============================= */
function initSoundToggleUI(){
  const toggle = document.getElementById("soundToggle");
  if(!toggle) return;
  const render = ()=>{ toggle.textContent = soundsEnabled ? "🔊" : "🔇"; toggle.title = soundsEnabled ? "كتم الأصوات" : "تفعيل الأصوات"; };
  render();
  toggle.addEventListener("click", ()=>{
    soundsEnabled = !soundsEnabled;
    try{ localStorage.setItem(SOUND_PREF_KEY, soundsEnabled ? "1" : "0"); }catch(e){}
    render();
    if(soundsEnabled) playClickSound();
  });
}

/* ============================= بدء التشغيل ============================= */
function initSounds(){
  hookFirstInteractionUnlock();
  hookNavSounds();
  hookButtonSounds();
  initSoundToggleUI();
}

if(document.readyState==="complete" || document.readyState==="interactive"){
  initSounds();
} else {
  document.addEventListener("DOMContentLoaded", initSounds);
}

window.playClickSound = playClickSound;
window.playNavSound = playNavSound;
window.playSuccessSound = playSuccessSound;
window.playWarnSound = playWarnSound;

})();
