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
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = Object.fromEntries(DAYS.map((day, index) => [day, index]));

let currentUser = null;
let timetable = [];
let attendance = [];
let unsubscribeTimetable = null;
let unsubscribeAttendance = null;
let target = Number(localStorage.getItem("bunkhelper-target") || 75);
let importedRows = [];
let eventsBound = false;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const localISODate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const todayName = () => new Date().toLocaleDateString("en-US", { weekday: "long" });
const displayToday = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const minutes = (time) => { const parts = String(time || "00:00").split(":").map(Number); return (parts[0] || 0) * 60 + (parts[1] || 0); };
const sortClasses = (items) => [...items].sort((a, b) => (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99) || String(a.time || "").localeCompare(String(b.time || "")) || String(a.subject || "").localeCompare(String(b.subject || "")));

function showToast(message, type = "info") { const host = $("toast-host"); if (!host) return; const toast = document.createElement("div"); toast.className = `toast toast-${type}`; toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button">×</button>`; toast.querySelector("button").onclick = () => toast.remove(); host.appendChild(toast); setTimeout(() => toast.remove(), 4000); }
function switchView(viewName) { document.querySelectorAll("[data-view]").forEach((section) => section.classList.toggle("hidden", section.dataset.view !== viewName)); document.querySelectorAll("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === viewName)); $("page-title").textContent = ({ dashboard: "Dashboard", timetable: "Timetable", attendance: "Mark Attendance", history: "History", settings: "Settings" })[viewName] || "Dashboard"; window.scrollTo({ top: 0, behavior: "smooth" }); }
function bindGoButtons() { document.querySelectorAll("[data-go]").forEach((button) => button.onclick = () => switchView(button.dataset.go)); }

function findScheduledLecture(date, time) {
  if (!date || !time) return null;
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const sameDay = timetable.filter((item) => item.day === weekday);
  const exact = sameDay.find((item) => item.time === time);
  if (exact) return exact;
  const targetMinutes = minutes(time);
  const nearest = [...sameDay].sort((a, b) => Math.abs(minutes(a.time) - targetMinutes) - Math.abs(minutes(b.time) - targetMinutes))[0];
  return nearest && Math.abs(minutes(nearest.time) - targetMinutes) <= 30 ? nearest : null;
}
function findAttendance(subject, date, time = "") { return attendance.find((item) => item.subject?.toLowerCase() === subject?.toLowerCase() && item.date === date && (!time || item.time === time)); }
function refreshSubjectDropdown() {
  const select = $("att-subject");
  const previous = select.value;
  const subjects = [...new Set(timetable.map((item) => item.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = subjects.length ? subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("") : '<option value="">No timetable classes</option>';
  select.disabled = !subjects.length;
  if (subjects.includes(previous)) select.value = previous;
  $("subject-hint").textContent = subjects.length ? "Your subject list comes from the saved timetable. Enter date + time to get the scheduled lecture." : "Add your weekly timetable first.";
}
function suggestLecture() { const match = findScheduledLecture($("att-date").value, $("att-time").value); if (!match) { $("suggestion-box").classList.add("hidden"); return; } $("att-subject").value = match.subject; $("suggestion-box").innerHTML = `<strong>Scheduled lecture:</strong> ${escapeHtml(match.subject)} · ${escapeHtml(match.day)} ${escapeHtml(match.time)}`; $("suggestion-box").classList.remove("hidden"); }

function renderToday() {
  const classes = sortClasses(timetable.filter((item) => item.day === todayName()));
  $("today-date").textContent = displayToday();
  $("today-day-title").textContent = classes.length ? `${classes.length} ${classes.length === 1 ? "class" : "classes"} scheduled today` : "No classes scheduled today";
  const host = $("today-classes-list");
  host.innerHTML = classes.length ? "" : '<div class="empty-inline">No classes scheduled for today.</div>';
  classes.forEach((item) => { const record = findAttendance(item.subject, localISODate(), item.time); const state = record?.status === "Present" ? "present" : record?.status === "Absent" ? "absent" : "upcoming"; host.insertAdjacentHTML("beforeend", `<button type="button" class="schedule-chip ${state}" data-today-subject="${escapeHtml(item.subject)}" data-today-time="${escapeHtml(item.time)}"><span class="chip-time">${escapeHtml(item.time)}</span><span class="chip-subject">${escapeHtml(item.subject)}</span><span class="chip-status">${record ? escapeHtml(record.status) : "Mark"}</span></button>`); });
}
function renderMiniTimetable() { const classes = sortClasses(timetable.filter((item) => item.day === todayName())); $("mini-timetable").innerHTML = classes.length ? classes.map((item) => `<div class="mini-row"><span class="mini-time">${escapeHtml(item.time)}</span><span class="mini-subject">${escapeHtml(item.subject)}</span><span class="mini-arrow">→</span></div>`).join("") : '<div class="empty-state compact"><div class="empty-icon">📅</div><h4>No classes today</h4><p>Your saved schedule will appear here.</p><button class="btn" type="button" data-go="timetable">Manage timetable</button></div>'; bindGoButtons(); }
function renderTimetable() { $("timetable-count").textContent = `${timetable.length} ${timetable.length === 1 ? "class" : "classes"}`; $("full-timetable").innerHTML = DAYS.map((day) => { const classes = sortClasses(timetable.filter((item) => item.day === day)); return `<section class="day-column ${day === todayName() ? "is-today" : ""}"><div class="day-header"><div><span class="day-name">${day}</span><span class="day-count">${classes.length} ${classes.length === 1 ? "class" : "classes"}</span></div>${day === todayName() ? '<span class="today-badge">TODAY</span>' : ""}</div><div class="day-items">${classes.length ? classes.map((item) => `<div class="class-card"><div><span class="class-time">${escapeHtml(item.time)}</span><h4>${escapeHtml(item.subject)}</h4></div><button type="button" class="icon-btn" data-delete-tt="${item.id}">×</button></div>`).join("") : '<div class="day-empty">No classes</div>'}</div></section>`; }).join(""); }
function renderStats() {
  const effective = attendance.filter((item) => item.status !== "Cancelled");
  const attended = effective.filter((item) => item.status === "Present").length;
  const missed = effective.filter((item) => item.status === "Absent").length;
  const pct = effective.length ? Math.round(attended / effective.length * 100) : 0;
  $("overall-percentage").textContent = `${pct}%`; $("total-classes").textContent = effective.length; $("total-attended").textContent = attended; $("total-missed").textContent = missed; $("target-inline").textContent = `${target}%`; $("target-threshold").value = String(target);
  const subjects = {};
  effective.forEach((item) => { subjects[item.subject] ||= { present: 0, total: 0 }; subjects[item.subject].total += 1; if (item.status === "Present") subjects[item.subject].present += 1; });
  const rows = Object.entries(subjects).sort(([a], [b]) => a.localeCompare(b));
  $("subject-analytics").innerHTML = rows.length ? rows.map(([subject, data]) => { const percentage = Math.round(data.present / data.total * 100); const ratio = target / 100; let advice; if (percentage >= target) { const bunks = Math.max(0, Math.floor((data.present - ratio * data.total) / ratio)); advice = bunks ? `You can miss ${bunks} more class${bunks === 1 ? "" : "es"} and stay at ${target}%.` : `At ${target}%. Keep attending.`; } else { const needed = Math.max(0, Math.ceil((ratio * data.total - data.present) / (1 - ratio))); advice = `Attend the next ${needed} class${needed === 1 ? "" : "es"} to reach ${target}%.`; } return `<div class="subject-stat"><div class="subject-stat-top"><div><h4>${escapeHtml(subject)}</h4><span>${data.present}/${data.total} attended</span></div><strong class="${percentage >= target ? "good" : "bad"}">${percentage}%</strong></div><div class="progress"><span style="width:${Math.min(100, percentage)}%"></span><i style="left:${target}%"></i></div><p>${escapeHtml(advice)}</p></div>`; }).join("") : '<div class="empty-state compact"><div class="empty-icon">📊</div><h3>No analytics yet</h3><p>Mark attendance and subject-wise stats will appear here.</p></div>';
  $("target-summary").innerHTML = `<div class="target-number">${target}%</div><div><strong>Target</strong><p>Current overall: <b>${pct}%</b></p></div>`;
}
function renderHistory() { const items = [...attendance].sort((a, b) => `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`)); $("history-list").innerHTML = items.length ? `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Status</th><th>Type</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(item.subject)}</strong></td><td>${escapeHtml(item.time || "—")}</td><td><span class="status-pill ${String(item.status).toLowerCase()}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.type || "Regular")}</td><td><button type="button" class="text-btn danger" data-delete-att="${item.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state compact"><div class="empty-icon">✓</div><h3>No attendance logged</h3><p>Your attendance records will appear here.</p></div>'; }

function parseTime(value) { const match = String(value).match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)?\b/i); if (!match) return null; let hour = Number(match[1]); const minute = Number(match[2] || 0); const meridiem = match[3]?.toUpperCase(); if (minute > 59 || hour > 23) return null; if (meridiem === "PM" && hour < 12) hour += 12; if (meridiem === "AM" && hour === 12) hour = 0; if (!meridiem && hour < 7) hour += 12; return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; }
function detectDay(line) { return DAYS.find((day) => line.toLowerCase().includes(day.toLowerCase())) || null; }
function cleanSubject(value) { return String(value || "").replace(/[|•·]+/g, " ").replace(/\s+/g, " ").replace(/^[-–—:]+|[-–—:]+$/g, "").trim(); }

// Important: OCR creates an editable staging table. It never writes guessed data directly to Firestore.
function parseOCRText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows = [];
  let activeDay = null;
  lines.forEach((rawLine) => {
    let line = rawLine;
    const day = detectDay(line);
    if (day) { activeDay = day; line = line.replace(new RegExp(day, "ig"), " ").trim(); }
    if (!activeDay) return;
    const timeMatch = line.match(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM)?\b/i);
    if (!timeMatch) return;
    const time = parseTime(timeMatch[0]);
    if (!time) return;
    const subject = cleanSubject(line.replace(timeMatch[0], ""));
    if (!subject || subject.length < 2 || /^(break|lunch|recess|holiday|free|off|room|faculty)$/i.test(subject)) return;
    rows.push({ day: activeDay, time, subject, selected: true });
  });
  const seen = new Set();
  return rows.filter((row) => { const key = `${row.day}|${row.time}|${row.subject.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function renderImportReview() {
  const host = $("import-preview-list");
  if (!importedRows.length) { host.innerHTML = '<div class="empty-inline">No timetable rows were confidently detected. Try a clearer screenshot or use manual entry.</div>'; $("save-import-btn").disabled = true; return; }
  host.innerHTML = importedRows.map((row, index) => `<div class="import-row"><input type="checkbox" data-import-check="${index}" ${row.selected ? "checked" : ""}><select data-import-day="${index}">${DAYS.map((day) => `<option ${day === row.day ? "selected" : ""}>${day}</option>`).join("")}</select><input type="time" data-import-time="${index}" value="${escapeHtml(row.time)}"><input type="text" data-import-subject="${index}" value="${escapeHtml(row.subject)}"><button type="button" class="text-btn danger" data-remove-import="${index}">Remove</button></div>`).join("");
  $("save-import-btn").disabled = !importedRows.some((row) => row.selected && row.subject.trim() && row.time);
}
async function saveImportedRows() {
  const selected = importedRows.filter((row) => row.selected && row.subject.trim() && row.time);
  if (!selected.length) return;
  try { const batch = writeBatch(db); selected.forEach((row) => { const ref = doc(collection(db, "timetables")); batch.set(ref, { uid: currentUser.uid, subject: row.subject.trim(), day: row.day, time: row.time }); }); await batch.commit(); importedRows = []; renderImportReview(); $("ocr-status").textContent = `Saved ${selected.length} timetable ${selected.length === 1 ? "class" : "classes"}.`; showToast("Imported timetable saved.", "success"); } catch (error) { console.error(error); showToast("Could not save the imported timetable. Check Firestore rules.", "error"); }
}
async function deleteRecord(collectionName, id) { if (!confirm("Delete this record?")) return; try { await deleteDoc(doc(db, collectionName, id)); } catch (error) { console.error(error); showToast("Could not delete record.", "error"); } }
async function saveAttendance(status) { const subject = $("att-subject").value; const date = $("att-date").value; const time = $("att-time").value; const type = $("att-type").value; if (!subject || !date || !time) { showToast("Choose a lecture, date and time first.", "warning"); return; } if (findAttendance(subject, date, time)) { showToast("That lecture is already recorded for this date and time.", "warning"); return; } await addDoc(collection(db, "attendance"), { uid: currentUser.uid, subject, date, time, status, type, timetableMatch: Boolean(findScheduledLecture(date, time)) }); showToast(`${status}: ${subject}`, status === "Present" ? "success" : "warning"); }
async function clearTimetable() { if (!timetable.length) return; if (!confirm(`Delete all ${timetable.length} timetable classes?`)) return; try { const batch = writeBatch(db); timetable.forEach((item) => batch.delete(doc(db, "timetables", item.id))); await batch.commit(); showToast("Timetable cleared.", "success"); } catch (error) { console.error(error); showToast("Could not clear timetable.", "error"); } }
async function addSampleTimetable() { const sample = [["Monday","09:00","Constitutional Law I"],["Monday","10:00","Law of Contracts II"],["Tuesday","09:00","Consumer Behaviour"],["Tuesday","10:00","Management Accounting"],["Wednesday","09:00","The Bharatiya Nyaya Sanhita 2023"],["Wednesday","10:00","Macroeconomics"],["Thursday","09:00","Business Ethics & CSR"],["Thursday","10:00","Environmental Management"],["Friday","09:00","Constitutional Law I"],["Friday","10:00","Law of Contracts II"]]; try { const batch = writeBatch(db); sample.forEach(([day,time,subject]) => { const ref = doc(collection(db, "timetables")); batch.set(ref, { uid: currentUser.uid, day, time, subject }); }); await batch.commit(); showToast("Sample timetable added.", "info"); } catch (error) { console.error(error); showToast("Could not add sample timetable.", "error"); } }

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.querySelectorAll("[data-nav]").forEach((button) => button.onclick = () => switchView(button.dataset.nav));
  bindGoButtons();
  $("logout-btn").onclick = () => signOut(auth);
  $("week-view-btn").onclick = () => switchView("timetable");
  $("history-view-btn").onclick = () => switchView("history");
  $("target-threshold").value = String(target);
  $("target-threshold").onchange = (event) => { target = Number(event.target.value); localStorage.setItem("bunkhelper-target", String(target)); renderStats(); };
  $("att-date").value = localISODate();
  $("att-time").value = new Date().toTimeString().slice(0, 5);
  ["att-date", "att-time"].forEach((id) => $(id).addEventListener("input", suggestLecture));
  $("attendance-form").onsubmit = async (event) => { event.preventDefault(); try { await saveAttendance($("att-status").value); event.target.reset(); $("att-date").value = localISODate(); $("att-time").value = new Date().toTimeString().slice(0, 5); refreshSubjectDropdown(); suggestLecture(); } catch (error) { console.error(error); showToast("Could not save attendance. Check Firestore rules.", "error"); } };
  $("quick-present").onclick = () => saveAttendance("Present").catch((error) => { console.error(error); showToast("Could not save attendance.", "error"); });
  $("quick-absent").onclick = () => saveAttendance("Absent").catch((error) => { console.error(error); showToast("Could not save attendance.", "error"); });
  $("timetable-form").onsubmit = async (event) => { event.preventDefault(); try { await addDoc(collection(db, "timetables"), { uid: currentUser.uid, subject: $("subject-input").value.trim(), day: $("day-input").value, time: $("time-input").value }); event.target.reset(); showToast("Class added to timetable.", "success"); } catch (error) { console.error(error); showToast("Could not add class. Check Firestore rules.", "error"); } };
  $("clear-timetable-btn").onclick = clearTimetable;
  $("sample-timetable-btn").onclick = addSampleTimetable;
  $("export-btn").onclick = () => { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), target, timetable, attendance }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "bunkhelper-backup.json"; a.click(); URL.revokeObjectURL(url); showToast("Backup exported.", "success"); };
  $("full-timetable").onclick = (event) => { const id = event.target.closest("[data-delete-tt]")?.dataset.deleteTt; if (id) deleteRecord("timetables", id); };
  $("history-list").onclick = (event) => { const id = event.target.closest("[data-delete-att]")?.dataset.deleteAtt; if (id) deleteRecord("attendance", id); };
  $("today-classes-list").onclick = (event) => { const chip = event.target.closest("[data-today-subject]"); if (!chip) return; switchView("attendance"); $("att-subject").value = chip.dataset.todaySubject; $("att-date").value = localISODate(); $("att-time").value = chip.dataset.todayTime; $("att-status").value = "Present"; suggestLecture(); };
  $("upload-img-btn").onclick = () => $("ocr-file-input").click();
  $("ocr-file-input").onchange = async (event) => { const file = event.target.files?.[0]; if (!file) return; try { $("ocr-status").textContent = "Reading screenshot…"; const worker = await Tesseract.createWorker("eng"); const result = await worker.recognize(file); await worker.terminate(); const text = result.data.text || ""; $("ocr-preview").textContent = text.trim() || "No readable text found."; $("ocr-preview-wrap").classList.remove("hidden"); importedRows = parseOCRText(text); renderImportReview(); $("ocr-status").textContent = importedRows.length ? `Detected ${importedRows.length} candidate rows. Review and save them below.` : "Text was read, but no timetable rows could be confidently identified."; showToast(importedRows.length ? "Candidate timetable rows ready for review." : "OCR could not confidently identify timetable rows.", importedRows.length ? "success" : "warning"); } catch (error) { console.error(error); $("ocr-status").textContent = "OCR failed."; showToast("Could not read screenshot.", "error"); } event.target.value = ""; };
  $("save-import-btn").onclick = saveImportedRows;
  $("import-preview-list").addEventListener("input", (event) => { const raw = event.target.dataset.importTime ?? event.target.dataset.importSubject ?? event.target.dataset.importDay ?? event.target.dataset.importCheck; if (raw === undefined) return; const index = Number(raw); if (!Number.isInteger(index) || !importedRows[index]) return; if (event.target.dataset.importTime !== undefined) importedRows[index].time = event.target.value; if (event.target.dataset.importSubject !== undefined) importedRows[index].subject = event.target.value; if (event.target.dataset.importDay !== undefined) importedRows[index].day = event.target.value; if (event.target.dataset.importCheck !== undefined) importedRows[index].selected = event.target.checked; $("save-import-btn").disabled = !importedRows.some((row) => row.selected && row.subject.trim() && row.time); });
  $("import-preview-list").addEventListener("click", (event) => { const raw = event.target.closest("[data-remove-import]")?.dataset.removeImport; if (raw === undefined) return; importedRows.splice(Number(raw), 1); renderImportReview(); });
}

function startListeners() {
  if (unsubscribeTimetable) unsubscribeTimetable();
  if (unsubscribeAttendance) unsubscribeAttendance();
  unsubscribeTimetable = onSnapshot(query(collection(db, "timetables"), where("uid", "==", currentUser.uid)), (snapshot) => { timetable = sortClasses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))); renderToday(); renderMiniTimetable(); renderTimetable(); refreshSubjectDropdown(); suggestLecture(); }, (error) => { console.error(error); showToast("Timetable could not be loaded. Check Firebase/Firestore rules.", "error"); });
  unsubscribeAttendance = onSnapshot(query(collection(db, "attendance"), where("uid", "==", currentUser.uid)), (snapshot) => { attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderStats(); renderHistory(); renderToday(); }, (error) => { console.error(error); showToast("Attendance could not be loaded. Check Firebase/Firestore rules.", "error"); });
}

function signedIn(user) { currentUser = user; $("auth-screen").classList.add("hidden"); $("app-screen").classList.remove("hidden"); $("user-name").textContent = user.displayName || user.email || "Student"; $("user-avatar").src = user.photoURL || "https://ui-avatars.com/api/?name=Student&background=171c2d&color=fff"; bindEvents(); startListeners(); switchView("dashboard"); }
function signedOut() { currentUser = null; timetable = []; attendance = []; if (unsubscribeTimetable) unsubscribeTimetable(); if (unsubscribeAttendance) unsubscribeAttendance(); $("auth-screen").classList.remove("hidden"); $("app-screen").classList.add("hidden"); }

$("login-btn").onclick = async () => { try { await setPersistence(auth, browserLocalPersistence); await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) { console.error(error); showToast(`Login failed: ${error.message}`, "error"); } };
onAuthStateChanged(auth, (user) => user ? signedIn(user) : signedOut());
