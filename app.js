// Reset workout app — UI, rendering, state, and event handlers.

import {
  WARMUP, COOLDOWN, PLAN, tipForWeek,
  INJURY_FLAGS, SWAPS, FINISH_MSGS, NUTRITION_OPTIONS,
  dayById, exerciseById
} from "./data.js";

import {
  loadCache, saveCache, fetchFromCloud, flushQueue,
  upsertAppState, insertSession, insertExerciseLog,
  upsertWeight, upsertNutrition, isCloudConfigured
} from "./db.js";

// ─── Boot ────────────────────────────────────────────────────────────────────
let state = loadCache();
let current = "home";

window.addEventListener("DOMContentLoaded", () => {
  renderPresets(); paintTimer(); go("home");
  // Background reconcile with cloud, then re-render current view if data changed.
  if (isCloudConfigured) {
    flushQueue().then(() => fetchFromCloud()).then(applyCloud);
  }
  window.addEventListener("online", () => { flushQueue(); });
});

function applyCloud(cloud){
  if (!cloud) return;
  let changed = false;
  if (cloud.appState) {
    const s = cloud.appState;
    state.week     = s.week     ?? state.week;
    state.progress = s.progress ?? state.progress;
    state.swaps    = s.swaps    ?? state.swaps;
    state.videos   = s.videos   ?? state.videos;
    changed = true;
  }
  if (cloud.sessions?.length) {
    state.sessions = cloud.sessions.map(s => ({
      id: s.id, dayId: s.day_id, name: s.day_name, date: s.completed_at,
      done: s.done_sets, total: s.total_sets, exercises: s.exercises || []
    }));
    state.history = [...state.sessions].sort((a,b)=>new Date(a.date)-new Date(b.date));
    changed = true;
  }
  if (cloud.logs?.length) {
    state.cloudLogs = cloud.logs; // used for PR derivation
    changed = true;
  }
  if (cloud.weights?.length) {
    state.weights = cloud.weights.map(w => ({ date: w.recorded_on, kg: Number(w.kg) }));
    changed = true;
  }
  if (cloud.nutrition?.length) {
    state.nutrition = cloud.nutrition.map(n => ({ date: n.recorded_on, rating: n.rating, note: n.note || "" }));
    changed = true;
  }
  if (changed) { saveCache(state); rerender(); }
}

function rerender(){
  if (current === "home") renderHome();
  else if (current === "history") renderHistory();
  // skip day view to avoid clobbering in-progress edits
}

// ─── State persistence ───────────────────────────────────────────────────────
function persistAppState(){ saveCache(state); upsertAppState(state); }
function persistLocal(){ saveCache(state); }

// ─── Navigation ──────────────────────────────────────────────────────────────
function go(v, arg){
  current = v;
  document.getElementById("nav-home").classList.toggle("active", v === "home" || v === "day");
  document.getElementById("nav-hist").classList.toggle("active", v === "history");
  if (v === "home") renderHome();
  else if (v === "day") renderDay(arg);
  else if (v === "history") renderHistory(arg);
  else if (v === "session") renderSessionDetail(arg);
  window.scrollTo({ top:0, behavior:"smooth" });
}
window.go = go;

// ─── Resolve swaps when rendering a day ──────────────────────────────────────
function resolvedExercise(dayId, exId){
  const altId = state.swaps?.[dayId]?.[exId];
  if (altId) {
    const alt = exerciseById(altId);
    if (alt) return alt;
  }
  return exerciseById(exId);
}

// ─── Day-progress helpers ────────────────────────────────────────────────────
function ensure(dayId){
  const d = dayById(dayId);
  if (!state.progress[dayId]) state.progress[dayId] = {};
  d.ex.forEach(e => {
    const a = state.progress[dayId][e.id];
    if (!Array.isArray(a) || a.length !== e.sets) state.progress[dayId][e.id] = new Array(e.sets).fill(false);
  });
}
function dayCount(dayId){
  ensure(dayId);
  const d = dayById(dayId);
  let done = 0, total = 0;
  d.ex.forEach(e => { const a = state.progress[dayId][e.id]; total += e.sets; done += a.filter(Boolean).length; });
  return { done, total, pct: total ? Math.round(done/total*100) : 0 };
}

