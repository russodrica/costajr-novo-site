import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];
const EXT_OK = ["pdf", "jpg", "jpeg", "png", "webp", "xls", "xlsx", "csv"];

// POST → URL assinada p/ subir o contrato do empréstimo/financiamento ao bucket privado.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const body = await request.json();
    const empId = String(body.emprestimo_id || "").trim();
    if (!empId) return jsonErr(400, "Empréstimo não informado.");
    const nomeOriginal = String(body.nome || "contrato").slice(0, 150);
    const ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    if (!EXT_OK.includes(ext)) return jsonErr(400, `Extensão .${ext} não permitida.`);
    const db = supabaseAdmin();
    const { data: emp } = await db.from("doc_emprestimos").select("id").eq("id", empId).maybeSingle();
    if (!emp) return jsonErr(404, "Empréstimo não encontrado.");
    const sl = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `emprestimos/${empId}/${sl}.${ext}`;
    const { data, error } = await db.storage.from("doc-empresa").createSignedUploadUrl(path);
    if (error) return jsonErr(500, error.message);
    return jsonOk({ signed_url: data.signedUrl, path, nome_original: nomeOriginal });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
