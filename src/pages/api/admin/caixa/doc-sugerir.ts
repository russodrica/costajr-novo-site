import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { SLOTS_DOC, slotPorKey, detectarSlotPorTexto, detectarValidade, casarColaborador } from "~/lib/slotsDoc";
import { lerDocumentoGemini, geminiConfigurado, extrairJson } from "~/lib/llm";

export const prerender = false;

// POST { path, nome_arquivo, content_type, usar_ia } → SUGERE colaborador + slot + validade.
// (1) por nome do arquivo (sempre); (2) se usar_ia e Gemini setado e PDF/imagem: lê o documento.
// É só SUGESTÃO — quem confirma é a pessoa (endpoint doc-anexar).
export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAdminCookie(request);
    const b = await request.json().catch(() => ({}));
    const nome = String(b.nome_arquivo || "").trim();
    const path = String(b.path || "").trim();
    const ct = String(b.content_type || "").toLowerCase();
    const db = supabaseAdmin();

    const { data: colabs } = await db.from("rh_colaboradores").select("id, nome").neq("status", "desligado").limit(3000);
    const lista = (colabs || []).map((c: any) => ({ id: c.id, nome: c.nome }));

    // 1) heurística pelo nome do arquivo
    let slotKey = detectarSlotPorTexto(nome);
    let validade = detectarValidade(nome);
    let match = casarColaborador(nome, lista);
    let origem = "arquivo";
    let iaUsada = false;

    // 2) IA lê o documento (Gemini) — opcional, graceful
    if (b.usar_ia && geminiConfigurado() && path && (ct === "application/pdf" || ct.startsWith("image/"))) {
      try {
        const { data: blob } = await db.storage.from("rh").download(path);
        if (blob) {
          const buf = Buffer.from(await blob.arrayBuffer());
          const b64 = buf.toString("base64");
          const system = `Você lê um documento de RH de um colaborador da construtora Costa Júnior e extrai metadados. Responda APENAS JSON, sem texto em volta: {"nome_pessoa":"nome completo da pessoa, ou vazio","tipo":"um de: ASO, CNH, RG, Contrato, CTPS, Titulo de Eleitor, Certidao, Comprovante de Residencia, NR-35, NR-10, NR-06, NR-01, Advertencia, Suspensao, Ordem de Servico, Outro","validade":"data de validade/vencimento em AAAA-MM-DD, ou vazio se não houver"}`;
          const raw = await lerDocumentoGemini(system, "Extraia os metadados deste documento.", b64, ct);
          const o = raw ? extrairJson(raw) : null;
          if (o) {
            iaUsada = true; origem = "ia";
            const slotIa = detectarSlotPorTexto(String(o.tipo || ""));
            if (slotIa) slotKey = slotIa;
            if (o.validade && /^\d{4}-\d{2}-\d{2}$/.test(String(o.validade).trim())) validade = String(o.validade).trim();
            if (o.nome_pessoa) {
              const m2 = casarColaborador(String(o.nome_pessoa), lista);
              if (m2 && (!match || m2.score >= match.score)) match = m2;
            }
          }
        }
      } catch { /* IA falhou — segue só com a heurística do arquivo */ }
    }

    const slot = (slotKey && slotPorKey(slotKey)) || slotPorKey("outro")!;
    const confianca = match && match.score >= 100 ? "alta" : match ? "media" : "baixa";

    return jsonOk({
      colaborador_id: match?.id || null,
      colaborador_nome: match?.nome || null,
      slot: slot.key,
      slot_label: slot.label,
      tem_validade: slot.validade,
      validade: validade || null,
      confianca, origem, ia_usada: iaUsada,
      ia_disponivel: geminiConfigurado(),
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const GET: APIRoute = async () => jsonOk({ slots: SLOTS_DOC });
