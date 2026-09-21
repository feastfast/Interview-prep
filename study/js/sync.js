/* Optional cloud sync: Firebase Google sign-in + one Firestore document per user.
   The app works fully offline; this only merges progress between devices. */
import * as store from "./store.js";
import { mergeStates } from "./merge.js";

const CFG = {
  apiKey: "AIzaSyCyZPs9zQ9KGlc69cqsQTOfPQoKW98WfPg",
  authDomain: "interview-prep-study.firebaseapp.com",
  projectId: "interview-prep-study",
  storageBucket: "interview-prep-study.firebasestorage.app",
  messagingSenderId: "231207309446",
  appId: "1:231207309446:web:45c48a7c1f8b50dddf0107",
};
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const FLAG = "prep-study-signed-in";

let fb = null, user = null, timer = null, busy = false;
export const status = { user: null, note: "", error: "", syncing: false, last: 0, ready: false };
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(status));

async function ensure() {
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
  const a = app.initializeApp(CFG);
  fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  status.ready = true;
  fb.A.onAuthStateChanged(fb.auth, u => {
    user = u;
    status.user = u ? { name: u.displayName || u.email, email: u.email, photo: u.photoURL } : null;
    if (u) { localStorage.setItem(FLAG, "1"); syncNow(); } else { localStorage.removeItem(FLAG); }
    emit();
  });
  return fb;
}

/* Called on every page load: only touches the network if the user signed in before. */
export function autoStart() {
  if (localStorage.getItem(FLAG)) ensure().catch(e => { status.error = String(e.message || e); emit(); });
}

export async function signIn() {
  status.error = ""; emit();
  try {
    const { auth, A } = await ensure();
    await A.signInWithPopup(auth, new A.GoogleAuthProvider());
  } catch (e) {
    const c = e && e.code;
    status.error = c === "auth/popup-blocked" ? "The browser blocked the sign-in pop-up. Allow pop-ups for this site and try again."
      : c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request" ? ""
      : c === "auth/unauthorized-domain" ? "This domain is not authorised in Firebase (Authentication > Settings > Authorized domains)."
      : "Sign-in failed: " + (e.message || e);
    emit();
  }
}
export async function signOut() {
  if (!fb) return;
  await fb.A.signOut(fb.auth);
  status.note = "";
  emit();
}

const ref = () => fb.F.doc(fb.db, "users", user.uid, "data", "progress");

export async function syncNow() {
  if (!user || busy) return;
  busy = true; status.syncing = true; status.error = ""; emit();
  try {
    const snap = await fb.F.getDoc(ref());
    const remote = snap.exists() ? JSON.parse(snap.data().blob) : null;
    const merged = mergeStates(store.get(), remote);
    store.replace(merged, "remote");
    await fb.F.setDoc(ref(), { blob: JSON.stringify(merged), updated: fb.F.serverTimestamp(), v: 1 });
    status.last = Date.now(); status.note = "Synced";
  } catch (e) {
    status.error = e && e.code === "permission-denied" ? "Sync was refused (check the Firestore rules)." : "Sync failed: " + (e.message || e);
  } finally { busy = false; status.syncing = false; emit(); }
}

/* Push soon after local changes (debounced), and re-pull when the tab becomes visible again. */
export function scheduleSync() { if (!user) return; clearTimeout(timer); timer = setTimeout(syncNow, 4000); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && user) syncNow(); });
