import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, where, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnneTFty97_4QmcRFOV58AqDUTmzwqtLo",
  authDomain: "bunkhelper-7ae5b.firebaseapp.com",
  projectId: "bunkhelper-7ae5b",
  storageBucket: "bunkhelper-7ae5b.firebasestorage.app",
  messagingSenderId: "377239213325",
  appId: "1:377239213325:web:7fab96687d9f5585318c44",
  measurementId: "G-7ZSZX0SLEH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SLOTS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00"];
const ORDER = Object.fromEntries(DAYS.map((d,i)=>[d,i]));
const SUBJECTS = [
  "Consumer Behaviour",
  "The Bharatiya Nyaya Sanhita 2023 (IPC)",
  "Management Accounting",
  "Constitutional Law I",
  "Macroeconomics",
  "Business Ethics & CSR",
  "Environmental Management",
  "Law of Contracts II",
  "Business Ethics & CSR (T)",
  "Law of Contracts II (T)"
];

let currentUser = null;
let timetable = [];
let attendance = [];
let importedRows = [];
let unsubscribeTimetable = null;
let unsubscribeAttendance = null;
let target = Number(localStorage.getItem("bunkhelper-target") || 75);
let eventsBound = false;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

const localISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const todayName = () => new Date().toLocaleDateString("en-US", {weekday:"long"});
const todayLabel = () => new Date().toLocaleDateString("en-IN", {weekday:"long",day:"numeric",month:"long",year:"numeric"});
const minutes = (time) => {
  const [h,m] = String(time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const sortClasses = (items) => [...items].sort((a,b) =>
  (ORDER[a.day] ?? 99) - (ORDER[b.day] ?? 99) ||
  String(a.time || "").localeCompare(String(b.time || "")) ||
  String(a.subject || "").localeCompare(String(b.subject || ""))
);

function showToast(message, type = "info") {
  const host = $("toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span><button type="button">×</button>`;
  el.querySelector("button").onclick = () => el.remove();
  host.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function switchView(name) {
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.view !== name);
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
  $("page-title").textContent = {
    dashboard:"Dashboard", timetable:"Timetable", attendance:"Mark Attendance",
    history:"History", settings:"Settings"
  }[name] || "Dashboard";
  $("page-subtitle").textContent = {
    dashboard:"Your schedule and attendance at a glance.",
    timetable:"Save your weekly timetable once. Use it everywhere else.",
    attendance:"Pick a lecture, mark it present or absent, and move on.",
    history:"Every attendance record in one place.",
    settings:"Target percentage and data tools."
  }[name] || "";
  window.scrollTo({top:0, behavior:"smooth"});
}

function bindGoButtons() {
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.onclick = () => switchView(button.dataset.go);
  });
}

function findAttendance(subject, date, time = "") {
  return attendance.find((item) =>
    item.subject?.toLowerCase() === subject?.toLowerCase() &&
    item.date === date &&
    (!time || item.time === time)
  );
}

function findScheduledLecture(date, time) {
  if (!date || !time) return null;
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {weekday:"long"});
  const exact = timetable.find((item) => item.day === weekday && item.time === time);
  if (exact) return exact;
  const nearby = sortClasses(timetable.filter((item) => item.day === weekday))
    .sort((a,b)=>Math.abs(minutes(a.time)-minutes(time))-Math.abs(minutes(b.time)-minutes(time)))[0];
  return nearby && Math.abs(minutes(nearby.time)-minutes(time)) <= 20 ? nearby : null;
}

