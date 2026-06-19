import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";
import { slotPorKey } from "~/lib/slotsDoc";

export const prerender = false;

// POST { path, nome_arquivo, colaborador_id, slot, validade, validade_na, observacoes }
// → cria a linha em rh_documentos com o TÍTULO no prefixo do slot (cai no slot certo da
// ficha) e o arquivo já no bucket privado `rh` (path do upload). Quem confirma é a pessoa.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "caixa-entrada"); if (_ro) return _ro;
    const b = await request.json().catch(() => ({}));

    const path = String(b.path || "").trim();
    const nome = String(b.nome_arquivo || "arquivo").trim().slice(0, 120);
    const colaborador_id = String(b.colaborador_id || "").trim();
    const slot = slotPorKey(String(b.slot || "outro")) || slotPorKey("outro")!;
    if (!path || !path.startsWith("inbox/")) return jsonErr(400, "Arquivo ausente ou inválido.");
    if (!colaborador_id) return jsonErr(400, "Escolha o colaborador.");

    const validadeNA = b.validade_na === true || b.validade_na === "true";
    const validade = validadeNA ? null : (String(b.validade || "").trim() || null);
    const titulo = `${slot.prefixo} — ${nome}`.slice(0, 200);

    const db = supabaseAdmin();
    const { data: colab } = await db.from("rh_colaboradores").select("id, nome").eq("id", colaborador_id).maybeSingle();
    if (!colab) return jsonErr(400, "Colaborador não encontrado.");

    const row: Record<string, unknown> = {
      colaborador_id, titulo, tipo: slot.tipo, storage_path: path,
      validade, validade_na: validadeNA,
      observacoes: String(b.observacoes || "").trim() || null,
      criado_por: admin.email,
    };
    const { data, error } = await db.from("rh_documentos").insert(row).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "rh_documentos", registro_id: data.id,
      descricao: `Caixa de Entrada: anexou "${slot.label}" a ${colab.nome}`, dados: { tipo: slot.tipo, validade },
    });
    return jsonOk({ ...data, colaborador_nome: colab.nome }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
