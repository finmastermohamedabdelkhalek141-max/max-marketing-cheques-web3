(function(){
"use strict";

/* ============================= STORAGE (Firebase Firestore — بيانات مشتركة أونلاين) ============================= */
const firebaseConfig = {
  apiKey: "AIzaSyBpYrAGytKtXvjiAhwdY8LDMTQ5QTEgQzs",
  authDomain: "marketing-cheques.firebaseapp.com",
  databaseURL: "https://marketing-cheques-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "marketing-cheques",
  storageBucket: "marketing-cheques.firebasestorage.app",
  messagingSenderId: "752758390258",
  appId: "1:752758390258:web:0e0a945ba8171267787f6b",
  measurementId: "G-PRGW8KHX72"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const STATE_DOC = db.collection("marketing_cheques").doc("state");

function defaultState(){
  return { clients:[], cheques:[], collections:[], nextClientSeq:1, nextChequeSeq:1, nextCollectionSeq:1, userStatus:{} };
}

// state تُحمَّل محليًا بشكل افتراضي فورًا (عشان الواجهة تظهر بسرعة)، وتُستبدل ببيانات Firestore
// الحقيقية بمجرد وصولها عبر المستمع اللحظي (onSnapshot) أدناه.
function loadState(){ return defaultState(); }

let firestoreReady = false;
let pendingSave = false;

// طابور تسلسلي: كل عملية حفظ تنتظر اكتمال اللي قبلها، وتُنفَّذ داخل Firestore transaction
// تقرأ أحدث نسخة من السيرفر لحظة الكتابة (مش النسخة القديمة المحلية) فتمنع "دعس" حذف/تعديل
// حصل من مستخدم تاني قبل ما نحفظ نحن (كانت هي سبب رجوع البيانات المحذوفة).
let saveQueue = Promise.resolve();

function saveState(){
  pendingSave = true;
  const localSnapshot = state; // النسخة المحلية اللي عملنا عليها التغيير المطلوب حفظه الآن
  saveQueue = saveQueue.then(()=>
    db.runTransaction(tx=>{
      return tx.get(STATE_DOC).then(doc=>{
        const serverState = doc.exists ? Object.assign(defaultState(), doc.data()) : defaultState();
        // ندمج تغييرنا المحلي فوق أحدث نسخة من السيرفر بدل استبدالها بالكامل،
        // بحيث أي تعديل/حذف حصل من مستخدم تاني في نفس اللحظة تقريبًا ما يضيعش.
        const merged = mergeStateForSave(serverState, localSnapshot);
        tx.set(STATE_DOC, merged);
        return merged;
      });
    }).catch(err=>{
      console.error("Firestore save error:", err);
      toast("تعذر حفظ البيانات أونلاين — تحقق من اتصال الإنترنت");
    })
  );
}

// دمج بسيط: بياناتنا المحلية (اللي فيها التغيير الجديد) هي المرجع لقوائم العملاء/الشيكات/التحصيلات
// والحالات، لأن هي دي اللي عليها فعل المستخدم الحالي (إضافة/تعديل/حذف). الهدف من الدمج هو تجنّب
// إعادة كتابة حقول لسه ما وصلتناش (لو تمت إضافتها من مستخدم تاني بين آخر قراءة عندنا وبين لحظة الحفظ)
// عن طريق البدء من نسخة السيرفر الأحدث بدل نسخة محلية قديمة.
function mergeStateForSave(serverState, localState){
  return {
    ...serverState,
    clients: localState.clients,
    cheques: localState.cheques,
    collections: localState.collections,
    nextClientSeq: Math.max(serverState.nextClientSeq||1, localState.nextClientSeq||1),
    nextChequeSeq: Math.max(serverState.nextChequeSeq||1, localState.nextChequeSeq||1),
    nextCollectionSeq: Math.max(serverState.nextCollectionSeq||1, localState.nextCollectionSeq||1),
    userStatus: { ...serverState.userStatus, ...localState.userStatus }
  };
}


STATE_DOC.onSnapshot(
  { includeMetadataChanges:true },
  snap=>{
    // تجاهل الصدى المحلي الناتج عن حفظنا نحن (بيانات لسه بتتكتب/pending) — بنستخدم النسخة اللي عندنا بالفعل.
    if(snap.metadata.hasPendingWrites) return;
    if(snap.exists){
      state = Object.assign(defaultState(), snap.data());
    } else if(firestoreReady){
      // المستند اتمسح من مكان تاني؛ نرجّع الحالة الافتراضية.
      state = defaultState();
    }
    firestoreReady = true;
    if(currentUser){ try{ render(); }catch(e){ console.error(e); } }
  },
  err=>{
    console.error("Firestore listen error:", err);
    toast("تعذر الاتصال بقاعدة البيانات أونلاين");
  }
);

let state = loadState();
if(!Array.isArray(state.collections)) state.collections = [];
if(!state.nextCollectionSeq) state.nextCollectionSeq = 1;
if(!state.userStatus || typeof state.userStatus !== "object") state.userStatus = {};

/* ============================= AUTH / PERMISSIONS ============================= */
const SESSION_KEY = "marketing_cheques_session_v1";
// كل مستخدم له كود (اسم دخول) ورقم سري وصلاحيات محددة (أسماء الشاشات المسموح بها)
const USERS = [
  {
    code: "CFOMRKOO11@gmail.com",
    password: "97982732",
    role: "admin",
    label: "أدمن",
    perms: ["receipts","cheques","collect","clients","reportCheques","reportClients","users"],
    caps: { clientsMode:"full", chequesMode:"full", collectMode:"full" }
  },
  {
    code: "CMO11@gmail.com",
    password: "123123",
    role: "employee",
    label: "مسؤول",
    perms: ["clients","cheques"],
    caps: { clientsMode:"addonly", chequesMode:"viewonly", collectMode:"none" }
  },
  {
    code: "CFO11@gmail.com",
    password: "123123",
    role: "employee",
    label: "مسؤول",
    perms: ["cheques"],
    caps: { clientsMode:"none", chequesMode:"register", collectMode:"none" }
  },
  {
    code: "CMO22@gmail.com",
    password: "123123",
    role: "employee",
    label: "موظف",
    perms: ["clients"],
    caps: { clientsMode:"addonly", chequesMode:"none", collectMode:"none" }
  },
  {
    code: "CFOM22@gmail.com",
    password: "123123",
    role: "employee",
    label: "موظف",
    perms: ["cheques"],
    caps: { clientsMode:"none", chequesMode:"viewonly", collectMode:"none" }
  },
  {
    code: "mmm123@gmail.com",
    password: "123123",
    role: "employee",
    label: "موظف",
    perms: ["cheques"],
    caps: { clientsMode:"none", chequesMode:"limited", collectMode:"none" }
  }
];
let currentUser = null;
function normCode(v){ return String(v||"").trim().toLowerCase(); }
function findUser(code, password){
  return USERS.find(u => normCode(u.code)===normCode(code) && String(u.password)===String(password)) || null;
}
function hasPerm(viewName){
  if(!currentUser) return false;
  return currentUser.perms.includes(viewName);
}
function caps(){
  return (currentUser && currentUser.caps) || { clientsMode:"none", chequesMode:"none", collectMode:"none" };
}
function isLimitedPlanViewRole(){
  return caps().chequesMode === "limited";
}
/* ============================= تفعيل/إيقاف حسابات المستخدمين (الأكواد) ============================= */
// الحساب يُعتبر مفعّلاً افتراضيًا ما لم يُسجَّل له إيقاف صريح في state.userStatus
function isUserActive(code){
  const key = normCode(code);
  if(Object.prototype.hasOwnProperty.call(state.userStatus, key)) return !!state.userStatus[key];
  return true;
}
function setUserActive(code, active){
  const key = normCode(code);
  state.userStatus[key] = !!active;
  saveState();
}
function toggleUserActive(code){
  setUserActive(code, !isUserActive(code));
}

// موظف CFO11: يدخل شاشة الشيكات فقط، بصلاحية محدودة داخلها (بحث + تسجيل استلام شيك وطباعة إيصاله فقط)
function isLimitedChequesRole(){
  return caps().chequesMode === "register";
}
// موظف CMO11: يدخل شاشة إدارة الشيكات فقط للبحث والعرض بدون أي تفاعل (تحديد/تسجيل/تعديل/حذف/طباعة)
function isViewOnlyChequesRole(){
  return caps().chequesMode === "viewonly";
}
// موظف CMO11: يدخل شاشة العملاء وخطط السداد لإضافة عميل جديد فقط، بدون تعديل أو حذف لعملاء موجودين
function isAddOnlyClientsRole(){
  return caps().clientsMode === "addonly";
}

function firstAllowedView(){
  if(!currentUser) return null;
  return currentUser.perms[0] || null;
}

function loadSession(){
  try{
    const raw = sessionStorage.getItem(SESSION_KEY);
    if(raw){
      const saved = JSON.parse(raw);
      const u = USERS.find(x=>normCode(x.code)===normCode(saved.code));
      if(u) return u;
    }
  }catch(e){}
  return null;
}
function saveSession(user){
  try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify({code:user.code})); }catch(e){}
}
function clearSession(){
  try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
}

function applyPermissionsToUI(){
  // شارة المستخدم
  document.getElementById("userBadgeWho").textContent = currentUser.code;
  document.getElementById("userBadgeRole").textContent = currentUser.label;

  // عناصر التنقل: إظهار المسموح فقط
  document.querySelectorAll(".nav-item[data-perm]").forEach(el=>{
    el.classList.toggle("perm-hidden", !hasPerm(el.dataset.perm));
  });
  // إظهار عناوين المجموعات فقط إذا كان بها عنصر مسموح ظاهر
  const groupHasVisible = (groupEl) => {
    let sib = groupEl.nextElementSibling;
    while(sib && !sib.classList.contains("nav-group-label")){
      if(sib.classList.contains("nav-item") && !sib.classList.contains("perm-hidden")) return true;
      sib = sib.nextElementSibling;
    }
    return false;
  };
  ["navGroupDocs","navGroupOps","navGroupReports","navGroupAdmin"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle("perm-hidden", !groupHasVisible(el));
  });
}

function openGate(){
  document.body.classList.add("gate-open");
  document.getElementById("loginGate").style.display = "flex";
  const errBox = document.getElementById("loginErr");
  if(errBox){ errBox.classList.remove("show"); errBox.textContent = "الكود أو الرقم السري غير صحيح."; }
  const codeInput = document.getElementById("loginCode");
  if(codeInput){ codeInput.value=""; }
  const passInput = document.getElementById("loginPass");
  if(passInput){ passInput.value=""; }
  setTimeout(()=>{ if(codeInput) codeInput.focus(); }, 50);
}
function closeGate(){
  document.body.classList.remove("gate-open");
  document.getElementById("loginGate").style.display = "none";
}

function doLogin(code, password){
  const u = findUser(code, password);
  const errBox = document.getElementById("loginErr");
  if(!u){
    if(errBox) errBox.classList.add("show");
    return false;
  }
  if(!isUserActive(u.code)){
    if(errBox){
      errBox.textContent = "هذا الحساب موقوف حاليًا. الرجاء مراجعة الأدمن.";
      errBox.classList.add("show");
    }
    return false;
  }
  if(errBox) errBox.classList.remove("show");
  currentUser = u;
  saveSession(u);
  closeGate();
  applyPermissionsToUI();
  setView(firstAllowedView() || "collect");
  return true;
}

function doLogout(){
  currentUser = null;
  clearSession();
  openGate();
}

function initAuth(){
  document.getElementById("loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    const code = document.getElementById("loginCode").value;
    const password = document.getElementById("loginPass").value;
    doLogin(code, password);
  });
  document.getElementById("btnLogout").addEventListener("click", doLogout);

  const restored = loadSession();
  if(restored && isUserActive(restored.code)){
    currentUser = restored;
    closeGate();
    applyPermissionsToUI();
  } else {
    if(restored) clearSession();
    openGate();
  }
}

function purgeOrphanChequeData(){
  const validIds = new Set(state.clients.map(c=>c.id));
  const orphanChequeIds = new Set(state.cheques.filter(chq=>!validIds.has(chq.clientId)).map(chq=>chq.id));
  if(orphanChequeIds.size===0) return 0;
  state.cheques = state.cheques.filter(chq=>!orphanChequeIds.has(chq.id));
  state.collections = state.collections.filter(rec=>!orphanChequeIds.has(rec.chequeId) && validIds.has(rec.clientId));
  saveState();
  return orphanChequeIds.size;
}
let view = "cheques";

