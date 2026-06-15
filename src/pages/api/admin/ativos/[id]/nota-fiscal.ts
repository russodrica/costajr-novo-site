import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

const TIPOS_OK: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

// POST { arquivo_base64, content_type } → sobe a NF ao bucket PRIVADO ativos-docs
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "ativos"); if (_ro) return _ro;
    const id = params.id!;
    const { arquivo_base64, content_type } = await request.json();
    const ext = TIPOS_OK[content_type];
    if (!arquivo_base64 || !ext) return jsonErr(400, "Envie um PDF ou imagem da nota fiscal.");

    const buf = Buffer.from(arquivo_base64, "base64");
    if (buf.length > 15 * 1024 * 1024) return jsonErr(400, "Arquivo muito grande (máx. 15MB).");

    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id, nota_fiscal_path").eq("id", id).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");

    // remove o anterior (se houver) para não acumular lixo
    if (ativo.nota_fiscal_path) await db.storage.from("ativos-docs").remove([ativo.nota_fiscal_path]).catch(() => {});

    const path = `${id}/nf-${Date.now()}.${ext}`;
    const { error: eUp } = await db.storage.from("ativos-docs").upload(path, buf, { contentType: content_type, upsert: false });
    if (eUp) return jsonErr(500, eUp.message);

    const { error } = await db.from("ativos").update({ nota_fiscal_path: path, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "nota_fiscal", registro_id: id, descricao: `Anexou nota fiscal do ativo ${id}`, dados: { nota_fiscal_path: path } });
    return jsonOk({ ok: true, nota_fiscal_path: path });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE → remove a NF do cofre
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "ativos"); if (_ro) return _ro;
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: ativo } = await db.from("ativos").select("id, nota_fiscal_path").eq("id", id).maybeSingle();
    if (!ativo) return jsonErr(404, "Ativo não encontrado");
    const pathAnterior = ativo.nota_fiscal_path;
    if (pathAnterior) await db.storage.from("ativos-docs").remove([pathAnterior]).catch(() => {});
    const { error } = await db.from("ativos").update({ nota_fiscal_path: null, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, { acao: "excluir", entidade: "nota_fiscal", registro_id: id, descricao: `Removeu a nota fiscal do ativo ${id}`, dados: { nota_fiscal_path: pathAnterior } });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
