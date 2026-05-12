// Service worker do CJR Manutenção (PWA)
// Estratégia: network-first para HTML/API, cache-first para estáticos
const CACHE_VERSION = "cjr-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRE_CACHE = [
  "/",
  "/manutencao",
  "/manutencao/cliente/login",
  "/manutencao/tecnico/login",
  "/logo-cjr.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRE_CACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // não cacheia externos (MP, Supabase, Resend, etc)

  // APIs e webhook: sempre rede, nunca cache
  if (url.pathname.startsWith("/api/")) return;

  // Assets versionados (Astro) → cache-first agressivo
  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request).catch(() => null);
        if (res && res.ok) cache.put(request, res.clone());
        return res || new Response("offline", { status: 504 });
      })
    );
    return;
  }

  // Imagens estáticas → cache-first
  if (request.destination === "image" || /\.(png|jpg|jpeg|webp|svg|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request).catch(() => null);
        if (res && res.ok) cache.put(request, res.clone());
        return res || hit || Response.error();
      })
    );
    return;
  }

  // HTML / navegação → network-first com fallback
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const cp = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, cp));
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(request);
          if (hit) return hit;
          return caches.match("/manutencao") || new Response("Sem conexão", { status: 503 });
        })
    );
    return;
  }
});

// Mensagem para forçar atualização sem precisar fechar o app
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