/* ============================= HELPERS ============================= */
function fmt(n){
  n = Number(n)||0;
  return n.toLocaleString("ar-OM",{minimumFractionDigits:0,maximumFractionDigits:3});
}
function fmtPct(n){
  n = Number(n)||0;
  return n.toLocaleString("ar-OM",{minimumFractionDigits:0,maximumFractionDigits:2});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){
  if(!d) return "—";
  try{
    const dt = new Date(d+"T00:00:00");
    return dt.toLocaleDateString("ar-OM",{year:"numeric",month:"long",day:"numeric"});
  }catch(e){ return d; }
}
function uid(prefix){ return prefix+"_"+Math.random().toString(36).slice(2,9); }
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove("show"), 2400);
}
function esc(s){
  return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* Convert a Rial Omani amount (rial + baisa, 1 rial = 1000 baisa) into formal Arabic words,
   for use on the legal collection receipt ("المبلغ كتابة"). */
function numberToArabicWords(amount){
  amount = Math.round(Math.max(0, Number(amount)||0) * 1000) / 1000;
  const rial = Math.floor(amount);
  const baisa = Math.round((amount - rial) * 1000);

  const ones = ["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة"];
  const teens = ["عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
  const tens = ["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
  const hundreds = ["","مائة","مئتان","ثلاثمائة","أربعمائة","خمسمائة","ستمائة","سبعمائة","ثمانمائة","تسعمائة"];

  function threeDigits(n){
    n = Math.floor(n);
    if(n<=0) return "";
    const h = Math.floor(n/100), rem = n%100, t = Math.floor(rem/10), o = rem%10;
    const parts = [];
    if(h>0) parts.push(hundreds[h]);
    if(rem>=10 && rem<20){
      parts.push(teens[rem-10]);
    } else {
      if(o>0) parts.push(ones[o]);
      if(t>0) parts.push(tens[t]);
    }
    return parts.join(" و");
  }

  function integerWords(n){
    if(n<=0) return "صفر";
    const scales = [
      {value:1000000000, singular:"مليار", dual:"ملياران", plural:"مليارات"},
      {value:1000000, singular:"مليون", dual:"مليونان", plural:"ملايين"},
      {value:1000, singular:"ألف", dual:"ألفان", plural:"آلاف"}
    ];
    let rest = n; const words = [];
    scales.forEach(sc=>{
      const count = Math.floor(rest/sc.value);
      if(count>0){
        rest = rest % sc.value;
        if(count===1) words.push(sc.singular);
        else if(count===2) words.push(sc.dual);
        else if(count>=3 && count<=10) words.push(threeDigits(count)+" "+sc.plural);
        else words.push(threeDigits(count)+" "+sc.singular);
      }
    });
    if(rest>0) words.push(threeDigits(rest));
    return words.join(" و") || "صفر";
  }

  let result = integerWords(rial) + " ريال عماني";
  if(baisa>0) result += " و" + integerWords(baisa) + " بيسة";
  result += " لا غير";
  return result;
}

/* ============================= OMAN BANKS LIST ============================= */
const COMPANY_LOGO_DATA_URI = "data:image/png;base64,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";

const OMAN_BANKS = {
  "بنوك محلية": [
    "بنك مسقط",
    "البنك الوطني العماني",
    "بنك ظفار",
    "بنك صحار الدولي",
    "البنك العربي العماني",
    "البنك الأهلي"
  ],
  "بنوك إسلامية": [
    "بنك نزوى",
    "بنك العز الإسلامي",
    "ميثاق (الخدمات المصرفية الإسلامية - بنك مسقط)"
  ],
  "بنوك متخصصة": [
    "بنك التنمية العماني",
    "بنك الإسكان العماني"
  ],
  "فروع بنوك أجنبية": [
    "HSBC عمان",
    "بنك أبوظبي الأول - عمان",
    "بنك قطر الوطني - عمان",
    "ستاندرد تشارترد - عمان",
    "ستيت بنك أوف إنديا - عمان",
    "بنك حبيب المحدود - عمان",
    "بنك بيروت عمان"
  ]
};
const BANK_CASH_VALUE = "نقدًا (كاش)";
const BANK_OTHER_VALUE = "__other__";
const BANK_TRANSFER_PREFIX = "تحويل - ";
const ALL_BANK_NAMES = Object.values(OMAN_BANKS).flat();
const ALL_TRANSFER_VALUES = ALL_BANK_NAMES.map(b=>BANK_TRANSFER_PREFIX+b);

function bankSelectHtml(selectedId, selectedValue){
  const isKnown = ALL_BANK_NAMES.includes(selectedValue) || ALL_TRANSFER_VALUES.includes(selectedValue) || selectedValue===BANK_CASH_VALUE;
  const isOther = selectedValue && !isKnown;
  let html = `<select id="${selectedId}">`;
  html += `<option value="">— اختر —</option>`;
  html += `<option value="${esc(BANK_CASH_VALUE)}" ${selectedValue===BANK_CASH_VALUE?"selected":""}>${esc(BANK_CASH_VALUE)}</option>`;
  html += `<optgroup label="تحويل بنكي">`;
  ALL_BANK_NAMES.forEach(b=>{
    const val = BANK_TRANSFER_PREFIX+b;
    html += `<option value="${esc(val)}" ${selectedValue===val?"selected":""}>${esc(val)}</option>`;
  });
  html += `</optgroup>`;
  Object.keys(OMAN_BANKS).forEach(group=>{
    html += `<optgroup label="${esc(group)}">`;
    OMAN_BANKS[group].forEach(b=>{
      html += `<option value="${esc(b)}" ${selectedValue===b?"selected":""}>${esc(b)}</option>`;
    });
    html += `</optgroup>`;
  });
  html += `<option value="${BANK_OTHER_VALUE}" ${isOther?"selected":""}>بنك آخر (اكتب الاسم)</option>`;
  html += `</select>
    <input id="${selectedId}Other" placeholder="اكتب اسم البنك" style="margin-top:8px;${isOther?"":"display:none;"}" value="${isOther?esc(selectedValue):""}">`;
  return html;
}
function bindBankSelect(selectId){
  const sel = document.getElementById(selectId);
  const other = document.getElementById(selectId+"Other");
  if(!sel || !other) return;
  sel.addEventListener("change", ()=>{
    other.style.display = sel.value===BANK_OTHER_VALUE ? "block" : "none";
    if(sel.value===BANK_OTHER_VALUE) other.focus();
  });
}
function getBankValue(selectId){
  const sel = document.getElementById(selectId);
  const other = document.getElementById(selectId+"Other");
  if(!sel) return "";
  if(sel.value===BANK_OTHER_VALUE) return (other?.value||"").trim();
  return sel.value;
}

/* Payment status helpers for an installment.
   An unpaid installment is only marked "overdue" once its due date has passed by
   more than 2 days (a short grace period) — otherwise it stays "upcoming". */
function installmentStatus(inst){
  const paid = inst.paidAmount||0;
  if(paid >= inst.amount - 0.5) return "paid";
  if(paid > 0) return "partial";
  const due = inst.dueDate;
  if(due){
    const dueDate = new Date(due+"T00:00:00");
    const today = new Date(todayISO()+"T00:00:00");
    const diffDays = Math.round((today-dueDate)/(1000*60*60*24));
    if(diffDays > 2) return "overdue";
  }
  return "upcoming";
}
function statusBadge(status){
  const map = {
    paid:      ['badge-ok','مسدد بالكامل'],
    partial:   ['badge-due','مسدد جزئيًا'],
    overdue:   ['badge-warn','متأخر'],
    upcoming:  ['badge-idle','لم يحين موعدها'],
  };
  const [cls,label] = map[status]||map.upcoming;
  return `<span class="badge ${cls}">${label}</span>`;
}

/* For a still-pending cheque, derive its collection urgency from its due date (chequeDate):
   - overdue (due date already passed): "متأخرة"
   - due date today or in the future (or no due date set): "لم يحين موعدها" */
function pendingChequeUrgency(chequeDate){
  if(!chequeDate) return "upcoming";
  const due = new Date(chequeDate+"T00:00:00");
  const today = new Date(todayISO()+"T00:00:00");
  if(due < today) return "late";
  return "upcoming";
}

/* Cheque collection status: pending (received, awaiting bank clearance — shown with a
   dynamic urgency sub-label based on its due date), collected (cashed successfully),
   bounced (returned/rejected by bank). Pass the cheque object (or {status, chequeDate}). */
function chequeStatusBadge(chq){
  if(typeof chq === "string") chq = {status:chq, chequeDate:null}; // backward-compat call style
  const status = chq.status || "pending";
  if(status==="collected"){
    const face = chq.amount||0;
    const collected = (chq.collectedAmount!=null ? chq.collectedAmount : face);
    if(face>0.5 && collected < face-0.5){
      return `<span class="badge badge-due">تحصيل جزئي (${fmt(collected)} من ${fmt(face)})</span>`;
    }
    return `<span class="badge badge-ok">تم التحصيل</span>`;
  }
  if(status==="bounced") return `<span class="badge badge-warn">مرتد</span>`;
  const urgencyMap = {
    late:       ['badge-warn','متأخرة'],
    upcoming:   ['badge-idle','لم يحين موعدها'],
  };
  const [cls,label] = urgencyMap[pendingChequeUrgency(chq.chequeDate)];
  return `<span class="badge ${cls}">${label}</span>`;
}

/* Build a client's installment plan from stored assumptions.
   Structure mirrors the uploaded model: reservation + down payment + N years, each year split into
   3 flexible phases (3 months / 3 months / 5 months) chosen by the client, plus an auto-computed
   final (12th) installment = year total - sum of the 11 flexible installments. */
function buildPlan(client){
  const installments = [];
  let seq = 1;
  installments.push({
    id: client.id+"_res", seq: seq++, type:"حجز", label:"دفعة الحجز",
    year:null, month:null, amount: client.reservation, dueDate: client.contractDate || null
  });
  installments.push({
    id: client.id+"_down", seq: seq++, type:"مقدم", label:"دفعة المقدم",
    year:null, month:null, amount: client.downPayment, dueDate: client.contractDate || null
  });
  const startDate = client.installmentsStartDate ? new Date(client.installmentsStartDate+"T00:00:00") : (client.contractDate ? new Date(client.contractDate+"T00:00:00") : new Date());

  if(client.installmentMode === "consultant"){
    // Consultant-based schedule: one installment per row, valued as a percentage of
    // the remaining balance (المتبقي المقسط على السنوات), spaced monthly starting
    // from the installments start date. Order follows the row order set on the client.
    let cursor = new Date(startDate);
    const rows = client.consultantSchedule || [];
    rows.forEach((row, i)=>{
      const amt = (client.remaining||0) * ((parseFloat(row.percent)||0)/100);
      const due = new Date(cursor);
      installments.push({
        id: client.id+"_cs"+(row.id||i), seq: seq++, type:"قسط استشاري",
        label: row.label || `دفعة ${i+1}`,
        year:null, month:i+1, amount: Math.round(amt*100)/100,
        dueDate: due.toISOString().slice(0,10),
        consultantPercent: parseFloat(row.percent)||0
      });
      cursor.setMonth(cursor.getMonth()+1);
    });
  } else {
    let cursor = new Date(startDate);
    const yearPlans = client.yearPlans || [];
    for(let y=1; y<=client.years; y++){
      const yp = yearPlans[y-1] || {phase1:0, phase2:0, phase3:0, lastInstallment:0};
      for(let m=1; m<=12; m++){
        const due = new Date(cursor);
        let amt;
        if(m<=3) amt = yp.phase1||0;
        else if(m<=6) amt = yp.phase2||0;
        else if(m<=11) amt = yp.phase3||0;
        else amt = yp.lastInstallment||0;
        installments.push({
          id: client.id+"_y"+y+"m"+m, seq: seq++, type:"قسط شهري",
          label: `السنة ${arabicYear(y)} — شهر ${m}`,
          year:y, month:m, amount: Math.round(amt*100)/100,
          dueDate: due.toISOString().slice(0,10)
        });
        cursor.setMonth(cursor.getMonth()+1);
      }
    }
  }

  const overrides = client.planOverrides || {};
  installments.forEach(inst=>{
    const o = overrides[inst.id];
    if(o){
      if(o.amount!=null && o.amount!=="") inst.amount = Math.round((parseFloat(o.amount)||0)*100)/100;
      if(o.dueDate) inst.dueDate = o.dueDate;
      inst.edited = true;
    }
  });
  return installments;
}
function arabicYear(y){ return ["الأولى","الثانية","الثالثة","الرابعة","الخامسة","السادسة"][y-1] || y; }

/* Attach paid amounts from recorded cheques to a plan */
function planWithPayments(client){
  const plan = buildPlan(client);
  const activeCheques = state.cheques.filter(c=>c.clientId===client.id && c.status!=="bounced");
  const collectedCheques = activeCheques.filter(c=>c.status==="collected");
  const byInstCovered = {}, byInstPaid = {};
  activeCheques.forEach(c=>{
    (c.allocations||[]).forEach(a=>{
      byInstCovered[a.installmentId] = (byInstCovered[a.installmentId]||0) + a.amount;
    });
  });
  collectedCheques.forEach(c=>{
    // Credit installments only with the portion actually collected from the bank
    // (chq.collectedAmount), not the cheque's face value. If the cheque was only
    // partially collected, spread that ratio across all of its allocated installments
    // so the plan/status correctly shows "مسدد جزئيًا" instead of "مسدد بالكامل".
    const faceAmount = c.amount || 0;
    const actuallyCollected = (c.collectedAmount!=null ? c.collectedAmount : faceAmount);
    const ratio = faceAmount>0.5 ? Math.min(1, actuallyCollected/faceAmount) : 1;
    (c.allocations||[]).forEach(a=>{
      byInstPaid[a.installmentId] = (byInstPaid[a.installmentId]||0) + a.amount*ratio;
    });
  });
  plan.forEach(inst=>{
    inst.coveredAmount = byInstCovered[inst.id]||0; // has a cheque assigned (pending or collected)
    inst.paidAmount = byInstPaid[inst.id]||0;        // actually collected from the bank
  });
  return plan;
}

function clientTotals(client){
  const plan = planWithPayments(client);
  const totalDue = plan.reduce((s,i)=>s+i.amount,0);
  const totalPaid = plan.reduce((s,i)=>s+i.paidAmount,0);
  const overdue = plan.filter(i=>installmentStatus(i)==="overdue").reduce((s,i)=>s+(i.amount-i.paidAmount),0);
  return { totalDue, totalPaid, remaining: totalDue-totalPaid, overdue, plan };
}

function findClientByCode(code){
  code = (code||"").trim();
  if(!code) return null;
  return state.clients.find(c=>c.code.toLowerCase() === code.toLowerCase()) || null;
}

/* ============================= SEED DATA ============================= */
function seedDemo(){
  if(state.clients.length){
    if(!confirm("سيتم إضافة بيانات تجريبية إلى البيانات الحالية. متابعة؟")) return;
  }
  const c1id = uid("cl");
  const c2id = uid("cl");
  state.clients.push({
    id:c1id, code:"CL-1001", name:"أحمد محمد السيد", unit:"شقة A-204 — كمبوند النخيل",
    phone:"968 9123 4567", contractNumber:"CN-2025-0451", contractDate:"2025-01-15",
    unitPrice:1500000,
    reservationPct:0.05, reservation:75000,
    downPaymentPct:0.10, downPayment:150000,
    remainingPct:0.85, remaining:1275000, chequesCount:36, years:3,
    yearPlans:[
      {percent:0.40, amount:510000, phase1:42500, phase2:42500, phase3:42500, lastInstallment:42500},
      {percent:0.35, amount:446250, phase1:37187.5, phase2:37187.5, phase3:37187.5, lastInstallment:37187.5},
      {percent:0.25, amount:318750, phase1:26562.5, phase2:26562.5, phase3:26562.5, lastInstallment:26562.5}
    ],
    installmentsStartDate:"2025-02-15",
    createdAt: new Date().toISOString()
  });
  state.clients.push({
    id:c2id, code:"CL-1002", name:"منى عبد الرحمن", unit:"فيلا B-12 — كمبوند الواحة",
    phone:"968 9988 1122", contractNumber:"CN-2024-0389", contractDate:"2024-11-01",
    unitPrice:2400000,
    reservationPct:0.05, reservation:120000,
    downPaymentPct:0.10, downPayment:240000,
    remainingPct:0.85, remaining:2040000, chequesCount:48, years:4,
    yearPlans:[
      {percent:0.30, amount:612000, phase1:51000, phase2:51000, phase3:51000, lastInstallment:51000},
      {percent:0.25, amount:510000, phase1:42500, phase2:42500, phase3:42500, lastInstallment:42500},
      {percent:0.25, amount:510000, phase1:42500, phase2:42500, phase3:42500, lastInstallment:42500},
      {percent:0.20, amount:408000, phase1:34000, phase2:34000, phase3:34000, lastInstallment:34000}
    ],
    installmentsStartDate:"2024-12-01",
    createdAt: new Date().toISOString()
  });
  // A couple of recorded cheques for client 1
  const plan1 = buildPlan(state.clients.find(c=>c.id===c1id));
  state.cheques.push({
    id: uid("chk"), clientId:c1id, chequeNumber:"0451236", bank:"بنك مسقط",
    amount: plan1[0].amount, receivedDate:"2025-01-15", chequeDate:"2025-01-15", notes:"",
    allocations:[{installmentId:plan1[0].id, amount:plan1[0].amount}],
    status:"collected", collectedDate:"2025-01-16", bounceDate:null, bounceReason:"",
    seq: state.nextChequeSeq++, createdAt:new Date().toISOString()
  });
  state.cheques.push({
    id: uid("chk"), clientId:c1id, chequeNumber:"0451237", bank:"بنك مسقط",
    amount: plan1[1].amount, receivedDate:"2025-01-15", chequeDate:"2025-02-01", notes:"",
    allocations:[{installmentId:plan1[1].id, amount:plan1[1].amount}],
    status:"pending", collectedDate:null, bounceDate:null, bounceReason:"",
    seq: state.nextChequeSeq++, createdAt:new Date().toISOString()
  });
  saveState();
  toast("تم تحميل بيانات تجريبية");
  render();
}
document.getElementById("btnSeed").addEventListener("click", seedDemo);

/* ============================= NAV ============================= */
document.querySelectorAll(".nav-item").forEach(el=>{
  el.addEventListener("click", ()=>{ setView(el.dataset.view); });
});
function setView(v){
  if(!hasPerm(v)){
    v = firstAllowedView();
    if(!v) return;
  }
  view = v;
  document.querySelectorAll(".nav-item").forEach(el=>{
    el.classList.toggle("active", el.dataset.view===v);
  });
  const titles = {
    cheques:["إدارة الشيكات","ابحث عن العميل بالكود لعرض خطة السداد وتسجيل استلام شيك"],
    collect:["تحصيل الشيكات","متابعة كل الشيكات المستلمة وتسجيل تحصيلها أو ارتدادها من البنك"],
    clients:["العملاء وخطط السداد","إضافة عميل جديد وضبط بيانات خطة السداد الخاصة به"],
    reportCheques:["تقرير الشيكات","كل الشيكات المستلمة عبر جميع العملاء"],
    reportClients:["تقرير العملاء","ملخص الحالة المالية لكل عميل"],
    receipts:["إيصالات استلام الشيكات","السجل الرسمي الموثّق لكل إيصال صادر عن استلام شيك من عميل"],
    users:["إدارة المستخدمين","تفعيل أو إيقاف صلاحية الدخول لأي كود مستخدم"],
  };
  document.getElementById("pageTitle").textContent = titles[v][0];
  document.getElementById("pageSub").textContent = titles[v][1];
  render();
}

/* ============================= RENDER ROOT ============================= */
function render(){
  const app = document.getElementById("app");
  if(view==="cheques") app.innerHTML = renderChequesScreen();
  else if(view==="collect") app.innerHTML = renderCollectScreen();
  else if(view==="clients") app.innerHTML = renderClientsScreen();
  else if(view==="reportCheques") app.innerHTML = renderChequesReport();
  else if(view==="reportClients") app.innerHTML = renderClientsReport();
  else if(view==="receipts") app.innerHTML = renderReceiptsScreen();
  else if(view==="users") app.innerHTML = renderUsersScreen();
  bindEvents();
}

/* ============================= SCREEN: CHEQUES (marketing entry point) ============================= */
let chequeSearchState = { code:"", client:null, selectedInstallments:{} };
let receiptsSearchState = { q:"" };

function renderChequesScreen(){
  const c = chequeSearchState.client;
  let html = `
  <div class="card">
    <h2>البحث عن العميل</h2>
    <p class="hint">اكتب كود العميل فقط لعرض بيانات خطة السداد الخاصة به.</p>
    <div class="row" style="align-items:end;">
      <div class="field" style="margin-bottom:0;">
        <label>كود العميل</label>
        <input id="chqCode" placeholder="مثال: CL-1001" value="${esc(chequeSearchState.code)}" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:0;">
        <button class="btn btn-brass" id="btnFindClient">عرض بيانات العميل</button>
      </div>
    </div>
  </div>`;

  if(chequeSearchState.code && !c){
    html += `<div class="card"><div class="empty"><div class="ico">🔍</div>لا يوجد عميل بهذا الكود. تحقّق من الكود أو أضف العميل من شاشة «العملاء وخطط السداد».</div></div>`;
    return html;
  }
  if(!c) return html;

  const t = clientTotals(c);
  const chqLimited = isLimitedPlanViewRole();
  const chqNoActions = isLimitedChequesRole() || isViewOnlyChequesRole() || chqLimited;
  const chqNoSelect = isViewOnlyChequesRole();

  html += `
  <div class="card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="margin-bottom:8px;">${esc(c.name)} <span class="muted" style="font-weight:400;font-size:14px;">— ${esc(c.code)}</span></h2>
        <div class="tag-flex">
          <span class="tag">${esc(c.unit)}</span>
          ${c.contractNumber ? `<span class="tag">رقم العقد: ${esc(c.contractNumber)}</span>` : ""}
          <span class="tag">سعر الوحدة: ${fmt(c.unitPrice)} ر.ع</span>
          <span class="tag">تاريخ التعاقد: ${fmtDate(c.contractDate)}</span>
        </div>
      </div>
    </div>
    ${chqLimited ? "" : `
    <div class="kpi-grid" style="margin-top:18px;">
      <div class="kpi"><div class="lbl">إجمالي المستحق</div><div class="val">${fmt(t.totalDue)} <small>ر.ع</small></div></div>
      <div class="kpi"><div class="lbl">إجمالي المسدد (شيكات محصّلة فعليًا)</div><div class="val">${fmt(t.totalPaid)} <small>ر.ع</small></div></div>
      <div class="kpi"><div class="lbl">المتبقي</div><div class="val">${fmt(t.remaining)} <small>ر.ع</small></div></div>
      <div class="kpi"><div class="lbl">متأخر السداد</div><div class="val" style="color:${t.overdue>0?'var(--warn)':'inherit'}">${fmt(t.overdue)} <small>ر.ع</small></div></div>
    </div>`}
  </div>

  html += chqLimited ? `
  <div class="card">
    <h2 style="margin:0 0 12px;">خطة السداد والدفعات</h2>
    <p class="hint">حدد دفعة أو أكثر مستحقة، ثم سجّل رقم الشيك المستلم من العميل أدناه.</p>
    <div class="table-wrap">
      <table id="planTable">
        <thead><tr>
          <th style="width:36px;" class="no-print"></th>
          <th>م</th><th>البيان</th><th>تاريخ الاستحقاق</th>
        </tr></thead>
        <tbody>
          ${t.plan.filter(inst=>inst.amount>0.001).map(inst=>{
            const uncovered = Math.max(0, inst.amount - inst.coveredAmount);
            const checked = chequeSearchState.selectedInstallments[inst.id] ? "checked" : "";
            const disabled = uncovered<=0.5 ? "disabled" : "";
            return `<tr>
              <td class="no-print"><input type="checkbox" class="instCheck" data-inst="${inst.id}" ${checked} ${disabled}></td>
              <td class="num muted">${inst.seq}</td>
              <td>${esc(inst.label)}</td>
              <td class="num">${fmtDate(inst.dueDate)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
  ` : `
  <div class="card">
    <div class="toolbar" style="margin-bottom:2px;">
      <h2 style="margin:0;">خطة السداد والدفعات</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportPlanExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportPlanWord">تصدير Word</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnPrintPlan">طباعة جدول السداد</button>
    </div>
    <p class="hint">حدد دفعة أو أكثر مستحقة، ثم سجّل رقم الشيك المستلم من العميل لاستخراج إيصال استلام. ملحوظة: عمود «المسدد» يعكس فقط الشيكات التي تم تحصيلها فعليًا من البنك (من شاشة تحصيل الشيكات) — أما الشيك المستلم ولم يُحصَّل بعد فيمنع تسجيل شيك آخر لنفس الدفعة، لكنه لا يُحتسب مسددًا حتى يتم تحصيله. يمكنك تعديل قيمة أو تاريخ استحقاق أي دفعة يدويًا بالضغط على «تعديل».</p>
    <div class="table-wrap">
      <table id="planTable">
        <thead><tr>
          ${chqNoSelect ? "" : `<th style="width:36px;" class="no-print"></th>`}
          <th>م</th><th>البيان</th><th>نوع الدفعة</th><th>تاريخ الاستحقاق</th>
          <th>القيمة المستحقة</th><th>المسدد</th><th>رقم الشيك</th><th>الحالة</th>${chqNoActions ? "" : `<th class="no-print">تعديل</th>`}
        </tr></thead>
        <tbody>
          ${t.plan.filter(inst=>inst.amount>0.001).map(inst=>{
            const st = installmentStatus(inst);
            const remaining = Math.max(0, inst.amount - inst.paidAmount);
            const uncovered = Math.max(0, inst.amount - inst.coveredAmount);
            const checked = chequeSearchState.selectedInstallments[inst.id] ? "checked" : "";
            const disabled = uncovered<=0.5 ? "disabled" : "";
            const linkedCheques = state.cheques.filter(chq=>(chq.allocations||[]).some(a=>a.installmentId===inst.id));
            const chqCell = linkedCheques.length
              ? linkedCheques.map(chq=>`
                  <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                    <span>${esc(chq.chequeNumber)} ${chequeStatusBadge(chq)}</span>
                    ${chqNoActions ? "" : `
                    <button class="btn btn-ghost btn-sm no-print" data-print-receipt="${chq.id}" title="طباعة إيصال هذا الشيك" style="padding:2px 8px;">🖨️</button>
                    <button class="btn btn-danger btn-sm no-print" data-del-cheque="${chq.id}" title="حذف هذا الشيك" style="padding:2px 8px;">🗑️</button>`}
                  </div>`).join("")
              : `<span class="muted">—</span>`;
            return `<tr>
              ${chqNoSelect ? "" : `<td class="no-print"><input type="checkbox" class="instCheck" data-inst="${inst.id}" ${checked} ${disabled}></td>`}
              <td class="num muted">${inst.seq}</td>
              <td>${esc(inst.label)} ${inst.edited?`<span class="muted" title="تم تعديلها يدويًا">✎</span>`:""}</td>
              <td class="muted">${esc(inst.type)}</td>
              <td class="num">${fmtDate(inst.dueDate)}</td>
              <td class="num">${fmt(inst.amount)}</td>
              <td class="num">${fmt(inst.paidAmount)} ${inst.paidAmount>0 && remaining>0 ? `<span class="muted">(متبقي ${fmt(remaining)})</span>`:""}</td>
              <td class="num">${chqCell}</td>
              <td>${statusBadge(st)}</td>
              ${chqNoActions ? "" : `<td class="no-print"><button class="btn btn-ghost btn-sm" data-edit-inst="${inst.id}">تعديل</button></td>`}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
  `;

  ${chqNoSelect ? "" : `
  <div class="card">
    <h2>تسجيل استلام شيك</h2>
    <p class="hint">أدخل بيانات الشيك المستلم فقط — لا يلزم إدخال أي بيانات أخرى.</p>
    <div class="row3">
      <div class="field">
        <label>رقم الشيك</label>
        <input id="chkNumber" placeholder="رقم الشيك">
      </div>
      <div class="field">
        <label>البنك (اختياري)</label>
        ${bankSelectHtml("chkBank", "")}
      </div>
      <div class="field">
        <label>تاريخ استحقاق الشيك</label>
        <input id="chkDate" type="date" readonly style="background:#f1ede2;">
        <div class="import-hint">تلقائي — يؤخذ من تاريخ استحقاق الدفعة المحددة أدناه.</div>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label>تاريخ استلام الشيك</label>
        <input id="chkReceived" type="date" value="${todayISO()}" readonly style="background:#f1ede2;">
        <div class="import-hint">تلقائي — تاريخ اليوم من الجهاز.</div>
      </div>
      <div class="field">
        <label>ملاحظات (اختياري)</label>
        <input id="chkNotes" placeholder="ملاحظات إضافية">
      </div>
    </div>
    <div class="field">
      <label>قيمة الشيك</label>
      <input id="chkAmount" type="number" step="0.01" placeholder="0.00" readonly style="background:#f1ede2;">
      <div class="import-hint" id="selSummary">حدد دفعة واحدة أو أكثر من الجدول أعلاه لحساب قيمة الشيك تلقائيًا.</div>
    </div>
    <button class="btn btn-brass" id="btnSaveCheque">حفظ الشيك واستخراج الإيصال</button>
  </div>`}`;

  return html;
}

/* ============================= SCREEN: COLLECT CHEQUES ============================= */
let collectFilterState = { status:"pending", q:"" };
let quickCollectState = { code:"", client:null, chequeId:"", receiptNumber:"" };
/* Tracks the last collect/reopen/bounce action taken on this screen, so a persistent
   confirmation (not just a fading toast) can be shown at the bottom of the screen. */
let lastCollectAction = null;

/* Quick-collect panel: look a client up by code, show their unit/contract, let the user
   pick the due date of a payment that already has a pending cheque registered against it,
   auto-fill that cheque's number & value, then record the amount actually collected and
   the collection method (bank / cash) and issue a formal collection receipt. */
function renderQuickCollectCard(){
  const c = quickCollectState.client;
  let html = `
  <div class="card" style="border:2px solid var(--brass);">
    <h2>تحصيل سريع بواسطة كود العميل</h2>
    <p class="hint">أدخل كود العميل لعرض اسم الوحدة ورقم العقد الخاصين به، ثم اختر تاريخ استحقاق الدفعة لعرض بيانات الشيك المرتبط بها وتسجيل تحصيلها.</p>
    <div class="row" style="align-items:end;">
      <div class="field" style="margin-bottom:0;">
        <label>كود العميل</label>
        <input id="qcCode" placeholder="مثال: CL-1001" value="${esc(quickCollectState.code)}" autocomplete="off">
      </div>
      <div class="field" style="margin-bottom:0;">
        <button class="btn btn-brass" id="btnQcFind">عرض بيانات العميل</button>
      </div>
    </div>`;

  if(quickCollectState.code && !c){
    html += `<div class="empty" style="padding:24px 0;"><div class="ico">🔍</div>لا يوجد عميل بهذا الكود.</div>
    </div>`;
    return html;
  }
  if(!c){ html += `</div>`; return html; }

  html += `
    <div class="tag-flex" style="margin-top:14px;">
      <span class="tag">${esc(c.name)}</span>
      <span class="tag">الوحدة: ${esc(c.unit)}</span>
      ${c.contractNumber ? `<span class="tag">رقم العقد: ${esc(c.contractNumber)}</span>` : ""}
    </div>`;

  // Due payments include cheques still pending AND cheques already collected but only
  // *partially* (chq.collectedAmount < chq.amount) — so the remaining balance of a
  // partially-collected payment stays selectable here until it is fully settled.
  const dueCheques = state.cheques
    .filter(chq=>chq.clientId===c.id && (
      chq.status==="pending" ||
      (chq.status==="collected" && chq.amount>0.5 && (chq.collectedAmount!=null?chq.collectedAmount:chq.amount) < chq.amount-0.5)
    ))
    .sort((a,b)=>(a.chequeDate||"").localeCompare(b.chequeDate||""));

  if(dueCheques.length===0){
    html += `<div class="empty" style="padding:24px 0;"><div class="ico">✅</div>لا توجد شيكات قيد التحصيل لهذا العميل حاليًا.</div>
    </div>`;
    return html;
  }

  const selChq = dueCheques.find(chq=>chq.id===quickCollectState.chequeId) || dueCheques[0];
  quickCollectState.chequeId = selChq.id;
  const selIsPartial = selChq.status==="collected";
  const selPaidSoFar = selIsPartial ? (selChq.collectedAmount||0) : 0;
  const selRemaining = Math.max(0, selChq.amount - selPaidSoFar);

  html += `
    <div class="field" style="margin-top:14px;">
      <label>تاريخ استحقاق الدفعة</label>
      <select id="qcDueSelect">
        ${dueCheques.map(chq=>{
          const isPartial = chq.status==="collected";
          const remaining = isPartial ? Math.max(0, chq.amount-(chq.collectedAmount||0)) : chq.amount;
          const suffix = isPartial ? ` — تحصيل جزئي، المتبقي ${fmt(remaining)} ر.ع` : ` — ${fmt(chq.amount)} ر.ع`;
          return `<option value="${chq.id}" ${chq.id===selChq.id?"selected":""}>${fmtDate(chq.chequeDate)} — شيك رقم ${esc(chq.chequeNumber)}${suffix}</option>`;
        }).join("")}
      </select>
    </div>
    ${selIsPartial ? `<div class="tag-flex" style="margin-top:8px;">
      <span class="tag" style="border-color:var(--warn);color:var(--warn);">تحصيل جزئي سابق: ${fmt(selPaidSoFar)} ر.ع من أصل ${fmt(selChq.amount)} ر.ع</span>
      <span class="tag" style="border-color:var(--ok);color:var(--ok);">المتبقي المستحق: ${fmt(selRemaining)} ر.ع</span>
    </div>` : ""}
    <div class="row3">
      <div class="field">
        <label>رقم الشيك</label>
        <input id="qcChqNumber" value="${esc(selChq.chequeNumber)}" readonly style="background:#f1ede2;">
      </div>
      <div class="field">
        <label>بنك الشيك</label>
        <input id="qcChqBank" value="${esc(selChq.bank||"—")}" readonly style="background:#f1ede2;">
      </div>
      <div class="field">
        <label>${selIsPartial ? "المتبقي المستحق" : "قيمة الشيك"}</label>
        <input id="qcChqAmount" value="${fmt(selIsPartial ? selRemaining : selChq.amount)}" readonly style="background:#f1ede2;">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label>المبلغ المحصَّل فعليًا</label>
        <input id="qcAmount" type="number" step="0.001" min="0" value="${selIsPartial ? selRemaining : selChq.amount}">
      </div>
      <div class="field">
        <label>تاريخ التحصيل</label>
        <input id="qcDate" type="date" value="${todayISO()}">
      </div>
    </div>
    <div class="field">
      <label>رقم إيصال التحصيل</label>
      <input id="qcReceiptNo" placeholder="مثال: 1051" value="${esc(quickCollectState.receiptNumber||"")}">
    </div>
    <div class="field">
      <label>طريقة التحصيل</label>
      ${bankSelectHtml("qcMethod", "")}
    </div>
    <button class="btn btn-brass" id="btnQcConfirm">تسجيل التحصيل وطباعة الإيصال</button>
  </div>`;
  return html;
}

function bindQuickCollectEvents(){
  const findBtn = document.getElementById("btnQcFind");
  const codeInput = document.getElementById("qcCode");
  if(findBtn){
    findBtn.addEventListener("click", ()=>{
      quickCollectState.code = codeInput.value.trim();
      quickCollectState.client = findClientByCode(quickCollectState.code);
      quickCollectState.chequeId = "";
      render();
    });
  }
  if(codeInput){
    codeInput.addEventListener("keydown", e=>{ if(e.key==="Enter") findBtn.click(); });
  }
  const dueSelect = document.getElementById("qcDueSelect");
  if(dueSelect){
    dueSelect.addEventListener("change", ()=>{
      quickCollectState.chequeId = dueSelect.value;
      render();
    });
  }
  bindBankSelect("qcMethod");
  const receiptNoInput = document.getElementById("qcReceiptNo");
  if(receiptNoInput){
    receiptNoInput.addEventListener("input", ()=>{ quickCollectState.receiptNumber = receiptNoInput.value; });
  }
  const confirmBtn = document.getElementById("btnQcConfirm");
  if(confirmBtn) confirmBtn.addEventListener("click", confirmQuickCollect);
}

function confirmQuickCollect(){
  const c = quickCollectState.client;
  if(!c){ toast("لم يتم اختيار عميل"); return; }
  const chq = state.cheques.find(x=>x.id===quickCollectState.chequeId);
  // A due payment here is either a cheque still "pending", or one already "collected"
  // but only partially (its collected-so-far amount is short of its full value) — the
  // latter lets the user complete/settle the remaining balance of a partial payment.
  const isPartialCompletion = !!chq && chq.status==="collected" && chq.amount>0.5 && (chq.collectedAmount!=null?chq.collectedAmount:chq.amount) < chq.amount-0.5;
  if(!chq || !(chq.status==="pending" || isPartialCompletion)){ toast("لم يتم العثور على شيك قيد التحصيل لهذه الدفعة"); return; }
  const amount = parseFloat(document.getElementById("qcAmount").value)||0;
  if(amount<=0){ toast("أدخل مبلغًا محصَّلًا صحيحًا"); return; }
  const method = getBankValue("qcMethod");
  if(!method){ toast("اختر طريقة التحصيل"); return; }
  const date = document.getElementById("qcDate").value || todayISO();
  const receiptNumber = (document.getElementById("qcReceiptNo").value||"").trim();
  if(!receiptNumber){ toast("أدخل رقم إيصال التحصيل"); return; }

  // Cumulative collected amount: adds onto whatever was already collected in a prior
  // (partial) round, instead of overwriting it, so the cheque's paid total keeps growing
  // toward its full face value across successive completion receipts.
  const priorCollected = isPartialCompletion ? (chq.collectedAmount||0) : 0;
  chq.status = "collected";
  chq.collectedDate = date;
  chq.collectionMethod = method;
  chq.collectedAmount = priorCollected + amount;

  const record = {
    id: uid("col"), seq: state.nextCollectionSeq++,
    clientId:c.id, chequeId:chq.id, amount, method, date, receiptNumber,
    createdAt:new Date().toISOString()
  };
  state.collections.push(record);
  saveState();
  toast("تم تسجيل التحصيل بنجاح");
  quickCollectState.chequeId = "";
  quickCollectState.receiptNumber = "";
  openCollectionReceipt(record, chq, c);
}

function renderCollectScreen(){
  const q = collectFilterState.q.trim().toLowerCase();
  let rows = state.cheques.slice().sort((a,b)=>a.seq-b.seq).map(chq=>{
    const cl = state.clients.find(c=>c.id===chq.clientId);
    return { chq, cl };
  });
  if(collectFilterState.status!=="all"){
    rows = rows.filter(r=>(r.chq.status||"pending")===collectFilterState.status);
  }
  if(q){
    const planCache = {};
    rows = rows.filter(r=>{
      if((r.chq.chequeNumber||"").toLowerCase().includes(q)) return true;
      if((r.cl?.code||"").toLowerCase().includes(q)) return true;
      if((r.cl?.name||"").toLowerCase().includes(q)) return true;
      if(r.cl){
        if(!planCache[r.cl.id]) planCache[r.cl.id] = buildPlan(r.cl);
        const plan = planCache[r.cl.id];
        const matchesInstSeq = (r.chq.allocations||[]).some(a=>{
          const inst = plan.find(i=>i.id===a.installmentId);
          return inst && String(inst.seq).toLowerCase().includes(q);
        });
        if(matchesInstSeq) return true;
      }
      return false;
    });
  }

  const counts = { pending:0, collected:0, bounced:0 };
  state.cheques.forEach(c=>{ counts[c.status||"pending"] = (counts[c.status||"pending"]||0)+1; });

  let html = renderQuickCollectCard();
  const orphanCount = state.cheques.filter(chq=>!state.clients.some(c=>c.id===chq.clientId)).length;
  if(orphanCount>0){
    html += `<div class="card" style="border:2px solid var(--warn);">
      <h2 style="color:var(--warn);">شيكات لعملاء محذوفين</h2>
      <p class="hint">يوجد ${orphanCount} شيك/شيكات مسجلة لعملاء تم حذفهم سابقًا. يمكنك حذفها نهائيًا من هنا.</p>
      <button class="btn btn-danger" id="btnPurgeOrphans">حذف كل شيكات العملاء المحذوفين</button>
    </div>`;
  }
  html += `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    <div class="kpi"><div class="lbl">قيد التحصيل</div><div class="val">${counts.pending||0}</div></div>
    <div class="kpi"><div class="lbl">تم تحصيلها</div><div class="val" style="color:var(--ok);">${counts.collected||0}</div></div>
    <div class="kpi"><div class="lbl">مرتدة</div><div class="val" style="color:var(--warn);">${counts.bounced||0}</div></div>
  </div>
  <div class="card">
    <div class="toolbar" style="margin-bottom:2px;">
      <h2 style="margin:0;">متابعة تحصيل الشيكات</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportCollectExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportCollectWord">تصدير Word</button>
    </div>
    <p class="hint">سجّل هنا نتيجة عرض كل شيك على البنك: تحصيل ناجح أو ارتداد. لا يؤثر هذا على تسجيل استلام الشيك نفسه.</p>
    <div class="toolbar">
      <div class="field grow" style="margin-bottom:0;">
        <label>بحث (رقم الشيك / كود العميل / اسم العميل / رقم الدفعة "م")</label>
        <input id="colSearch" value="${esc(collectFilterState.q)}" placeholder="اكتب للبحث...">
      </div>
      <div class="field" style="margin-bottom:0;min-width:170px;">
        <label>الحالة</label>
        <select id="colStatus">
          <option value="pending" ${collectFilterState.status==="pending"?"selected":""}>قيد التحصيل</option>
          <option value="collected" ${collectFilterState.status==="collected"?"selected":""}>تم التحصيل</option>
          <option value="bounced" ${collectFilterState.status==="bounced"?"selected":""}>مرتد</option>
          <option value="all" ${collectFilterState.status==="all"?"selected":""}>كل الشيكات</option>
        </select>
      </div>
    </div>`;

  if(rows.length===0){
    html += `<div class="empty"><div class="ico">🧾</div>لا توجد شيكات مطابقة لهذا الفلتر.</div></div>`;
    html += renderLastCollectActionCard();
    return html;
  }

  html += `<div class="table-wrap"><table id="collectTable"><thead><tr>
    <th>م</th><th>كود العميل</th><th>اسم العميل</th><th>رقم الشيك</th><th>البنك</th>
    <th>تاريخ استحقاق الشيك</th><th>القيمة</th><th>الحالة</th><th>تفاصيل</th><th class="no-print"></th>
  </tr></thead><tbody>
    ${rows.map((r,i)=>{
      const st = r.chq.status||"pending";
      let detail = "—";
      if(st==="collected") detail = `تاريخ التحصيل: ${fmtDate(r.chq.collectedDate)}`;
      else if(st==="bounced") detail = `تاريخ الارتداد: ${fmtDate(r.chq.bounceDate)}${r.chq.bounceReason?" — "+esc(r.chq.bounceReason):""}`;
      let actions = "";
      if(st==="pending"){
        actions = `
          <button class="btn btn-brass btn-sm" data-collect="${r.chq.id}">تحصيل الشيك</button>
          <button class="btn btn-danger btn-sm" data-bounce="${r.chq.id}">تسجيل ارتداد</button>`;
      } else {
        actions = `<button class="btn btn-ghost btn-sm" data-reopen="${r.chq.id}">إعادة لقيد التحصيل</button>`;
        if(st==="collected"){
          actions += ` <button class="btn btn-ghost btn-sm" data-print-collection="${r.chq.id}" title="طباعة إيصال التحصيل الرسمي">🖨️ طباعة إيصال التحصيل</button>`;
        }
      }
      actions += ` <button class="btn btn-danger btn-sm" data-del-cheque="${r.chq.id}" title="حذف الشيك نهائيًا">حذف</button>`;
      return `<tr>
        <td class="num muted">${i+1}</td>
        <td class="num" style="font-family:monospace;">${esc(r.cl?.code||"—")}</td>
        <td>${esc(r.cl?.name||"عميل محذوف")}</td>
        <td class="num">${esc(r.chq.chequeNumber)}</td>
        <td>${esc(r.chq.bank||"—")}</td>
        <td class="num">${fmtDate(r.chq.chequeDate)}</td>
        <td class="num">${fmt(r.chq.amount)}</td>
        <td>${chequeStatusBadge(r.chq)}</td>
        <td class="muted" style="font-size:12.5px;">${detail}</td>
        <td style="white-space:nowrap;">${actions}</td>
      </tr>`;
    }).join("")}
  </tbody></table></div></div>`;
  html += renderLastCollectActionCard();
  return html;
}

/* Persistent (non-fading) confirmation of the last collect/reopen/bounce action,
   shown at the bottom of «تحصيل الشيكات». Stays visible until the next action replaces it
   or the app is reloaded — unlike the toast, it doesn't disappear after a few seconds. */
function renderLastCollectActionCard(){
  if(!lastCollectAction) return "";
  const a = lastCollectAction;
  let icon="ℹ️", color="var(--ink)", text="";
  if(a.type==="collect"){
    icon="✅"; color="var(--ok)";
    text = `تم تحصيل الشيك رقم <strong>${esc(a.chequeNumber)}</strong> للعميل <strong>${esc(a.clientName)}</strong> بقيمة <strong>${fmt(a.amount)} ر.ع</strong> بتاريخ ${fmtDate(a.date)}.`;
  } else if(a.type==="reopen"){
    icon="↩️"; color="var(--ink-soft)";
    text = `تم إلغاء التحصيل وإرجاع الشيك رقم <strong>${esc(a.chequeNumber)}</strong> للعميل <strong>${esc(a.clientName)}</strong> بقيمة <strong>${fmt(a.amount)} ر.ع</strong> إلى «قيد الانتظار» — لن يظهر محصّلاً بعد الآن في أي شاشة أو تقرير أو إيصال.`;
  } else if(a.type==="bounce"){
    icon="⚠️"; color="var(--warn)";
    text = `تم تسجيل ارتداد الشيك رقم <strong>${esc(a.chequeNumber)}</strong> للعميل <strong>${esc(a.clientName)}</strong> بقيمة <strong>${fmt(a.amount)} ر.ع</strong>.`;
  }
  return `
  <div class="card" style="border:2px solid ${color};">
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <span style="font-size:18px;">${icon}</span>
      <div style="font-size:13.5px;line-height:1.8;">${text}</div>
    </div>
  </div>`;
}

function bindCollectEvents(){
  bindQuickCollectEvents();
  const xl = document.getElementById("btnExportCollectExcel");
  if(xl) xl.addEventListener("click", ()=>exportTableExcel("collectTable","تحصيل_الشيكات"));
  const wd = document.getElementById("btnExportCollectWord");
  if(wd) wd.addEventListener("click", ()=>exportTableWord("collectTable","تحصيل الشيكات"));
  const search = document.getElementById("colSearch");
  if(search){
    search.addEventListener("input", ()=>{
      collectFilterState.q = search.value;
      render();
      document.getElementById("colSearch")?.focus();
    });
  }
  const status = document.getElementById("colStatus");
  if(status){
    status.addEventListener("change", ()=>{
      collectFilterState.status = status.value;
      render();
    });
  }
  document.querySelectorAll("[data-collect]").forEach(btn=>{
    btn.addEventListener("click", ()=>openCollectModal(btn.dataset.collect));
  });
  document.querySelectorAll("[data-bounce]").forEach(btn=>{
    btn.addEventListener("click", ()=>openBounceModal(btn.dataset.bounce));
  });
  document.querySelectorAll("[data-print-collection]").forEach(btn=>{
    btn.addEventListener("click", ()=>reprintCollectionReceipt(btn.dataset.printCollection));
  });
  document.querySelectorAll("[data-reopen]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const chq = state.cheques.find(c=>c.id===btn.dataset.reopen);
      if(!chq) return;
      confirmModal("إعادة الشيك لقيد التحصيل", `سيتم إلغاء حالة «${chq.status==="collected"?"تم التحصيل":"مرتد"}» للشيك رقم ${chq.chequeNumber} وإعادته إلى قيد التحصيل، وحذف سجل السداد المرتبط به إن وجد.`, ()=>{
        chq.status = "pending"; chq.collectedDate=null; chq.bounceDate=null; chq.bounceReason="";
        chq.collectionMethod=null; chq.collectedAmount=null;
        state.collections = state.collections.filter(rec=>rec.chequeId!==chq.id);
        const cl = state.clients.find(c=>c.id===chq.clientId);
        lastCollectAction = { type:"reopen", chequeNumber:chq.chequeNumber, clientName:cl?.name||"عميل محذوف", amount:chq.amount };
        saveState(); toast("تم إرجاع الشيك لقيد التحصيل وحذف سجل السداد"); render();
      });
    });
  });
  document.querySelectorAll("[data-del-cheque]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const chq = state.cheques.find(c=>c.id===btn.dataset.delCheque);
      if(!chq) return;
      confirmModal("حذف الشيك؟", `سيتم حذف الشيك رقم ${esc(chq.chequeNumber)} نهائيًا وكل سجلات التحصيل المرتبطة به. هذا الإجراء لا يمكن التراجع عنه.`, ()=>{
        state.cheques = state.cheques.filter(c=>c.id!==chq.id);
        state.collections = state.collections.filter(rec=>rec.chequeId!==chq.id);
        saveState(); toast("تم حذف الشيك"); render();
      });
    });
  });
  const purgeBtn = document.getElementById("btnPurgeOrphans");
  if(purgeBtn){
    purgeBtn.addEventListener("click", ()=>{
      confirmModal("حذف شيكات العملاء المحذوفين؟", "سيتم حذف كل الشيكات وسجلات التحصيل المرتبطة بعملاء غير موجودين حاليًا. لا يمكن التراجع عن هذا الإجراء.", ()=>{
        const n = purgeOrphanChequeData();
        toast(n>0 ? `تم حذف ${n} شيك/شيكات` : "لا توجد شيكات لحذفها");
        render();
      });
    });
  }
}