function refreshSubjectDropdown() {
  const select = $("att-subject");
  const previous = select.value;
  const subjects = [...new Set(timetable.map((item)=>item.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  select.innerHTML = subjects.length
    ? subjects.map((subject)=>`<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("")
    : '<option value="">No timetable classes</option>';
  select.disabled = !subjects.length;
  if (subjects.includes(previous)) select.value = previous;
  $("subject-hint").textContent = subjects.length
    ? "Subjects come directly from your saved timetable. Date + time will select the lecture automatically."
    : "Add your timetable first.";
}

function suggestLecture() {
  const match = findScheduledLecture($("att-date").value, $("att-time").value);
  if (!match) {
    $("suggestion-box").classList.add("hidden");
    return;
  }
  $("att-subject").value = match.subject;
  $("suggestion-box").innerHTML = `<strong>Scheduled lecture:</strong> ${escapeHtml(match.subject)} · ${escapeHtml(match.day)} ${escapeHtml(match.time)}`;
  $("suggestion-box").classList.remove("hidden");
}

function renderDashboardToday() {
  const classes = sortClasses(timetable.filter((item)=>item.day===todayName()));
  $("today-date").textContent = todayLabel();
  $("today-day-title").textContent = classes.length
    ? `${classes.length} ${classes.length === 1 ? "class" : "classes"} scheduled today`
    : "No classes scheduled today";
  $("today-classes-list").innerHTML = classes.length
    ? classes.map((item)=>{
        const record = findAttendance(item.subject, localISODate(), item.time);
        return `<button type="button" class="schedule-chip ${record?.status?.toLowerCase() || "upcoming"}"
          data-today-subject="${escapeHtml(item.subject)}" data-today-time="${escapeHtml(item.time)}">
          <span class="chip-time">${escapeHtml(item.time)}</span>
          <span class="chip-subject">${escapeHtml(item.subject)}</span>
          <span class="chip-status">${record ? escapeHtml(record.status) : "Mark"}</span>
        </button>`;
      }).join("")
    : '<div class="empty-inline">No classes scheduled for today.</div>';

  $("mini-timetable").innerHTML = classes.length
    ? classes.map((item)=>{
        const record = findAttendance(item.subject, localISODate(), item.time);
        return `<div class="mini-row"><span class="mini-time">${escapeHtml(item.time)}</span><span class="mini-subject">${escapeHtml(item.subject)}</span><span class="mini-arrow">${record ? escapeHtml(record.status) : "—"}</span></div>`;
      }).join("")
    : '<div class="empty-state compact"><div class="empty-icon">📅</div><h4>No classes today</h4><p>Your saved timetable will appear here.</p><button class="btn" type="button" data-go="timetable">Manage timetable</button></div>';
  bindGoButtons();

  $("attendance-today-preview").innerHTML = classes.length
    ? classes.map((item)=>{
        const record = findAttendance(item.subject, localISODate(), item.time);
        return `<div class="mini-row"><span class="mini-time">${escapeHtml(item.time)}</span><span class="mini-subject">${escapeHtml(item.subject)}</span><span class="mini-state">${record ? escapeHtml(record.status) : "Not marked"}</span></div>`;
      }).join("")
    : '<div class="hint">No classes scheduled today.</div>';
}

function renderTimetable() {
  $("timetable-count").textContent = `${timetable.length} ${timetable.length === 1 ? "class" : "classes"}`;
  $("full-timetable").innerHTML = DAYS.map((day)=>{
    const classes = sortClasses(timetable.filter((item)=>item.day===day));
    return `<section class="day-column ${day === todayName() ? "is-today" : ""}">
      <div class="day-header"><div><span class="day-name">${day}</span><span class="day-count">${classes.length} ${classes.length===1?"class":"classes"}</span></div>${day===todayName()?'<span class="today-badge">TODAY</span>':""}</div>
      <div class="day-items">${classes.length
        ? classes.map((item)=>`<div class="class-card"><div><span class="class-time">${escapeHtml(item.time)}</span><h4>${escapeHtml(item.subject)}</h4></div><button type="button" class="icon-btn" data-delete-tt="${item.id}">×</button></div>`).join("")
        : '<div class="day-empty">No classes</div>'}</div>
    </section>`;
  }).join("");
}

function renderStats() {
  const effective = attendance.filter((item)=>item.status !== "Cancelled");
  const attended = effective.filter((item)=>item.status==="Present").length;
  const missed = effective.filter((item)=>item.status==="Absent").length;
  const percent = effective.length ? Math.round(attended/effective.length*100) : 0;

  $("overall-percentage").textContent = `${percent}%`;
  $("total-classes").textContent = effective.length;
  $("total-attended").textContent = attended;
  $("total-missed").textContent = missed;
  $("target-inline").textContent = `${target}%`;
  $("target-threshold").value = String(target);
  $("target-summary").innerHTML = `<div class="target-number">${target}%</div><div><strong>Target</strong><p>Current overall: <b>${percent}%</b></p></div>`;

  const subjects = {};
  effective.forEach((item)=>{
    subjects[item.subject] ||= {present:0,total:0};
    subjects[item.subject].total++;
    if (item.status==="Present") subjects[item.subject].present++;
  });

  const rows = Object.entries(subjects);
  $("subject-analytics").innerHTML = rows.length
    ? rows.map(([subject,data])=>{
        const pct = Math.round(data.present/data.total*100);
        const ratio = target/100;
        if (pct >= target) {
          const bunks = Math.max(0, Math.floor((data.present - ratio*data.total)/ratio));
          const advice = bunks
            ? `You can miss ${bunks} more class${bunks===1?"":"es"} and stay at ${target}%.`
            : `At ${target}%. Keep attending.`;
          return `<div class="subject-stat"><div class="subject-stat-top"><div><h4>${escapeHtml(subject)}</h4><span>${data.present}/${data.total} attended</span></div><strong class="good">${pct}%</strong></div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span><i style="left:${target}%"></i></div><p>${escapeHtml(advice)}</p></div>`;
        }
        const needed = Math.max(1, Math.ceil((ratio*data.total - data.present)/(1-ratio)));
        const advice = `Attend the next ${needed} class${needed===1?"":"es"} to reach ${target}%.`;
        return `<div class="subject-stat"><div class="subject-stat-top"><div><h4>${escapeHtml(subject)}</h4><span>${data.present}/${data.total} attended</span></div><strong class="bad">${pct}%</strong></div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span><i style="left:${target}%"></i></div><p>${escapeHtml(advice)}</p></div>`;
      }).join("")
    : '<div class="empty-state compact"><div class="empty-icon">📊</div><h3>No analytics yet</h3><p>Mark attendance and your subject statistics will appear here.</p></div>';
}

function renderHistory() {
  const rows = [...attendance].sort((a,b)=>`${b.date} ${b.time||""}`.localeCompare(`${a.date} ${a.time||""}`));
  $("history-list").innerHTML = rows.length
    ? `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Status</th><th>Type</th><th></th></tr></thead><tbody>
      ${rows.map((item)=>`<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(item.subject)}</strong></td><td>${escapeHtml(item.time||"—")}</td><td><span class="status-pill ${String(item.status).toLowerCase()}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.type||"Regular")}</td><td><button type="button" class="text-btn danger" data-delete-att="${item.id}">Delete</button></td></tr>`).join("")}
    </tbody></table></div>`
    : '<div class="empty-state compact"><div class="empty-icon">✓</div><h3>No attendance logged</h3><p>Your attendance records will appear here.</p></div>';
}

function renderAll() {
  renderDashboardToday();
  renderTimetable();
  renderStats();
  renderHistory();
  refreshSubjectDropdown();
  suggestLecture();
}

async function deleteRecord(collectionName,id) {
  if (!confirm("Delete this record?")) return;
  try {
    await deleteDoc(doc(db,collectionName,id));
    showToast("Deleted.","success");
  } catch(error) {
    console.error(error);
    showToast("Could not delete record. Check Firestore rules.","error");
  }
}

async function saveAttendance(status) {
  const subject=$("att-subject").value;
  const date=$("att-date").value;
  const time=$("att-time").value;
  const type=$("att-type").value;
  if(!subject||!date||!time){showToast("Choose a lecture, date and time first.","warning");return;}
  if(findAttendance(subject,date,time)){showToast("That lecture is already recorded for this date/time.","warning");return;}
  try {
    await addDoc(collection(db,"attendance"),{uid:currentUser.uid,subject,date,time,status,type,timetableMatch:Boolean(findScheduledLecture(date,time))});
    showToast(`${status}: ${subject}`,status==="Present"?"success":"warning");
  } catch(error) {
    console.error(error);
    showToast("Could not save attendance. Check Firestore rules.","error");
  }
}

async function clearTimetable() {
  if(!timetable.length){showToast("Your timetable is already empty.","info");return;}
  if(!confirm(`Delete all ${timetable.length} timetable classes?`)) return;
  try {
    const batch=writeBatch(db);
    timetable.forEach((item)=>batch.delete(doc(db,"timetables",item.id)));
    await batch.commit();
    showToast("Timetable cleared.","success");
  } catch(error) {
    console.error(error);
    showToast("Could not clear timetable.","error");
  }
}

async function addSampleTimetable() {
  const sample=[
    ["Monday","09:00","Constitutional Law I"],["Monday","10:00","Law of Contracts II"],
    ["Tuesday","09:00","Consumer Behaviour"],["Tuesday","10:00","Management Accounting"],
    ["Wednesday","09:00","The Bharatiya Nyaya Sanhita 2023 (IPC)"],["Wednesday","10:00","Macroeconomics"],
    ["Thursday","09:00","Business Ethics & CSR"],["Thursday","10:00","Environmental Management"],
    ["Friday","09:00","Constitutional Law I"],["Friday","10:00","Law of Contracts II"]
  ];
  try {
    const batch=writeBatch(db);
    sample.forEach(([day,time,subject])=>{const ref=doc(collection(db,"timetables"));batch.set(ref,{uid:currentUser.uid,day,time,subject})});
    await batch.commit();
    showToast("Sample timetable added.","info");
  } catch(error) {
    console.error(error);
    showToast("Could not add sample timetable.","error");
  }
}

function renderImportRows() {
  const host=$("import-preview-list");
  if(!importedRows.length){
    host.innerHTML='<div class="empty-inline">No timetable classes detected yet. Upload your timetable screenshot.</div>';
    $("save-import-btn").disabled=true;
    return;
  }
  host.innerHTML=importedRows.map((row,index)=>`<div class="import-row"><input type="checkbox" data-import-check="${index}" ${row.selected?"checked":""} aria-label="Select row"><select data-import-day="${index}">${DAYS.map(day=>`<option ${row.day===day?"selected":""}>${day}</option>`).join("")}</select><input type="time" data-import-time="${index}" value="${escapeHtml(row.time)}"><input type="text" data-import-subject="${index}" value="${escapeHtml(row.subject)}"><button type="button" class="text-btn danger" data-remove-import="${index}">Remove</button></div>`).join("");
  $("save-import-btn").disabled=!importedRows.some(row=>row.selected&&row.subject.trim()&&row.time);
}

async function loadImage(file) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(img.src);resolve(img)};
    img.onerror=reject;
    img.src=URL.createObjectURL(file);
  });
}

function cleanOCRText(value) {
  return String(value||"").replace(/[|•·]+/g," ").replace(/\s+/g," ").trim();
}

function canonicalSubject(raw) {
  const s=cleanOCRText(raw);
  const n=s.toLowerCase().replace(/[^a-z0-9()]+/g," ").replace(/\s+/g," ").trim();
  if(!n||/^(break|lunch|recess|holiday|free|off)$/.test(n)) return "";
  if(/consumer/.test(n)&&/behav/.test(n)) return "Consumer Behaviour";
  if(/bharatiya|nyaya|sanhita/.test(n)) return "The Bharatiya Nyaya Sanhita 2023 (IPC)";
  if(/management/.test(n)&&/account/.test(n)) return "Management Accounting";
  if(/constitutional/.test(n)&&/law/.test(n)) return "Constitutional Law I";
  if(/macro/.test(n)) return "Macroeconomics";
  if(/business/.test(n)&&/ethic/.test(n)) return /\(\s*t\s*\)/.test(n)?"Business Ethics & CSR (T)":"Business Ethics & CSR";
  if(/environmental/.test(n)&&/manage/.test(n)) return "Environmental Management";
  if(/contract/.test(n)&&/(ii|2)/.test(n)) return /\(\s*t\s*\)/.test(n)?"Law of Contracts II (T)":"Law of Contracts II";
  return s;
}

async function ocrCell(worker,img,x0,y0,x1,y1,scale) {
  const pad=4;
  const sx=Math.max(0,Math.floor(x0/scale)+pad);
  const sy=Math.max(0,Math.floor(y0/scale)+pad);
  const sw=Math.max(20,Math.floor((x1-x0)/scale)-pad*2);
  const sh=Math.max(20,Math.floor((y1-y0)/scale)-pad*2);
  const source=document.createElement("canvas");
  source.width=sw; source.height=sh;
  const sc=source.getContext("2d",{willReadFrequently:true});
  sc.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
  const pixels=sc.getImageData(0,0,sw,sh);
  for(let i=0;i<pixels.data.length;i+=4){
    const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
    const min=Math.min(r,g,b),max=Math.max(r,g,b);
    const nearWhite=min>110&&(max-min)<75;
    const nearGray=(max-min)<30&&(r+g+b)/3>135;
    const v=(nearWhite||nearGray)?255:0;
    pixels.data[i]=v;pixels.data[i+1]=v;pixels.data[i+2]=v;pixels.data[i+3]=255;
  }
  sc.putImageData(pixels,0,0);
  const out=document.createElement("canvas");
  out.width=sw*3;out.height=sh*3;
  const oc=out.getContext("2d");
  oc.imageSmoothingEnabled=false;
  oc.drawImage(source,0,0,out.width,out.height);
  const result=await worker.recognize(out);
  return cleanOCRText(result.data?.text||"");
}

async function parseUploadedTimetable(file) {
  const img=await loadImage(file);
  const W=img.naturalWidth,H=img.naturalHeight,ratio=W/H;
  if(ratio<2.8||ratio>3.7) throw new Error("unsupported-layout");

  // Exact normalized grid for the user's timetable: one label column + eight hourly slots.
  const X=[0,114,275,443,589,687,804,975,1096,1161].map(v=>v/1161);
  const Y=[0,44,94,145,202,246,291,357].map(v=>v/357);
  const scale=Math.min(1,1600/W);
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const x=X.map(v=>Math.round(v*canvas.width)),y=Y.map(v=>Math.round(v*canvas.height));

  const worker=await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({tessedit_pageseg_mode:"6"});
    const candidates=[];
    let total=0;
    for(let r=0;r<6;r++) for(let c=1;c<=8;c++) {
      const x0=x[c],x1=x[c+1],y0=y[r+1],y1=y[r+2];
      const sample=ctx.getImageData(x0+3,y0+3,Math.max(10,x1-x0-6),Math.max(10,y1-y0-6)).data;
      let saturation=0,luminance=0,n=sample.length/4;
      for(let i=0;i<sample.length;i+=4){
        const rr=sample[i],gg=sample[i+1],bb=sample[i+2];
        saturation+=Math.max(rr,gg,bb)-Math.min(rr,gg,bb);
        luminance+=(rr+gg+bb)/3;
      }
      const sat=saturation/n/255,lum=luminance/n/255;
      const candidate=sat>.07||lum>.45;
      candidates.push({r,c,x0,x1,y0,y1,candidate});
      if(candidate) total++;
    }

    let done=0;
    const rows=[];
    for(const cell of candidates){
      if(!cell.candidate) continue;
      done++;
      $("ocr-status").textContent=`Reading class cells… ${done}/${total}`;
      const raw=await ocrCell(worker,img,cell.x0,cell.y0,cell.x1,cell.y1,scale);
      const subject=canonicalSubject(raw);
      if(!subject) continue;
      rows.push({day:DAYS[cell.r],time:SLOTS[cell.c-1],subject,selected:true});
    }
    const seen=new Set();
    return rows.filter((row)=>{
      const key=`${row.day}|${row.time}|${row.subject.toLowerCase()}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } finally {
    await worker.terminate();
  }
}

async function saveImported() {
  const rows=[];
  importedRows.forEach((row,index)=>{
    const checked=$(`input[data-import-check="${index}"]`)?.checked;
    const day=$(`select[data-import-day="${index}"]`)?.value;
    const time=$(`input[data-import-time="${index}"]`)?.value;
    const subject=cleanOCRText($(`input[data-import-subject="${index}"]`)?.value);
    if(checked&&day&&time&&subject) rows.push({day,time,subject});
  });
  if(!rows.length){showToast("Select at least one valid class to save.","warning");return;}
  try {
    const batch=writeBatch(db);
    if($("replace-timetable").checked) timetable.forEach((item)=>batch.delete(doc(db,"timetables",item.id)));
    const existing=new Set($("replace-timetable").checked?[]:timetable.map((x)=>`${x.day}|${x.time}|${x.subject.toLowerCase()}`));
    let added=0;
    for(const row of rows){
      const key=`${row.day}|${row.time}|${row.subject.toLowerCase()}`;
      if(existing.has(key)) continue;
      const ref=doc(collection(db,"timetables"));
      batch.set(ref,{uid:currentUser.uid,day:row.day,time:row.time,subject:row.subject});
      existing.add(key);added++;
    }
    await batch.commit();
    importedRows=[];
    renderImportRows();
    $("replace-timetable").checked=false;
    $("ocr-status").textContent=`Saved ${added} timetable ${added===1?"class":"classes"}.`;
    showToast(`${added} timetable ${added===1?"class":"classes"} saved.`,"success");
  } catch(error) {
    console.error(error);
    showToast("Could not save imported timetable. Check Firestore rules.","error");
  }
}

function bindEvents() {
  if(eventsBound) return;
  eventsBound=true;
  document.querySelectorAll("[data-nav]").forEach((button)=>button.onclick=()=>switchView(button.dataset.nav));
  bindGoButtons();
  $("logout-btn").onclick=()=>signOut(auth);
  $("week-view-btn").onclick=()=>switchView("timetable");
  $("history-view-btn").onclick=()=>switchView("history");

  $("target-threshold").value=String(target);
  $("target-threshold").onchange=(event)=>{target=Number(event.target.value);localStorage.setItem("bunkhelper-target",String(target));renderStats()};
  $("att-date").value=localISODate();
  $("att-time").value=new Date().toTimeString().slice(0,5);
  $("att-date").oninput=suggestLecture;
  $("att-time").oninput=suggestLecture;
  $("attendance-form").onsubmit=async(event)=>{
    event.preventDefault();
    await saveAttendance($("att-status").value);
    event.target.reset();
    $("att-date").value=localISODate();
    $("att-time").value=new Date().toTimeString().slice(0,5);
    refreshSubjectDropdown();
    suggestLecture();
  };
  $("quick-present").onclick=()=>saveAttendance("Present");
  $("quick-absent").onclick=()=>saveAttendance("Absent");

  $("timetable-form").onsubmit=async(event)=>{
    event.preventDefault();
    const subject=$("subject-input").value.trim(),day=$("day-input").value,time=$("time-input").value;
    if(!subject||!day||!time) return;
    try {
      await addDoc(collection(db,"timetables"),{uid:currentUser.uid,subject,day,time});
      event.target.reset();
      showToast("Class added to timetable.","success");
    } catch(error) {
      console.error(error);showToast("Could not add class. Check Firestore rules.","error");
    }
  };

  $("full-timetable").onclick=(event)=>{
    const id=event.target.closest("[data-delete-tt]")?.dataset.deleteTt;
    if(id) deleteRecord("timetables",id);
  };
  $("history-list").onclick=(event)=>{
    const id=event.target.closest("[data-delete-att]")?.dataset.deleteAtt;
    if(id) deleteRecord("attendance",id);
  };
  $("today-classes-list").onclick=(event)=>{
    const item=event.target.closest("[data-today-subject]");
    if(!item)return;
    switchView("attendance");
    $("att-subject").value=item.dataset.todaySubject;
    $("att-date").value=localISODate();
    $("att-time").value=item.dataset.todayTime;
    $("att-status").value="Present";
    suggestLecture();
  };

  $("upload-img-btn").onclick=()=>$ ("ocr-file-input").click();
  $("ocr-file-input").onchange=async(event)=>{
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    importedRows=[];renderImportRows();
    try {
      $("ocr-status").textContent="Preparing timetable…";
      importedRows=await parseUploadedTimetable(file);
      renderImportRows();
      if(importedRows.length){
        $("ocr-status").textContent=`Detected ${importedRows.length} candidate ${importedRows.length===1?"class":"classes"}. Review them below before saving.`;
        showToast("Timetable detected. Review the rows before saving.","success");
      } else {
        $("ocr-status").textContent="No coloured timetable cells could be read.";
        showToast("The timetable cells could not be read.","warning");
      }
    } catch(error) {
      console.error(error);
      $("ocr-status").textContent=error.message==="unsupported-layout"?"This image does not match the expected timetable layout.":"Could not read this timetable image.";
      showToast("Timetable import failed. You can still use manual entry.","error");
    }
  };

  $("save-import-btn").onclick=saveImported;
  $("clear-import-btn").onclick=()=>{importedRows=[];renderImportRows();$("ocr-status").textContent="Nothing imported yet.";$ ("ocr-preview").textContent="No OCR output available for cell-by-cell import.";};
  $("import-preview-list").addEventListener("input",(event)=>{
    const value=event.target.dataset.importCheck??event.target.dataset.importDay??event.target.dataset.importTime??event.target.dataset.importSubject;
    if(value===undefined)return;
    const index=Number(value);if(!Number.isInteger(index)||!importedRows[index])return;
    if(event.target.dataset.importCheck!==undefined) importedRows[index].selected=event.target.checked;
    if(event.target.dataset.importDay!==undefined) importedRows[index].day=event.target.value;
    if(event.target.dataset.importTime!==undefined) importedRows[index].time=event.target.value;
    if(event.target.dataset.importSubject!==undefined) importedRows[index].subject=event.target.value;
    $("save-import-btn").disabled=!importedRows.some(row=>row.selected&&row.subject.trim()&&row.time);
  });
  $("import-preview-list").addEventListener("click",(event)=>{
    const raw=event.target.closest("[data-remove-import]")?.dataset.removeImport;
    if(raw===undefined)return;importedRows.splice(Number(raw),1);renderImportRows();
  });
  $("sample-timetable-btn").onclick=addSampleTimetable;
  $("clear-timetable-btn").onclick=clearTimetable;
  $("export-btn").onclick=()=>{
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),target,timetable,attendance},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="bunkhelper-backup.json";a.click();URL.revokeObjectURL(url);showToast("Backup exported.","success");
  };
  renderImportRows();
}

function startRealtimeListeners() {
  if(unsubscribeTimetable) unsubscribeTimetable();
  if(unsubscribeAttendance) unsubscribeAttendance();
  unsubscribeTimetable=onSnapshot(query(collection(db,"timetables"),where("uid","==",currentUser.uid)),(snapshot)=>{
    timetable=snapshot.docs.map((d)=>({id:d.id,...d.data()}));renderAll();
  },(error)=>{console.error(error);showToast("Timetable could not be loaded. Check Firestore rules.","error")});
  unsubscribeAttendance=onSnapshot(query(collection(db,"attendance"),where("uid","==",currentUser.uid)),(snapshot)=>{
    attendance=snapshot.docs.map((d)=>({id:d.id,...d.data()}));renderStats();renderHistory();renderDashboardToday();
  },(error)=>{console.error(error);showToast("Attendance could not be loaded. Check Firestore rules.","error")});
}

$("login-btn").onclick=async()=>{
  try { await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,new GoogleAuthProvider()); }
  catch(error){ console.error(error);showToast("Login failed: "+error.message,"error"); }
};

onAuthStateChanged(auth,(user)=>{
  if(user){
    currentUser=user;
    $("auth-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    $("user-name").textContent=user.displayName||user.email||"Student";
    $("user-avatar").src=user.photoURL||"https://ui-avatars.com/api/?name=Student&background=171c2d&color=fff";
    bindEvents();
    startRealtimeListeners();
    switchView("dashboard");
  } else {
    currentUser=null;timetable=[];attendance=[];
    if(unsubscribeTimetable)unsubscribeTimetable();
    if(unsubscribeAttendance)unsubscribeAttendance();
    $("auth-screen").classList.remove("hidden");
    $("app-screen").classList.add("hidden");
  }
});
