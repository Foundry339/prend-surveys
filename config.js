/* ==========================================================================
   Prend Surveys — site configuration
   ========================================================================== */

/**
 * WHERE VOTES ARE STORED  (the one-line switch)
 *
 *   "local"    – counts live in this browser's localStorage only. Great for
 *                development and demos. Results are NOT shared between
 *                devices: every browser sees only its own votes.
 *   "firebase" – counts live in Firebase Firestore, shared by everyone.
 *                Fill in FIREBASE_CONFIG below first (see README.md).
 */
export const ADAPTER = "firebase";

/**
 * FIREBASE CONFIG  (only used when ADAPTER = "firebase")
 * Paste the values from: Firebase console → Project settings → Your apps → Web app.
 * These values are safe to publish; access is controlled by your Firestore rules.
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBlfuU9ksarjygvuyJ7vX5ZIJak6F6zhKE",
  authDomain: "prend-surveys.firebaseapp.com",
  projectId: "prend-surveys",
  storageBucket: "prend-surveys.firebasestorage.app",
  messagingSenderId: "767420321919",
  appId: "1:767420321919:web:70f44b02a6775b6cd02f4a",
};

/** Firestore collection that holds one document per survey. */
export const FIRESTORE_COLLECTION = "surveys";

/** All open/close logic and displayed dates use this time zone. */
export const TIME_ZONE = "America/New_York";

/** Where the survey definitions live. */
export const SURVEYS_URL = "surveys.json";