function openCollectModal(chqId){
  const chq = state.cheques.find(c=>c.id===chqId);
  if(!chq) return;
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="modal-bg" id="collectBg">
    <div class="modal">
      <h3>تحصيل الشيك رقم ${esc(chq.chequeNumber)}</h3>
      <p>أكّد تاريخ تحصيل الشيك فعليًا من البنك، والمبلغ الذي تم تحصيله فعليًا (قد يقل عن قيمة الشيك في حال تحصيل جزئي).</p>
      <div class="field">
        <label>تاريخ التحصيل</label>
        <input id="collectDateInput" type="date" value="${todayISO()}">
      </div>
      <div class="field">
        <label>المبلغ المحصَّل فعليًا من البنك</label>
        <input id="collectAmountInput" type="number" step="0.001" value="${chq.amount}">
        <div class="import-hint">القيمة الاسمية للشيك: ${fmt(chq.amount)} ر.ع. عدّل هذا المبلغ إذا تم تحصيل جزء منه فقط.</div>
      </div>
      <div class="field">
        <label>طريقة/بنك التحصيل (اختياري)</label>
        ${bankSelectHtml("collectMethod", "")}
      </div>
      <div class="field">
        <label>رقم إيصال التحصيل (اختياري)</label>
        <input id="collectReceiptNo" placeholder="رقم إيصال التحصيل">
      </div>
      <div class="modal-actions">
        <button class="btn btn-brass" id="collectConfirm">تأكيد التحصيل</button>
        <button class="btn btn-ghost" id="collectCancel">إلغاء</button>
      </div>
    </div>
  </div>`;
  bindBankSelect("collectMethod");
  document.getElementById("collectConfirm").addEventListener("click", ()=>{
    const d = document.getElementById("collectDateInput").value || todayISO();
    const collected = parseFloat(document.getElementById("collectAmountInput").value);
    const method = getBankValue("collectMethod");
    const receiptNumber = (document.getElementById("collectReceiptNo").value||"").trim();
    chq.status = "collected"; chq.collectedDate = d;
    chq.collectedAmount = isNaN(collected) ? chq.amount : collected;
    chq.collectionMethod = method || null;
    const cl = state.clients.find(c=>c.id===chq.clientId);
    // Create a formal collection record too, so an official collection receipt
    // (إيصال التحصيل الرسمي) can be printed for this cheque afterwards from
    // «متابعة تحصيل الشيكات» — matching the quick-collect flow.
    const record = {
      id: uid("col"), seq: state.nextCollectionSeq++,
      clientId: chq.clientId, chequeId: chq.id,
      amount: chq.collectedAmount, method: method||"—", date: d, receiptNumber,
      createdAt:new Date().toISOString()
    };
    state.collections = state.collections.filter(rec=>rec.chequeId!==chq.id);
    state.collections.push(record);
    lastCollectAction = { type:"collect", chequeNumber:chq.chequeNumber, clientName:cl?.name||"عميل محذوف", amount:chq.collectedAmount, date:d };
    saveState(); root.innerHTML=""; toast("تم تسجيل تحصيل الشيك"); render();
  });
  document.getElementById("collectCancel").addEventListener("click", ()=>{ root.innerHTML=""; });
  document.getElementById("collectBg").addEventListener("click", e=>{ if(e.target.id==="collectBg") root.innerHTML=""; });
}

function openBounceModal(chqId){
  const chq = state.cheques.find(c=>c.id===chqId);
  if(!chq) return;
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="modal-bg" id="bounceBg">
    <div class="modal">
      <h3>تسجيل ارتداد الشيك رقم ${esc(chq.chequeNumber)}</h3>
      <p>سيتم اعتبار الدفعات المرتبطة بهذا الشيك غير مسددة حتى يتم استلام شيك بديل.</p>
      <div class="field">
        <label>تاريخ الارتداد</label>
        <input id="bounceDateInput" type="date" value="${todayISO()}">
      </div>
      <div class="field">
        <label>سبب الارتداد (اختياري)</label>
        <input id="bounceReasonInput" placeholder="مثال: رصيد غير كافٍ">
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="bounceConfirm">تأكيد الارتداد</button>
        <button class="btn btn-ghost" id="bounceCancel">إلغاء</button>
      </div>
    </div>
  </div>`;
  document.getElementById("bounceConfirm").addEventListener("click", ()=>{
    const d = document.getElementById("bounceDateInput").value || todayISO();
    const reason = document.getElementById("bounceReasonInput").value.trim();
    chq.status = "bounced"; chq.bounceDate = d; chq.bounceReason = reason;
    const cl = state.clients.find(c=>c.id===chq.clientId);
    lastCollectAction = { type:"bounce", chequeNumber:chq.chequeNumber, clientName:cl?.name||"عميل محذوف", amount:chq.amount };
    saveState(); root.innerHTML=""; toast("تم تسجيل ارتداد الشيك"); render();
  });
  document.getElementById("bounceCancel").addEventListener("click", ()=>{ root.innerHTML=""; });
  document.getElementById("bounceBg").addEventListener("click", e=>{ if(e.target.id==="bounceBg") root.innerHTML=""; });
}

