import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { BUCKET_NEGOCIOS, storageNegocios, TIPOS_ANEXO_VALORES } from "../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";

// GET /api/admin/negocios/anexos?imovel_id=... — lista fotos e documentos do card.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const imovelId = url.searchParams.get("imovel_id") || "";
    if (!imovelId) return jsonErr(400, "Informe ?imovel_id=");
    const db = supabaseAdmin();
    const { data, error } = await db.from("negocios_anexos").select("*").eq("imovel_id", imovelId).order("created_at");
    if (error) return jsonErr(400, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/negocios/anexos — REGISTRA o arquivo que o navegador já subiu
// direto ao bucket pela URL assinada (ver anexos/upload-url.ts). Corpo em JSON,
// nunca multipart: a proteção anti-CSRF do Astro recusa POST de formulário.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados do arquivo.");

    const imovel_id = String(body.imovel_id || "").trim();
    const storage_path = String(body.storage_path || "").trim();
    if (!imovel_id || !storage_path) return jsonErr(400, "Envio incompleto — tente de novo.");

    const { data: imovel } = await db.from("negocios_imoveis").select("id, titulo, capa_anexo_id").eq("id", imovel_id).maybeSingle();
    if (!imovel) return jsonErr(404, "Cadastro não encontrado.");
    // o caminho tem de ser da pasta DESTE imóvel — senão dá para registrar o
    // arquivo de outro cadastro como se fosse deste
    const pastasOk = [`fotos/${imovel_id}/`, `docs/${imovel_id}/`, `conversas/${imovel_id}/`];
    if (!pastasOk.some((p) => storage_path.startsWith(p))) {
      return jsonErr(400, "Caminho de arquivo inválido.");
    }

    const especie = storage_path.startsWith("fotos/") ? "foto"
      : storage_path.startsWith("conversas/") ? "conversa" : "documento";

    // print de anotação precisa apontar para uma anotação DESTE cadastro
    let conversa_id: string | null = null;
    if (especie === "conversa") {
      conversa_id = String(body.conversa_id || "") || null;
      if (!conversa_id) return jsonErr(400, "Anotação não informada.");
      const { data: cv } = await db.from("negocios_conversas").select("id").eq("id", conversa_id).eq("imovel_id", imovel_id).maybeSingle();
      if (!cv) return jsonErr(400, "Anotação inválida.");
    }
    const tipo = String(body.tipo || "outro").trim();
    if (especie === "documento" && !TIPOS_ANEXO_VALORES.includes(tipo)) return jsonErr(400, "Tipo de documento inválido.");

    const nome_arquivo = String(body.nome_arquivo || "").slice(0, 150) || null;
    const titulo = String(body.titulo || "").trim() || nome_arquivo || (especie === "foto" ? "Foto" : "Documento");
    const row = {
      imovel_id, especie, titulo, conversa_id,
      tipo: especie === "documento" ? tipo : null,
      storage_path, nome_arquivo,
      content_type: String(body.content_type || "").slice(0, 120) || null,
      tamanho: Number(body.tamanho) || null,
      criado_por: admin.email,
    };
    const { data, error } = await db.from("negocios_anexos").insert(row).select().single();
    if (error) {
      // rollback do arquivo para não deixar lixo pago no storage
      try { await storageNegocios().storage.from(BUCKET_NEGOCIOS).remove([storage_path]); } catch { /* ignore */ }
      return jsonErr(400, error.message);
    }

    // print de conversa não entra na vitrine nem vira capa
    // primeira foto vira a capa do catálogo automaticamente
    let virouCapa = false;
    if (especie === "foto" && !imovel.capa_anexo_id) {
      await db.from("negocios_imoveis").update({ capa_anexo_id: data.id, updated_at: new Date().toISOString() }).eq("id", imovel_id);
      virouCapa = true;
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "negocios_anexos", registro_id: data.id,
      descricao: `Anexou ${especie === "foto" ? "foto" : "documento"} "${titulo}" em ${imovel.titulo}`,
      dados: { imovel_id, especie, tipo },
    });
    return jsonOk({ ...data, virou_capa: virouCapa }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
