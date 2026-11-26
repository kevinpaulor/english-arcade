// Service worker: permite instalar o app e faz as atualizações chegarem na hora.
// O GitHub Pages manda o navegador guardar os arquivos por 10 minutos; aqui o código
// (html, js, json) sempre é conferido com o servidor (resposta 304 rápida quando nada mudou).
// Fotos e ícones continuam vindo do cache normal do navegador.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const fresh = req.mode === "navigate" || /\.(html|js|json|webmanifest)$/i.test(url.pathname) || url.pathname.endsWith("/");
  if (!fresh) return;
  e.respondWith(fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).catch(() => fetch(req)));
});