/* ============================= SCREEN: CLIENTS ============================= */
let clientForm = null; // when editing/adding
function blankYearPlan(){ return {percent:"", phase1:"", phase2:"", phase3:""}; }

/* Default rows for the "consultant" installment schedule, mirroring the reference
   22-item breakdown supplied by the consultant. Items 1 (دفعة الحجز) and 2 (دفعة المقدم)
   from that reference are represented separately in the form (section 2, already existing
   reservation/down-payment % fields) and are shown there as locked reference rows —
   this array holds items 3–22 (the 20 percent-of-remaining construction-stage rows),
   fully editable (add/remove/rename/re-percent/reorder) per client from the form. */
function defaultConsultantSchedule(){
  return [
    { id: uid("cs"), label:"تجهيزات الموقع والحفر وأعمال الترميم والأساسات حتى صب الأرضيات الطابق الأرضي", percent:7.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الأرضي", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الأول وأعمال المباني للطابق الأرضي", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الثاني وأعمال المباني للطابق الأول", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الثالث وأعمال المباني للطابق الثاني", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الرابع وأعمال المباني للطابق الثالث", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الخامس وأعمال المباني للطابق الرابع", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق السادس وأعمال المباني للطابق الخامس", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق السابع وأعمال المباني للطابق السادس", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف الطابق الثامن وأعمال المباني للطابق السابع", percent:4.50 },
    { id: uid("cs"), label:"أعمدة وسقف السطح (البنت هاوس) وأعمال المباني للطابق الثامن", percent:4.50 },
    { id: uid("cs"), label:"باقي أعمال المباني كاملة شاملة الأعتاب الخرسانية واعمال البلاستر", percent:4.50 },
    { id: uid("cs"), label:"أعمال السطح من عزل مائي وحراري وبلاط وأعمال البلاستر الخارجي", percent:7.50 },
    { id: uid("cs"), label:"أعمال سيراميك الحوائط والارضيات للحمامات والمطابخ حتى الطابق الرابع الماني ومواسير المياه والصرف", percent:5.00 },
    { id: uid("cs"), label:"أعمال سيراميك الحوائط والارضيات للحمامات والمطابخ حتى طابق السطح (البنت هاوس) شامل العزل الماني ومواسير المياه والصرف", percent:5.00 },
    { id: uid("cs"), label:"باقي الأرضيات كاملة من بورسلين وجرانيت ودرج السلم", percent:5.00 },
    { id: uid("cs"), label:"تركيب الشبابيك والأبواب والمعلقات الكهربائية وأنظمة الحمامات مع الاكسسوارات", percent:5.00 },
    { id: uid("cs"), label:"أعمال الدهانات الداخلية والخارجية", percent:3.50 },
    { id: uid("cs"), label:"تركيب المصاعد وهاندريل السلالم", percent:3.50 },
    { id: uid("cs"), label:"إنهاء المبنى وتسليم المفاتيح", percent:8.50 }
  ];
}

function blankClientForm(){
  return {
    code:"", name:"", unit:"", phone:"", contractNumber:"", contractDate:"", installmentsStartDate:"",
    unitPrice:"", reservationPct:"", downPaymentPct:"", chequesCount:36, years:3,
    yearPlans:[blankYearPlan(), blankYearPlan(), blankYearPlan()],
    installmentMode:"standard", consultantSchedule: defaultConsultantSchedule()
  };
}
function yearsFromCheques(count){
  const n = Math.max(1, Math.round((parseFloat(count)||0)));
  return Math.min(6, Math.max(1, Math.ceil(n/12)));
}

/* Resolve a year's phase amounts: any phase left at 0 (or blank) is auto-calculated
   as an equal share of what's left after manually-entered phases, split evenly across
   its own months plus the always-auto final (12th) month. If all three phases are
   manual, this degenerates to the original behavior (last month = pure leftover). */
const PHASE_MONTHS = [3,3,5];
function resolveYearPhases(yearVal, p1raw, p2raw, p3raw){
  const raws = [p1raw, p2raw, p3raw];
  let manualTotal = 0, autoMonths = 0;
  const isAuto = [false,false,false];
  raws.forEach((r,i)=>{
    const v = parseFloat(r)||0;
    if(v>0){ manualTotal += v*PHASE_MONTHS[i]; }
    else { autoMonths += PHASE_MONTHS[i]; isAuto[i] = true; }
  });
  const remaining = yearVal - manualTotal;
  const autoRate = Math.round((remaining/(autoMonths+1))*100)/100;
  const resolved = raws.map((r,i)=>{
    const v = parseFloat(r)||0;
    return v>0 ? v : autoRate;
  });
  const flexTotal = resolved[0]*PHASE_MONTHS[0] + resolved[1]*PHASE_MONTHS[1] + resolved[2]*PHASE_MONTHS[2];
  const lastInst = Math.round((yearVal-flexTotal)*100)/100;
  return { phase1:resolved[0], phase2:resolved[1], phase3:resolved[2], lastInst, isAuto, autoRate };
}

function renderClientsScreen(){
  const addOnly = isAddOnlyClientsRole();
  let html = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <h2 style="margin:0;">قائمة العملاء</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm no-print" id="btnExportClientsListExcel">تصدير Excel</button>
        <button class="btn btn-ghost btn-sm no-print" id="btnExportClientsListWord">تصدير Word</button>
        <button class="btn btn-navy btn-sm" id="btnNewClient">+ عميل جديد</button>
      </div>
    </div>
    <p class="hint">إدارة بيانات العميل وأسس خطة السداد (سعر الوحدة، الحجز، المقدم، توزيع السنوات).</p>`;

  if(state.clients.length===0){
    html += `<div class="empty"><div class="ico">📋</div>لا يوجد عملاء بعد. أضف أول عميل لبدء إنشاء خطة سداد.</div>`;
  } else {
    html += `<div class="table-wrap"><table id="clientsListTable"><thead><tr>
      <th>الكود</th><th>اسم العميل</th><th>الوحدة</th><th>سعر الوحدة</th><th>تاريخ التعاقد</th>${addOnly ? "" : "<th></th>"}
    </tr></thead><tbody>
      ${state.clients.map(c=>`
        <tr>
          <td class="num" style="font-family:monospace;color:var(--brass-dark);font-weight:700;">${esc(c.code)}</td>
          <td>${esc(c.name)}</td>
          <td class="muted">${esc(c.unit)}</td>
          <td class="num">${fmt(c.unitPrice)}</td>
          <td class="num">${fmtDate(c.contractDate)}</td>
          ${addOnly ? "" : `<td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" data-edit-client="${c.id}">تعديل</button>
            <button class="btn btn-danger btn-sm" data-del-client="${c.id}">حذف</button>
          </td>`}
        </tr>
      `).join("")}
    </tbody></table></div>`;
  }
  html += `</div>`;

  if(clientForm){
    html += renderClientForm();
  }
  return html;
}

function renderClientForm(){
  const f = clientForm;
  const isEdit = !!f._editId;
  const mode = f.installmentMode || "standard";

  const resPctVal = parseFloat(f.reservationPct)||0;
  const downPctVal = parseFloat(f.downPaymentPct)||0;
  let consultantRows = `
    <tr style="background:#f8f6f0;">
      <td class="num muted">1</td>
      <td>دفعة الحجز <span class="muted" style="font-size:11.5px;">(من قسم «الافتراضات المالية الأساسية» أعلاه)</span></td>
      <td class="num muted">${resPctVal ? resPctVal+"%" : "—"}</td>
      <td class="num muted" id="csResRefVal">0 ر.ع</td>
      <td class="no-print"></td>
    </tr>
    <tr style="background:#f8f6f0;">
      <td class="num muted">2</td>
      <td>دفعة المقدم <span class="muted" style="font-size:11.5px;">(من قسم «الافتراضات المالية الأساسية» أعلاه)</span></td>
      <td class="num muted">${downPctVal ? downPctVal+"%" : "—"}</td>
      <td class="num muted" id="csDownRefVal">0 ر.ع</td>
      <td class="no-print"></td>
    </tr>`;
  (f.consultantSchedule||[]).forEach((row,i)=>{
    consultantRows += `
      <tr data-cs-row="${row.id}">
        <td class="num muted">${i+3}</td>
        <td><input class="csLabelInput" data-id="${row.id}" value="${esc(row.label)}" placeholder="بيان الدفعة"></td>
        <td><input type="number" step="0.01" class="csPercentInput" data-id="${row.id}" value="${esc(row.percent??"")}" placeholder="0" style="max-width:100px;"></td>
        <td class="num"><span id="csVal_${row.id}">0</span> ر.ع</td>
        <td class="no-print" style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-cs-up="${row.id}" title="نقل لأعلى">↑</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cs-down="${row.id}" title="نقل لأسفل">↓</button>
          <button type="button" class="btn btn-danger btn-sm" data-cs-del="${row.id}">حذف</button>
        </td>
      </tr>`;
  });

  let yearRows = "";
  for(let i=0;i<f.years;i++){
    const yp = f.yearPlans[i] || blankYearPlan();
    yearRows += `
      <tr>
        <td>السنة ${arabicYear(i+1)}</td>
        <td><input type="number" step="0.01" class="yearPctInput" data-idx="${i}" value="${esc(yp.percent??"")}" placeholder="0" style="max-width:110px;"></td>
        <td class="num"><span id="yearVal_${i}">0</span> ر.ع</td>
      </tr>`;
  }

  let phaseBlocks = "";
  for(let i=0;i<f.years;i++){
    const yp = f.yearPlans[i] || blankYearPlan();
    phaseBlocks += `
      <div class="year-block">
        <h4>السنة ${arabicYear(i+1)} <span class="muted" style="font-weight:400;font-size:12.5px;">— إجمالي السنة: <span id="yearVal2_${i}">0</span> ر.ع</span></h4>
        <div class="phase-grid">
          <div class="field" style="margin-bottom:0;">
            <label>المرحلة الأولى (أول 3 أشهر) — قيمة القسط</label>
            <input type="number" step="0.01" class="phase1Input" data-idx="${i}" value="${esc(yp.phase1??"")}" placeholder="اتركه 0 للحساب التلقائي">
            <div class="import-hint" id="phase1Hint_${i}"></div>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>المرحلة الثانية (تاني 3 أشهر) — قيمة القسط</label>
            <input type="number" step="0.01" class="phase2Input" data-idx="${i}" value="${esc(yp.phase2??"")}" placeholder="اتركه 0 للحساب التلقائي">
            <div class="import-hint" id="phase2Hint_${i}"></div>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>المرحلة الثالثة (آخر 5 أشهر) — قيمة القسط</label>
            <input type="number" step="0.01" class="phase3Input" data-idx="${i}" value="${esc(yp.phase3??"")}" placeholder="اتركه 0 للحساب التلقائي">
            <div class="import-hint" id="phase3Hint_${i}"></div>
          </div>
        </div>
        <div class="calc-row">
          <span class="k">القسط الأخير (الشهر 12) — يُحسب تلقائيًا دائمًا</span>
          <span class="v" id="lastInst_${i}">0 ر.ع</span>
        </div>
        <div id="phaseChk_${i}" style="font-size:12.5px;margin-top:4px;"></div>
      </div>`;
  }

  return `
  <div class="card" id="clientFormCard">
    <h2>${isEdit ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</h2>
    <p class="hint">أدخل النسب فقط حيث يلزم — القيم تُحسب تلقائيًا وتُبنى منها خطة السداد الشهرية.</p>

    <div class="form-section">
      <div class="form-section-title"><span class="num">1</span> بيانات العميل</div>
      <div class="row3">
        <div class="field"><label>كود العميل *</label><input id="fCode" value="${esc(f.code)}" placeholder="CL-1003"></div>
        <div class="field"><label>اسم العميل *</label><input id="fName" value="${esc(f.name)}"></div>
        <div class="field"><label>رقم الهاتف</label><input id="fPhone" value="${esc(f.phone)}" placeholder="968 9XXX XXXX"></div>
      </div>
      <div class="row3">
        <div class="field"><label>اسم المشروع / رقم الوحدة</label><input id="fUnit" value="${esc(f.unit)}"></div>
        <div class="field"><label>رقم العقد</label><input id="fContractNumber" value="${esc(f.contractNumber)}" placeholder="CN-2025-0001"></div>
        <div class="field"><label>تاريخ العقد</label><input id="fContractDate" type="date" value="${esc(f.contractDate)}"></div>
      </div>
    </div>

    <div class="form-section emphasis-brass">
      <div class="form-section-title"><span class="num">2</span> الافتراضات المالية الأساسية</div>
      <div class="field">
        <label>إجمالي سعر الوحدة * (إدخال يدوي)</label>
        <input id="fUnitPrice" type="number" step="0.01" value="${esc(f.unitPrice)}" placeholder="0.00">
      </div>
      <div class="row">
        <div class="field">
          <label>دفعة الحجز — النسبة % (إدخال يدوي)</label>
          <input id="fResPct" type="number" step="0.01" value="${esc(f.reservationPct)}" placeholder="مثال: 5">
        </div>
        <div class="field">
          <label>دفعة المقدم — النسبة % (إدخال يدوي)</label>
          <input id="fDownPct" type="number" step="0.01" value="${esc(f.downPaymentPct)}" placeholder="مثال: 10">
        </div>
      </div>
      <div class="calc-row"><span class="k">قيمة دفعة الحجز (تلقائي)</span><span class="v" id="spanResVal">0 ر.ع</span></div>
      <div class="calc-row"><span class="k">قيمة دفعة المقدم (تلقائي)</span><span class="v" id="spanDownVal">0 ر.ع</span></div>
      <div class="totals-row">
        <span>المتبقي المقسط على السنوات — نسبة <span id="spanRemainPct">0%</span></span>
        <span id="spanRemainVal">0 ر.ع</span>
      </div>
      <div id="remainWarn" style="font-size:12.5px;margin-top:6px;"></div>
    </div>

    <div class="form-section emphasis-navy">
      <div class="form-section-title"><span class="num">3</span> خاصية الأقساط</div>
      <p class="hint" style="margin-top:-8px;">اختر طريقة توزيع «المتبقي المقسط على السنوات» على دفعات العميل.</p>
      <div class="field" style="max-width:420px;">
        <label>نوع الأقساط</label>
        <select id="fInstallmentMode">
          <option value="standard" ${mode==="standard"?"selected":""}>الأقساط الاعتيادية</option>
          <option value="consultant" ${mode==="consultant"?"selected":""}>الأقساط وفقًا للاستشاري</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:0;max-width:420px;">
        <label>تاريخ بداية الأقساط</label>
        <input id="fInstStart" type="date" value="${esc(f.installmentsStartDate)}">
      </div>
    </div>

    ${mode==="consultant" ? `
    <div class="form-section emphasis-navy">
      <div class="form-section-title"><span class="num">4</span> جدول الأقساط وفقًا للاستشاري (22 بندًا)</div>
      <p class="hint" style="margin-top:-8px;">الصفان الأول والثاني (دفعة الحجز والمقدم) معروضان للمرجعية فقط ونسبتهما تُضبط من قسم «الافتراضات المالية الأساسية» أعلاه. الصفوف من 3 إلى 22 هي دفعات المتبقي المقسط على السنوات — أدخل بيان كل دفعة ونسبتها، ويمكنك إضافة أو حذف أو إعادة ترتيب أي صف منها. يجب أن يساوي إجمالي نسب الصفوف من 3 إلى 22 وحدها 100%.</p>
      <div class="table-wrap" style="margin-top:10px;background:#fff;">
        <table>
          <thead><tr><th>م</th><th>البيان</th><th>النسبة %</th><th>القيمة (تلقائي)</th><th class="no-print"></th></tr></thead>
          <tbody id="csRowsBody">${consultantRows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;">
        <button type="button" class="btn btn-ghost btn-sm" id="btnCsAddRow">+ إضافة دفعة</button>
      </div>
      <div class="totals-row" style="margin-top:10px;">
        <span>الإجمالي — نسبة <span id="csTotalPct">0%</span></span>
        <span id="csTotalVal">0 ر.ع</span>
      </div>
      <div id="csTotalChk" style="font-size:12.5px;margin-top:6px;"></div>
    </div>
    ` : `
    <div class="form-section emphasis-navy">
      <div class="form-section-title"><span class="num">4</span> توزيع المتبقي على السنوات</div>
      <p class="hint" style="margin-top:-8px;">أدخل إجمالي عدد الشيكات الشهرية المتفق عليها مع العميل — يظهر أدناه تلقائيًا تفصيل السنوات الكاملة اللازمة فقط (كل 12 شيك = سنة واحدة، ويُقرَّب لأعلى، بحد أقصى 6 سنوات).</p>
      <div class="row">
        <div class="field" style="margin-bottom:0;">
          <label>عدد الشيكات (الأقساط الشهرية الإجمالي)</label>
          <input id="fChequesCount" type="number" min="1" max="72" step="1" value="${esc(f.chequesCount)}" placeholder="مثال: 36">
          <div class="import-hint" id="chequesYearsHint">= ${f.years} ${f.years===1?"سنة":"سنوات"} بالتفصيل (${f.years*12} شهرًا معروضًا أدناه)</div>
        </div>
      </div>
      <div class="table-wrap" style="margin-top:14px;background:#fff;">
        <table>
          <thead><tr><th>السنة</th><th>نسبة السنة % (إدخال يدوي)</th><th>قيمة السنة (تلقائي)</th></tr></thead>
          <tbody id="yearRowsBody">${yearRows}</tbody>
        </table>
      </div>
      <div class="totals-row">
        <span>الإجمالي — نسبة <span id="yearsTotalPct">0%</span></span>
        <span id="yearsTotalVal">0 ر.ع</span>
      </div>
      <div id="yearsTotalChk" style="font-size:12.5px;margin-top:6px;"></div>
    </div>

    <div class="form-section">
      <div class="form-section-title"><span class="num">5</span> حساب الأقساط المرنة لكل سنة (3 مراحل: 3 + 3 + 5 أشهر، والقسط الأخير تلقائي)</div>
      <p class="hint" style="margin-top:-6px;">لكل مرحلة: أدخل قيمة القسط الشهري يدويًا، أو اتركها صفرًا ليتم حسابها تلقائيًا. المرحلة التلقائية تأخذ نصيبها بالتساوي من المبلغ المتبقي بعد خصم المراحل اليدوية (ويشاركها القسط الأخير دائمًا في هذا التوزيع).</p>
      <div id="phaseBlocksWrap">${phaseBlocks}</div>
    </div>
    `}

    <div style="display:flex;gap:10px;margin-top:10px;">
      <button class="btn btn-brass" id="btnSaveClientForm">${isEdit?"حفظ التعديلات":"إضافة العميل"}</button>
      <button class="btn btn-ghost" id="btnCancelClientForm">إلغاء</button>
    </div>
  </div>`;
}

/* ============================= SCREEN: REPORTS ============================= */
function renderChequesReport(){
  const rows = state.cheques.slice().sort((a,b)=>a.seq-b.seq).map(chq=>{
    const cl = state.clients.find(c=>c.id===chq.clientId);
    return {chq, cl};
  });
  let html = `
  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0;">تقرير الشيكات</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportChqExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportChqWord">تصدير Word</button>
      <button class="btn btn-navy btn-sm no-print" id="btnPrintChqReport">طباعة</button>
    </div>`;

  if(rows.length===0){
    html += `<div class="empty"><div class="ico">🧾</div>لا توجد شيكات مسجلة بعد.</div></div>`;
    return html;
  }

  const totalAmt = rows.reduce((s,r)=>s+r.chq.amount,0);
  const totalAmtWords = numberToArabicWords(totalAmt);
  html += `<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
    <div class="kpi"><div class="lbl">عدد الشيكات</div><div class="val">${rows.length}</div></div>
    <div class="kpi"><div class="lbl">إجمالي قيمة الشيكات المستلمة</div><div class="val">${fmt(totalAmt)} <small>ر.ع</small></div></div>
    <div class="kpi"><div class="lbl">عدد العملاء</div><div class="val">${new Set(rows.map(r=>r.cl?.id)).size}</div></div>
  </div>`;

  html += `<div class="table-wrap"><table id="chqReportTable"><thead><tr>
    <th>م</th><th>كود العميل</th><th>اسم العميل</th><th>رقم الشيك</th><th>البنك</th>
    <th>نوع الدفعة</th><th>تاريخ الاستلام</th><th>تاريخ استحقاق الشيك</th><th>القيمة</th><th>حالة التحصيل</th>
  </tr></thead><tbody>
    ${rows.map((r,i)=>{
      const plan = r.cl ? buildPlan(r.cl) : [];
      const types = [...new Set((r.chq.allocations||[]).map(a=>{
        const inst = plan.find(p=>p.id===a.installmentId);
        return inst ? inst.type : null;
      }).filter(Boolean))];
      return `
      <tr>
        <td class="num muted">${i+1}</td>
        <td class="num" style="font-family:monospace;">${esc(r.cl?.code||"—")}</td>
        <td>${esc(r.cl?.name||"عميل محذوف")}</td>
        <td class="num">${esc(r.chq.chequeNumber)}</td>
        <td>${esc(r.chq.bank||"—")}</td>
        <td class="muted">${esc(types.join("، ")||"—")}</td>
        <td class="num">${fmtDate(r.chq.receivedDate)}</td>
        <td class="num">${fmtDate(r.chq.chequeDate)}</td>
        <td class="num">${fmt(r.chq.amount)}</td>
        <td>${chequeStatusBadge(r.chq)}</td>
      </tr>
    `;}).join("")}
  </tbody>
  <tfoot><tr style="font-weight:700;"><td colspan="8">الإجمالي (${rows.length} شيك)</td><td class="num">${fmt(totalAmt)}</td><td></td></tr></tfoot>
  </table></div>
  <div class="table-total-words">إجمالي قيمة الشيكات كتابة: ${esc(totalAmtWords)}</div>
  </div>`;
  return html;
}

function renderClientsReport(){
  let html = `
  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0;">تقرير العملاء</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportClientsExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportClientsWord">تصدير Word</button>
      <button class="btn btn-navy btn-sm no-print" id="btnPrintClientsReport">طباعة</button>
    </div>`;

  if(state.clients.length===0){
    html += `<div class="empty"><div class="ico">👥</div>لا يوجد عملاء بعد.</div></div>`;
    return html;
  }

  const rows = state.clients.map(c=>({c, t:clientTotals(c)}));
  const grandDue = rows.reduce((s,r)=>s+r.t.totalDue,0);
  const grandPaid = rows.reduce((s,r)=>s+r.t.totalPaid,0);
  const grandRemaining = rows.reduce((s,r)=>s+r.t.remaining,0);
  const grandOverdue = rows.reduce((s,r)=>s+r.t.overdue,0);
  const grandDueWords = numberToArabicWords(grandDue);

  html += `<div class="kpi-grid">
    <div class="kpi"><div class="lbl">إجمالي المستحق على الكل</div><div class="val">${fmt(grandDue)} <small>ر.ع</small></div></div>
    <div class="kpi"><div class="lbl">إجمالي المسدد</div><div class="val">${fmt(grandPaid)} <small>ر.ع</small></div></div>
    <div class="kpi"><div class="lbl">إجمالي المتبقي</div><div class="val">${fmt(grandDue-grandPaid)} <small>ر.ع</small></div></div>
    <div class="kpi"><div class="lbl">إجمالي المتأخر</div><div class="val" style="color:${grandOverdue>0?'var(--warn)':'inherit'}">${fmt(grandOverdue)} <small>ر.ع</small></div></div>
  </div>`;

  html += `<div class="table-wrap"><table id="clientsReportTable"><thead><tr>
    <th>الكود</th><th>اسم العميل</th><th>الوحدة</th><th>إجمالي المستحق</th>
    <th>المسدد</th><th>المتبقي</th><th>المتأخر</th>
  </tr></thead><tbody>
    ${rows.map(r=>`
      <tr>
        <td class="num" style="font-family:monospace;color:var(--brass-dark);font-weight:700;">${esc(r.c.code)}</td>
        <td>${esc(r.c.name)}</td>
        <td class="muted">${esc(r.c.unit)}</td>
        <td class="num">${fmt(r.t.totalDue)}</td>
        <td class="num">${fmt(r.t.totalPaid)}</td>
        <td class="num">${fmt(r.t.remaining)}</td>
        <td class="num" style="${r.t.overdue>0?'color:var(--warn);font-weight:700;':''}">${fmt(r.t.overdue)}</td>
      </tr>
    `).join("")}
  </tbody>
  <tfoot><tr style="font-weight:700;">
    <td colspan="3">الإجمالي (${rows.length} عميل)</td>
    <td class="num">${fmt(grandDue)}</td>
    <td class="num">${fmt(grandPaid)}</td>
    <td class="num">${fmt(grandRemaining)}</td>
    <td class="num" style="${grandOverdue>0?'color:var(--warn);':''}">${fmt(grandOverdue)}</td>
  </tr></tfoot>
  </table></div>
  <div class="table-total-words">إجمالي المستحق على كل العملاء كتابة: ${esc(grandDueWords)}</div>
  </div>`;
  return html;
}

/* ============================= EVENTS ============================= */
function bindEvents(){
  if(view==="cheques") bindChequesEvents();
  if(view==="collect") bindCollectEvents();
  if(view==="clients") bindClientsEvents();
  if(view==="reportCheques") bindChequesReportEvents();
  if(view==="reportClients") bindClientsReportEvents();
  if(view==="receipts") bindReceiptsEvents();
  if(view==="users") bindUsersEvents();
}

function bindChequesEvents(){
  const findBtn = document.getElementById("btnFindClient");
  const codeInput = document.getElementById("chqCode");
  if(findBtn){
    findBtn.addEventListener("click", ()=>{
      chequeSearchState.code = codeInput.value.trim();
      chequeSearchState.client = findClientByCode(chequeSearchState.code);
      chequeSearchState.selectedInstallments = {};
      render();
    });
  }
  if(codeInput){
    codeInput.addEventListener("keydown", e=>{
      if(e.key==="Enter") findBtn.click();
    });
  }
  document.querySelectorAll(".instCheck").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const id = cb.dataset.inst;
      if(cb.checked) chequeSearchState.selectedInstallments[id] = true;
      else delete chequeSearchState.selectedInstallments[id];
      updateChequeAmount();
    });
  });
  updateChequeAmount();

  const saveBtn = document.getElementById("btnSaveCheque");
  if(saveBtn) saveBtn.addEventListener("click", saveCheque);
  bindBankSelect("chkBank");

  const printPlanBtn = document.getElementById("btnPrintPlan");
  if(printPlanBtn){
    if(!currentUser || currentUser.role !== "admin"){
      printPlanBtn.style.display = "none";
    } else if(chequeSearchState.client){
      printPlanBtn.addEventListener("click", ()=>{
        printTable("planTable", `جدول السداد — ${chequeSearchState.client.name} (${chequeSearchState.client.code})`);
      });
    }
  }
  const exportPlanXl = document.getElementById("btnExportPlanExcel");
  if(exportPlanXl && chequeSearchState.client){
    exportPlanXl.addEventListener("click", ()=>{
      exportTableExcel("planTable", `جدول_السداد_${chequeSearchState.client.code}`);
    });
  }
  const exportPlanWd = document.getElementById("btnExportPlanWord");
  if(exportPlanWd && chequeSearchState.client){
    exportPlanWd.addEventListener("click", ()=>{
      exportTableWord("planTable", `جدول السداد — ${chequeSearchState.client.name} (${chequeSearchState.client.code})`);
    });
  }
  document.querySelectorAll("[data-edit-inst]").forEach(btn=>{
    btn.addEventListener("click", ()=>openEditInstallmentModal(btn.dataset.editInst));
  });
  document.querySelectorAll("[data-print-receipt]").forEach(btn=>{
    btn.addEventListener("click", ()=>reprintReceipt(btn.dataset.printReceipt));
  });
  document.querySelectorAll("[data-del-cheque]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const chq = state.cheques.find(c=>c.id===btn.dataset.delCheque);
      if(!chq) return;
      confirmModal("حذف الشيك؟", `سيتم حذف الشيك رقم ${esc(chq.chequeNumber)} نهائيًا وكل سجلات التحصيل المرتبطة به. هذا الإجراء لا يمكن التراجع عنه.`, ()=>{
        state.cheques = state.cheques.filter(c=>c.id!==chq.id);
        state.collections = state.collections.filter(rec=>rec.chequeId!==chq.id);
        saveState(); toast("تم حذف الشيك"); render();
      });
    });
  });
}

/* Modal to manually edit a single installment's amount and/or due date.
   Stored as an override on the client (client.planOverrides), applied on top of the
   auto-computed plan every time it's rebuilt, so it persists and shows up everywhere
   (reports, receipts, totals). */
function openEditInstallmentModal(instId){
  const c = chequeSearchState.client;
  if(!c) return;
  const plan = planWithPayments(c);
  const inst = plan.find(i=>i.id===instId);
  if(!inst) return;
  const hasOverride = !!(c.planOverrides && c.planOverrides[instId]);
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="modal-bg" id="editInstBg">
    <div class="modal">
      <h3>تعديل الدفعة</h3>
      <p>${esc(inst.label)}</p>
      <div class="field">
        <label>القيمة المستحقة</label>
        <input id="editInstAmount" type="number" step="0.001" value="${inst.amount}">
      </div>
      <div class="field">
        <label>تاريخ الاستحقاق</label>
        <input id="editInstDate" type="date" value="${esc(inst.dueDate||"")}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-brass" id="editInstSave">حفظ التعديل</button>
        ${hasOverride ? `<button class="btn btn-danger" id="editInstReset">استعادة القيمة الافتراضية</button>` : ""}
        <button class="btn btn-ghost" id="editInstCancel">إلغاء</button>
      </div>
    </div>
  </div>`;
  document.getElementById("editInstSave").addEventListener("click", ()=>{
    const amount = parseFloat(document.getElementById("editInstAmount").value);
    const dueDate = document.getElementById("editInstDate").value;
    if(isNaN(amount) || amount<0){ toast("أدخل قيمة صحيحة"); return; }
    if(!c.planOverrides) c.planOverrides = {};
    c.planOverrides[instId] = { amount, dueDate: dueDate||null };
    saveState();
    root.innerHTML=""; toast("تم تعديل الدفعة"); render();
  });
  const resetBtn = document.getElementById("editInstReset");
  if(resetBtn){
    resetBtn.addEventListener("click", ()=>{
      if(c.planOverrides) delete c.planOverrides[instId];
      saveState();
      root.innerHTML=""; toast("تمت استعادة القيمة الافتراضية"); render();
    });
  }
  document.getElementById("editInstCancel").addEventListener("click", ()=>{ root.innerHTML=""; });
  document.getElementById("editInstBg").addEventListener("click", e=>{ if(e.target.id==="editInstBg") root.innerHTML=""; });
}

function updateChequeAmount(){
  const amtInput = document.getElementById("chkAmount");
  const dateInput = document.getElementById("chkDate");
  const receivedInput = document.getElementById("chkReceived");
  const summary = document.getElementById("selSummary");
  if(!amtInput) return;
  if(receivedInput) receivedInput.value = todayISO();
  const c = chequeSearchState.client;
  if(!c){ return; }
  const plan = planWithPayments(c);
  const ids = Object.keys(chequeSearchState.selectedInstallments);
  let total = 0; const labels=[]; let latestDue = "";
  ids.forEach(id=>{
    const inst = plan.find(i=>i.id===id);
    if(inst){
      total += Math.max(0, inst.amount - inst.coveredAmount);
      labels.push(inst.label);
      if(inst.dueDate && inst.dueDate > latestDue) latestDue = inst.dueDate;
    }
  });
  amtInput.value = total.toFixed(2);
  if(dateInput) dateInput.value = latestDue;
  summary.textContent = ids.length
    ? `محدد: ${labels.join("، ")} — إجمالي ${fmt(total)} ر.ع`
    : "حدد دفعة واحدة أو أكثر من الجدول أعلاه لحساب قيمة الشيك تلقائيًا.";
}

function saveCheque(){
  const c = chequeSearchState.client;
  if(!c){ toast("لم يتم اختيار عميل"); return; }
  const ids = Object.keys(chequeSearchState.selectedInstallments);
  if(ids.length===0){ toast("حدد دفعة واحدة على الأقل من خطة السداد"); return; }
  const number = document.getElementById("chkNumber").value.trim();
  if(!number){ toast("أدخل رقم الشيك"); return; }
  const bank = getBankValue("chkBank");
  const chequeDate = document.getElementById("chkDate").value;
  const received = document.getElementById("chkReceived").value || todayISO();
  const notes = document.getElementById("chkNotes").value.trim();
  const amount = parseFloat(document.getElementById("chkAmount").value)||0;

  const plan = planWithPayments(c);
  const allocations = ids.map(id=>{
    const inst = plan.find(i=>i.id===id);
    return { installmentId:id, amount: Math.max(0, inst.amount - inst.coveredAmount) };
  });

  const cheque = {
    id: uid("chk"), clientId:c.id, chequeNumber:number, bank, amount,
    receivedDate:received, chequeDate, notes, allocations,
    status:"pending", collectedDate:null, bounceDate:null, bounceReason:"",
    seq: state.nextChequeSeq++, createdAt:new Date().toISOString()
  };
  state.cheques.push(cheque);
  saveState();
  toast("تم حفظ الشيك بنجاح");
  chequeSearchState.selectedInstallments = {};
  openReceipt(cheque, c, allocations.map(a=>plan.find(i=>i.id===a.installmentId)));
  render();
}

function bindClientsEvents(){
  const btnNew = document.getElementById("btnNewClient");
  if(btnNew) btnNew.addEventListener("click", ()=>{ clientForm = blankClientForm(); render(); });
  const xl = document.getElementById("btnExportClientsListExcel");
  if(xl) xl.addEventListener("click", ()=>exportTableExcel("clientsListTable","قائمة_العملاء"));
  const wd = document.getElementById("btnExportClientsListWord");
  if(wd) wd.addEventListener("click", ()=>exportTableWord("clientsListTable","قائمة العملاء"));

  document.querySelectorAll("[data-edit-client]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const c = state.clients.find(x=>x.id===btn.dataset.editClient);
      if(!c) return;
      clientForm = {
        _editId:c.id, code:c.code, name:c.name, unit:c.unit, phone:c.phone,
        contractNumber:c.contractNumber||"", contractDate:c.contractDate||"", installmentsStartDate:c.installmentsStartDate||"",
        unitPrice:c.unitPrice,
        reservationPct: c.reservationPct!=null ? (c.reservationPct*100) : "",
        downPaymentPct: c.downPaymentPct!=null ? (c.downPaymentPct*100) : "",
        years:c.years,
        chequesCount: c.chequesCount!=null ? c.chequesCount : (c.years*12),
        yearPlans: (c.yearPlans||[]).map(yp=>({
          percent: yp.percent!=null ? (yp.percent*100) : "",
          phase1: yp.phase1Raw ?? (yp.phase1 ?? ""),
          phase2: yp.phase2Raw ?? (yp.phase2 ?? ""),
          phase3: yp.phase3Raw ?? (yp.phase3 ?? "")
        })),
        installmentMode: c.installmentMode || "standard",
        consultantSchedule: (c.consultantSchedule && c.consultantSchedule.length)
          ? c.consultantSchedule.map(r=>({ id:r.id||uid("cs"), label:r.label, percent:r.percent }))
          : defaultConsultantSchedule()
      };
      // pad in case stored years count doesn't match yearPlans length
      while(clientForm.yearPlans.length < clientForm.years) clientForm.yearPlans.push(blankYearPlan());
      render();
    });
  });
  document.querySelectorAll("[data-del-client]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.delClient;
      confirmModal("حذف العميل؟", "سيتم حذف بيانات العميل وخطة السداد الخاصة به، وكذلك جميع الشيكات وسجلات التحصيل المرتبطة به في كل الشاشات. هذا الإجراء لا يمكن التراجع عنه.", ()=>{
        state.clients = state.clients.filter(c=>c.id!==id);
        state.cheques = state.cheques.filter(chq=>chq.clientId!==id);
        state.collections = state.collections.filter(rec=>rec.clientId!==id);
        saveState();
        toast("تم حذف العميل وكل بياناته المرتبطة");
        render();
      });
    });
  });

  const chequesCountInput = document.getElementById("fChequesCount");
  if(chequesCountInput){
    chequesCountInput.addEventListener("change", ()=>{
      syncFormFromInputs();
      clientForm.chequesCount = chequesCountInput.value;
      const n = yearsFromCheques(chequesCountInput.value);
      const arr = clientForm.yearPlans.slice(0,n);
      while(arr.length<n) arr.push(blankYearPlan());
      clientForm.years = n;
      clientForm.yearPlans = arr;
      render();
    });
  }

  const modeSelect = document.getElementById("fInstallmentMode");
  if(modeSelect){
    modeSelect.addEventListener("change", ()=>{
      syncFormFromInputs();
      clientForm.installmentMode = modeSelect.value;
      if(clientForm.installmentMode === "consultant" && (!clientForm.consultantSchedule || !clientForm.consultantSchedule.length)){
        clientForm.consultantSchedule = defaultConsultantSchedule();
      }
      render();
    });
  }

  const csAddBtn = document.getElementById("btnCsAddRow");
  if(csAddBtn){
    csAddBtn.addEventListener("click", ()=>{
      syncFormFromInputs();
      clientForm.consultantSchedule.push({ id: uid("cs"), label:"", percent:"" });
      render();
    });
  }
  document.querySelectorAll("[data-cs-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      syncFormFromInputs();
      clientForm.consultantSchedule = clientForm.consultantSchedule.filter(r=>r.id!==btn.dataset.csDel);
      render();
    });
  });
  document.querySelectorAll("[data-cs-up]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      syncFormFromInputs();
      const arr = clientForm.consultantSchedule;
      const idx = arr.findIndex(r=>r.id===btn.dataset.csUp);
      if(idx>0){ [arr[idx-1],arr[idx]] = [arr[idx],arr[idx-1]]; render(); }
    });
  });
  document.querySelectorAll("[data-cs-down]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      syncFormFromInputs();
      const arr = clientForm.consultantSchedule;
      const idx = arr.findIndex(r=>r.id===btn.dataset.csDown);
      if(idx>=0 && idx<arr.length-1){ [arr[idx+1],arr[idx]] = [arr[idx],arr[idx+1]]; render(); }
    });
  });

  const saveFormBtn = document.getElementById("btnSaveClientForm");
  if(saveFormBtn) saveFormBtn.addEventListener("click", saveClientForm);
  const cancelBtn = document.getElementById("btnCancelClientForm");
  if(cancelBtn) cancelBtn.addEventListener("click", ()=>{ clientForm=null; render(); });

  // live recalculation of all derived percentages/values as the user types
  bindClientFormRecalc();
}

