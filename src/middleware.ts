import { defineMiddleware } from "astro:middleware";
import { supabaseAdmin } from "./lib/supabase";
import { getAdminTokenFromCookie, getPortalToken, verifyToken, type AdminClaims } from "./lib/auth";
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

// ── Cerca do FORNECEDOR (usuário externo) ────────────────────────────────────
// Deny-by-default para TODA a superfície de API: um token com role "fornecedor"
// só alcança a allowlist abaixo (downloads somente-leitura + logout). Qualquer
// outra rota /api/* responde 403 ANTES do handler — defesa em profundidade além
// do gate por perfil de cada endpoint e do cap em permissoes.ts.
const FORNECEDOR_API_ALLOW: RegExp[] = [
  /^\/api\/admin\/doc-empresa\/arquivos\/[^/]+$/,   // GET download de anexo (o handler restringe categoria e método)
  /^\/api\/admin\/doc-empresa\/extratos\/[^/]+$/,   // GET download de extrato (o handler barra DELETE por perfil)
  /^\/api\/fornecedor\/trocar-senha$/,              // POST: troca da PRÓPRIA senha provisória (endpoint só-fornecedor)
  /^\/api\/admin\/logout$/,
];
// Único POST que o fornecedor pode fazer além do logout (trocar a própria senha).
const FORNECEDOR_MUTACAO_OK = new Set(["/api/admin/logout", "/api/fornecedor/trocar-senha"]);
function ehTokenFornecedor(claims: { role?: string; roles?: string[] } | null): boolean {
  if (!claims) return false;
  const perfis = (claims.roles && claims.roles.length ? claims.roles : [claims.role]).filter(Boolean) as string[];
  return perfis.includes("fornecedor");
}

// ── Domínio da CR INTERMEDIAÇÕES IMOBILIÁRIAS ────────────────────────────────
// crintermediacao.com.br mora no MESMO projeto do portal (um deploy só), mas o
// visitante não pode cair na Costa Júnior: "/" vira a home da CR e "/autorizacao"
// vira o formulário. Qualquer /admin nesse domínio volta para o portal.
const HOSTS_CR = new Set([
  "crintermediacao.com.br",
  "www.crintermediacao.com.br",
]);

export const onRequest = defineMiddleware(async (context, next) => {
  // roteamento por domínio antes de tudo — é só reescrita de caminho, não mexe
  // em autenticação nem em permissão
  try {
    const u = new URL(context.request.url);
    if (HOSTS_CR.has(u.hostname.toLowerCase())) {
      const p = u.pathname.replace(/\/+$/, "") || "/";
      if (p === "/") return context.rewrite("/cr-site");
      if (p === "/autorizacao" || p === "/autorizacao-venda") return context.rewrite("/cr");
      if (p === "/admin" || p.startsWith("/admin/")) {
        return context.redirect(`https://www.costajr.com.br${u.pathname}${u.search}`, 302);
      }
    }
  } catch { /* nunca derruba a request pelo roteamento de domínio */ }

  // ── Cerca do fornecedor: qualquer /api/* fora da allowlist → 403 ──
  try {
    const req = context.request;
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/")) {
      // Avalia AMBOS os tokens (header x-portal-auth E cookie admin_token). Um header
      // INVÁLIDO não pode mascarar um cookie de fornecedor válido — senão a cerca seria
      // contornável mandando x-portal-auth com lixo (o `||` pegava o header e o
      // verifyToken lançava, pulando a cerca). Se QUALQUER token for de fornecedor, cerca.
      const candidatos = [getPortalToken(req), getAdminTokenFromCookie(req)].filter(Boolean);
      let ehForn = false;
      for (const cand of candidatos) {
        try {
          const claims = await verifyToken<AdminClaims>(cand);
          if (claims.tipo === "admin" && ehTokenFornecedor(claims)) { ehForn = true; break; }
        } catch { /* token inválido: tenta o próximo candidato */ }
      }
      if (ehForn) {
        const permitido = FORNECEDOR_API_ALLOW.some((re) => re.test(path));
        if (!permitido) {
          return new Response(
            JSON.stringify({ error: "Acesso de fornecedor: este recurso não está disponível." }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
        // mesmo na allowlist, fornecedor NUNCA muta (só GET), exceto logout e a
        // troca da própria senha provisória.
        if (MUTACOES.has(req.method) && !FORNECEDOR_MUTACAO_OK.has(path)) {
          return new Response(
            JSON.stringify({ error: "Acesso de fornecedor é somente leitura." }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
      }
    }
  } catch { /* nunca derruba a request pela cerca */ }

  // ── Trava central "somente-leitura" por usuário ──
  // Recusa QUALQUER edição em /api/admin/<modulo> quando o nível efetivo do usuário
  // naquele módulo não é "editar" (ou seja, "ver" ou "nenhum"). Cobre TODOS os
  // módulos de uma vez (não depende de marcar endpoint por endpoint). GET passa.
  try {
    const req = context.request;
    if (MUTACOES.has(req.method)) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/admin/")) {
        // Rotas de COMPARTILHAMENTO (e-mail / WhatsApp) são leitura+envio: quem tem acesso de
        // "ver" ao módulo já pode BAIXAR cada documento, então também pode compartilhá-lo. O
        // próprio endpoint gateia por perfil + bloqueioSeSemLeitura (recusa "nenhum"). Por isso
        // NÃO exigimos "editar" nelas (senão o botão retornaria 403 para perfis só-leitura).
        const ehCompartilhar = ["/enviar-email", "/bancarios-email", "/whatsapp-links", "/bancarios-whatsapp"].some((s) => path.endsWith(s));
        const modulo = ehCompartilhar ? null : moduloDaRotaApi(path);
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
