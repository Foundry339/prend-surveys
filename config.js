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
export const ADAPTER = "local";

/**
 * FIREBASE CONFIG  (only used when ADAPTER = "firebase")
 * Paste the values from: Firebase console → Project settings → Your apps → Web app.
 * These values are safe to publish; access is controlled by your Firestore rules.
 */
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

/** Firestore collection that holds one document per survey. */
export const FIRESTORE_COLLECTION = "surveys";

/** All open/close logic and displayed dates use this time zone. */
export const TIME_ZONE = "America/New_York";

/** Where the survey definitions live. */
export const SURVEYS_URL = "surveys.json";
