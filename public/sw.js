// Service worker do CJR Manutenção (PWA)
// Estratégia: network-first para HTML/API, cache-first para estáticos
const CACHE_VERSION = "cjr-v5";
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

  // Páginas do ADMIN: SEMPRE rede, nunca cache (são sensíveis e gated por perfil/embed;
  // servir HTML antigo do cache pode mostrar módulos a quem não deve — ex.: embed do RH).
  if (url.pathname.startsWith("/admin/") || url.pathname === "/admin") return;

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

  // HTML / navegação → SEMPRE rede, nunca cache. Servir HTML antigo do cache causava
  // ver versões desatualizadas (ex.: o embed do RH mostrando o admin inteiro, módulos
  // a quem não deve). Em falha de rede, mostra um aviso simples em vez de página obsoleta.
  // (Assets versionados /_astro/ e imagens continuam em cache — o app carrega rápido.)
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request).catch(() => new Response(
        "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:48px;text-align:center;color:#333'><h2>Sem conexão</h2><p>Verifique a internet e recarregue a página.</p>",
        { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
      ))
    );
    return;
  }
});

// Mensagem para forçar atualização sem precisar fechar o app
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
