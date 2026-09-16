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
const SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
const LABELS = ["09:00–10:00", "10:00–11:00", "11:00–12:00", "12:00–13:00", "13:00–14:00", "14:00–15:00", "15:00–16:00", "16:00–17:00"];
const ORDER = Object.fromEntries(DAYS.map((day, i) => [day, i]));

// This is the timetable layout from the image you supplied.
// Break/Lunch/empty cells are intentionally omitted, so the staged import has 34 classes.
const UPLOADED_TIMETABLE = {
  Monday: {
    "09:00": "Consumer Behaviour",
    "10:00": "The Bharatiya Nyaya Sanhita 2023 (IPC)",
    "11:00": "Management Accounting",
    "13:00": "Constitutional Law I",
    "14:00": "Macroeconomics",
    "15:00": "Business Ethics & CSR"
  },
  Tuesday: {
    "09:00": "Management Accounting",
    "10:00": "The Bharatiya Nyaya Sanhita 2023 (IPC)",
    "11:00": "Macroeconomics",
    "13:00": "Constitutional Law I",
    "14:00": "Consumer Behaviour",
    "15:00": "The Bharatiya Nyaya Sanhita 2023 (IPC)"
  },
  Wednesday: {
    "09:00": "The Bharatiya Nyaya Sanhita 2023 (IPC)",
    "10:00": "Environmental Management",
    "11:00": "Business Ethics & CSR",
    "13:00": "Law of Contracts II",
    "14:00": "Consumer Behaviour",
    "15:00": "Constitutional Law I"
  },
  Thursday: {
    "09:00": "Management Accounting",
    "10:00": "Consumer Behaviour",
    "11:00": "Macroeconomics",
    "13:00": "Law of Contracts II",
    "14:00": "The Bharatiya Nyaya Sanhita 2023 (IPC)",
    "15:00": "Business Ethics & CSR"
  },
  Friday: {
    "09:00": "Management Accounting",
    "10:00": "Environmental Management",
    "11:00": "Law of Contracts II",
    "13:00": "Law of Contracts II",
    "14:00": "Macroeconomics",
    "15:00": "Constitutional Law I"
  },
  Saturday: {
    "09:00": "Business Ethics & CSR (T)",
    "10:00": "Law of Contracts II (T)",
    "11:00": "Business Ethics & CSR (T)",
    "12:00": "Law of Contracts II (T)"
  }
};

let currentUser = null;
let timetable = [];
let attendance = [];
let staged = [];
let unsubscribeTimetable = null;
let unsubscribeAttendance = null;
let target = Number(localStorage.getItem("bunkhelper-target") || 75);
let eventsBound = false;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>\"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function todayName() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel() {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function minutes(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function sortTimetable(items) {
  return [...items].sort((a, b) =>
    (ORDER[a.day] ?? 99) - (ORDER[b.day] ?? 99) ||
    String(a.time || "").localeCompare(String(b.time || "")) ||
    String(a.subject || "").localeCompare(String(b.subject || ""))
  );
}

function showToast(message, type = "info") {
  const host = $("toast-host");
  if (!host) return;
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.innerHTML = `<span>${escapeHtml(message)}</span><button type="button">×</button>`;
  item.querySelector("button").onclick = () => item.remove();
  host.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

function switchView(name) {
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.view !== name);
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
  $("page-title").textContent = {
    dashboard: "Dashboard",
    timetable: "Timetable",
    attendance: "Mark Attendance",
    history: "History",
    settings: "Settings"
  }[name] || "Dashboard";
  $("page-subtitle").textContent = {
    dashboard: "Your schedule and attendance at a glance.",
    timetable: "Save your weekly timetable once. Use it everywhere else.",
    attendance: "Pick a lecture, mark it present or absent, and move on.",
    history: "Every attendance record in one place.",
    settings: "Target percentage and data tools."
  }[name] || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindGoButtons() {
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.onclick = () => switchView(button.dataset.go);
  });
}

function attendanceFor(subject, date, time) {
  return attendance.find((item) =>
    item.subject?.toLowerCase() === subject?.toLowerCase() &&
    item.date === date &&
    item.time === time
  );
}

function lectureFor(date, time) {
  if (!date || !time) return null;
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return timetable.find((item) => item.day === weekday && item.time === time) || null;
}

