import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../lib/auth";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { dadosAoVivo } from "../../../../lib/situacaoFinanceira";
import { VobiCotaError } from "../../../../lib/vobiBaixa";

export const prerender = false;

// GET /api/admin/situacao-financeira/aovivo[?forcar=1]
// Dados AO VIVO da Vobi para a aba "Situação Financeira" (fluxo mensal + contas em aberto por grupo).
// - Cache de 1 h em vobi_cache (a cota da Vobi é 1000 consultas/h para a integração INTEIRA).
// - ?forcar=1 ignora o cache e consulta a Vobi de novo (gasta cota — é o botão "Atualizar da Vobi").
// - Se a Vobi recusar e houver cópia salva, dadosAoVivo() devolve a cópia com `aviso` (200).
const MODULO = "situacao-financeira";

function msgDe(e: unknown): string {
  return String((e as { message?: unknown } | null)?.message ?? e ?? "");
}

/** Falha do login/sessão → 401/403 com texto simples (o resto vira 500). */
function erroDeAcesso(e: unknown): Response {
  const m = msgDe(e);
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  if (m === "Sem permissão") return jsonErr(403, "Você não tem permissão para ver esta área.");
  if (m === "Não autenticado" || m === "Token inválido" || code.startsWith("ERR_JW")) {
    return jsonErr(401, "Sua sessão expirou ou não é válida. Entre de novo no painel.");
  }
  return jsonErr(500, "Não consegui conferir o seu acesso agora. Tente de novo em instantes.", m);
}

function ehErroDeCota(e: unknown): boolean {
  if (e instanceof VobiCotaError) return true;
  if ((e as { cota?: unknown } | null)?.cota === true) return true;
  return /limite de consultas|cota|\b429\b/i.test(msgDe(e));
}

export const GET: APIRoute = async ({ request, url }) => {
  let admin: AdminClaims;
  try {
    admin = await requireAdminCookie(request);
  } catch (e) {
    return erroDeAcesso(e);
  }

  try {
    const ro = await bloqueioSeSemLeitura(admin, MODULO);
    if (ro) return ro;
  } catch (e) {
    return jsonErr(500, "Não consegui conferir a sua permissão agora. Tente de novo em instantes.", msgDe(e));
  }

  const forcar = url.searchParams.get("forcar");
  if (forcar !== null && forcar !== "0" && forcar !== "1") {
    return jsonErr(400, 'O parâmetro "forcar" só aceita 0 ou 1.');
  }

  try {
    return jsonOk(await dadosAoVivo(forcar === "1"));
  } catch (e) {
    if (ehErroDeCota(e)) {
      const espera = e instanceof VobiCotaError && e.esperaSeg ? ` Ela libera de novo em cerca de ${Math.ceil(e.esperaSeg / 60)} min.` : "";
      return jsonErr(
        429,
        "A Vobi atingiu o limite de consultas desta hora (o limite vale para todo o sistema) e ainda não há uma cópia salva para mostrar." +
          (espera || " Tente de novo mais tarde.") +
          " Não adianta clicar várias vezes: cada clique gasta o limite.",
      );
    }
    const m = msgDe(e);
    if ((e as { vobiConfig?: unknown } | null)?.vobiConfig || /credenciais da vobi/i.test(m)) {
      return jsonErr(503, "A ligação com a Vobi não está configurada no servidor (VOBI_UUID e VOBI_SECRET na Vercel). Os dados ao vivo ficam indisponíveis até isso ser feito.");
    }
    return jsonErr(502, "Não consegui ler os dados da Vobi agora. Tente de novo em alguns minutos.", m.slice(0, 300));
  }
};
