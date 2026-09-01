import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin, supabaseAdmin2 } from "../../../../../lib/supabase";
import { excluirComLixeira } from "../../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../../lib/permissoes";
import { bancosRestritosExterno, externosPermitidos, podeVerComoExterno } from "../../../../../lib/sigilo";
import { acessoFornecedor, bancoLiberado } from "../../../../../lib/fornecedorAcesso";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin", "financeiro", "juridico"];

// GET → URL assinada (10 min). O EXTERNO só chega aqui se a aba "Faturas de Cartão"
// tiver sido liberada para ele (116) e o cartão estiver no escopo dele.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request, { permitirFornecedor: true });
    const ehForn = temPerfil(admin, ["fornecedor"]);
    if (!ehForn && !temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data: row } = await db.from("doc_cartao_faturas").select("*").eq("id", params.id!).maybeSingle();
    if (!row?.storage_path) return jsonErr(404, "Fatura não encontrada.");
    if (ehForn) {
      const acesso = await acessoFornecedor(db, admin.sub);
      if (!acesso.faturas) return jsonErr(404, "Fatura não encontrada.");
      if (!bancoLiberado(acesso, (row as any).cartao)) return jsonErr(404, "Fatura não encontrada.");
      const restritos = await bancosRestritosExterno(db);
      const perm = await externosPermitidos(db, "doc_cartao_faturas", [params.id!]);
      if (!podeVerComoExterno(row, { ehExterno: true, profileId: admin.sub, restritos, permitidos: perm[params.id!] || [] })) {
        return jsonErr(404, "Fatura não encontrada.");
      }
      await registrarAcao(db, { req: request, admin }, {
        acao: "criar", entidade: "fornecedor_download", registro_id: params.id!,
        descricao: `Fornecedor ${admin.email} baixou fatura ${(row as any).cartao} ${String((row as any).mes).padStart(2, "0")}/${(row as any).ano}`,
      }).catch(() => {});
    }
    const { data, error } = await supabaseAdmin2().storage.from("doc-empresa").createSignedUrl(row.storage_path, 600);
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
    if (row.storage_path) await supabaseAdmin2().storage.from("doc-empresa").remove([row.storage_path]).catch(() => {});
    await excluirComLixeira(db, { req: request, admin }, {
      tabela: "doc_cartao_faturas", idCol: "id", id: params.id!,
      descricao: `Excluiu fatura ${row.cartao} ${String(row.mes).padStart(2, "0")}/${row.ano}`,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
