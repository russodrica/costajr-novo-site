import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin, supabaseAdmin2 } from "../../../../../lib/supabase";
import { excluirComLixeira, registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../../lib/permissoes";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

// GET → redireciona p/ URL assinada (10 min) do arquivo no bucket privado.
// FORNECEDOR (externo): leitura permitida (extratos fazem parte do escopo dele);
// download auditado. DELETE continua restrito aos perfis internos.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request, { permitirFornecedor: true });
    const ehForn = temPerfil(admin, ["fornecedor"]);
    if (!ehForn && !temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_extratos_bancarios").select("banco, mes, ano, storage_path").eq("id", params.id!).maybeSingle();
    if (!row?.storage_path) return jsonErr(404, "Extrato não encontrado.");
    if (ehForn) {
      await registrarAcao(db, { req: request, admin }, {
        acao: "criar", entidade: "fornecedor_download", registro_id: params.id!,
        descricao: `Fornecedor ${admin.email} baixou extrato ${(row as any).banco} ${String((row as any).mes).padStart(2, "0")}/${(row as any).ano}`,
      }).catch(() => {});
    }
    const { data, error } = await supabaseAdmin2().storage.from("doc-empresa").createSignedUrl(row.storage_path, 600);
    if (error || !data?.signedUrl) return jsonErr(500, error?.message || "Falha ao gerar link.");
    return new Response(null, { status: 302, headers: { Location: data.signedUrl } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE → remove o arquivo do storage e o registro (com lixeira/auditoria).
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_extratos_bancarios").select("*").eq("id", params.id!).maybeSingle();
    if (!row) return jsonErr(404, "Extrato não encontrado.");
    if (row.storage_path) await supabaseAdmin2().storage.from("doc-empresa").remove([row.storage_path]).catch(() => {});
    await excluirComLixeira(db, { req: request, admin }, {
      tabela: "doc_extratos_bancarios", idCol: "id", id: params.id!,
      descricao: `Excluiu extrato ${row.banco} ${String(row.mes).padStart(2, "0")}/${row.ano}`,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
