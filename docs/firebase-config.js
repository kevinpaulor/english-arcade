// Configuração pública do Firebase (estas chaves são públicas por natureza).
// Cole aqui o bloco firebaseConfig do console do Firebase.
export const firebaseConfig = {
  apiKey: "AIzaSyC8I45qwgFRUTIqRrDbx83sREQVf7z1Hus",
  authDomain: "english-arcade-cced9.firebaseapp.com",
  projectId: "english-arcade-cced9",
  storageBucket: "english-arcade-cced9.firebasestorage.app",
  messagingSenderId: "698700392290",
  appId: "1:698700392290:web:6f8c27eeb64e28ca97ae3b"
};
// UID do administrador (aparece na central admin na primeira vez que você entra).
export const ADMIN_UIDS = ["GDlCUy3WvYYXGasJxpFa6tWCm1S2"];
// Modelo de IA (Gemini pelo Firebase AI Logic, plano Spark) e limite diário por pessoa.
export const AI_MODEL = "gemini-2.5-flash";
export const AI_DAILY_LIMIT = 60;
// Chave do site do reCAPTCHA (App Check / Fraud Defense). Deixe vazio até configurar.
export const RECAPTCHA_KEY = "6LdPmzIuAAAAAIcWtV4CU7YhMtP8g1dVsIZi3yJW";
export const APP_VERSION = 1;