// ─── Home view ───────────────────────────────────────────────────────────────
function renderHome(){
  const t = tipForWeek(state.week);
  const cards = PLAN.map(d => {
    const c = dayCount(d.id);
    const last = lastDone(d.id);
    const circ = 2 * Math.PI * 15;
    const off = circ * (1 - c.pct/100);
    return `<button class="day-card" onclick="go('day','${d.id}')">
      <div class="day-top">
        <div class="day-info">
          <div class="day-name">${d.name}</div>
          <div class="day-focus">${d.focus}</div>
          <div class="day-meta">
            <span>${d.ex.length} exercises</span>
            <span class="dot">·</span>
            <span>${last ? "Last " + last : "Not started"}</span>
          </div>
        </div>
        <div class="ring ${c.pct === 100 ? "complete" : ""}">
          <svg width="38" height="38"><circle cx="19" cy="19" r="15" fill="none" stroke="var(--line)" stroke-width="3"/>
          <circle cx="19" cy="19" r="15" fill="none" stroke="${c.pct === 100 ? "var(--accent)" : "var(--ink)"}" stroke-width="3"
            stroke-dasharray="${circ}" stroke-dashoffset="${off}" stroke-linecap="round" style="transition:stroke-dashoffset .4s var(--ease)"/></svg>
          <span class="pct">${c.pct}%</span>
        </div>
      </div>
    </button>`;
  }).join("");

  document.getElementById("view").innerHTML = `
    <div class="week-bar">
      <div>
        <div class="label">Program week</div>
        <div class="week-pick">
          <button class="step" onclick="bumpWeek(-1)">−</button>
          <span class="num" id="weekNum">${state.week}</span>
          <button class="step" onclick="bumpWeek(1)">+</button>
        </div>
      </div>
      <div class="week-tip"><b>${t[0]}.</b> ${t[1]}</div>
    </div>
    <div class="days">${cards}</div>`;
}
function bumpWeek(n){ state.week = Math.min(12, Math.max(1, state.week + n)); persistAppState(); renderHome(); }
window.bumpWeek = bumpWeek;

