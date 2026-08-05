import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bancosRestritosExterno, linhaRestritaExterno } from "../../../../../lib/sigilo";

export const prerender = false;

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const mesAno = (m: any, a: any) => `${MESES[(Number(m) || 1) - 1] || m}/${a}`;

// GET /api/admin/fornecedores/[id]/bloqueados
// Mostra, para UM usuário externo, exatamente o que ele NÃO enxerga e o que ainda vê.
// Serve de conferência: a mesma regra que a tela e o download usam (src/lib/sigilo.ts).
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();

    const { data: forn } = await db.from("portal_profiles")
      .select("id, email, display_name, empresa")
      .eq("id", params.id!).eq("role", "fornecedor").maybeSingle();
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");
    const pid = String((forn as any).id);

    const restritos = await bancosRestritosExterno(db);

    // exceções liberadas para ESTA pessoa
    const { data: permRows } = await db.from("doc_externo_permitido").select("tabela, registro_id").eq("profile_id", pid);
    const liberado = new Set(((permRows || []) as any[]).map((r) => `${r.tabela}:${r.registro_id}`));

    // O fornecedor só enxerga EXTRATOS e arquivos de Documentos da Empresa.
    const [{ data: exRows }, { data: arqRows }] = await Promise.all([
      db.from("doc_extratos_bancarios").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }),
      db.from("doc_empresa_arquivos").select("id, nome, doc_id, restrito_externo, arquivado"),
    ]);

    const extratos = ((exRows || []) as any[]);
    const bloqueadosEx = extratos
      .filter((r) => linhaRestritaExterno(r, restritos) && !liberado.has(`doc_extratos_bancarios:${r.id}`))
      .map((r) => ({ id: r.id, label: `${r.banco} — ${mesAno(r.mes, r.ano)}`, motivo: r.restrito_externo ? "documento" : "banco" }));
    const liberadosEx = extratos
      .filter((r) => linhaRestritaExterno(r, restritos) && liberado.has(`doc_extratos_bancarios:${r.id}`))
      .map((r) => ({ id: r.id, label: `${r.banco} — ${mesAno(r.mes, r.ano)}` }));

    const arquivos = ((arqRows || []) as any[]).filter((a) => !a.arquivado);
    const arqRestritos = arquivos.filter((a) => a.restrito_externo);
    const docIds = [...new Set(arqRestritos.map((a) => a.doc_id).filter(Boolean))];
    let nomeDoc: Record<string, string> = {};
    if (docIds.length) {
      const { data: docs } = await db.from("doc_empresa").select("id, nome").in("id", docIds);
      nomeDoc = Object.fromEntries(((docs || []) as any[]).map((d) => [d.id, d.nome]));
    }
    const bloqueadosArq = arqRestritos
      .filter((a) => !liberado.has(`doc_empresa_arquivos:${a.id}`))
      .map((a) => ({ id: a.id, label: nomeDoc[a.doc_id] && nomeDoc[a.doc_id] !== a.nome ? `${nomeDoc[a.doc_id]} — ${a.nome}` : a.nome }));
    const liberadosArq = arqRestritos
      .filter((a) => liberado.has(`doc_empresa_arquivos:${a.id}`))
      .map((a) => ({ id: a.id, label: nomeDoc[a.doc_id] && nomeDoc[a.doc_id] !== a.nome ? `${nomeDoc[a.doc_id]} — ${a.nome}` : a.nome }));

    return jsonOk({
      ok: true,
      fornecedor: forn,
      bancosEscondidos: restritos,
      bloqueados: { extratos: bloqueadosEx, arquivos: bloqueadosArq },
      liberadosNaMao: { extratos: liberadosEx, arquivos: liberadosArq },
      resumo: {
        extratosTotal: extratos.length,
        extratosVisiveis: extratos.length - bloqueadosEx.length,
        arquivosTotal: arquivos.length,
        arquivosVisiveis: arquivos.length - bloqueadosArq.length,
      },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