/* Live recalculation for the client form: percentages -> auto values, and flexible
   phase amounts -> auto last installment. Reads current DOM input values directly
   so it can run on every keystroke without a full re-render (keeps focus/cursor). */
function bindClientFormRecalc(){
  const card = document.getElementById("clientFormCard");
  if(!card) return;
  card.addEventListener("input", recalcClientForm);
  recalcClientForm();
}

function setText(id, text){
  const el = document.getElementById(id);
  if(el) el.textContent = text;
}

function recalcClientForm(){
  if(!document.getElementById("clientFormCard")) return;
  const chequesCountVal = document.getElementById("fChequesCount")?.value;
  if(chequesCountVal!==undefined){
    const ny = yearsFromCheques(chequesCountVal);
    setText("chequesYearsHint", `= ${ny} ${ny===1?"سنة":"سنوات"} بالتفصيل (${ny*12} شهرًا معروضًا أدناه — اضغط خارج الحقل لتحديث الجدول)`);
  }
  const unitPrice = parseFloat(document.getElementById("fUnitPrice")?.value)||0;
  const resPct = parseFloat(document.getElementById("fResPct")?.value)||0;
  const downPct = parseFloat(document.getElementById("fDownPct")?.value)||0;
  const resVal = unitPrice*resPct/100;
  const downVal = unitPrice*downPct/100;
  const remainPct = 100 - resPct - downPct;
  const remainVal = unitPrice*remainPct/100;

  setText("spanResVal", fmt(resVal)+" ر.ع");
  setText("spanDownVal", fmt(downVal)+" ر.ع");
  setText("csResRefVal", fmt(resVal)+" ر.ع");
  setText("csDownRefVal", fmt(downVal)+" ر.ع");
  setText("spanRemainPct", remainPct.toFixed(2)+"%");
  setText("spanRemainVal", fmt(remainVal)+" ر.ع");
  const remainWarn = document.getElementById("remainWarn");
  if(remainWarn){
    remainWarn.innerHTML = (unitPrice>0 && remainPct<0)
      ? `<span style="color:var(--warn);">تنبيه: نسبة الحجز + المقدم تتجاوز 100%</span>` : "";
  }

  // consultant-mode schedule totals
  let totalCsPct=0, totalCsVal=0;
  document.querySelectorAll(".csPercentInput").forEach(inp=>{
    const pct = parseFloat(inp.value)||0;
    const val = remainVal*pct/100;
    totalCsPct += pct; totalCsVal += val;
    setText("csVal_"+inp.dataset.id, fmt(val));
  });
  setText("csTotalPct", totalCsPct.toFixed(2)+"%");
  setText("csTotalVal", fmt(totalCsVal)+" ر.ع");
  const csChk = document.getElementById("csTotalChk");
  if(csChk){
    if(remainVal<=0){ csChk.innerHTML=""; }
    else if(Math.abs(totalCsPct-100)<0.5){
      csChk.innerHTML = `<span style="color:var(--ok);">✓ إجمالي نسب الجدول مطابق للمتبقي (100%)</span>`;
    } else {
      csChk.innerHTML = `<span style="color:var(--warn);">مجموع النسب الحالي ${totalCsPct.toFixed(2)}% — يجب أن يساوي 100%</span>`;
    }
  }

  let totalYearPct=0, totalYearVal=0;
  document.querySelectorAll(".yearPctInput").forEach(inp=>{
    const idx = inp.dataset.idx;
    const pct = parseFloat(inp.value)||0;
    const val = remainVal*pct/100;
    totalYearPct += pct; totalYearVal += val;
    setText("yearVal_"+idx, fmt(val));
    setText("yearVal2_"+idx, fmt(val));

    const p1raw = document.querySelector(`.phase1Input[data-idx="${idx}"]`)?.value;
    const p2raw = document.querySelector(`.phase2Input[data-idx="${idx}"]`)?.value;
    const p3raw = document.querySelector(`.phase3Input[data-idx="${idx}"]`)?.value;
    const r = resolveYearPhases(val, p1raw, p2raw, p3raw);
    setText("lastInst_"+idx, fmt(r.lastInst)+" ر.ع");
    [1,2,3].forEach(n=>{
      const hintEl = document.getElementById(`phase${n}Hint_${idx}`);
      if(!hintEl) return;
      hintEl.innerHTML = (r.isAuto[n-1] && val>0)
        ? `<span style="color:var(--brass-dark);">تلقائي = ${fmt(r["phase"+n])} ر.ع</span>` : "";
    });
    const flexTotal = r.phase1*3 + r.phase2*3 + r.phase3*5;
    const lastInst = r.lastInst;
    const chkEl = document.getElementById("phaseChk_"+idx);
    if(chkEl){
      if(val<=0){
        chkEl.innerHTML = "";
      } else if(lastInst<0){
        chkEl.innerHTML = `<span style="color:var(--warn);">تنبيه: إجمالي المراحل المرنة (${fmt(flexTotal)}) يتجاوز إجمالي السنة (${fmt(val)})</span>`;
      } else {
        chkEl.innerHTML = `<span style="color:var(--ok);">✓ إجمالي الأقساط الاثني عشر = ${fmt(flexTotal+lastInst)} ر.ع (مطابق لإجمالي السنة)</span>`;
      }
    }
  });
  setText("yearsTotalPct", totalYearPct.toFixed(2)+"%");
  setText("yearsTotalVal", fmt(totalYearVal)+" ر.ع");
  const yearsChk = document.getElementById("yearsTotalChk");
  if(yearsChk){
    if(remainVal<=0){ yearsChk.innerHTML=""; }
    else if(Math.abs(totalYearPct-100)<0.5 && Math.abs(totalYearVal-remainVal)<1){
      yearsChk.innerHTML = `<span style="color:var(--ok);">✓ إجمالي توزيع السنوات مطابق للمتبقي (100%)</span>`;
    } else {
      yearsChk.innerHTML = `<span style="color:var(--warn);">مجموع النسب الحالي ${totalYearPct.toFixed(2)}% — يجب أن يساوي 100%</span>`;
    }
  }
}