function lastDone(dayId){
  const h = state.history.filter(x => x.dayId === dayId);
  if (!h.length) return null;
  return relDate(h[h.length-1].date);
}
function relDate(iso){
  const d = new Date(iso), now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + "d ago";
  return d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

// ─── Day view ────────────────────────────────────────────────────────────────
function renderDay(dayId){
  ensure(dayId);
  const d = dayById(dayId);
  const exHtml = d.ex.map(origEx => {
    const e = resolvedExercise(dayId, origEx.id);     // swapped exercise if active
    const slotId = origEx.id;                          // set-tracking key stays original
    let a = state.progress[dayId][slotId];
    // Keep checkbox count in sync with the displayed exercise's set count (handles swaps)
    if (a.length !== e.sets) {
      a = [...a.slice(0, e.sets), ...new Array(Math.max(0, e.sets - a.length)).fill(false)];
      state.progress[dayId][slotId] = a;
      persistLocal();
    }
    const done = a.every(Boolean);
    const swapped = e.id !== slotId;
    const flag = INJURY_FLAGS[e.id];
    const chip = flag
      ? `<span class="injury-chip ${flag.type}"><span class="chip-dot"></span>${flag.type === "back" ? "BACK" : "ELBOW"}</span>`
      : "";
    const flagBox = flag
      ? `<div class="injury-flag ${flag.type}">
           <span class="flag-ico">${flag.type === "back" ? "⚠" : "🎾"}</span>
           <span>${flag.warn}</span>
         </div>`
      : "";
    const setsHtml = a.map((on, si) => `<span class="set ${on ? "on" : ""}" onclick="toggleSet('${dayId}','${slotId}',${si})">
        <span class="box"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>
        Set ${si+1}</span>`).join("");
    const lg = state.log[slotId] || { reps:"", weight:"" };
    const vid = effectiveVideo(e);
    return `<div class="ex ${done ? "done" : ""}" id="ex-${slotId}">
      <div class="ex-head">
        <div style="flex:1;min-width:0">
          <div class="ex-name-row">
            <span class="ex-name">${e.name}</span>
            ${chip}
            ${swapped ? `<span class="swap-badge">SWAPPED</span>` : ""}
          </div>
          <div class="ex-prescribe">${e.sets} × ${e.reps}</div>
          <span class="ex-load">${e.load}</span>
          ${flagBox}
        </div>
        <div class="ex-actions">
          <button class="swap-btn" onclick="openSwapModal('${dayId}','${slotId}')" title="Swap exercise">⇄</button>
          <span class="ex-done-badge">✓ Done</span>
        </div>
      </div>
      <div class="sets">${setsHtml}</div>
      <div class="logrow">
        <span class="field">Reps <input type="text" inputmode="decimal" placeholder="—" value="${lg.reps}" onchange="logVal('${slotId}','reps',this.value)"></span>
        <span class="field">Wt <input type="text" inputmode="decimal" placeholder="kg" value="${lg.weight}" onchange="logVal('${slotId}','weight',this.value)"></span>
      </div>
      <button class="vid-toggle" onclick="toggleVid('${e.id}','${slotId}')">
        <span id="vlabel-${slotId}">${vid ? "Watch demo" : "Add demo video"}</span>
      </button>
      <div class="vid-wrap" id="vid-${slotId}">${vid ? embedHtml(vid, e.id, slotId) : emptyVideoHtml(e.id, slotId)}</div>
    </div>`;
  }).join("");

  document.getElementById("view").innerHTML = `
    <button class="back" onclick="go('home')">← All sessions</button>
    <div class="session-head">
      <h2>${d.name}</h2>
      <div class="focus">${d.focus} · ${d.ex.length} exercises · Rest 60 sec</div>
    </div>
    <details class="accordion"><summary>Warm-up · 5 min <span class="ico">▾</span></summary>
      <div class="body"><ul>${WARMUP.map(x => `<li>${x}</li>`).join("")}</ul></div></details>
    <div>${exHtml}</div>
    <details class="accordion" style="margin-top:10px"><summary>Cool-down · 5 min <span class="ico">▾</span></summary>
      <div class="body"><ul>${COOLDOWN.map(x => `<li>${x}</li>`).join("")}</ul></div></details>
    <div class="finish-bar">
      <button class="btn primary" id="finishBtn" onclick="finishSession('${dayId}')">Finish &amp; log session</button>
      <button class="btn" onclick="resetDay('${dayId}')">Reset</button>
    </div>`;
  updateFinishBtn(dayId);
}

function toggleSet(dayId, slotId, i){
  const a = state.progress[dayId][slotId];
  a[i] = !a[i];
  persistAppState();
  const ex = document.getElementById("ex-" + slotId);
  const pills = ex.querySelectorAll(".set");
  pills[i].classList.toggle("on", a[i]);
  ex.classList.toggle("done", a.every(Boolean));
  updateFinishBtn(dayId);
  if (a[i]) startTimerQuiet();
}
window.toggleSet = toggleSet;

function logVal(slotId, k, v){
  if (!state.log[slotId]) state.log[slotId] = { reps:"", weight:"" };
  state.log[slotId][k] = v;
  persistLocal();
  // Write a row to exercise_logs whenever both fields are present and weight parses
  const l = state.log[slotId];
  const w = parseFloat(l.weight);
  if (l.reps && !isNaN(w)) {
    insertExerciseLog({ exercise_id: slotId, reps: l.reps, weight: w });
  }
}
window.logVal = logVal;

function updateFinishBtn(dayId){
  const c = dayCount(dayId);
  const b = document.getElementById("finishBtn");
  if (!b) return;
  b.disabled = c.done === 0;
  b.textContent = c.done === c.total ? "Finish & log session ✓" : `Finish & log (${c.done}/${c.total} sets)`;
}

function finishSession(dayId){
  const c = dayCount(dayId);
  if (c.done === 0) return;
  const d = dayById(dayId);
  // Snapshot exercises (resolves swaps) with the user's logged reps/weight
  const exercisesSnapshot = d.ex.map(origEx => {
    const e = resolvedExercise(dayId, origEx.id);
    const a = state.progress[dayId][origEx.id];
    const lg = state.log[origEx.id] || { reps:"", weight:"" };
    return {
      id: e.id, slot_id: origEx.id, name: e.name, focus: d.focus,
      sets_total: e.sets, sets_done: a.filter(Boolean).length,
      reps: lg.reps, weight: lg.weight
    };
  });
  const session = {
    day_id: dayId, day_name: d.name,
    completed_at: new Date().toISOString(),
    done_sets: c.done, total_sets: c.total,
    exercises: exercisesSnapshot
  };
  const localEntry = {
    dayId, name: d.name, date: session.completed_at,
    done: c.done, total: c.total, exercises: exercisesSnapshot
  };
  state.history.push(localEntry);
  if (!state.sessions) state.sessions = [];
  state.sessions.unshift(localEntry);
  // reset progress for that day
  d.ex.forEach(e => state.progress[dayId][e.id] = new Array(e.sets).fill(false));
  persistAppState();
  insertSession(session);
  renderComplete(dayId, { done:c.done, total:c.total, exercises:exercisesSnapshot, dayName:d.name });
}
window.finishSession = finishSession;

function resetDay(dayId){
  const d = dayById(dayId);
  d.ex.forEach(e => state.progress[dayId][e.id] = new Array(e.sets).fill(false));
  persistAppState();
  renderDay(dayId);
}
window.resetDay = resetDay;

// ─── Session-complete view ───────────────────────────────────────────────────
function renderComplete(dayId, { done, total, exercises, dayName }){
  const exercisesCompleted = exercises.filter(e => e.sets_done === e.sets_total).length;
  const msg = FINISH_MSGS[Math.floor(Math.random() * FINISH_MSGS.length)];
  const pct = total === 0 ? 0 : Math.round(done/total*100);
  document.getElementById("view").innerHTML = `
    <div class="complete-head">
      <div class="complete-check">✓</div>
      <h2>Session Complete</h2>
      <p class="complete-day">${dayName}</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${exercisesCompleted}</div><div class="l">Exercises</div></div>
      <div class="stat"><div class="n">${done}</div><div class="l">Sets done</div></div>
      <div class="stat"><div class="n">${pct}%</div><div class="l">Complete</div></div>
    </div>
    <div class="complete-msg">${msg}</div>
    <button class="btn primary" style="width:100%;margin-bottom:10px" onclick="go('home')">Back to plan</button>
    <button class="btn" style="width:100%" onclick="go('history')">See my progress</button>`;
}

// ─── Swap modal ──────────────────────────────────────────────────────────────
function openSwapModal(dayId, slotId){
  const currentEx = resolvedExercise(dayId, slotId);
  const baseEx = exerciseById(slotId);
  const alts = SWAPS[currentEx.id] || [];
  const optionHtml = alts.map(altId => {
    const ex = exerciseById(altId);
    if (!ex) return "";
    const flag = INJURY_FLAGS[altId];
    const caution = flag ? `<span class="swap-caution ${flag.type}">${flag.type} caution</span>` : "";
    return `<div class="swap-option" onclick="confirmSwap('${dayId}','${slotId}','${altId}')">
      <div class="so-info">
        <div class="so-name">${ex.name} ${caution}</div>
        <div class="so-load">${ex.sets}×${ex.reps} · ${ex.load}</div>
      </div>
      <span class="so-arrow">→</span>
    </div>`;
  }).join("");
  const restoreBtn = currentEx.id !== baseEx.id
    ? `<button class="modal-cancel" onclick="restoreSwap('${dayId}','${slotId}')">Restore ${baseEx.name}</button>`
    : "";
  document.getElementById("modalRoot").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-title">Swap exercise</div>
        <div class="modal-sub">Replacing: ${currentEx.name}</div>
        ${optionHtml || `<p style="color:var(--ink-3);font-size:13px;padding:8px 0">No alternatives configured.</p>`}
        ${restoreBtn}
        <button class="modal-cancel" onclick="closeModal()">Keep current</button>
      </div>
    </div>`;
}
window.openSwapModal = openSwapModal;

function confirmSwap(dayId, slotId, altId){
  if (!state.swaps) state.swaps = {};
  if (!state.swaps[dayId]) state.swaps[dayId] = {};
  state.swaps[dayId][slotId] = altId;
  persistAppState();
  closeModal();
  renderDay(dayId);
}
window.confirmSwap = confirmSwap;

function restoreSwap(dayId, slotId){
  if (state.swaps?.[dayId]?.[slotId]) {
    delete state.swaps[dayId][slotId];
    persistAppState();
  }
  closeModal();
  renderDay(dayId);
}
window.restoreSwap = restoreSwap;

function closeModal(){ document.getElementById("modalRoot").innerHTML = ""; }
window.closeModal = closeModal;

// ─── Video helpers ───────────────────────────────────────────────────────────
function effectiveVideo(e){ return (state.videos[e.id] || e.video || "").trim(); }
function parseVideo(url){
  url = (url || "").trim();
  if (!url) return null;
  let m;
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/))) return "https://www.youtube-nocookie.com/embed/" + m[1];
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return "https://player.vimeo.com/video/" + m[1];
  if (/^[\w-]{11}$/.test(url)) return "https://www.youtube-nocookie.com/embed/" + url;
  return null;
}
function embedHtml(raw, exId, slotId){
  const src = parseVideo(raw);
  if (!src) return emptyVideoHtml(exId, slotId, "Link not recognised — try a YouTube or Vimeo URL.");
  return `<div class="embed"><iframe loading="lazy" src="${src}" title="Exercise demo" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></div>
    <button class="vid-edit" onclick="editVideo('${exId}','${slotId}')">Change video</button>`;
}
function emptyVideoHtml(exId, slotId, msg){
  const sid = slotId || exId;
  return `<div class="vid-empty">
    <p>${msg || "Paste a YouTube or Vimeo link to save a demo for this exercise."}</p>
    <div class="row">
      <input type="text" id="vinput-${sid}" placeholder="https://youtu.be/…" onkeydown="if(event.key==='Enter')saveVideo('${exId}','${sid}')">
      <button class="btn-sm" onclick="saveVideo('${exId}','${sid}')">Save</button>
    </div></div>`;
}
function toggleVid(exId, slotId){
  const w = document.getElementById("vid-" + slotId);
  const open = w.classList.toggle("open");
  const lbl = document.getElementById("vlabel-" + slotId);
  const has = !!effectiveVideo(exerciseById(exId));
  lbl.textContent = open ? (has ? "Hide demo" : "Add demo video") : (has ? "Watch demo" : "Add demo video");
}
window.toggleVid = toggleVid;

function saveVideo(exId, slotId){
  const sid = slotId || exId;
  const v = document.getElementById("vinput-" + sid).value.trim();
  if (!parseVideo(v)) {
    document.getElementById("vid-" + sid).innerHTML = emptyVideoHtml(exId, sid, "Couldn't read that. Try a YouTube or Vimeo URL.");
    return;
  }
  state.videos[exId] = v;
  persistAppState();
  document.getElementById("vid-" + sid).innerHTML = embedHtml(v, exId, sid);
  const lbl = document.getElementById("vlabel-" + sid);
  if (lbl) lbl.textContent = "Hide demo";
}
window.saveVideo = saveVideo;
function editVideo(exId, slotId){
  const sid = slotId || exId;
  document.getElementById("vid-" + sid).innerHTML = emptyVideoHtml(exId, sid);
}
window.editVideo = editVideo;

// ─── History / Progress view ─────────────────────────────────────────────────
function renderHistory(){
  const total = state.history.length;
  const thisWeek = state.history.filter(x => (Date.now() - new Date(x.date)) < 7 * 86400000).length;
  const days = new Set(state.history.map(x => new Date(x.date).toDateString())).size;

  const today = new Date().toISOString().slice(0,10);
  const calMonth = state.calMonth || today.slice(0,7); // "YYYY-MM"

  document.getElementById("view").innerHTML = `
    ${renderNutritionSection()}
    <div class="section-head">Weekly weigh-in</div>
    ${renderWeightSection()}
    ${total ? `
      <div class="section-head">At a glance</div>
      <div class="stats">
        <div class="stat"><div class="n">${total}</div><div class="l">Sessions</div></div>
        <div class="stat"><div class="n">${thisWeek}</div><div class="l">This week</div></div>
        <div class="stat"><div class="n">${days}</div><div class="l">Active days</div></div>
      </div>
    ` : ""}
    <div class="section-head">Personal records</div>
    ${renderPRSection()}
    <div class="section-head">Calendar</div>
    ${renderCalendar(calMonth)}
    <div class="section-head">Past sessions</div>
    ${renderSessionList()}
    ${total ? `<button class="danger" onclick="clearAll()">Clear all saved data</button>` : ""}
  `;
}

function renderNutritionSection(){
  const today = new Date().toISOString().slice(0,10);
  const todayEntry = state.nutrition.find(n => n.date === today);
  const sel = todayEntry ? todayEntry.rating : "";
  const note = todayEntry ? todayEntry.note : "";
  const recent = [...state.nutrition].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
  return `<div class="section-head">How did you eat today?</div>
    <div class="nutrition-card">
      <div class="nutrition-bar">
        ${NUTRITION_OPTIONS.map(o => `<button class="nutrition-btn ${sel === o.key ? "sel" : ""}" data-rating="${o.key}" onclick="selectNutr('${o.key}')">${o.label}</button>`).join("")}
      </div>
      <textarea class="nutrition-note" id="nutrNote" rows="2" placeholder="Optional note…">${note}</textarea>
      <button class="btn-sm" style="margin-top:8px" onclick="saveNutr()">${todayEntry ? "Update" : "Save"}</button>
    </div>
    ${recent.length ? `<div class="nutr-list">
      ${recent.map(n => `<div class="nutr-history-item">
        <span>${new Date(n.date).toLocaleDateString(undefined,{ weekday:"short", month:"short", day:"numeric" })}</span>
        <span class="nutr-rating ${n.rating}">${n.rating}</span>
      </div>`).join("")}
    </div>` : ""}`;
}

function selectNutr(rating){
  document.querySelectorAll(".nutrition-btn").forEach(b => b.classList.toggle("sel", b.dataset.rating === rating));
}
window.selectNutr = selectNutr;

function saveNutr(){
  const today = new Date().toISOString().slice(0,10);
  const sel = document.querySelector(".nutrition-btn.sel");
  if (!sel) return;
  const rating = sel.dataset.rating;
  const note = document.getElementById("nutrNote").value.trim();
  state.nutrition = state.nutrition.filter(n => n.date !== today);
  state.nutrition.push({ date: today, rating, note });
  persistLocal();
  upsertNutrition({ recorded_on: today, rating, note });
  renderHistory();
}
window.saveNutr = saveNutr;

function renderWeightSection(){
  return `<div class="weight-card">
    <div class="weight-form">
      <input type="number" inputmode="decimal" id="wtInput" step="0.1" placeholder="kg" />
      <button class="btn-sm" onclick="logWeight()">Log weight</button>
    </div>
    ${renderWeightChart(state.weights)}
  </div>`;
}

function renderWeightChart(weights){
  if (!weights || weights.length < 2) {
    return `<p class="muted-line">Log at least 2 weigh-ins to see your trend.</p>`;
  }
  const pts = weights.slice(-12);
  const vals = pts.map(p => Number(p.kg));
  const minV = Math.min(...vals) - 1;
  const maxV = Math.max(...vals) + 1;
  const W = 360, H = 90, PAD = 10;
  const toX = i => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const toY = v => PAD + (1 - (v - minV) / (maxV - minV)) * (H - PAD * 2);
  const poly = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(vals[i]).toFixed(1)}`).join(" ");
  const circles = pts.map((p, i) => `<circle cx="${toX(i).toFixed(1)}" cy="${toY(vals[i]).toFixed(1)}" r="3.5" fill="var(--accent)"/>`).join("");
  const diff = vals[vals.length-1] - vals[0];
  const sign = diff > 0 ? "+" : "";
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" aria-label="Weight trend">
      <polyline points="${poly}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${circles}
    </svg>
    <div class="trend-label">${vals[vals.length-1].toFixed(1)} kg · change: ${sign}${diff.toFixed(1)} kg over ${pts.length} check-ins</div>
  </div>`;
}

function logWeight(){
  const v = parseFloat(document.getElementById("wtInput").value);
  if (!v || v < 20 || v > 300) return;
  const today = new Date().toISOString().slice(0,10);
  state.weights = state.weights.filter(w => w.date !== today);
  state.weights.push({ date: today, kg: v });
  state.weights.sort((a,b)=>a.date.localeCompare(b.date));
  persistLocal();
  upsertWeight(v, today);
  renderHistory();
}
window.logWeight = logWeight;

// PRs derived from logs (cloud logs preferred, fall back to local state.log)
function derivedPRs(){
  const prs = {};
  // local log only knows the latest entry per exercise — still useful pre-cloud
  Object.entries(state.log || {}).forEach(([exId, l]) => {
    const w = parseFloat(l.weight);
    if (!isNaN(w) && l.reps) {
      prs[exId] = { weight: w, reps: l.reps, date: null };
    }
  });
  // cloud logs (if loaded) carry history — take the heaviest per exercise
  (state.cloudLogs || []).forEach(r => {
    const w = Number(r.weight);
    if (!w) return;
    const cur = prs[r.exercise_id];
    if (!cur || w > cur.weight) {
      prs[r.exercise_id] = { weight: w, reps: r.reps, date: r.logged_at };
    }
  });
  return prs;
}
function renderPRSection(){
  const prs = derivedPRs();
  const entries = Object.entries(prs);
  if (!entries.length) return `<p class="muted-line">Log reps and weight on an exercise to start tracking PRs.</p>`;
  return `<div class="pr-grid">${entries.map(([exId, pr]) => {
    const ex = exerciseById(exId);
    if (!ex) return "";
    const when = pr.date ? new Date(pr.date).toLocaleDateString(undefined,{ month:"short", day:"numeric" }) : "current";
    return `<div class="pr-item">
      <div><div class="pr-name">${ex.name}</div><div class="pr-date">${when}</div></div>
      <span class="pr-val">${pr.weight} kg × ${pr.reps}</span>
    </div>`;
  }).join("")}</div>`;
}

function renderCalendar(monthStr){
  const [y, m] = monthStr.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const startDow = (first.getDay() + 6) % 7; // 0 = Monday
  const sessionDays = new Set(state.history.map(x => x.date.slice(0,10)));
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= last.getDate(); d++) {
    const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const has = sessionDays.has(iso);
    const isToday = iso === new Date().toISOString().slice(0,10);
    cells.push(`<div class="cal-cell ${has ? "has-session" : ""} ${isToday ? "today" : ""}" ${has ? `onclick="openDayDetail('${iso}')"` : ""}>${d}</div>`);
  }
  const monthLabel = first.toLocaleDateString(undefined, { month:"long", year:"numeric" });
  return `<div class="calendar-card">
    <div class="cal-head">
      <button class="step" onclick="shiftMonth(-1)">‹</button>
      <span class="cal-title">${monthLabel}</span>
      <button class="step" onclick="shiftMonth(1)">›</button>
    </div>
    <div class="cal-dow">${["Mo","Tu","We","Th","Fr","Sa","Su"].map(d => `<span>${d}</span>`).join("")}</div>
    <div class="cal-grid">${cells.join("")}</div>
  </div>`;
}
function shiftMonth(delta){
  const cur = state.calMonth || new Date().toISOString().slice(0,7);
  const [y, m] = cur.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.calMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  renderHistory();
}
window.shiftMonth = shiftMonth;
function openDayDetail(iso){
  const sess = state.history.filter(x => x.date.slice(0,10) === iso);
  if (!sess.length) return;
  if (sess.length === 1) go("session", sess[0].date);
  else go("session", sess[sess.length-1].date);
}
window.openDayDetail = openDayDetail;

function renderSessionList(){
  if (!state.history.length) return `<div class="empty"><div class="big">Nothing logged yet</div><div class="small">Finish a session and it'll show up here.</div></div>`;
  const h = [...state.history].reverse().slice(0, 30);
  return h.map(x => `<div class="hist-item" onclick="go('session','${x.date}')">
    <div><div class="name">${x.name}</div><div class="when">${new Date(x.date).toLocaleDateString(undefined,{ weekday:"short", month:"short", day:"numeric" })} · ${new Date(x.date).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })}</div></div>
    <span class="tag">${x.done}/${x.total} sets</span>
  </div>`).join("");
}

