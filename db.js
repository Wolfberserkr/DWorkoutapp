// Firebase Firestore sync layer — drop-in replacement for the Supabase db.js.
// Same exported API, so app.js is unchanged.
// Single shared user: hard-coded USER_ID, no login screen.
// Security is handled by Firestore rules (firestore.rules) which restrict all
// reads and writes to the specific USER_ID path.

import { initializeApp }      from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc,
  collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ─── CONFIGURE ME ────────────────────────────────────────────────────────────
// 1. Go to https://console.firebase.google.com
// 2. Create a project → Add a web app → copy the firebaseConfig object
// 3. Paste it below
// 4. Enable Firestore Database (Start in production mode)
// 5. Open Firestore → Rules → paste the contents of firestore.rules → Publish
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyD3ccfsh3MQTaqR6EMN3c-EPmOijjJy6lY",
  authDomain:        "d-workout-app-8c7ca.firebaseapp.com",
  projectId:         "d-workout-app-8c7ca",
  storageBucket:     "d-workout-app-8c7ca.firebasestorage.app",
  messagingSenderId: "609823007828",
  appId:             "1:609823007828:web:64918d7c17e7dd42af79c1"
};
// Must match the userId value in firestore.rules
export const USER_ID = "a1f0c8d2-3b4e-4f5a-9c0d-1e2f3a4b5c6d";
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY  = "reset_state_v3";
const QUEUE_KEY  = "reset_pending_ops_v1";
const LEGACY_KEY = "reset_state_v2";

export const isCloudConfigured = !!(FIREBASE_CONFIG.projectId);

let db = null;
if (isCloudConfigured) {
  try {
    db = getFirestore(initializeApp(FIREBASE_CONFIG));
  } catch (e) {
    console.warn("Firebase init failed", e);
  }
}

// Shorthand helpers for user sub-collections
const uDoc = (...segs) => doc(db,        "users", USER_ID, ...segs);
const uCol = (...segs) => collection(db, "users", USER_ID, ...segs);

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
function enqueue(op){ const q = loadQueue(); q.push(op); saveQueue(q); }

async function runOp(op){
  if (!db) throw new Error("no cloud");
  if (op.kind === "setDoc") {
    await setDoc(doc(db, ...op.path), op.data, op.merge ? { merge:true } : {});
  } else if (op.kind === "addDoc") {
    await addDoc(collection(db, ...op.path), op.data);
  } else {
    throw new Error("unknown op: " + op.kind);
  }
}

export async function flushQueue(){
  if (!db) return;
  const q = loadQueue();
  if (!q.length) return;
  const remaining = [];
  for (const op of q) { try { await runOp(op); } catch { remaining.push(op); } }
  saveQueue(remaining);
}

async function pushOp(op){
  if (!db) return;
  try { await runOp(op); } catch { enqueue(op); }
}

// ─── Write helpers ───────────────────────────────────────────────────────────
export function upsertAppState(state){
  return pushOp({
    kind:"setDoc", merge:true,
    path:["users", USER_ID, "app_state", "singleton"],
    data:{ week:state.week, progress:state.progress, swaps:state.swaps,
           videos:state.videos, updated_at:new Date().toISOString() }
  });
}

export function insertSession(session){
  return pushOp({
    kind:"addDoc",
    path:["users", USER_ID, "sessions"],
    data:{ ...session, user_id:USER_ID }
  });
}

export function insertExerciseLog(row){
  return pushOp({
    kind:"addDoc",
    path:["users", USER_ID, "exercise_logs"],
    data:{ ...row, user_id:USER_ID, logged_at:new Date().toISOString() }
  });
}

export function upsertWeight(kg, recorded_on){
  return pushOp({
    kind:"setDoc", merge:true,
    path:["users", USER_ID, "weights", recorded_on],
    data:{ kg, recorded_on, user_id:USER_ID, updated_at:new Date().toISOString() }
  });
}

export function upsertNutrition({ recorded_on, rating, note }){
  return pushOp({
    kind:"setDoc", merge:true,
    path:["users", USER_ID, "nutrition", recorded_on],
    data:{ recorded_on, rating, note:note||null, user_id:USER_ID, updated_at:new Date().toISOString() }
  });
}

// ─── Cloud reads (called on boot to reconcile with cache) ────────────────────
export async function fetchFromCloud(){
  if (!db) return null;
  try {
    const [stSnap, sessSnap, logsSnap, wtsSnap, nutSnap] = await Promise.all([
      getDoc(uDoc("app_state","singleton")),
      getDocs(query(uCol("sessions"),      orderBy("completed_at","desc"), limit(200))),
      getDocs(query(uCol("exercise_logs"), orderBy("logged_at","desc"),    limit(500))),
      getDocs(query(uCol("weights"),       orderBy("recorded_on","asc"))),
      getDocs(query(uCol("nutrition"),     orderBy("recorded_on","desc"),  limit(60)))
    ]);
    return {
      appState:  stSnap.exists()     ? stSnap.data()                        : null,
      sessions:  sessSnap.docs.map(d => ({ id:d.id, ...d.data() })),
      logs:      logsSnap.docs.map(d => d.data()),
      weights:   wtsSnap.docs.map(d  => d.data()),
      nutrition: nutSnap.docs.map(d  => d.data())
    };
  } catch(e) {
    console.warn("cloud fetch failed", e);
    return null;
  }
}
