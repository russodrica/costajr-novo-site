import { defineMiddleware } from "astro:middleware";
import { supabaseAdmin } from "./lib/supabase";
import { getAdminTokenFromCookie, verifyToken, type AdminClaims } from "./lib/auth";
import { moduloDaRotaApi, nivelModuloUsuario, MODULO_LABEL } from "./lib/permissoes";
import {
  isBot,
  parseUserAgent,
  classifyReferrer,
  shouldTrack,
  readSessionCookie,
  nextSession,
  buildSessionCookie,
  getGeo,
} from "./lib/analytics";

const MUTACOES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const onRequest = defineMiddleware(async (context, next) => {
  // ── Trava central "somente-leitura" por usuário ──
  // Recusa QUALQUER edição em /api/admin/<modulo> quando o nível efetivo do usuário
  // naquele módulo não é "editar" (ou seja, "ver" ou "nenhum"). Cobre TODOS os
  // módulos de uma vez (não depende de marcar endpoint por endpoint). GET passa.
  try {
    const req = context.request;
    if (MUTACOES.has(req.method)) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/admin/")) {
        const modulo = moduloDaRotaApi(path);
        if (modulo) {
          const tok = getAdminTokenFromCookie(req);
          if (tok) {
            try {
              const claims = await verifyToken<AdminClaims>(tok);
              if (claims.tipo === "admin") {
                const nivel = await nivelModuloUsuario(claims, modulo);
                if (nivel !== "editar") {
                  const rotulo = MODULO_LABEL[modulo] || modulo;
                  return new Response(
                    JSON.stringify({ error: `Você tem acesso somente de leitura em "${rotulo}". Fale com o administrador.` }),
                    { status: 403, headers: { "content-type": "application/json" } },
                  );
                }
              }
            } catch { /* token inválido/expirado -> deixa o endpoint tratar a auth (401) */ }
          }
        }
      }
    }
  } catch { /* nunca derruba a request por causa do guard de permissão */ }

  const response = await next();

  // Headers de segurança em todas as respostas
  try {
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(self)");
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    // CSP em Report-Only (FASE 1): mede violações sem quebrar os ~29 scripts inline
    // (define:vars/is:inline) do app. FASE 2 (futuro): migrar p/ nonce e tornar enforce
    // — aí remove 'unsafe-inline' do script-src. Já protege com frame-ancestors/object-src.
    response.headers.set(
      "Content-Security-Policy-Report-Only",
      "default-src 'self'; base-uri 'self'; form-action 'self'; " +
      "frame-ancestors 'self' https://costajr.com.br https://www.costajr.com.br; " +
      "img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'"
    );
    // Não cachear respostas de API (podem conter dados sensíveis / URLs assinadas).
    if (new URL(context.request.url).pathname.startsWith("/api/")) {
      response.headers.set("Cache-Control", "no-store");
    }
  } catch { /* respostas imutáveis (ex.: assets) podem recusar set — ignora */ }

  try {
    const req = context.request;
    if (req.method !== "GET") return response;

    const url = new URL(req.url);
    if (!shouldTrack(url.pathname)) return response;

    // Só registra páginas HTML reais (não navegações de prefetch / fetch JSON).
    const accept = req.headers.get("accept") || "";
    if (!accept.includes("text/html")) return response;

    const ua = req.headers.get("user-agent") || "";
    const bot = isBot(ua);

    // Sessão (mesmo bots ganham um sid pra dedupe básico, mas marcamos is_bot).
    const sessionState = nextSession(readSessionCookie(req.headers.get("cookie") || ""));
    response.headers.append("Set-Cookie", buildSessionCookie(sessionState));

    if (bot) return response;

    const { device, os, browser } = parseUserAgent(ua);
    const referrer = req.headers.get("referer") || "";
    const { ref_host, ref_kind } = classifyReferrer(referrer, url.host);
    const geo = getGeo(req);

    const payload = {
      path: url.pathname,
      session_id: sessionState.sid,
      referrer: referrer || null,
      ref_host,
      ref_kind,
      utm_source: url.searchParams.get("utm_source"),
      utm_medium: url.searchParams.get("utm_medium"),
      utm_campaign: url.searchParams.get("utm_campaign"),
      device,
      os,
      browser,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      is_bot: false,
    };

    // Fire-and-forget — não bloqueia a resposta.
    supabaseAdmin()
      .from("page_views")
      .insert(payload)
      .then(({ error }) => {
        if (error) console.error("[analytics] insert falhou:", error.message);
      });
  } catch (err) {
    console.error("[analytics] erro no middleware:", err);
  }

  return response;
});
