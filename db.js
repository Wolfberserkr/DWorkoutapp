// Google Apps Script Web App sync layer.
// No login, no OAuth, no API keys — just a Web App URL that acts as a REST endpoint.
// Data lives in a Google Sheet you can open and read like a spreadsheet at any time.
// Falls back to localStorage-only if SCRIPT_URL is not set.

// ─── CONFIGURE ME ────────────────────────────────────────────────────────────
// Paste your Apps Script Web App URL here after deploying (see README for steps)
const SCRIPT_URL = "";
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY  = "reset_state_v3";
const QUEUE_KEY  = "reset_pending_ops_v1";
const LEGACY_KEY = "reset_state_v2";

export const isCloudConfigured = !!(SCRIPT_URL);
export const USER_ID = "local"; // kept for API compatibility with app.js

// ─── Local cache ─────────────────────────────────────────────────────────────
const Mem = { data:{} };
function safeGet(k){ try { return localStorage.getItem(k); } catch { return Mem.data[k]; } }
function safeSet(k,v){ try { localStorage.setItem(k,v); } catch { Mem.data[k]=v; } }

const DEFAULT_STATE = () => ({
  week:1, progress:{}, log:{}, videos:{}, swaps:{},
  history:[], weights:[], nutrition:[], sessions:[]
});

export function loadCache(){
  try {
    const v3 = JSON.parse(safeGet(CACHE_KEY));
    if (v3?.progress) return { ...DEFAULT_STATE(), ...v3 };
    const v2 = JSON.parse(safeGet(LEGACY_KEY));
    if (v2?.progress) return { ...DEFAULT_STATE(), ...v2 };
  } catch {}
  return DEFAULT_STATE();
}
export function saveCache(state){ safeSet(CACHE_KEY, JSON.stringify(state)); }

// ─── Pending-ops queue (offline writes) ──────────────────────────────────────
function loadQueue(){ try { return JSON.parse(safeGet(QUEUE_KEY)) || []; } catch { return []; } }
function saveQueue(q){ safeSet(QUEUE_KEY, JSON.stringify(q)); }

async function post(action, payload){
  if (!SCRIPT_URL) return;
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action, payload }),
    redirect: "follow"
  });
  return res;
}

async function pushOp(action, payload){
  if (!SCRIPT_URL) return;
  try { await post(action, payload); }
  catch { const q = loadQueue(); q.push({ action, payload }); saveQueue(q); }
}

export async function flushQueue(){
  if (!SCRIPT_URL) return;
  const q = loadQueue();
  if (!q.length) return;
  const remaining = [];
  for (const op of q) {
    try { await post(op.action, op.payload); }
    catch { remaining.push(op); }
  }
  saveQueue(remaining);
}

// ─── Write helpers ───────────────────────────────────────────────────────────
export function upsertAppState(state){
  return pushOp("upsertAppState", {
    week: state.week, progress: state.progress,
    swaps: state.swaps, videos: state.videos
  });
}

export function insertSession(session){
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return pushOp("insertSession", { ...session, id });
}

export function insertExerciseLog(row){
  return pushOp("insertLog", { ...row, logged_at: new Date().toISOString() });
}

export function upsertWeight(kg, recorded_on){
  return pushOp("upsertWeight", { kg, recorded_on });
}

export function upsertNutrition({ recorded_on, rating, note }){
  return pushOp("upsertNutrition", { recorded_on, rating, note: note || "" });
}

// ─── Cloud read (called on boot to reconcile with cache) ─────────────────────
export async function fetchFromCloud(){
  if (!SCRIPT_URL) return null;
  try {
    const res = await fetch(SCRIPT_URL + "?action=fetch");
    return await res.json();
  } catch(e) {
    console.warn("cloud fetch failed", e);
    return null;
  }
}
