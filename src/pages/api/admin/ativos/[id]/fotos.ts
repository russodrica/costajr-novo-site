import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// POST { imagem_base64, content_type } → sobe a foto ao bucket `ativos` e adiciona à lista fotos[]
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "ativos"); if (_ro) return _ro;
    const id = params.id!;
    const { imagem_base64, content_type } = await request.json();
    if (!imagem_base64 || !String(content_type || "").startsWith("image/")) {
      return jsonErr(400, "Envie uma imagem válida.");
    }
    const buf = Buffer.from(imagem_base64, "base64");
    if (buf.length > 10 * 1024 * 1024) return jsonErr(400, "Imagem muito grande (máx. 10MB).");

    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id, fotos").eq("id", id).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    const ext = content_type === "image/png" ? "png" : content_type === "image/webp" ? "webp" : "jpg";
    const path = `${id}/${Date.now()}.${ext}`;
    const { error: eUp } = await db.storage.from("ativos").upload(path, buf, { contentType: content_type, upsert: false });
    if (eUp) return jsonErr(500, eUp.message);

    const publicUrl = `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/ativos/${path}`;
    const fotos = [...(ativo.fotos || []), publicUrl];
    const { error } = await db.from("ativos").update({ fotos, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "criar", entidade: "ativos_fotos", registro_id: id, descricao: `Adicionou foto ao ativo ${id}`, dados: { url: publicUrl } });
    return jsonOk({ url: publicUrl, fotos });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE ?url=... → remove a foto da lista (e do storage)
export const DELETE: APIRoute = async ({ request, params, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "ativos"); if (_ro) return _ro;
    const id = params.id!;
    const fotoUrl = url.searchParams.get("url");
    if (!fotoUrl) return jsonErr(400, "Informe ?url=");

    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id, fotos").eq("id", id).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    const fotos = (ativo.fotos || []).filter((f: string) => f !== fotoUrl);
    // remove do storage (best-effort)
    const marcador = "/storage/v1/object/public/ativos/";
    const idx = fotoUrl.indexOf(marcador);
    if (idx >= 0) await db.storage.from("ativos").remove([fotoUrl.slice(idx + marcador.length)]).catch(() => {});

    const { error } = await db.from("ativos").update({ fotos, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "ativos_fotos", registro_id: id, descricao: `Removeu foto do ativo ${id}`, dados: { url: fotoUrl } });
    return jsonOk({ fotos });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
