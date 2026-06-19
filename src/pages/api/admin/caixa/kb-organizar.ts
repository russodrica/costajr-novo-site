import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";
import { gerarTextoLLM, llmConfigurado, extrairJson } from "~/lib/llm";

export const prerender = false;

// POST { texto, categorias? } → IA transforma texto livre em { pergunta, resposta, categoria }
// para a pessoa revisar antes de salvar. Sem chave de IA: responde { ia:false } (graceful).
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "caixa-entrada"); if (_ro) return _ro;
    const b = await request.json().catch(() => ({}));
    const texto = String(b.texto || "").trim();
    if (!texto) return jsonErr(400, "Cole um texto para a IA organizar.");
    if (!llmConfigurado()) return jsonOk({ ia: false });

    const cats = Array.isArray(b.categorias) && b.categorias.length
      ? b.categorias.slice(0, 20).join(", ")
      : "Geral, Operacional, RH, Financeiro, Comercial, Santander";
    const system = `Você organiza o conhecimento interno da Costa Júnior Engenharia para um FAQ interno (a assistente JunIA usa essa base). A partir de um texto livre (anotação, e-mail, instrução), gere UMA pergunta clara — como um colaborador realmente perguntaria — e a resposta correspondente, em português do Brasil, objetiva e cordial. Não invente nada além do que está no texto. Escolha a categoria mais adequada entre: ${cats}. Responda APENAS com JSON: {"pergunta":"...","resposta":"...","categoria":"..."}`;

    let out: any = null;
    try {
      const raw = await gerarTextoLLM(system, [{ role: "user", content: texto.slice(0, 6000) }]);
      out = raw ? extrairJson(raw) : null;
    } catch { out = null; }
    if (!out || !out.resposta) return jsonOk({ ia: false });

    return jsonOk({
      ia: true,
      pergunta: String(out.pergunta || "").trim(),
      resposta: String(out.resposta || "").trim(),
      categoria: String(out.categoria || "Geral").trim() || "Geral",
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
