// Central do administrador: leitura de uso, sugestões e liberação de versões.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit, serverTimestamp, documentId } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UIDS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ms = t => t && t.toMillis ? t.toMillis() : 0;

window.ADM = {
  onAuth(cb) { onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, name: u.displayName || u.email || "", admin: ADMIN_UIDS.includes(u.uid) } : null)); },
  async login() { const p = new GoogleAuthProvider(); try { await signInWithPopup(auth, p); } catch (e) { if (e && e.code === "auth/popup-blocked") await signInWithRedirect(auth, p); else throw e; } },
  logout: () => signOut(auth),
  async users() {
    const qs = await getDocs(query(collection(db, "users"), orderBy("lastSeen", "desc"), limit(300)));
    const out = []; qs.forEach(d => { const x = d.data(); out.push(Object.assign({}, x, { id: d.id, lastSeen: ms(x.lastSeen) })); }); return out;
  },
  async days(uid) {
    const qs = await getDocs(query(collection(db, "users", uid, "days"), orderBy(documentId(), "desc"), limit(14)));
    const out = []; qs.forEach(d => out.push(Object.assign({ day: d.id }, d.data()))); return out;
  },
  async feedback() {
    const qs = await getDocs(query(collection(db, "feedback"), orderBy("ts", "desc"), limit(200)));
    const out = []; qs.forEach(d => { const x = d.data(); out.push(Object.assign({}, x, { id: d.id, ts: ms(x.ts) })); }); return out;
  },
  async answer(id, status, reply) { await setDoc(doc(db, "feedback", id), { status, reply: String(reply || "").slice(0, 1500), answered: serverTimestamp() }, { merge: true }); },
  async release() {
    let rel = null; try { const r = await getDoc(doc(db, "release", "current")); if (r.exists()) rel = r.data(); } catch (e) {}
    let file = {}; try { file = await (await fetch("versions.json", { cache: "no-store" })).json(); } catch (e) {}
    return { stable: (rel && rel.stable) || file.default || 1, beta: file.beta || 0, notes: file.notes || {} };
  },
  async setStable(n) { await setDoc(doc(db, "release", "current"), { stable: n, updated: serverTimestamp() }, { merge: true }); }
};
window.dispatchEvent(new Event("adm-ready"));