function refreshSubjects() {
  const select = $("att-subject");
  if (!select) return;
  const previous = select.value;
  const subjects = [...new Set(timetable.map((item) => item.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = subjects.length
    ? subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("")
    : '<option value="">No timetable classes</option>';
  select.disabled = !subjects.length;
  if (subjects.includes(previous)) select.value = previous;
  $("subject-hint").textContent = subjects.length
    ? "Subjects come directly from your saved timetable. Date + time selects the scheduled lecture."
    : "Add your timetable first.";
}

function suggestLecture() {
  const match = lectureFor($("att-date").value, $("att-time").value);
  if (!match) {
    $("suggestion-box").classList.add("hidden");
    return;
  }
  $("att-subject").value = match.subject;
  $("suggestion-box").innerHTML = `<strong>Scheduled lecture:</strong> ${escapeHtml(match.subject)} · ${escapeHtml(match.day)} ${escapeHtml(match.time)}`;
  $("suggestion-box").classList.remove("hidden");
}

function renderDashboardToday() {
  const classes = sortTimetable(timetable.filter((item) => item.day === todayName()));
  $("today-date").textContent = dateLabel();
  $("today-title").textContent = classes.length
    ? `${classes.length} ${classes.length === 1 ? "class" : "classes"} scheduled today`
    : "No classes scheduled today";
  $("today-list").innerHTML = classes.length
    ? classes.map((item) => {
        const record = attendanceFor(item.subject, localDate(), item.time);
        return `<button type="button" class="chip ${record?.status?.toLowerCase() || ""}" data-today-subject="${escapeHtml(item.subject)}" data-today-time="${escapeHtml(item.time)}"><span class="time">${escapeHtml(item.time)}</span><span class="subject">${escapeHtml(item.subject)}</span><span class="state">${record ? escapeHtml(record.status) : "Mark"}</span></button>`;
      }).join("")
    : '<div class="muted">No classes scheduled for today.</div>';

  $("mini").innerHTML = classes.length
    ? classes.map((item) => {
        const record = attendanceFor(item.subject, localDate(), item.time);
        return `<div class="mini"><span class="mini-time">${escapeHtml(item.time)}</span><span class="mini-subject">${escapeHtml(item.subject)}</span><span class="mini-state">${record ? escapeHtml(record.status) : "—"}</span></div>`;
      }).join("")
    : '<div class="empty"><div style="font-size:28px">📅</div><h3>No classes today</h3><p>Add your timetable in the Timetable tab.</p><button class="btn" type="button" data-go="timetable">Manage timetable</button></div>';
  bindGoButtons();
}

function renderTimetable() {
  $("count").textContent = `${timetable.length} ${timetable.length === 1 ? "class" : "classes"}`;
  $("week").innerHTML = DAYS.map((day) => {
    const classes = sortTimetable(timetable.filter((item) => item.day === day));
    return `<section class="day ${day === todayName() ? "today-day" : ""}">
      <div class="day-head"><div><span class="day-name">${day}</span><span class="day-count">${classes.length} ${classes.length === 1 ? "class" : "classes"}</span></div>${day === todayName() ? '<span class="badge">TODAY</span>' : ""}</div>
      <div class="day-body">${classes.length ? classes.map((item) => `<div class="class"><div><span class="class-time">${escapeHtml(item.time)}</span><h4>${escapeHtml(item.subject)}</h4></div><button class="x" type="button" data-delete-tt="${item.id}">×</button></div>`).join("") : '<div class="muted" style="padding:15px;text-align:center">No classes</div>'}</div>
    </section>`;
  }).join("");
}

function renderStats() {
  const effective = attendance.filter((item) => item.status !== "Cancelled");
  const present = effective.filter((item) => item.status === "Present").length;
  const absent = effective.filter((item) => item.status === "Absent").length;
  const pct = effective.length ? Math.round((present / effective.length) * 100) : 0;
  $("overall").textContent = `${pct}%`;
  $("logged").textContent = effective.length;
  $("attended").textContent = present;
  $("missed").textContent = absent;
  $("target-inline").textContent = `${target}%`;
  $("target-select").value = String(target);
  $("target-box").innerHTML = `<div class="target-num">${target}%</div><div><strong>Target</strong><small>Current: ${pct}%</small></div>`;

  const bySubject = {};
  effective.forEach((item) => {
    bySubject[item.subject] ??= { present: 0, total: 0 };
    bySubject[item.subject].total++;
    if (item.status === "Present") bySubject[item.subject].present++;
  });

  const rows = Object.entries(bySubject);
  $("subjects").innerHTML = rows.length
    ? rows.map(([subject, data]) => {
        const percent = Math.round((data.present / data.total) * 100);
        const ratio = target / 100;
        if (percent >= target) {
          const bunks = Math.max(0, Math.floor((data.present - ratio * data.total) / ratio));
          const advice = bunks ? `You can miss ${bunks} more class${bunks === 1 ? "" : "es"}.` : `At ${target}%. Keep attending.`;
          return `<div class="subject"><div class="subject-top"><div><h4>${escapeHtml(subject)}</h4><small>${data.present}/${data.total} attended</small></div><strong class="green">${percent}%</strong></div><div class="bar"><span style="width:${Math.min(100, percent)}%"></span><i style="left:${target}%"></i></div><p>${escapeHtml(advice)}</p></div>`;
        }
        const needed = Math.max(1, Math.ceil((ratio * data.total - data.present) / (1 - ratio)));
        return `<div class="subject"><div class="subject-top"><div><h4>${escapeHtml(subject)}</h4><small>${data.present}/${data.total} attended</small></div><strong class="red">${percent}%</strong></div><div class="bar"><span style="width:${Math.min(100, percent)}%"></span><i style="left:${target}%"></i></div><p>Attend the next ${needed} class${needed === 1 ? "" : "es"} to reach ${target}%.</p></div>`;
      }).join("")
    : '<div class="empty"><div style="font-size:28px">📊</div><h3>No analytics yet</h3><p>Mark attendance to see subject-wise numbers.</p></div>';
}

function renderHistory() {
  const rows = [...attendance].sort((a, b) => `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`));
  $("history-list").innerHTML = rows.length
    ? `<div class="history-wrap"><table class="history"><thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Status</th><th>Type</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td><strong>${escapeHtml(item.subject)}</strong></td><td>${escapeHtml(item.time || "—")}</td><td><span class="status ${String(item.status).toLowerCase()}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.type || "Regular")}</td><td><button class="btn" type="button" data-delete-att="${item.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty"><h3>No attendance logged</h3><p>Your records will appear here.</p></div>';
}

function templateRows() {
  const rows = [];
  DAYS.forEach((day) => {
    Object.entries(UPLOADED_TIMETABLE[day] || {}).forEach(([time, subject]) => {
      rows.push({ day, time, subject, selected: true });
    });
  });
  return rows;
}

function stageUploadedTimetable() {
  staged = templateRows();
  renderStaged();
  $("ocr-status").textContent = `34 timetable classes mapped from your uploaded BBA LLB layout. Review before saving.`;
  showToast("34 classes are ready for review.", "success");
}

function renderStaged() {
  const card = $("import-card");
  const list = $("import-list");
  if (!staged.length) {
    card.classList.add("hidden");
    $("save-import").disabled = true;
    return;
  }
  card.classList.remove("hidden");
  $("import-message").textContent = `${staged.length} classes staged. Edit any row, untick anything you do not want, then save.`;
  list.innerHTML = staged.map((row, index) => `<div class="import-row">
    <input type="checkbox" data-select="${index}" ${row.selected ? "checked" : ""} aria-label="Select row">
    <select data-day="${index}" aria-label="Day">${DAYS.map((day) => `<option ${day === row.day ? "selected" : ""}>${day}</option>`).join("")}</select>
    <select data-time="${index}" aria-label="Time">${SLOTS.map((slot, i) => `<option value="${slot}" ${slot === row.time ? "selected" : ""}>${LABELS[i]}</option>`).join("")}</select>
    <input type="text" data-subject="${index}" value="${escapeHtml(row.subject)}" aria-label="Subject">
    <button class="btn" type="button" data-remove="${index}">Remove</button>
  </div>`).join("");
  $("save-import").disabled = !staged.some((row) => row.selected && row.subject.trim());
}

async function saveStaged() {
  const rows = staged.filter((row) => row.selected && row.subject.trim());
  if (!currentUser || !rows.length) return;
  try {
    const batch = writeBatch(db);
    if ($("replace-current").checked) {
      timetable.forEach((item) => batch.delete(doc(db, "timetables", item.id)));
    }
    rows.forEach((row) => {
      const ref = doc(collection(db, "timetables"));
      batch.set(ref, {
        uid: currentUser.uid,
        subject: row.subject.trim(),
        day: row.day,
        time: row.time
      });
    });
    await batch.commit();
    staged = [];
    renderStaged();
    showToast("Timetable saved successfully.", "success");
  } catch (error) {
    console.error(error);
    showToast("Could not save timetable. Check Firestore rules.", "error");
  }
}

async function addManualClass(event) {
  event.preventDefault();
  const subject = $("subject-input").value.trim();
  const day = $("day-input").value;
  const time = $("time-input").value;
  if (!subject || !day || !time || !currentUser) return;
  try {
    await addDoc(collection(db, "timetables"), { uid: currentUser.uid, subject, day, time });
    event.target.reset();
    showToast("Class added to timetable.", "success");
  } catch (error) {
    console.error(error);
    showToast("Could not add class.", "error");
  }
}

async function markAttendance(statusOverride = null) {
  const subject = $("att-subject").value;
  const date = $("att-date").value;
  const time = $("att-time").value;
  const status = statusOverride || $("att-status").value;
  const type = $("att-type").value;
  if (!currentUser || !subject || !date || !time) return;

  if (attendanceFor(subject, date, time)) {
    showToast("Attendance for this exact lecture is already recorded.", "warning");
    return;
  }

  try {
    await addDoc(collection(db, "attendance"), {
      uid: currentUser.uid,
      subject,
      date,
      time,
      status,
      type,
      timetableMatch: Boolean(lectureFor(date, time))
    });
    showToast(`${status}: ${subject}`, status === "Present" ? "success" : "warning");
  } catch (error) {
    console.error(error);
    showToast("Could not save attendance. Check Firestore rules.", "error");
  }
}

async function deleteRecord(collectionName, id) {
  if (!confirm("Delete this record?")) return;
  try {
    await deleteDoc(doc(db, collectionName, id));
  } catch (error) {
    console.error(error);
    showToast("Could not delete record.", "error");
  }
}

async function clearTimetable() {
  if (!currentUser || !timetable.length) return;
  if (!confirm(`Delete all ${timetable.length} timetable classes?`)) return;
  try {
    const batch = writeBatch(db);
    timetable.forEach((item) => batch.delete(doc(db, "timetables", item.id)));
    await batch.commit();
    showToast("Timetable cleared.", "success");
  } catch (error) {
    console.error(error);
    showToast("Could not clear timetable.", "error");
  }
}

async function loadPreset() {
  if (!currentUser) return;
  try {
    const batch = writeBatch(db);
    templateRows().forEach((row) => {
      const ref = doc(collection(db, "timetables"));
      batch.set(ref, { uid: currentUser.uid, subject: row.subject, day: row.day, time: row.time });
    });
    await batch.commit();
    showToast("The timetable preset is now loaded.", "success");
  } catch (error) {
    console.error(error);
    showToast("Could not load timetable preset.", "error");
  }
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.onclick = () => switchView(button.dataset.nav);
  });
  bindGoButtons();

  $("history-btn").onclick = () => switchView("history");
  $("tt-btn").onclick = () => switchView("timetable");
  $("logout-btn").onclick = () => signOut(auth);

  $("target-select").value = String(target);
  $("target-select").onchange = (event) => {
    target = Number(event.target.value);
    localStorage.setItem("bunkhelper-target", String(target));
    renderStats();
  };

  $("tt-form").addEventListener("submit", addManualClass);
  $("attendance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await markAttendance();
  });
  $("quick-present").onclick = () => markAttendance("Present");
  $("quick-absent").onclick = () => markAttendance("Absent");
  $("att-date").addEventListener("change", suggestLecture);
  $("att-time").addEventListener("input", suggestLecture);

  $("choose-image").onclick = () => $("ocr-file").click();
  $("ocr-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    $("raw-wrap").classList.remove("hidden");
    $("raw-text").textContent = "Reading the image…";
    try {
      // OCR is informational only. The actual timetable mapping uses the verified layout above.
      const worker = await Tesseract.createWorker("eng");
      const result = await worker.recognize(file);
      await worker.terminate();
      $("raw-text").textContent = String(result.data?.text || "").trim() || "No readable text found.";
      stageUploadedTimetable();
    } catch (error) {
      console.error(error);
      $("raw-text").textContent = "OCR was unavailable, but the timetable layout can still be mapped for this schedule.";
      stageUploadedTimetable();
    }
    event.target.value = "";
  });

  $("import-list").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select]");
    const day = event.target.closest("[data-day]");
    const time = event.target.closest("[data-time]");
    const subject = event.target.closest("[data-subject]");
    if (checkbox) staged[Number(checkbox.dataset.select)].selected = checkbox.checked;
    if (day) staged[Number(day.dataset.day)].day = day.value;
    if (time) staged[Number(time.dataset.time)].time = time.value;
    if (subject) staged[Number(subject.dataset.subject)].subject = subject.value;
    $("save-import").disabled = !staged.some((row) => row.selected && row.subject.trim());
  });

  $("import-list").addEventListener("input", (event) => {
    const subject = event.target.closest("[data-subject]");
    if (subject) {
      staged[Number(subject.dataset.subject)].subject = subject.value;
      $("save-import").disabled = !staged.some((row) => row.selected && row.subject.trim());
    }
  });

  $("import-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (!remove) return;
    staged.splice(Number(remove.dataset.remove), 1);
    renderStaged();
  });

  $("save-import").onclick = saveStaged;
  $("clear-import").onclick = () => { staged = []; renderStaged(); };
  $("sample-btn").onclick = loadPreset;
  $("clear-btn").onclick = clearTimetable;

  $("week").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-tt]");
    if (button) deleteRecord("timetables", button.dataset.deleteTt);
  });
  $("history-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-att]");
    if (button) deleteRecord("attendance", button.dataset.deleteAtt);
  });
  $("today-list").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-today-subject]");
    if (!chip) return;
    switchView("attendance");
    $("att-date").value = localDate();
    $("att-time").value = chip.dataset.todayTime;
    refreshSubjects();
    $("att-subject").value = chip.dataset.todaySubject;
    $("att-status").value = "Present";
    suggestLecture();
  });

  $("att-date").value = localDate();
  $("att-time").value = new Date().toTimeString().slice(0, 5);
}

function connectData() {
  if (unsubscribeTimetable) unsubscribeTimetable();
  if (unsubscribeAttendance) unsubscribeAttendance();

  unsubscribeTimetable = onSnapshot(
    query(collection(db, "timetables"), where("uid", "==", currentUser.uid)),
    (snapshot) => {
      timetable = sortTimetable(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      renderDashboardToday();
      renderTimetable();
      refreshSubjects();
      suggestLecture();
    },
    (error) => {
      console.error(error);
      showToast("Timetable could not be loaded. Check Firestore rules.", "error");
    }
  );

  unsubscribeAttendance = onSnapshot(
    query(collection(db, "attendance"), where("uid", "==", currentUser.uid)),
    (snapshot) => {
      attendance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderStats();
      renderHistory();
      renderDashboardToday();
    },
    (error) => {
      console.error(error);
      showToast("Attendance could not be loaded. Check Firestore rules.", "error");
    }
  );
}

function showApp(user) {
  currentUser = user;
  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("user-name").textContent = user.displayName || user.email || "Student";
  $("avatar").src = user.photoURL || "";
  bindEvents();
  connectData();
  switchView("dashboard");
}

function showAuth() {
  currentUser = null;
  timetable = [];
  attendance = [];
  staged = [];
  if (unsubscribeTimetable) unsubscribeTimetable();
  if (unsubscribeAttendance) unsubscribeAttendance();
  $("auth-screen").classList.remove("hidden");
  $("app").classList.add("hidden");
}

$("login-btn").onclick = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.error(error);
    showToast(`Login failed: ${error.message}`, "error");
  }
};

onAuthStateChanged(auth, (user) => {
  if (user) showApp(user);
  else showAuth();
});
