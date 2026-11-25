// Ponte entre o app e o Firebase (Auth, Firestore, AI Logic).
// Expõe window.EA para o app. Nada aqui envia dados para fora do Firebase.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, signInAnonymously, linkWithPopup, signOut, updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
  serverTimestamp, increment, addDoc, where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UIDS, AI_MODEL, AI_DAILY_LIMIT, RECAPTCHA_KEY, APP_VERSION } from "./firebase-config.js";

const ROOT = new URL("../../", location.href);
const app = initializeApp(firebaseConfig);
if (RECAPTCHA_KEY) {
  try {
    const ac = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js");
    ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(RECAPTCHA_KEY), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn("App Check", e); }
}
const auth = getAuth(app);
const db = getFirestore(app);
let model = null, aiMod = null, aiInst = null;
async function getAIInst() {
  if (aiInst) return aiInst;
  aiMod = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js");
  aiInst = aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() });
  return aiInst;
}
// Se o modelo principal falhar (ex.: aposentado), tenta os próximos e guarda o que funcionou.
const CHAT_MODELS = [AI_MODEL, "gemini-flash-latest", "gemini-3-flash-preview", "gemini-2.5-flash-lite"].filter((x, i, a) => x && a.indexOf(x) === i);
let chatModelOk = null;
async function getModel(name) {
  return aiMod.getGenerativeModel(await getAIInst(), { model: name });
}
// Voz IA: modelos de texto-para-fala do Gemini (o primeiro que funcionar fica guardado).
const TTS_MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
let ttsModelOk = null;
async function ttsOnce(name, text, lang) {
  const mdl = aiMod.getGenerativeModel(await getAIInst(), {
    model: name,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }, languageCode: lang } }
  });
  const r = await mdl.generateContent([{ text }]);
  const parts = (((r.response.candidates || [])[0] || {}).content || {}).parts || [];
  const p = parts.find(x => x.inlineData && x.inlineData.data);
  if (!p) throw { code: "noaudio" };
  return { data: p.inlineData.data, mime: p.inlineData.mimeType || "" };
}

const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const plain = o => JSON.parse(JSON.stringify(o));

const ERR = {
  "auth/invalid-email": "Email inválido.",
  "auth/missing-password": "Digite a senha.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/email-already-in-use": "Esse email já tem conta. Use ENTRAR.",
  "auth/invalid-credential": "Email ou senha incorretos.",
  "auth/wrong-password": "Email ou senha incorretos.",
  "auth/user-not-found": "Não existe conta com esse email.",
  "auth/too-many-requests": "Muitas tentativas. Espere um pouco e tente de novo.",
  "auth/network-request-failed": "Sem internet. Confira a conexão.",
  "auth/popup-closed-by-user": "A janela do Google foi fechada.",
  "auth/credential-already-in-use": "Essa conta do Google já está em uso por outro perfil.",
  "auth/operation-not-allowed": "Esse tipo de login ainda não foi ativado no Firebase.",
  "auth/unauthorized-domain": "Este site ainda não foi autorizado no Firebase (Domínios autorizados)."
};
const msg = e => ERR[e && e.code] || "Não deu certo (" + ((e && e.code) || "erro") + "). Tente de novo.";

let current = null, beatTimer = null, activeSince = Date.now(), pendingMs = 0;

function userInfo(u) {
  if (!u) return null;
  return { uid: u.uid, name: u.displayName || (u.email ? u.email.split("@")[0] : ""), email: u.email || "", anon: u.isAnonymous, admin: ADMIN_UIDS.includes(u.uid) };
}

