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
// Flash-Lite: o mais rápido e com a maior cota grátis (cerca de 500 pedidos/dia no plano grátis).
const CHAT_MODELS = [AI_MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"].filter((x, i, a) => x && a.indexOf(x) === i);
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let chatModelOk = CHAT_MODELS.includes(lsGet("ea-ai-model")) ? lsGet("ea-ai-model") : null;
async function getModel(name) {
  const inst = await getAIInst();
  // Sem "pensar" antes de responder: a resposta de texto começa a aparecer bem mais rápido.
  const generationConfig = { maxOutputTokens: 700, temperature: 0.7 };
  if (/2\.5/.test(name)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  // Os Flash-Lite 3.x já respondem sem "pensar" (nível mínimo) por padrão.
  return aiMod.getGenerativeModel(inst, { model: name, generationConfig });
}
// Conta de usos da IA no dia: lê do Firestore uma vez e depois conta aqui (resposta mais rápida).
const aiUsed = { day: "", n: 0 };
/* limite diário de IA: o administrador (Kevin) tem mais usos que os outros usuários */
const ADMIN_AI_LIMIT = 300;
const aiLimit = () => { const u = auth.currentUser; return u && ADMIN_UIDS.includes(u.uid) ? Math.max(ADMIN_AI_LIMIT, AI_DAILY_LIMIT) : AI_DAILY_LIMIT; };
async function aiUsedToday(dref) {
  if (aiUsed.day !== today()) {
    aiUsed.day = today(); aiUsed.n = 0;
    try { const d = await getDoc(dref); if (d.exists()) aiUsed.n = d.data().ai || 0; } catch (e) {}
  }
  return aiUsed.n;
}
// Voz IA: modelos de texto-para-fala do Gemini (o primeiro que funcionar fica guardado).
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
let ttsModelOk = TTS_MODELS.includes(lsGet("ea-tts-model")) ? lsGet("ea-tts-model") : null;
async function ttsOnce(name, text, lang) {
  const inst = await getAIInst();
  const mdl = aiMod.getGenerativeModel(inst, {
    model: name,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: Object.assign({ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }, lang ? { languageCode: lang } : {}) }
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
      const qs = await getDocs(query(collection(db, "users", u.uid, "chats"), orderBy("upd", "desc"), limit(200)));
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
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    let text = "", ok = false, last = null;
    const order = chatModelOk ? [chatModelOk, ...CHAT_MODELS.filter(x => x !== chatModelOk)] : CHAT_MODELS;
    for (const name of order) {
      text = "";
      try {
        const m = await getModel(name);
        const r = await m.generateContentStream(prompt);
        for await (const ch of r.stream) { text += ch.text(); if (onText) onText({ text }); }
        chatModelOk = name; lsSet("ea-ai-model", name); ok = true; break;
      } catch (e) { console.warn("ai", name, e); last = e; if (text) break; }
    }
    if (!ok) throw { code: "ai", message: String(last && last.message || last) };
    aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
    return { text };
  },
  async speak(text, lang) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    await getAIInst();
    let out = null, last = null;
    for (const name of (ttsModelOk ? [ttsModelOk, ...TTS_MODELS.filter(x => x !== ttsModelOk)] : TTS_MODELS)) {
      try { out = await ttsOnce(name, String(text).slice(0, 1500), lang); ttsModelOk = name; lsSet("ea-tts-model", name); break; }
      catch (e) { last = e; console.warn("tts", name, e); }
    }
    if (!out) throw { code: "tts", message: String(last && last.message || last) };
    aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
    return out;
  },

  async define(word, sentence, mode) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    const w = String(word).slice(0, 300), ctx = String(sentence || "").slice(0, 240);
    const prompt = mode === "ex"
      ? "Word or expression: \"" + w + "\". Sentence where it appears: \"" + ctx + "\".\nReturn ONLY JSON, all in English: {\"examples\": [\"three new, natural, varied example sentences using it with the same meaning\"]}."
      : mode === "pt"
      ? "Word or expression: \"" + w + "\". Sentence where it appears: \"" + ctx + "\".\nReturn ONLY JSON {\"pt\": \"the Brazilian Portuguese translation of it as used here (a whole sentence gets a full natural translation), max 40 words\"}."
      : "Word or expression: \"" + w + "\". Sentence where it appears: \"" + ctx + "\".\nReturn ONLY JSON, all in English, no Portuguese: {\"pos\": \"part of speech\", \"def\": \"a short, simple definition in the style of the Cambridge Learner's Dictionary for the meaning used here — if it is a whole sentence or clause, a simple English explanation of what it means and when people say it — max 35 words\", \"example\": \"one new natural example sentence using it\"}.";
    const order = chatModelOk ? [chatModelOk, ...CHAT_MODELS.filter(x => x !== chatModelOk)] : CHAT_MODELS;
    let last = null;
    for (const name of order) {
      try {
        const inst = await getAIInst();
        const mdl = aiMod.getGenerativeModel(inst, { model: name, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 400, temperature: 0.2 } });
        const r = await mdl.generateContent(prompt);
        const obj = JSON.parse(r.response.text().trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim());
        aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
        return obj;
      } catch (e) { console.warn("define", name, e); last = e; }
    }
    throw { code: "ai", message: String(last && last.message || last) };
  },
  // ---------- Matérias: lê o texto de um link com a ferramenta "URL context" do Gemini ----------
  async readUrl(url) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    const prompt = "Open this web page: " + String(url).slice(0, 500) + "\n" +
      "The user wants to read it inside an English-learning reader app. Return exactly this format and nothing else:\n" +
      "TITLE: <the real headline of the article — never site menu text such as 'Skip to content', 'Menu' or 'Sign in'>\nSOURCE: <the site or publication name>\nTEXT:\n<the main article body, paragraph by paragraph as written on the page, separated by blank lines. Skip menus, ads, photo captions, related links and comments.>\n" +
      "If you cannot open the page or it has no article, return only the word ERROR.";
    const order = [chatModelOk, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"].filter((x, i, a) => x && a.indexOf(x) === i);
    let last = null;
    for (const name of order) {
      try {
        const inst = await getAIInst();
        const mdl = aiMod.getGenerativeModel(inst, { model: name, tools: [{ urlContext: {} }], generationConfig: { maxOutputTokens: 8192, temperature: 0 } });
        const r = await mdl.generateContent(prompt);
        const txt = (r.response.text() || "").trim();
        aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
        if (!txt || /^ERROR\b/.test(txt)) throw { code: "nopage" };
        return txt;
      } catch (e) { console.warn("readUrl", name, e); last = e; if (e && e.code === "nopage") break; }
    }
    throw { code: (last && last.code) || "ai", message: String(last && last.message || last) };
  },
  async articleMeta(text, lang) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    const prompt = "Here is the start of a text the student will read:\n\"\"\"\n" + String(text).slice(0, 3500) + "\n\"\"\"\nReturn ONLY JSON: {\"title\": \"a short, specific headline for this text, max 10 words, " + (lang === "en" ? "in English" : "in the text's language") + "\"}.";
    const order = chatModelOk ? [chatModelOk, ...CHAT_MODELS.filter(x => x !== chatModelOk)] : CHAT_MODELS;
    let last = null;
    for (const name of order) {
      try {
        const inst = await getAIInst();
        const mdl = aiMod.getGenerativeModel(inst, { model: name, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 120, temperature: 0.3 } });
        const r = await mdl.generateContent(prompt);
        const obj = JSON.parse(r.response.text().trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim());
        aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
        return obj;
      } catch (e) { console.warn("articleMeta", name, e); last = e; }
    }
    throw { code: "ai", message: String(last && last.message || last) };
  },
  // ---------- Meus cadernos (fotos de páginas do aluno) ----------
  async readPage(b64, mime) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const dref = doc(db, "users", u.uid, "days", today());
    if ((await aiUsedToday(dref)) >= aiLimit()) throw { code: "limit" };
    const prompt = "This is a photo of a page from a student's English notebook, textbook or worksheet. The student is Brazilian.\n" +
      "Read it carefully (handwriting included). Keep only the study content, and CORRECT every English mistake you find.\n" +
      "Return ONLY JSON with these keys:\n" +
      "{\"ok\": true, \"title\": \"short title of the page, max 6 words\", \"topic\": \"subject in Portuguese, max 3 words\", " +
      "\"notebook\": \"suggested notebook name in Portuguese, max 4 words\", \"notebook_en\": \"the same notebook name in English\", \"date\": \"YYYY-MM-DD if a date is written on the page, else empty\", " +
      "\"summary\": \"1 or 2 sentences in Portuguese about what the page teaches\", " +
      "\"phrases\": [\"up to 12 corrected English sentences or examples from the page\"], " +
      "\"vocab\": [[\"English word or expression\", \"meaning in Portuguese, max 8 words\"]], " +
      "\"tip\": \"one short study tip in Portuguese\", \"summary_en\": \"the same summary in English\", \"tip_en\": \"the same tip in English\", \"fixes\": [\"mistakes you corrected, as 'wrong → right', max 6\"]}\n" +
      "If the photo is not a study page, return {\"ok\": false}.";
    const order = chatModelOk ? [chatModelOk, ...CHAT_MODELS.filter(x => x !== chatModelOk)] : CHAT_MODELS;
    let last = null;
    for (const name of order) {
      try {
        const inst = await getAIInst();
        const mdl = aiMod.getGenerativeModel(inst, { model: name, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2000, temperature: 0.2 } });
        const r = await mdl.generateContent([{ text: prompt }, { inlineData: { data: b64, mimeType: mime || "image/jpeg" } }]);
        let txt = r.response.text().trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const obj = JSON.parse(txt);
        aiUsed.n++; setDoc(dref, { ai: increment(1) }, { merge: true }).catch(() => {});
        return obj;
      } catch (e) { console.warn("readPage", name, e); last = e; }
    }
    throw { code: "ai", message: String(last && last.message || last) };
  },
  async loadNotebooks() {
    const u = auth.currentUser; if (!u) return { notebooks: [], pages: [] };
    const out = { notebooks: [], pages: [] };
    try {
      const [a, b] = await Promise.all([getDocs(collection(db, "users", u.uid, "notebooks")), getDocs(collection(db, "users", u.uid, "pages"))]);
      a.forEach(d => out.notebooks.push(Object.assign({ id: d.id }, d.data())));
      b.forEach(d => { const x = Object.assign({ id: d.id }, d.data()); x.v = (x.v || []).map(p => p && typeof p === "object" && !Array.isArray(p) ? [p.w, p.m] : p); out.pages.push(x); });
    } catch (e) { console.warn("loadNotebooks", e); out.error = true; }
    return out;
  },
  async saveNotebook(nb) { const u = auth.currentUser; if (!u) throw { code: "auth" }; const x = plain(nb); delete x.id; await setDoc(doc(db, "users", u.uid, "notebooks", nb.id), x); },
  async savePage(pg, img) {
    const u = auth.currentUser; if (!u) throw { code: "auth" };
    const x = plain(pg); delete x.id;
    // O Firestore não aceita lista dentro de lista: o vocabulário vai como {w, m}.
    x.v = (x.v || []).map(p => Array.isArray(p) ? { w: String(p[0] || ""), m: String(p[1] || "") } : p);
    await setDoc(doc(db, "users", u.uid, "pages", pg.id), x);
    if (img) await setDoc(doc(db, "users", u.uid, "pageimg", pg.id), { img });
  },
  async pageImage(id) { const u = auth.currentUser; if (!u) return null; const d = await getDoc(doc(db, "users", u.uid, "pageimg", id)); return d.exists() ? d.data().img : null; },
  async deletePage(id) { const u = auth.currentUser; if (!u) return; await deleteDoc(doc(db, "users", u.uid, "pages", id)); try { await deleteDoc(doc(db, "users", u.uid, "pageimg", id)); } catch (e) {} },
  async deleteNotebook(id) { const u = auth.currentUser; if (!u) return; await deleteDoc(doc(db, "users", u.uid, "notebooks", id)); },
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
