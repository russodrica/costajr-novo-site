import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

// Mapeia o tipo do doc de admissão → tipo aceito em rh_documentos
// (rh_documentos só aceita: contrato, aso, ficha_epi, advertencia, atestado, certificado, cnh, outro)
const MAPA_TIPO_DOC: Record<string, string> = {
  rg: "outro",
  cpf: "outro",
  ctps: "outro",
  comprovante_residencia: "outro",
  foto: "outro",
  aso: "aso",
  cnh: "cnh",
};
const LABEL_TIPO: Record<string, string> = {
  rg: "RG",
  cpf: "CPF",
  cnh: "CNH",
  ctps: "CTPS",
  comprovante_residencia: "Comprovante de residência",
  foto: "Foto 3x4",
  aso: "ASO",
  outro: "Documento",
};

// PATCH /api/admin/rh/admissoes/[id]
// body: { acao: "cancelar" } ou { acao: "concluir" }
// concluir → cria rh_colaboradores + move docs para rh_documentos + marca concluída
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    const { data: adm } = await db.from("rh_admissoes").select("*").eq("id", params.id!).maybeSingle();
    if (!adm) return jsonErr(404, "Admissão não encontrada");

    if (body.acao === "cancelar") {
      if (adm.status === "concluida") return jsonErr(400, "Admissão já concluída — não pode ser cancelada");
      const { data, error } = await db
        .from("rh_admissoes")
        .update({ status: "cancelada", updated_at: new Date().toISOString() })
        .eq("id", adm.id)
        .select()
        .single();
      if (error) return jsonErr(400, error.message);
      return jsonOk(data);
    }

    if (body.acao === "concluir") {
      if (adm.status === "concluida") return jsonErr(400, "Admissão já concluída");
      if (adm.status === "cancelada") return jsonErr(400, "Admissão cancelada — não pode ser concluída");

      // 1) cria o colaborador com os dados da admissão
      const novoColab: Record<string, unknown> = {
        nome: adm.nome,
        status: "ativo",
        data_admissao: new Date().toISOString().slice(0, 10),
        criado_por: admin.email,
      };
      if (adm.email) novoColab.email = adm.email;
      if (adm.telefone) novoColab.telefone = adm.telefone;
      if (adm.cargo) novoColab.cargo = adm.cargo;
      if (adm.regime) novoColab.regime = adm.regime;
      if (adm.observacoes) novoColab.observacoes = adm.observacoes;

      const { data: colab, error: errColab } = await db.from("rh_colaboradores").insert(novoColab).select().single();
      if (errColab) return jsonErr(400, `Erro ao criar colaborador: ${errColab.message}`);

      // 2) move os documentos da admissão para rh_documentos
      // (o arquivo já está no bucket privado "rh" — só copiamos o storage_path)
      const { data: docs } = await db.from("rh_admissoes_docs").select("*").eq("admissao_id", adm.id);
      if (docs && docs.length) {
        const rows = docs.map((d: any) => ({
          colaborador_id: colab.id,
          titulo: `${LABEL_TIPO[d.tipo] || d.tipo}${d.nome_arquivo ? ` — ${d.nome_arquivo}` : ""}`.slice(0, 200),
          tipo: MAPA_TIPO_DOC[d.tipo] || "outro",
          storage_path: d.storage_path,
          observacoes: "Recebido na admissão digital",
          criado_por: admin.email,
        }));
        const { error: errDocs } = await db.from("rh_documentos").insert(rows);
        if (errDocs) {
          // rollback: desfaz a criação do colaborador para não deixar registro órfão
          await db.from("rh_colaboradores").delete().eq("id", colab.id);
          return jsonErr(400, `Falha ao mover os documentos — a admissão NÃO foi concluída (nenhum colaborador foi criado). Tente novamente. Detalhe: ${errDocs.message}`);
        }
      }

      // 3) marca a admissão como concluída
      const { data, error } = await db
        .from("rh_admissoes")
        .update({ status: "concluida", colaborador_id: colab.id, updated_at: new Date().toISOString() })
        .eq("id", adm.id)
        .select()
        .single();
      if (error) return jsonErr(400, error.message);
      return jsonOk({ ...data, colaborador: colab });
    }

    return jsonErr(400, "Ação inválida (use 'cancelar' ou 'concluir')");
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
