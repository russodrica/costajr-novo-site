import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { excluirComLixeira } from "../../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_cartao_faturas").select("storage_path").eq("id", params.id!).maybeSingle();
    if (!row?.storage_path) return jsonErr(404, "Fatura não encontrada.");
    const { data, error } = await db.storage.from("doc-empresa").createSignedUrl(row.storage_path, 600);
    if (error || !data?.signedUrl) return jsonErr(500, error?.message || "Falha ao gerar link.");
    return new Response(null, { status: 302, headers: { Location: data.signedUrl } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_cartao_faturas").select("*").eq("id", params.id!).maybeSingle();
    if (!row) return jsonErr(404, "Fatura não encontrada.");
    if (row.storage_path) await db.storage.from("doc-empresa").remove([row.storage_path]).catch(() => {});
    await excluirComLixeira(db, { req: request, admin }, {
      tabela: "doc_cartao_faturas", idCol: "id", id: params.id!,
      descricao: `Excluiu fatura ${row.cartao} ${String(row.mes).padStart(2, "0")}/${row.ano}`,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
