import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../../lib/supabase";
import { registrarAcao } from "../../../../../../../lib/auditoria";

export const prerender = false;

// POST /api/admin/rh/epi/fichas/[id]/assinado  (multipart: campo "arquivo")
//   Anexa o PDF/imagem assinado da ficha de EPI (bucket privado 'rh') e marca
//   a ficha como assinada. Limite ~4,5MB (corpo da Vercel).
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const db = supabaseAdmin();
    const id = params.id!;
    const { data: ficha } = await db.from("epi_fichas").select("id, colaborador_id, assinado_path").eq("id", id).maybeSingle();
    if (!ficha) return jsonErr(404, "Ficha não encontrada");

    const form = await request.formData();
    const file = form.get("arquivo");
    if (!(file instanceof File)) return jsonErr(400, "Envie o arquivo assinado (campo 'arquivo').");
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
    const path = `epi/${ficha.colaborador_id}/${id}-assinado.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await db.storage.from("rh").upload(path, buf, { contentType: file.type || "application/pdf", upsert: true });
    if (upErr) return jsonErr(400, "Falha no upload: " + upErr.message);

    await db.from("epi_fichas").update({ assinado_path: path, status: "assinada" }).eq("id", id);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "epi_fichas", registro_id: id, descricao: "Anexou ficha de EPI assinada", dados: { path } });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// GET .../assinado — baixa o documento assinado por URL assinada (10 min).
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    const { data: ficha } = await db.from("epi_fichas").select("assinado_path").eq("id", params.id!).maybeSingle();
    if (!ficha?.assinado_path) return jsonErr(404, "Sem documento assinado.");
    const { data, error } = await db.storage.from("rh").createSignedUrl(ficha.assinado_path, 600);
    if (error || !data) return jsonErr(400, "Falha ao gerar link.");
    return new Response(null, { status: 302, headers: { location: data.signedUrl } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
