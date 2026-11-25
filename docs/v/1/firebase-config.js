// Configuração pública do Firebase (estas chaves são públicas por natureza).
// Cole aqui o bloco firebaseConfig do console do Firebase.
export const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "COLE_AQUI.firebaseapp.com",
  projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI.firebasestorage.app",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};
// UID do administrador (aparece na central admin na primeira vez que você entra).
export const ADMIN_UIDS = ["COLE_SEU_UID_AQUI"];
// Modelo de IA (Gemini pelo Firebase AI Logic, plano Spark) e limite diário por pessoa.
export const AI_MODEL = "gemini-2.5-flash";
export const AI_DAILY_LIMIT = 60;
// Chave do site do reCAPTCHA (App Check / Fraud Defense). Deixe vazio até configurar.
export const RECAPTCHA_KEY = "";
export const APP_VERSION = 1;