function renderSessionDetail(dateKey){
  const sess = state.history.find(x => x.date === dateKey);
  if (!sess) { go("history"); return; }
  const rows = (sess.exercises || []).map(e => {
    const ex = exerciseById(e.id) || { name: e.name };
    const ringPct = e.sets_total ? Math.round(e.sets_done/e.sets_total*100) : 0;
    return `<div class="detail-ex">
      <div class="detail-ex-head">
        <span class="detail-ex-name">${e.name}</span>
        <span class="detail-ex-sets">${e.sets_done}/${e.sets_total} sets</span>
      </div>
      <div class="detail-ex-meta">
        ${e.reps ? `<span>Reps logged: <b>${e.reps}</b></span>` : ""}
        ${e.weight ? `<span>Weight: <b>${e.weight} kg</b></span>` : ""}
        ${!e.reps && !e.weight ? `<span class="muted-line" style="padding:0">No reps/weight logged</span>` : ""}
      </div>
    </div>`;
  }).join("");
  const when = new Date(sess.date);
  document.getElementById("view").innerHTML = `
    <button class="back" onclick="go('history')">← Past sessions</button>
    <div class="session-head">
      <h2>${sess.name}</h2>
      <div class="focus">${when.toLocaleDateString(undefined,{ weekday:"long", month:"long", day:"numeric" })} · ${when.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })} · ${sess.done}/${sess.total} sets</div>
    </div>
    ${rows || `<p class="muted-line">No detailed snapshot for this session.</p>`}`;
}

