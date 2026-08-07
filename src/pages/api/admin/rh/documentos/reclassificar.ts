import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { inferirTipoDoc, TIPO_DOC_LABEL } from "../../../../../lib/rhTiposDoc";

export const prerender = false;

// POST /api/admin/rh/documentos/reclassificar
// Passa os documentos SEM tipo (ou marcados como "Outro") pelo reconhecimento por
// título/nome do arquivo e arruma o tipo de todos de uma vez.
//
// Nunca mexe em documento que já tem tipo escolhido a mão — o palpite de texto
// não sobrescreve decisão de gente. Com `?seco=1` só mostra o que faria.
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, "rh"); if (bl) return bl;
    const db = supabaseAdmin();
    const seco = url.searchParams.get("seco") === "1";

    const { data, error } = await db
      .from("rh_documentos")
      .select("id, titulo, tipo, nome_arquivo, storage_path")
      .or("tipo.is.null,tipo.eq.outro")
      .limit(5000);
    if (error) return jsonErr(400, error.message);

    const mudancas: { id: string; titulo: string; de: string; para: string }[] = [];
    for (const d of data || []) {
      const nome = (d as any).nome_arquivo || String((d as any).storage_path || "").split("/").pop() || "";
      const novo = inferirTipoDoc(d.titulo || "", nome, d.tipo || "outro");
      if (novo && novo !== (d.tipo || "outro")) {
        mudancas.push({ id: d.id, titulo: d.titulo || "", de: d.tipo || "(vazio)", para: novo });
      }
    }

    // resumo por tipo, para a tela dizer o que aconteceu em português
    const porTipo: Record<string, number> = {};
    for (const m of mudancas) porTipo[TIPO_DOC_LABEL[m.para] || m.para] = (porTipo[TIPO_DOC_LABEL[m.para] || m.para] || 0) + 1;

    if (seco) return jsonOk({ analisados: (data || []).length, reconhecidos: mudancas.length, porTipo, seco: true });

    let ok = 0;
    for (const m of mudancas) {
      const { error: e } = await db.from("rh_documentos").update({ tipo: m.para }).eq("id", m.id);
      if (!e) ok++;
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "rh_documentos", registro_id: null,
      descricao: `Classificou automaticamente ${ok} documento(s) de RH pelo título`,
      dados: { analisados: (data || []).length, porTipo },
    });

    return jsonOk({ analisados: (data || []).length, atualizados: ok, semReconhecer: (data || []).length - mudancas.length, porTipo });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
