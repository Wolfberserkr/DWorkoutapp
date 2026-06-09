// Supabase client + cache-first sync layer.
// Single shared user (hard-coded UUID). LocalStorage is the read cache; Supabase is durable storage.
// If the keys below aren't filled in, the app silently falls back to localStorage-only mode.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CONFIGURE ME ────────────────────────────────────────────────────────────
// 1. Create a Supabase project (https://supabase.com)
// 2. Run /supabase/schema.sql in the SQL editor (replace the UUID inside it if you change USER_ID)
// 3. Paste your project URL and anon key below
export const SUPABASE_URL      = "";   // e.g. "https://xxxxx.supabase.co"
export const SUPABASE_ANON_KEY = "";   // anon/public key — safe to ship, RLS gates access
export const USER_ID           = "a1f0c8d2-3b4e-4f5a-9c0d-1e2f3a4b5c6d";
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY  = "reset_state_v3";
const QUEUE_KEY  = "reset_pending_ops_v1";
const LEGACY_KEY = "reset_state_v2";

const cloudConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const supabase = cloudConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ─── Local cache ─────────────────────────────────────────────────────────────
const Mem = { data:{} };
function safeGet(k){ try { return localStorage.getItem(k); } catch { return Mem.data[k]; } }
function safeSet(k,v){ try { localStorage.setItem(k,v); } catch { Mem.data[k] = v; } }

const DEFAULT_STATE = () => ({
  week: 1,
  progress: {},
  log: {},
  videos: {},
  swaps: {},
  history: [],
  weights: [],
  nutrition: [],
  sessions: []
});

export function loadCache(){
  try {
    const v3 = JSON.parse(safeGet(CACHE_KEY));
    if (v3 && v3.progress) return { ...DEFAULT_STATE(), ...v3 };
    const v2 = JSON.parse(safeGet(LEGACY_KEY));
    if (v2 && v2.progress) return { ...DEFAULT_STATE(), ...v2 };
  } catch {}
  return DEFAULT_STATE();
}
export function saveCache(state){ safeSet(CACHE_KEY, JSON.stringify(state)); }

// ─── Pending-ops queue (offline writes) ──────────────────────────────────────
function loadQueue(){ try { return JSON.parse(safeGet(QUEUE_KEY)) || []; } catch { return []; } }
function saveQueue(q){ safeSet(QUEUE_KEY, JSON.stringify(q)); }
function enqueue(op){ const q = loadQueue(); q.push(op); saveQueue(q); }

async function runOp(op){
  if (!supabase) throw new Error("no cloud");
  const t = supabase.from(op.table);
  if (op.kind === "upsert") return await t.upsert(op.row, op.opts || {});
  if (op.kind === "insert") return await t.insert(op.row);
  if (op.kind === "delete") return await t.delete().match(op.match);
  throw new Error("bad op");
}

export async function flushQueue(){
  if (!supabase) return;
  const q = loadQueue();
  if (!q.length) return;
  const remaining = [];
  for (const op of q) {
    try { const { error } = await runOp(op); if (error) remaining.push(op); }
    catch { remaining.push(op); }
  }
  saveQueue(remaining);
}

// ─── Write helpers (optimistic; queue on failure) ────────────────────────────
async function pushOp(op){
  if (!supabase) return; // localStorage-only mode
  try {
    const { error } = await runOp(op);
    if (error) enqueue(op);
  } catch { enqueue(op); }
}

export function upsertAppState(state){
  return pushOp({
    kind:"upsert",
    table:"app_state",
    row:{ user_id:USER_ID, week:state.week, progress:state.progress, swaps:state.swaps, videos:state.videos, updated_at:new Date().toISOString() },
    opts:{ onConflict:"user_id" }
  });
}

export function insertSession(session){
  return pushOp({ kind:"insert", table:"sessions", row:{ ...session, user_id:USER_ID } });
}

export function insertExerciseLog(row){
  return pushOp({ kind:"insert", table:"exercise_logs", row:{ ...row, user_id:USER_ID, logged_at:new Date().toISOString() } });
}

export function upsertWeight(kg, recorded_on){
  return pushOp({
    kind:"upsert",
    table:"weights",
    row:{ user_id:USER_ID, kg, recorded_on, updated_at:new Date().toISOString() },
    opts:{ onConflict:"user_id,recorded_on" }
  });
}

export function upsertNutrition({ recorded_on, rating, note }){
  return pushOp({
    kind:"upsert",
    table:"nutrition",
    row:{ user_id:USER_ID, recorded_on, rating, note: note || null, updated_at:new Date().toISOString() },
    opts:{ onConflict:"user_id,recorded_on" }
  });
}

// ─── Cloud reads (called on boot to reconcile with cache) ────────────────────
export async function fetchFromCloud(){
  if (!supabase) return null;
  try {
    const [st, sess, logs, wts, nut] = await Promise.all([
      supabase.from("app_state").select("*").eq("user_id", USER_ID).maybeSingle(),
      supabase.from("sessions").select("*").eq("user_id", USER_ID).order("completed_at", { ascending:false }).limit(200),
      supabase.from("exercise_logs").select("*").eq("user_id", USER_ID).order("logged_at", { ascending:false }).limit(500),
      supabase.from("weights").select("*").eq("user_id", USER_ID).order("recorded_on", { ascending:true }).limit(200),
      supabase.from("nutrition").select("*").eq("user_id", USER_ID).order("recorded_on", { ascending:false }).limit(60)
    ]);
    return {
      appState: st.data || null,
      sessions: sess.data || [],
      logs: logs.data || [],
      weights: wts.data || [],
      nutrition: nut.data || []
    };
  } catch (e) {
    console.warn("cloud fetch failed", e);
    return null;
  }
}

export const isCloudConfigured = cloudConfigured;