async function beat(extra) {
  if (!current) return;
  const now = Date.now();
  if (document.visibilityState === "visible") { pendingMs += now - activeSince; }
  activeSince = now;
  const ms = Math.min(pendingMs, 10 * 60 * 1000); pendingMs = 0;
  const u = auth.currentUser; if (!u) return;
  const base = { lastSeen: serverTimestamp(), name: u.displayName || current.name || "", email: u.email || "", anon: u.isAnonymous, version: APP_VERSION, totalMs: increment(ms) };
  try {
    await setDoc(doc(db, "users", u.uid), Object.assign(base, extra || {}), { merge: true });
    if (ms) await setDoc(doc(db, "users", u.uid, "days", today()), { ms: increment(ms) }, { merge: true });
  } catch (e) { console.warn("beat", e); }
}
document.addEventListener("visibilitychange", () => {
  if (!current) return;
  if (document.visibilityState === "hidden") { pendingMs += Date.now() - activeSince; activeSince = Date.now(); beat(); }
  else activeSince = Date.now();
});

const EA = {
  ROOT: ROOT.href,
  ready: true,
  onAuth(cb) {
    getRedirectResult(auth).catch(() => {});
    if (isSignInWithEmailLink(auth, location.href)) {
      let email = localStorage.getItem("ea-link-email") || window.prompt("Confirme seu email para entrar:") || "";
      signInWithEmailLink(auth, email.trim(), location.href)
        .then(() => { localStorage.removeItem("ea-link-email"); history.replaceState(null, "", location.pathname + location.hash); })
        .catch(e => cb(null, msg(e)));
    }
    onAuthStateChanged(auth, async u => {
      current = userInfo(u);
      clearInterval(beatTimer);
      if (u) {
        activeSince = Date.now();
        try { await setDoc(doc(db, "users", u.uid), { visits: increment(1), created: u.metadata.creationTime || "" }, { merge: true }); } catch (e) {}
        beat(); beatTimer = setInterval(() => beat(), 90 * 1000);
      }
      cb(current);
    });
  },
  user: () => current,
  async google() {
    const p = new GoogleAuthProvider();
    try { await signInWithPopup(auth, p); }
    catch (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment" || e.code === "auth/cancelled-popup-request")) { await signInWithRedirect(auth, p); return; }
      throw msg(e);
    }
  },
  async emailLogin(email, pass) { try { await signInWithEmailAndPassword(auth, email.trim(), pass); } catch (e) { throw msg(e); } },
  async emailCreate(email, pass, name) {
    try { const r = await createUserWithEmailAndPassword(auth, email.trim(), pass); if (name) await updateProfile(r.user, { displayName: name }); }
    catch (e) { throw msg(e); }
  },
  async emailLink(email) {
    try { await sendSignInLinkToEmail(auth, email.trim(), { url: ROOT.href, handleCodeInApp: true }); localStorage.setItem("ea-link-email", email.trim()); }
    catch (e) { throw msg(e); }
  },
  async resetPassword(email) { try { await sendPasswordResetEmail(auth, email.trim()); } catch (e) { throw msg(e); } },
  async anon() { try { await signInAnonymously(auth); } catch (e) { throw msg(e); } },
  async linkGoogle() { try { await linkWithPopup(auth.currentUser, new GoogleAuthProvider()); current = userInfo(auth.currentUser); beat(); return current; } catch (e) { throw msg(e); } },
  async setName(name) { if (auth.currentUser) { await updateProfile(auth.currentUser, { displayName: name }); current = userInfo(auth.currentUser); beat(); } },
  async logout() { await beat(); await signOut(auth); },

  async loadAll() {
    const u = auth.currentUser; if (!u) return {};
    const out = { sessions: [] };
    try {
      const [p, s] = await Promise.all([getDoc(doc(db, "users", u.uid, "private", "profile")), getDoc(doc(db, "users", u.uid, "private", "state"))]);
      if (p.exists()) out.profile = p.data().profile;
      if (s.exists()) out.state = s.data();
      const qs = await getDocs(query(collection(db, "users", u.uid, "chats"), orderBy("upd", "desc"), limit(60)));
      qs.forEach(d => out.sessions.push(d.data()));
    } catch (e) { console.warn("loadAll", e); out.error = true; }
    return out;
  },
  async saveProfile(profile) { const u = auth.currentUser; if (u) await setDoc(doc(db, "users", u.uid, "private", "profile"), { profile: plain(profile) }); },
  async saveState(state) {
    const u = auth.currentUser; if (!u) return;
    await setDoc(doc(db, "users", u.uid, "private", "state"), plain(state));
    await setDoc(doc(db, "users", u.uid), { score: state.score || 0, drills: state.drills || 0, msgs: state.msgs || 0 }, { merge: true });
  },
  async saveSession(x) { const u = auth.currentUser; if (u && x && x.id) await setDoc(doc(db, "users", u.uid, "chats", x.id), plain(x)); },
  async deleteSession(id) { const u = auth.currentUser; if (u) await deleteDoc(doc(db, "users", u.uid, "chats", id)); },
  async countMessage() { const u = auth.currentUser; if (u) try { await setDoc(doc(db, "users", u.uid, "days", today()), { msgs: increment(1) }, { merge: true }); } catch (e) {} },

  async ask(prompt, onText) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    try { const d = await getDoc(dref); if (d.exists() && (d.data().ai || 0) >= AI_DAILY_LIMIT) throw { code: "limit" }; }
    catch (e) { if (e && e.code === "limit") throw e; }
    let text = "", ok = false, last = null;
    for (const name of (chatModelOk ? [chatModelOk] : CHAT_MODELS)) {
      text = "";
      try {
        const m = await getModel(name);
        const r = await m.generateContentStream(prompt);
        for await (const ch of r.stream) { text += ch.text(); if (onText) onText({ text }); }
        chatModelOk = name; ok = true; break;
      } catch (e) { console.warn("ai", name, e); last = e; if (text) break; }
    }
    if (!ok) throw { code: "ai", message: String(last && last.message || last) };
    try { await setDoc(dref, { ai: increment(1) }, { merge: true }); } catch (e) {}
    return { text };
  },
  async speak(text, lang) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    try { const d = await getDoc(dref); if (d.exists() && (d.data().ai || 0) >= AI_DAILY_LIMIT) throw { code: "limit" }; }
    catch (e) { if (e && e.code === "limit") throw e; }
    await getAIInst();
    let out = null, last = null;
    for (const name of (ttsModelOk ? [ttsModelOk] : TTS_MODELS)) {
      try { out = await ttsOnce(name, String(text).slice(0, 1500), lang || "en-US"); ttsModelOk = name; break; }
      catch (e) { last = e; console.warn("tts", name, e); }
    }
    if (!out) throw { code: "tts", message: String(last && last.message || last) };
    try { await setDoc(dref, { ai: increment(1) }, { merge: true }); } catch (e) {}
    return out;
  },
  async feedback(text) {
    const u = auth.currentUser; if (!u) throw "Entre na sua conta primeiro.";
    await addDoc(collection(db, "feedback"), { uid: u.uid, name: u.displayName || current.name || "", email: u.email || "", text: String(text).slice(0, 1500), ts: serverTimestamp(), status: "nova", reply: "" });
  },
  async myFeedback() {
    const u = auth.currentUser; if (!u) return [];
    try {
      const qs = await getDocs(query(collection(db, "feedback"), where("uid", "==", u.uid), limit(20)));
      const out = []; qs.forEach(d => out.push(Object.assign({ id: d.id }, d.data()))); return out;
    } catch (e) { return []; }
  },
  async versions() {
    let rel = null;
    try { const r = await getDoc(doc(db, "release", "current")); if (r.exists()) rel = r.data(); } catch (e) {}
    let file = null;
    try { file = await (await fetch(new URL("versions.json", ROOT), { cache: "no-store" })).json(); } catch (e) {}
    return { stable: (rel && rel.stable) || (file && file.default) || 1, beta: (file && file.beta) || 0, notes: (file && file.notes) || {}, current: APP_VERSION };
  }
};
window.EA = EA;
window.dispatchEvent(new Event("ea-ready"));