function clearAll(){
  if (!confirm("Clear local cache? Cloud data stays in Supabase.")) return;
  state = { week:1, progress:{}, log:{}, videos:{}, swaps:{}, history:[], weights:[], nutrition:[], sessions:[] };
  persistLocal();
  go("history");
}
window.clearAll = clearAll;

// ─── Rest timer ──────────────────────────────────────────────────────────────
let tDur = 60, tLeft = 60, tRun = false, tInt = null;
function renderPresets(){
  document.getElementById("presets").innerHTML = [45, 60, 90].map(s =>
    `<button class="preset ${s === tDur ? "sel" : ""}" onclick="setPreset(${s})">${s < 60 ? s + "s" : (s/60) + "m" + (s%60 ? (" " + (s%60) + "s") : "")}</button>`).join("");
}
function fmt(s){ const m = Math.floor(s/60), x = s%60; return m + ":" + String(x).padStart(2,"0"); }
function paintTimer(){ const el = document.getElementById("timerDisplay"); el.textContent = fmt(tLeft); el.classList.toggle("ring-now", tLeft === 0); }
function setPreset(s){ tDur = s; tLeft = s; tRun = false; clearInterval(tInt); document.getElementById("tGo").textContent = "Start"; renderPresets(); paintTimer(); }
window.setPreset = setPreset;
function toggleTimer(){ const p = document.getElementById("timerPanel"); p.classList.toggle("open"); renderPresets(); paintTimer(); }
window.toggleTimer = toggleTimer;
function timerToggle(){
  if (tRun) { tRun = false; clearInterval(tInt); document.getElementById("tGo").textContent = "Resume"; return; }
  if (tLeft === 0) tLeft = tDur;
  tRun = true; document.getElementById("tGo").textContent = "Pause";
  tInt = setInterval(() => { tLeft--; paintTimer(); if (tLeft <= 0) { clearInterval(tInt); tRun = false; document.getElementById("tGo").textContent = "Start"; doneBeep(); } }, 1000);
}
window.timerToggle = timerToggle;
function timerReset(){ tRun = false; clearInterval(tInt); tLeft = tDur; document.getElementById("tGo").textContent = "Start"; paintTimer(); }
window.timerReset = timerReset;
function startTimerQuiet(){ if (!tRun) { tLeft = tDur; paintTimer(); } }
function doneBeep(){
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    [0, .18, .36].forEach(t => {
      const o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.frequency.value = 880; o.start(c.currentTime + t);
      g.gain.setValueAtTime(.001, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.3, c.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(.001, c.currentTime + t + .16);
      o.stop(c.currentTime + t + .17);
    });
  } catch {}
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
}