function syncFormFromInputs(){
  if(!clientForm) return;
  const g = id=>document.getElementById(id)?.value ?? "";
  clientForm.code = g("fCode");
  clientForm.name = g("fName");
  clientForm.phone = g("fPhone");
  clientForm.unit = g("fUnit");
  clientForm.contractNumber = g("fContractNumber");
  clientForm.contractDate = g("fContractDate");
  clientForm.unitPrice = g("fUnitPrice");
  clientForm.reservationPct = g("fResPct");
  clientForm.downPaymentPct = g("fDownPct");
  clientForm.installmentsStartDate = g("fInstStart");
  clientForm.chequesCount = g("fChequesCount");
  document.querySelectorAll(".yearPctInput").forEach(inp=>{
    const idx = parseInt(inp.dataset.idx,10);
    if(clientForm.yearPlans[idx]) clientForm.yearPlans[idx].percent = inp.value;
  });
  document.querySelectorAll(".phase1Input").forEach(inp=>{
    const idx = parseInt(inp.dataset.idx,10);
    if(clientForm.yearPlans[idx]) clientForm.yearPlans[idx].phase1 = inp.value;
  });
  document.querySelectorAll(".phase2Input").forEach(inp=>{
    const idx = parseInt(inp.dataset.idx,10);
    if(clientForm.yearPlans[idx]) clientForm.yearPlans[idx].phase2 = inp.value;
  });
  document.querySelectorAll(".phase3Input").forEach(inp=>{
    const idx = parseInt(inp.dataset.idx,10);
    if(clientForm.yearPlans[idx]) clientForm.yearPlans[idx].phase3 = inp.value;
  });
  if(clientForm.consultantSchedule){
    document.querySelectorAll(".csLabelInput").forEach(inp=>{
      const row = clientForm.consultantSchedule.find(r=>r.id===inp.dataset.id);
      if(row) row.label = inp.value;
    });
    document.querySelectorAll(".csPercentInput").forEach(inp=>{
      const row = clientForm.consultantSchedule.find(r=>r.id===inp.dataset.id);
      if(row) row.percent = inp.value;
    });
  }
}

function saveClientForm(){
  syncFormFromInputs();
  const f = clientForm;
  if(!f.code.trim() || !f.name.trim()){ toast("أدخل كود واسم العميل"); return; }
  const dupe = state.clients.find(c=>c.code.toLowerCase()===f.code.trim().toLowerCase() && c.id!==f._editId);
  if(dupe){ toast("يوجد عميل آخر بنفس الكود"); return; }

  const unitPrice = parseFloat(f.unitPrice)||0;
  if(unitPrice<=0){ toast("أدخل إجمالي سعر الوحدة"); return; }
  const reservationPct = (parseFloat(f.reservationPct)||0)/100;
  const downPaymentPct = (parseFloat(f.downPaymentPct)||0)/100;
  const reservation = unitPrice*reservationPct;
  const downPayment = unitPrice*downPaymentPct;
  const remainingPct = 1 - reservationPct - downPaymentPct;
  if(remainingPct<0){ toast("نسبة الحجز + المقدم تتجاوز 100% — راجع النسب"); return; }
  const remaining = unitPrice*remainingPct;

  const installmentMode = f.installmentMode === "consultant" ? "consultant" : "standard";

  let payload = {
    code:f.code.trim(), name:f.name.trim(), unit:f.unit.trim(), phone:f.phone.trim(),
    contractNumber:(f.contractNumber||"").trim(), contractDate:f.contractDate, installmentsStartDate:f.installmentsStartDate,
    unitPrice, reservationPct, reservation, downPaymentPct, downPayment,
    remainingPct, remaining, installmentMode
  };

  if(installmentMode === "consultant"){
    const rows = (f.consultantSchedule||[]).filter(r=>(r.label||"").trim());
    if(!rows.length){ toast("أضف دفعة واحدة على الأقل في جدول الاستشاري"); return; }
    const totalPct = rows.reduce((s,r)=>s+(parseFloat(r.percent)||0),0);
    if(Math.abs(totalPct-100) > 0.5){
      toast(`مجموع نسب جدول الاستشاري ${totalPct.toFixed(2)}% — يجب أن يساوي 100% تقريبًا`);
      return;
    }
    payload.consultantSchedule = rows.map(r=>({ id:r.id||uid("cs"), label:r.label.trim(), percent: parseFloat(r.percent)||0 }));
    // keep standard-mode fields populated too (harmless, in case user switches mode later)
    payload.chequesCount = f.chequesCount; payload.years = f.years; payload.yearPlans = f.yearPlans;
  } else {
    const chequesCount = parseInt(f.chequesCount,10) || (f.years*12);
    const years = yearsFromCheques(chequesCount);
    if(years !== f.yearPlans.length){
      while(f.yearPlans.length<years) f.yearPlans.push(blankYearPlan());
      f.yearPlans = f.yearPlans.slice(0,years);
    }

    const yearPlans = f.yearPlans.map(yp=>{
      const percent = (parseFloat(yp.percent)||0)/100;
      const amount = remaining*percent;
      const r = resolveYearPhases(amount, yp.phase1, yp.phase2, yp.phase3);
      return {
        percent, amount, phase1:r.phase1, phase2:r.phase2, phase3:r.phase3, lastInstallment:r.lastInst,
        phase1Raw: yp.phase1 || "", phase2Raw: yp.phase2 || "", phase3Raw: yp.phase3 || ""
      };
    });

    const negIdx = yearPlans.findIndex(yp=>yp.amount>0 && yp.lastInstallment<0);
    if(negIdx>=0){
      toast(`تنبيه: القسط الأخير للسنة ${arabicYear(negIdx+1)} أصبح سالبًا — قلّل قيم المراحل`);
      return;
    }

    payload.chequesCount = chequesCount; payload.years = years; payload.yearPlans = yearPlans;
    // preserve any existing consultant schedule so switching modes later doesn't lose it
    payload.consultantSchedule = f.consultantSchedule || defaultConsultantSchedule();
  }

  if(f._editId){
    const idx = state.clients.findIndex(c=>c.id===f._editId);
    state.clients[idx] = {...state.clients[idx], ...payload};
    toast("تم حفظ تعديلات العميل");
  } else {
    state.clients.push({ id:uid("cl"), ...payload, createdAt:new Date().toISOString() });
    toast("تم إضافة العميل");
  }
  saveState();
  clientForm = null;
  render();
}

