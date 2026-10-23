/* ==========================================================================
   Prend Surveys — data layer
   --------------------------------------------------------------------------
   A tiny, swappable storage module. The rest of the app only ever calls:

     getResults(surveyId)            -> Promise<number[]>   counts by option index
     submitVote(surveyId, optIndex)  -> Promise<void>

   Only AGGREGATE COUNTS are stored. Nothing identifying: no names, no IPs,
   no per-voter records.

   Pick the adapter in config.js (ADAPTER = "local" | "firebase").
   To add another backend, write an object with the same two methods and
   register it in ADAPTERS below.
   ========================================================================== */

import { ADAPTER, FIREBASE_CONFIG, FIRESTORE_COLLECTION } from "./config.js";

/* --------------------------------------------------------------------------
   Adapter 1: "local"
   ⚠ Results live in THIS browser's localStorage only. Other devices never
   see them. This mode exists so the app works instantly with no backend.
   -------------------------------------------------------------------------- */

const LOCAL_PREFIX = "prendSurveys:results:";
const memoryFallback = new Map(); // used if localStorage is blocked (private mode, etc.)

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return memoryFallback.get(key) ?? null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { memoryFallback.set(key, value); }
}

function readLocalCounts(surveyId) {
  try {
    const parsed = JSON.parse(lsGet(LOCAL_PREFIX + surveyId) || "[]");
    return Array.isArray(parsed) ? parsed.map((n) => Number(n) || 0) : [];
  } catch {
    return [];
  }
}

const localAdapter = {
  name: "local",

  async getResults(surveyId) {
    return readLocalCounts(surveyId);
  },

  async submitVote(surveyId, optionIndex) {
    const counts = readLocalCounts(surveyId);
    while (counts.length <= optionIndex) counts.push(0);
    counts[optionIndex] += 1;
    lsSet(LOCAL_PREFIX + surveyId, JSON.stringify(counts));
  },

  /** Demo helper: store sample counts only if nothing is stored yet. */
  seed(surveyId, counts) {
    if (lsGet(LOCAL_PREFIX + surveyId) === null) {
      lsSet(LOCAL_PREFIX + surveyId, JSON.stringify(counts));
    }
  },
};

/* --------------------------------------------------------------------------
   Adapter 2: "firebase"  (Cloud Firestore, modular SDK loaded from a CDN)
   Document shape — one per survey, at  <FIRESTORE_COLLECTION>/<surveyId>:
       { c0: 12, c1: 7, c2: 3 }        // c<N> = vote count for option N
   Votes use increment(1), so concurrent voters never overwrite each other.
   -------------------------------------------------------------------------- */

const FIREBASE_VERSION = "10.14.1";
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_FS_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`;

let firebasePromise = null;

/** Lazily loads the SDK (only when the firebase adapter is actually used). */
function loadFirebase() {
  if (!firebasePromise) {
    firebasePromise = (async () => {
      const [{ initializeApp }, fs] = await Promise.all([
        import(FIREBASE_APP_URL),
        import(FIREBASE_FS_URL),
      ]);
      const db = fs.getFirestore(initializeApp(FIREBASE_CONFIG));
      return { db, ...fs };
    })().catch((err) => {
      firebasePromise = null; // allow a retry after a network failure
      throw err;
    });
  }
  return firebasePromise;
}

const firebaseAdapter = {
  name: "firebase",

  async getResults(surveyId) {
    const { db, doc, getDoc } = await loadFirebase();
    const snap = await getDoc(doc(db, FIRESTORE_COLLECTION, surveyId));
    const counts = [];
    if (snap.exists()) {
      for (const [key, value] of Object.entries(snap.data())) {
        const match = /^c(\d+)$/.exec(key);
        if (match) counts[Number(match[1])] = Number(value) || 0;
      }
    }
    return Array.from(counts, (n) => n || 0); // fill holes with 0
  },

  async submitVote(surveyId, optionIndex) {
    const { db, doc, setDoc, increment } = await loadFirebase();
    // merge:true creates the document on the very first vote, and otherwise
    // behaves as an update that atomically adds 1 to a single field.
    await setDoc(
      doc(db, FIRESTORE_COLLECTION, surveyId),
      { ["c" + optionIndex]: increment(1) },
      { merge: true }
    );
  },
};

/* -------------------------------------------------------------------------- */

const ADAPTERS = { local: localAdapter, firebase: firebaseAdapter };
const adapter = ADAPTERS[ADAPTER];

if (!adapter) {
  console.error(
    `[Prend Surveys] Unknown ADAPTER "${ADAPTER}" in config.js. Use "local" or "firebase".`
  );
}

export const adapterName = ADAPTER;

export function getResults(surveyId) {
  return adapter.getResults(surveyId);
}

export function submitVote(surveyId, optionIndex) {
  return adapter.submitVote(surveyId, optionIndex);
}

/**
 * Local-adapter demo only: pre-fills results for surveys that define
 * "sampleResults" in surveys.json. No-op for every other adapter.
 */
export function seedDemoResults(surveys) {
  if (typeof adapter.seed !== "function") return;
  for (const s of surveys) {
    if (Array.isArray(s.sampleResults)) adapter.seed(s.id, s.sampleResults);
  }
}
