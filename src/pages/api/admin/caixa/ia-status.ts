import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { gerarTextoLLM } from "~/lib/llm";

export const prerender = false;

function provedor(): string | null {
  if (process.env.GROQ_API_KEY) return "Groq (gpt-oss)";
  if (process.env.GEMINI_API_KEY) return "Gemini (Google)";
  if (process.env.NVIDIA_API_KEY) return "NVIDIA gpt-oss";
  if (process.env.ANTHROPIC_API_KEY) return "Claude (Anthropic)";
  return null;
}

// GET → diz se a IA esta viva. Faz um "ping" minimo ao provedor e devolve ok ou o
// motivo do erro (sem NUNCA expor a chave). Usado pelo medidor na /admin/caixa-entrada.
export const GET: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const prov = provedor();
    if (!prov) {
      return jsonOk({ provider: null, configurado: false, ok: false, motivo: "Nenhuma chave de IA configurada na Vercel (GEMINI_API_KEY)." });
    }
    try {
      const r = await gerarTextoLLM("Voce e um teste de conectividade. Responda apenas: OK", [{ role: "user", content: "ping" }]);
      const ok = !!(r && r.trim());
      return jsonOk({ provider: prov, configurado: true, ok, resposta: (r || "").slice(0, 40), motivo: ok ? null : "O provedor respondeu vazio." });
    } catch (e: any) {
      return jsonOk({ provider: prov, configurado: true, ok: false, motivo: String(e?.message || e).slice(0, 200) });
    }
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