function bindChequesReportEvents(){
  const p = document.getElementById("btnPrintChqReport");
  if(p) p.addEventListener("click", ()=>printTable("chqReportTable","تقرير الشيكات"));
  const xl = document.getElementById("btnExportChqExcel");
  if(xl) xl.addEventListener("click", ()=>exportTableExcel("chqReportTable","تقرير_الشيكات"));
  const wd = document.getElementById("btnExportChqWord");
  if(wd) wd.addEventListener("click", ()=>exportTableWord("chqReportTable","تقرير الشيكات"));
}
function bindClientsReportEvents(){
  const p = document.getElementById("btnPrintClientsReport");
  if(p) p.addEventListener("click", ()=>printTable("clientsReportTable","تقرير العملاء"));
  const xl = document.getElementById("btnExportClientsExcel");
  if(xl) xl.addEventListener("click", ()=>exportTableExcel("clientsReportTable","تقرير_العملاء"));
  const wd = document.getElementById("btnExportClientsWord");
  if(wd) wd.addEventListener("click", ()=>exportTableWord("clientsReportTable","تقرير العملاء"));
}

/* ============================= SCREEN: RECEIPTS ARCHIVE (official, high-value) ============================= */
function renderReceiptsScreen(){
  const all = state.cheques.slice().sort((a,b)=>b.seq-a.seq).map(chq=>({
    chq, cl: state.clients.find(c=>c.id===chq.clientId)
  }));

  const q = (receiptsSearchState.q||"").trim().toLowerCase();
  const rows = q ? all.filter(r=>{
    return (r.cl?.name||"").toLowerCase().includes(q)
        || (r.cl?.code||"").toLowerCase().includes(q)
        || (r.chq.chequeNumber||"").toLowerCase().includes(q)
        || (r.chq.bank||"").toLowerCase().includes(q);
  }) : all;

  const totalAmt = all.reduce((s,r)=>s+r.chq.amount,0);
  const lastOne = all[0];

  let html = `
  <div class="archive-hero">
    <div class="archive-hero-top">
      <div class="archive-seal">۞</div>
      <div>
        <h2>السجل الرسمي لإيصالات استلام الشيكات</h2>
        <div class="tagline">كل إيصال هنا وثيقة معتمدة باسم الشركة — يمكن استعراضه أو إعادة طباعته في أي وقت</div>
      </div>
    </div>
    <div class="archive-kpis">
      <div class="archive-kpi"><div class="lbl">عدد الإيصالات الصادرة</div><div class="val">${all.length}</div></div>
      <div class="archive-kpi"><div class="lbl">إجمالي قيمة الشيكات الموثّقة</div><div class="val">${fmt(totalAmt)} <small>ر.ع</small></div></div>
      <div class="archive-kpi"><div class="lbl">آخر إيصال صادر</div><div class="val" style="font-size:15px;">${lastOne ? "رقم "+String(lastOne.chq.seq).padStart(5,"0") : "—"}</div></div>
    </div>
    <div class="legal-blurb"><strong>ملحوظة:</strong> محضر اتفاق الدفعات التعاقدية مستند إثبات استلام فقط، ولا يعني تحصيل قيمته فعليًا من البنك؛ تبقى قيمته معلّقة حتى تاريخ استحقاقه وتحصيله.</div>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0;">جميع الإيصالات</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportReceiptsExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportReceiptsWord">تصدير Word</button>
      <input id="receiptsSearch" type="text" placeholder="ابحث بكود العميل، الاسم، رقم الشيك أو البنك…" style="max-width:320px;" value="${esc(receiptsSearchState.q||"")}">
    </div>`;

  if(all.length===0){
    html += `<div class="empty"><div class="ico">🧾</div>لا توجد إيصالات صادرة بعد — سيظهر هنا كل إيصال فور تسجيل شيك جديد من شاشة «إدارة الشيكات».</div></div>`;
    return html;
  }
  if(rows.length===0){
    html += `<div class="empty"><div class="ico">🔎</div>لا توجد نتائج مطابقة لبحثك.</div></div>`;
    return html;
  }

  html += `<div class="receipt-ledger">`;
  html += rows.map(r=>{
    const cl = r.cl;
    return `
    <div class="receipt-card">
      <div class="rc-seq">${String(r.chq.seq).padStart(5,"0")}<small>رقم مرجعي</small></div>
      <div class="rc-main">
        <div class="rc-client">${esc(cl?.name||"عميل محذوف")} ${cl?`<span class="code">${esc(cl.code)}</span>`:""}</div>
        <div class="rc-meta">شيك رقم ${esc(r.chq.chequeNumber)} — ${esc(r.chq.bank||"بنك غير محدد")} — استلم بتاريخ ${fmtDate(r.chq.receivedDate)}</div>
      </div>
      <div class="rc-amount">
        <div class="v num">${fmt(r.chq.amount)}</div>
        <div class="k">ريال عماني</div>
      </div>
      <div>${chequeStatusBadge(r.chq)}</div>
      <div class="rc-actions no-print">
        <button class="btn btn-brass btn-sm" data-reprint="${r.chq.id}" ${cl?"":"disabled"}>عرض وطباعة الإيصال</button>
      </div>
    </div>`;
  }).join("");
  html += `</div></div>`;
  return html;
}

/* ============================= SCREEN: USERS (admin only — تفعيل/إيقاف الأكواد) ============================= */
function renderUsersScreen(){
  if(!currentUser || currentUser.role!=="admin"){
    return `<div class="card"><h2>غير مسموح</h2><p class="hint">هذه الشاشة مخصصة للأدمن فقط.</p></div>`;
  }
  let rows = USERS.map(u=>{
    const active = isUserActive(u.code);
    const isSelf = normCode(u.code)===normCode(currentUser.code);
    return `
      <tr>
        <td>${esc(u.code)}</td>
        <td>${esc(u.label)}</td>
        <td>${esc((u.perms||[]).join("، "))}</td>
        <td>${active ? '<span class="badge badge-ok">مفعّل</span>' : '<span class="badge badge-warn">موقوف</span>'}</td>
        <td class="no-print">
          <button class="btn ${active?'btn-ghost':'btn-brass'} btn-sm" data-toggle-user="${esc(u.code)}" ${isSelf?"disabled title=\"لا يمكنك إيقاف حسابك الحالي\"":""}>
            ${active ? "إيقاف الكود" : "تشغيل الكود"}
          </button>
        </td>
      </tr>`;
  }).join("");

  return `
  <div class="card">
    <div class="toolbar" style="margin-bottom:2px;">
      <h2 style="margin:0;">إدارة المستخدمين</h2>
      <div class="grow"></div>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportUsersExcel">تصدير Excel</button>
      <button class="btn btn-ghost btn-sm no-print" id="btnExportUsersWord">تصدير Word</button>
    </div>
    <p class="hint">يمكنك تفعيل أو إيقاف صلاحية الدخول لأي كود مستخدم. الكود الموقوف لا يستطيع تسجيل الدخول للنظام حتى تتم إعادة تفعيله، وإن كان مسجّلاً دخوله حاليًا سيتم إخراجه تلقائيًا عند إعادة تحميل الصفحة.</p>
    <div class="table-wrap">
      <table id="usersTable">
        <thead><tr><th>الكود (اسم الدخول)</th><th>المسمى</th><th>الصلاحيات</th><th>الحالة</th><th class="no-print">إجراء</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function bindUsersEvents(){
  document.querySelectorAll("[data-toggle-user]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const code = btn.dataset.toggleUser;
      toggleUserActive(code);
      render();
    });
  });
  const xl = document.getElementById("btnExportUsersExcel");
  if(xl) xl.addEventListener("click", ()=>exportTableExcel("usersTable","إدارة_المستخدمين"));
  const wd = document.getElementById("btnExportUsersWord");
  if(wd) wd.addEventListener("click", ()=>exportTableWord("usersTable","إدارة المستخدمين"));
}

function bindReceiptsEvents(){
  const search = document.getElementById("receiptsSearch");
  if(search){
    search.addEventListener("input", ()=>{
      receiptsSearchState.q = search.value;
      render();
      const el = document.getElementById("receiptsSearch");
      if(el){ el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    });
  }
  document.querySelectorAll("[data-reprint]").forEach(btn=>{
    btn.addEventListener("click", ()=>reprintReceipt(btn.dataset.reprint));
  });
  const xl = document.getElementById("btnExportReceiptsExcel");
  if(xl) xl.addEventListener("click", ()=>exportAOAExcel(buildReceiptsAOA(), "إيصالات_الاستلام"));
  const wd = document.getElementById("btnExportReceiptsWord");
  if(wd) wd.addEventListener("click", ()=>exportAOAWord(buildReceiptsAOA(), "إيصالات استلام الشيكات"));
}

/* مصفوفة بيانات (AOA) لكل الإيصالات الظاهرة حاليًا (مطابقة لنفس فلتر البحث في الشاشة) — تُستخدم لتصدير Excel/Word */
function buildReceiptsAOA(){
  const all = state.cheques.slice().sort((a,b)=>b.seq-a.seq).map(chq=>({
    chq, cl: state.clients.find(c=>c.id===chq.clientId)
  }));
  const q = (receiptsSearchState.q||"").trim().toLowerCase();
  const rows = q ? all.filter(r=>{
    return (r.cl?.name||"").toLowerCase().includes(q)
        || (r.cl?.code||"").toLowerCase().includes(q)
        || (r.chq.chequeNumber||"").toLowerCase().includes(q)
        || (r.chq.bank||"").toLowerCase().includes(q);
  }) : all;
  const aoa = [["رقم مرجعي","كود العميل","اسم العميل","رقم الشيك","البنك","تاريخ الاستلام","القيمة","الحالة"]];
  rows.forEach(r=>{
    aoa.push([
      String(r.chq.seq).padStart(5,"0"),
      r.cl?.code||"—",
      r.cl?.name||"عميل محذوف",
      r.chq.chequeNumber||"—",
      r.chq.bank||"—",
      fmtDate(r.chq.receivedDate),
      fmt(r.chq.amount),
      (r.chq.status||"pending")==="collected" ? "تم التحصيل" : (r.chq.status==="bounced" ? "مرتد" : "قيد التحصيل")
    ]);
  });
  return aoa;
}

function reprintReceipt(chequeId){
  const chq = state.cheques.find(c=>c.id===chequeId);
  if(!chq){ toast("تعذر العثور على الشيك"); return; }
  const cl = state.clients.find(c=>c.id===chq.clientId);
  if(!cl){ toast("بيانات العميل غير متوفرة لهذا الشيك"); return; }
  const plan = buildPlan(cl);
  const instItems = (chq.allocations||[]).map(a=>plan.find(i=>i.id===a.installmentId)).filter(Boolean);
  openReceipt(chq, cl, instItems, true);
}

/* Reprint the official collection receipt (إيصال التحصيل الرسمي) for an already-collected
   cheque, from its stored collections record — used by the print button in «متابعة تحصيل
   الشيكات» so a formal collection receipt can be retrieved for any cheque found via search
   (by cheque number, client code/name, or installment number). */
function reprintCollectionReceipt(chequeId){
  const chq = state.cheques.find(c=>c.id===chequeId);
  if(!chq){ toast("تعذر العثور على الشيك"); return; }
  const cl = state.clients.find(c=>c.id===chq.clientId);
  if(!cl){ toast("بيانات العميل غير متوفرة لهذا الشيك"); return; }
  const record = state.collections.find(rec=>rec.chequeId===chq.id);
  if(!record){ toast("لا يوجد سجل تحصيل رسمي مرتبط بهذا الشيك"); return; }
  openCollectionReceipt(record, chq, cl);
}

/* ============================= CONFIRM MODAL ============================= */
function confirmModal(title, body, onConfirm){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="modal-bg" id="confirmBg">
    <div class="modal">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      <div class="modal-actions">
        <button class="btn btn-danger" id="confirmYes">تأكيد الحذف</button>
        <button class="btn btn-ghost" id="confirmNo">إلغاء</button>
      </div>
    </div>
  </div>`;
  document.getElementById("confirmYes").addEventListener("click", ()=>{ root.innerHTML=""; onConfirm(); });
  document.getElementById("confirmNo").addEventListener("click", ()=>{ root.innerHTML=""; });
  document.getElementById("confirmBg").addEventListener("click", e=>{ if(e.target.id==="confirmBg") root.innerHTML=""; });
}

/* ============================= RECEIPT ============================= */
function openReceipt(cheque, client, instItems, isReprint){
  const printArea = document.getElementById("printArea");

  const isConsultantMode = client.installmentMode === "consultant";
  const yearPlans = client.yearPlans || [];
  const downPaymentRowHtml = isConsultantMode
    ? `<tr>
        <td>دفعة المقدم</td>
        <td class="num">${fmtPct((client.downPaymentPct||0)*100)}%</td>
        <td class="num">${fmt(client.downPayment||0)}</td>
      </tr>`
    : "";
  const yearsHtml = isConsultantMode
    ? downPaymentRowHtml + (client.consultantSchedule||[]).map(row=>`
        <tr>
          <td>${esc(row.label)}</td>
          <td class="num">${fmtPct(parseFloat(row.percent)||0)}%</td>
          <td class="num">${fmt((client.remaining||0)*((parseFloat(row.percent)||0)/100))}</td>
        </tr>`).join("")
    : yearPlans.map((yp,idx)=>`
        <tr>
          <td>السنة ${arabicYear(idx+1)}</td>
          <td class="num">${fmt(yp.amount||0)}</td>
        </tr>`).join("");
  const totalInstallments = isConsultantMode
    ? (client.downPayment||0) + (client.consultantSchedule||[]).reduce((s,row)=>s+(client.remaining||0)*((parseFloat(row.percent)||0)/100),0)
    : yearPlans.reduce((s,yp)=>s+(yp.amount||0),0);

  const planForOrder = buildPlan(client);
  // Order rows the same way the "خطة السداد والدفعات" screen does — by installment
  // sequence — rather than by cheque registration order, so the printed record's item
  // order matches what the user sees on the payment-plan screen.
  const chequePlanSeq = (c)=>{
    const seqs = (c.allocations||[]).map(a=>{
      const inst = planForOrder.find(i=>i.id===a.installmentId);
      return inst ? inst.seq : Infinity;
    });
    return seqs.length ? Math.min(...seqs) : Infinity;
  };
  const allCheques = state.cheques.filter(c=>c.clientId===client.id).sort((a,b)=>{
    const sa = chequePlanSeq(a), sb = chequePlanSeq(b);
    if(sa!==sb) return sa-sb;
    return a.seq-b.seq;
  });
  const totalReceived = allCheques.reduce((s,c)=>s+c.amount,0);
  const totalReceivedWords = numberToArabicWords(totalReceived);
  const totalChequesCount = allCheques.length;
  const agreedPaymentsCount = isConsultantMode
    ? (client.consultantSchedule||[]).length
    : yearPlans.length;
  const chequesHistoryHtml = allCheques.map(c=>{
    const isCurrent = c.id===cheque.id;
    let statusLabel = c.status==="bounced" ? "مرتد" : c.status==="collected" ? "تم التحصيل" : "قيد الانتظار";
    if(c.status==="collected"){
      const face = c.amount||0;
      const collected = (c.collectedAmount!=null ? c.collectedAmount : face);
      if(face>0.5 && collected < face-0.5){
        statusLabel = `تحصيل جزئي (${fmt(collected)} من ${fmt(face)})`;
      }
    }
    return `
    <tr${isCurrent ? ' style="background:var(--brass-soft);font-weight:700;"' : ''}>
      <td class="num">${c.seq}${isCurrent ? " ★" : ""}</td>
      <td class="num">${esc(c.chequeNumber)}</td>
      <td>${esc(c.bank||"—")}</td>
      <td class="num">${fmtDate(c.receivedDate)}</td>
      <td class="num">${fmtDate(c.chequeDate)}</td>
      <td class="num">${fmt(c.amount)}</td>
      <td>${esc(statusLabel)}</td>
    </tr>`;
  }).join("");

  printArea.innerHTML = `
  <div class="receipt-doc">

    <div class="receipt-page">
      <div class="receipt-head">
        <div>
          <img src="${COMPANY_LOGO_DATA_URI}" alt="بن أرحب للتطوير العقاري" class="receipt-logo">
          <h2>محضر اتفاق الدفعات التعاقدية</h2>
          <div class="co">قسم التسويق — إدارة المبيعات والعملاء</div>
          <div class="co-details">
            رقم السجل التجاري: 1811487 — ص.ب. 2435، الرمز البريدي 133، الخوير، سلطنة عمان<br>
            محافظة مسقط / منطقة بوشر — الهاتف: +9689445559 — البريد الإلكتروني: info@binarha.om
          </div>
        </div>
        <div class="receipt-no">
          رقم مرجعي: ${String(cheque.seq).padStart(5,"0")}<br>
          تاريخ الإصدار: ${fmtDate(todayISO())}
        </div>
      </div>

      <div class="receipt-grid">
        <div><span class="k">اسم العميل</span><span class="v">${esc(client.name)}</span></div>
        <div><span class="k">كود العميل</span><span class="v">${esc(client.code)}</span></div>
        <div><span class="k">اسم الوحدة</span><span class="v">${esc(client.unit)}</span></div>
        <div><span class="k">رقم العقد</span><span class="v">${esc(client.contractNumber||"—")}</span></div>
        <div><span class="k">تاريخ العقد</span><span class="v">${fmtDate(client.contractDate)}</span></div>
        <div><span class="k">إجمالي قيمة الوحدة</span><span class="v">${fmt(client.unitPrice)} ريال عماني</span></div>
        <div><span class="k">إجمالي عدد الدفعات التعاقدية المتفق عليها</span><span class="v">${agreedPaymentsCount}</span></div>
      </div>

      <table class="receipt-table">
        <thead><tr><th>${isConsultantMode?"بيان الدفعة":"السنة"}</th>${isConsultantMode?"<th>نسبة</th>":""}<th>${isConsultantMode?"القيمة":"إجمالي أقساط السنة"}</th></tr></thead>
        <tbody>${yearsHtml}</tbody>
      </table>
      <div class="receipt-total-block"><span>الإجمالي</span><span class="num">${fmt(totalInstallments)}</span></div>

      ${cheque.notes ? `<div><span class="k" style="display:block;margin-bottom:4px;">ملاحظات</span>${esc(cheque.notes)}</div>` : ""}
    </div>

    <div class="receipt-page receipt-page-break">
      <div class="receipt-section-title">جميع الدفعات التعاقدية المتفق عليها مع العميل</div>
      <table class="receipt-table">
        <thead><tr><th>رقم مرجعي</th><th>رقم الشيك</th><th>البنك</th><th>تاريخ الاستلام</th><th>تاريخ الاستحقاق</th><th>القيمة</th><th>الحالة</th></tr></thead>
        <tbody>${chequesHistoryHtml}</tbody>
      </table>
      <div class="receipt-total-block"><span>إجمالي الدفعات التعاقدية المتفق عليها من العميل</span><span class="num">${fmt(totalReceived)}</span></div>

      <div class="legal-note">
        <strong>ملاحظة قانونية:</strong> هذا المستند لا يُعد بأي حال من الأحوال دليلاً على تحصيل الشركة للمبالغ نقدًا أو بصورة نهائية، وإنما يُثبت فقط أن العميل قد التزم بتسديد دفعات تعاقدية وفقًا لشروط العقد، سواء كانت عن طريق شيكات، تحويلات بنكية، أو أي وسيلة دفع أخرى. وتظل قيمة كل دفعة معلقة لحين تاريخ استحقاقها وتحصيلها الفعلي من الجهة المصرفية أو الوسيلة المعتمدة للسداد. وفي حال تسليم شيكات من العميل، فإنها تُعتبر وسيلة دفع معلقة لا تُعد تحصيلاً نهائيًا إلا بعد صرفها وتأكيد قيمتها من البنك المسحوب عليه.
      </div>

      <div class="receipt-sign">
        <div class="line">توقيع مدير قسم المبيعات</div>
        <div class="line">توقيع العميل</div>
      </div>
    </div>

  </div>`;

  showReceiptModal(isReprint);
}

function showReceiptModal(isReprint){
  const root = document.getElementById("modalRoot");
  const canPrint = !isLimitedChequesRole();
  root.innerHTML = `
  <div class="modal-bg no-print" id="receiptBg">
    <div class="modal" style="max-width:640px;max-height:88vh;overflow-y:auto;">
      <h3>${isReprint ? "الإيصال جاهز للاستعراض" : "تم تسجيل بيانات الشيك بنجاح"}</h3>
      <p>محضر اتفاق الدفعات التعاقدية جاهز للطباعة.</p>
      <div class="modal-actions">
        ${canPrint ? `<button class="btn btn-brass" id="btnDoPrintReceipt">طباعة الإيصال</button>` : ""}
        <button class="btn btn-ghost" id="btnCloseReceipt">إغلاق</button>
      </div>
    </div>
  </div>`;
  if(canPrint) document.getElementById("btnDoPrintReceipt").addEventListener("click", ()=>window.print());
  document.getElementById("btnCloseReceipt").addEventListener("click", ()=>{ root.innerHTML=""; });
  document.getElementById("receiptBg").addEventListener("click", e=>{ if(e.target.id==="receiptBg") root.innerHTML=""; });
}

/* Formal receipt issued when an amount is actually collected against a client's cheque
   (via the "quick collect by client code" panel) — distinct from the cheque-receipt above,
   which only documents that a cheque instrument was received, not that funds were collected. */
function openCollectionReceipt(record, chq, client){
  const printArea = document.getElementById("printArea");
  const plan = buildPlan(client);
  const linkedInsts = (chq.allocations||[]).map(a=>plan.find(i=>i.id===a.installmentId)).filter(Boolean).sort((a,b)=>a.seq-b.seq);
  const instLabels = linkedInsts.map(inst=>inst.label).join("، ") || "—";
  const instSeqs = linkedInsts.map(inst=>inst.seq).join("، ") || "—";
  const paymentRefLabel = linkedInsts.length>1 ? "الدفعات التعاقدية أرقام" : "الدفعة التعاقدية رقم";
  const instDueDates = linkedInsts.map(inst=>fmtDate(inst.dueDate)).join("، ") || "—";
  const instAmounts = linkedInsts.map(inst=>fmt(inst.amount)).join("، ") || "—";

  // If this cheque already had earlier collection round(s) recorded against it (a
  // previous partial collection), this receipt is a *settlement/completion* receipt for
  // the remaining balance — it must reference the prior receipt and show the full
  // accounting breakdown rather than the plain first-time collection wording.
  const priorRecords = state.collections
    .filter(r=>r.chequeId===chq.id && r.id!==record.id)
    .sort((a,b)=>(a.date||"").localeCompare(b.date||"") || a.seq-b.seq);
  const isSettlement = priorRecords.length>0;
  const priorPaidTotal = priorRecords.reduce((s,r)=>s+r.amount,0);
  const prevRecord = priorRecords[priorRecords.length-1];
  const totalCollectedNow = priorPaidTotal + record.amount;
  const remainingBeforeThis = Math.max(0, chq.amount - priorPaidTotal);
  const isFullySettled = totalCollectedNow >= chq.amount - 0.5;

  const amountWords = numberToArabicWords(record.amount);
  const diff = (isSettlement ? totalCollectedNow : record.amount) - chq.amount;
  let clarifyStatement;
  if(isSettlement){
    const prevRefNo = `TC-${String(prevRecord.seq).padStart(5,"0")}`;
    if(isFullySettled){
      clarifyStatement = `يُثبت هذا الإيصال الرسمي أن العميل قد قام بسداد مبلغ وقدره (${fmt(record.amount)} ريال عماني) بتاريخ ${fmtDate(record.date)}، يمثل الجزء المتبقي والأخير من قيمة ${paymentRefLabel} ${esc(chq.chequeNumber||"—")} البالغة قيمتها التعاقدية المستحقة (${fmt(chq.amount)} ريال عماني)، وذلك استكمالًا لما سبق تحصيله من العميل ذاته بمبلغ (${fmt(priorPaidTotal)} ريال عماني) بموجب إيصال التحصيل السابق رقم (${esc(prevRecord.receiptNumber||"—")}) والمرجع الداخلي رقم (${esc(prevRefNo)})، والذي كان قد ترك رصيدًا متبقيًا ومستحقًا وقدره (${fmt(remainingBeforeThis)} ريال عماني) قبل صدور هذا الإيصال. وبإتمام تحصيل هذا المبلغ الأخير وقيده في السجلات المحاسبية للشركة، يصبح إجمالي ما تم تحصيله فعليًا من هذه الدفعة التعاقدية (${fmt(totalCollectedNow)} ريال عماني)، بما يُعادل كامل قيمتها الاسمية المستحقة ودون أي نقص، فلا يتبقى بذمة العميل أي مبلغ آخر عن هذه الدفعة تحديدًا وفقًا لشروط عقد البيع رقم ${esc(client.contractNumber||"—")}. وبهذا تُعتبر الدفعة التعاقدية المذكورة مسددة ومُسوّاة بالكامل في السجلات المالية للشركة، وذلك دون أي أثر على باقي مستحقات العميل الأخرى غير المشمولة بهذا الإيصال.`;
    } else {
      const stillRemaining = fmt(Math.max(0, chq.amount-totalCollectedNow));
      clarifyStatement = `يُثبت هذا الإيصال الرسمي أن العميل قد قام بسداد مبلغ إضافي وقدره (${fmt(record.amount)} ريال عماني) بتاريخ ${fmtDate(record.date)}، على حساب ${paymentRefLabel} ${esc(chq.chequeNumber||"—")} البالغة قيمتها التعاقدية المستحقة (${fmt(chq.amount)} ريال عماني)، وذلك استكمالًا لما سبق تحصيله من العميل ذاته بمبلغ (${fmt(priorPaidTotal)} ريال عماني) بموجب إيصال التحصيل السابق رقم (${esc(prevRecord.receiptNumber||"—")}) والمرجع الداخلي رقم (${esc(prevRefNo)})، والذي كان قد ترك رصيدًا متبقيًا ومستحقًا وقدره (${fmt(remainingBeforeThis)} ريال عماني) قبل صدور هذا الإيصال. وبقيد هذا المبلغ الإضافي في السجلات المحاسبية للشركة، يصبح إجمالي ما تم تحصيله فعليًا من هذه الدفعة حتى تاريخه (${fmt(totalCollectedNow)} ريال عماني) من أصل قيمتها التعاقدية المذكورة، دون أن يترتب على ذلك، بأي حال، إبراءٌ كاملٌ لذمة العميل عن هذه الدفعة، ويظل الرصيد المتبقي وقدره (${stillRemaining} ريال عماني) دَينًا مستحقًا وواجب السداد في ذمة العميل، مع احتفاظ الشركة بكامل حقوقها القانونية والتعاقدية في المطالبة بتحصيله لاحقًا بموجب عقد البيع رقم ${esc(client.contractNumber||"—")}. ولا يُحتَجّ بهذا الإيصال كدليل على إبراء الذمة إلا في حدود إجمالي المبلغ المحصَّل فعليًا الموضح أعلاه.`;
    }
  } else if (Math.abs(diff) <= 0.5) {
    clarifyStatement = `تم تحصيل المبلغ الموضح أعلاه فعليًا وقيده في السجلات المحاسبية للشركة بتاريخ ${fmtDate(record.date)}، وتُعتبر ${paymentRefLabel} ${esc(chq.chequeNumber||"—")} مسددة بالكامل من واقع هذا التحصيل، دون أثر على باقي مستحقات العميل الأخرى بموجب عقد البيع رقم ${esc(client.contractNumber||"—")}.`;
  } else if (diff < 0) {
    const remaining = fmt(Math.abs(diff));
    clarifyStatement = `تم تحصيل مبلغ ${fmt(record.amount)} ر.ع فعليًا، وقيده في السجلات المحاسبية للشركة بتاريخ ${fmtDate(record.date)}، وذلك كسداد جزئي على حساب ${paymentRefLabel} ${esc(chq.chequeNumber||"—")} البالغة قيمتها الاسمية ${fmt(chq.amount)} ر.ع. ولا يترتب على هذا التحصيل الجزئي، بأي حال، إبراءٌ كاملٌ لذمة العميل عن ${paymentRefLabel} المذكورة، ويظل الرصيد المتبقي وقدره ${remaining} ر.ع دَينًا مستحقًا وواجب السداد في ذمة العميل، مع احتفاظ الشركة بكامل حقوقها القانونية والتعاقدية في المطالبة بتحصيل هذا المتبقي بموجب عقد البيع رقم ${esc(client.contractNumber||"—")}. ولا يُحتَجّ بهذا الإيصال كدليل على إبراء الذمة إلا في حدود المبلغ المحصَّل فعليًا الموضح أعلاه.`;
  } else {
    const excess = fmt(diff);
    clarifyStatement = `تم تحصيل مبلغ ${fmt(record.amount)} ر.ع فعليًا، وقيده في السجلات المحاسبية للشركة بتاريخ ${fmtDate(record.date)}، وهو ما يزيد بمبلغ ${excess} ر.ع عن القيمة الاسمية لـ ${paymentRefLabel} ${esc(chq.chequeNumber||"—")} البالغة ${fmt(chq.amount)} ر.ع. وتُعتبر ${paymentRefLabel} المذكورة مسددة بالكامل من واقع هذا التحصيل، على أن يُقيَّد الفائض المذكور لحساب العميل مقابل مستحقاته الأخرى بموجب عقد البيع رقم ${esc(client.contractNumber||"—")}.`;
  }

  const stampPartial = isSettlement ? !isFullySettled : (diff<-0.5);
  const stampLabel = isSettlement ? (isFullySettled ? "تم استكمال تحصيل الدفعة" : "تحصيل جزئي") : (diff<-0.5 ? "تحصيل جزئي" : "تم التحصيل");

  printArea.innerHTML = `
  <div class="tc-wrap">
    <div class="tc-frame">
      <div class="tc-corner tl"><svg viewBox="0 0 40 40"><path d="M2 38 Q2 2 38 2" fill="none" stroke="#a9773c" stroke-width="2"/><circle cx="8" cy="30" r="2" fill="#a9773c"/><circle cx="30" cy="8" r="2" fill="#a9773c"/></svg></div>
      <div class="tc-corner tr"><svg viewBox="0 0 40 40"><path d="M2 38 Q2 2 38 2" fill="none" stroke="#a9773c" stroke-width="2"/><circle cx="8" cy="30" r="2" fill="#a9773c"/><circle cx="30" cy="8" r="2" fill="#a9773c"/></svg></div>
      <div class="tc-corner bl"><svg viewBox="0 0 40 40"><path d="M2 38 Q2 2 38 2" fill="none" stroke="#a9773c" stroke-width="2"/><circle cx="8" cy="30" r="2" fill="#a9773c"/><circle cx="30" cy="8" r="2" fill="#a9773c"/></svg></div>
      <div class="tc-corner br"><svg viewBox="0 0 40 40"><path d="M2 38 Q2 2 38 2" fill="none" stroke="#a9773c" stroke-width="2"/><circle cx="8" cy="30" r="2" fill="#a9773c"/><circle cx="30" cy="8" r="2" fill="#a9773c"/></svg></div>
      <div class="tc-watermark">نسخة أصلية</div>

      <div class="tc-body">
        <div class="tc-paid${stampPartial ? ' tc-partial':''}">${esc(stampLabel)}</div>
        <img src="${COMPANY_LOGO_DATA_URI}" alt="بن أرحب للتطوير العقاري" class="tc-logo">
        <div class="tc-ribbon">إيصال تحصيل رسمي</div>
        <div class="tc-co">قسم التسويق — إدارة المبيعات والعملاء</div>
        <div class="tc-co-details">
          رقم السجل التجاري: 1811487 — ص.ب. 2435، الرمز البريدي 133، الخوير، سلطنة عمان<br>
          محافظة مسقط / منطقة بوشر — الهاتف: +9689445559 — البريد الإلكتروني: info@binarha.om
        </div>
        <div class="tc-refno">رقم مرجعي: TC-${String(record.seq).padStart(5,"0")} &nbsp;|&nbsp; تاريخ الإصدار: ${fmtDate(todayISO())}</div>

        <table class="tc-table">
          <tr><td class="k">رقم إيصال التحصيل</td><td class="v" colspan="3">${esc(record.receiptNumber||"—")}</td></tr>
          <tr><td class="k">اسم العميل</td><td class="v">${esc(client.name)}</td><td class="k">كود العميل</td><td class="v">${esc(client.code)}</td></tr>
          <tr><td class="k">اسم الوحدة</td><td class="v">${esc(client.unit)}</td><td class="k">رقم العقد</td><td class="v">${esc(client.contractNumber||"—")}</td></tr>
          <tr><td class="k">البيان</td><td class="v k-red" colspan="3">${esc(instLabels)}</td></tr>
          <tr><td class="k">رقم الدفعة التعاقدية</td><td class="v" colspan="3">${esc(chq.chequeNumber||"—")}</td></tr>
          <tr><td class="k">تاريخ استحقاق الدفعة التعاقدية</td><td class="v">${esc(instDueDates)}</td><td class="k">قيمة استحقاق الدفعة التعاقدية</td><td class="v">${esc(instAmounts)} ر.ع</td></tr>
          <tr><td class="k">تاريخ التحصيل الفعلي</td><td class="v">${fmtDate(record.date)}</td><td class="k">طريقة التحصيل</td><td class="v">${esc(record.method)}</td></tr>
        </table>

        <div class="tc-amount">
          <div class="figure">المبلغ المحصَّل: ${fmt(record.amount)} ريال عماني</div>
          <div class="words">المبلغ كتابة: ${esc(amountWords)}</div>
        </div>

        <div class="tc-clarify">
          <strong>توضيح محاسبي:</strong> ${clarifyStatement}
        </div>

        <div class="tc-legal">
          <strong>ملحوظة قانونية:</strong> يُعد هذا الإيصال سندًا رسميًا صادرًا عن الشركة يُثبت التحصيل الفعلي للمبلغ الموضح أعلاه من العميل المذكور أعلاه، ويجوز الاحتجاج به قانونيًا كدليل قاطع على السداد في حدود المبلغ المحصَّل فعليًا. تحتفظ الشركة بنسخة من هذا الإيصال ضمن سجلاتها الرسمية.
        </div>

        <div class="tc-foot">
          <div class="tc-sign"><div class="line">توقيع المحاسب</div></div>
          <div class="tc-seal">ختم واعتماد<br>الشركة</div>
          <div class="tc-sign"><div class="line">توقيع/ختم العميل</div></div>
        </div>
      </div>
    </div>
  </div>`;

  showCollectionReceiptModal();
}

function showCollectionReceiptModal(){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="modal-bg no-print" id="collectionReceiptBg">
    <div class="modal" style="max-width:640px;max-height:88vh;overflow-y:auto;">
      <h3>تم تسجيل التحصيل بنجاح</h3>
      <p>إيصال التحصيل جاهز للطباعة.</p>
      <div class="modal-actions">
        <button class="btn btn-brass" id="btnDoPrintCollection">طباعة الإيصال</button>
        <button class="btn btn-ghost" id="btnCloseCollection">إغلاق</button>
      </div>
    </div>
  </div>`;
  document.getElementById("btnDoPrintCollection").addEventListener("click", ()=>window.print());
  document.getElementById("btnCloseCollection").addEventListener("click", ()=>{ root.innerHTML=""; render(); });
  document.getElementById("collectionReceiptBg").addEventListener("click", e=>{ if(e.target.id==="collectionReceiptBg"){ root.innerHTML=""; render(); } });
}

/* ============================= PRINT / EXPORT (reports) ============================= */
function printTable(tableId, title){
  const table = document.getElementById(tableId);
  if(!table){ toast("لا توجد بيانات للطباعة"); return; }
  const printArea = document.getElementById("printArea");
  printArea.innerHTML = `
    <div style="padding:30px;font-family:${'var(--sans)'.length?'"IBM Plex Sans Arabic",Tahoma,sans-serif':''};direction:rtl;">
      <h2 style="font-family:'Amiri',Georgia,serif;border-bottom:2px solid #a9773c;padding-bottom:10px;">${esc(title)}</h2>
      <div style="font-size:12px;color:#666;margin-bottom:14px;">تاريخ الطباعة: ${fmtDate(todayISO())}</div>
      ${table.outerHTML}
    </div>`;
  window.print();
}

function tableToAOA(tableId){
  const table = document.getElementById(tableId);
  const aoa = [];
  if(!table) return aoa;
  table.querySelectorAll("tr").forEach(tr=>{
    const row = [];
    tr.querySelectorAll("th,td").forEach(cell=>row.push(cell.textContent.trim()));
    aoa.push(row);
  });
  return aoa;
}

/* تصدير عام من مصفوفة بيانات (AOA) — يُستخدم لشاشات فيها جدول HTML فعلي أو لشاشات ذات بطاقات (مثل الإيصالات) */
function exportAOAExcel(aoa, filenameBase){
  if(!aoa || aoa.length===0){ toast("لا توجد بيانات للتصدير"); return; }
  if(window.XLSX){
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "تقرير");
    window.XLSX.writeFile(wb, filenameBase+".xlsx");
  } else {
    // CSV fallback with BOM for Arabic support in Excel
    const csv = aoa.map(row=>row.map(cell=>{
      const v = String(cell).replace(/"/g,'""');
      return /[",\n]/.test(v) ? `"${v}"` : v;
    }).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
    downloadBlob(blob, filenameBase+".csv");
  }
}

function exportAOAWord(aoa, title){
  if(!aoa || aoa.length===0){ toast("لا توجد بيانات للتصدير"); return; }
  const tableHtml = `<table>
    <thead><tr>${(aoa[0]||[]).map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${aoa.slice(1).map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <style>
      body{font-family:Arial, "Segoe UI", sans-serif;}
      table{border-collapse:collapse;width:100%;}
      th,td{border:1px solid #999;padding:6px 8px;text-align:right;font-size:13px;}
      th{background:#eee;}
      h2{font-family:Georgia,serif;}
    </style></head>
    <body dir="rtl">
      <h2>${esc(title)}</h2>
      <p style="font-size:12px;color:#555;">تاريخ التصدير: ${fmtDate(todayISO())}</p>
      ${tableHtml}
    </body></html>`;
  const blob = new Blob(['\ufeff', html], {type:"application/msword;charset=utf-8"});
  downloadBlob(blob, title.replace(/\s+/g,"_")+".doc");
}

function exportTableExcel(tableId, filenameBase){
  exportAOAExcel(tableToAOA(tableId), filenameBase);
}

function exportTableWord(tableId, title){
  exportAOAWord(tableToAOA(tableId), title);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

/* ============================= INIT ============================= */
initAuth();
if(currentUser){
  setView(firstAllowedView() || "collect");
}

})();
