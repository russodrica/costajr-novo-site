import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bancosRestritosExterno, linhaRestritaExterno, podeVerComoExterno } from "../../../../../lib/sigilo";
import { acessoFornecedor, bancoLiberado, resumoAcesso } from "../../../../../lib/fornecedorAcesso";

export const prerender = false;

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const mesAno = (m: any, a: any) => `${MESES[(Number(m) || 1) - 1] || m}/${a}`;

// GET /api/admin/fornecedores/[id]/bloqueados
//
// CONFERÊNCIA de verdade: percorre TODOS os documentos que existem e roda, em
// cada um, exatamente as mesmas funções que a tela e a rota de download usam
// (lib/fornecedorAcesso + lib/sigilo). O que sair como "vê" aqui é o que ele vê
// no navegador; o que sair como "não vê" também não abre por link direto.
//
// Categorias vedadas ao externo — espelha CATS_VEDADAS_FORNECEDOR da rota de
// download e as abas escondidas da tela de Documentos da Empresa.
const CATS_VEDADAS = new Set(["Contratos", "Clientes", "Consórcios", "Seguros"]);

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();

    const { data: forn } = await db.from("portal_profiles")
      .select("id, email, display_name, empresa, role, roles")
      .eq("id", params.id!).maybeSingle();
    const rs = forn ? (((forn as any).roles?.length ? (forn as any).roles : [(forn as any).role]).filter(Boolean)) : [];
    if (!forn || !rs.includes("fornecedor")) return jsonErr(404, "Fornecedor não encontrado.");
    const pid = String((forn as any).id);

    const acesso = await acessoFornecedor(db, pid);
    const restritos = await bancosRestritosExterno(db);

    // exceções abertas nome a nome para ESTA pessoa
    const { data: permRows } = await db.from("doc_externo_permitido").select("tabela, registro_id").eq("profile_id", pid);
    const liberado = new Set(((permRows || []) as any[]).map((r) => `${r.tabela}:${r.registro_id}`));
    const permDe = (tabela: string, id: any) => (liberado.has(`${tabela}:${id}`) ? [pid] : []);

    const [{ data: exRows }, { data: arqRows }] = await Promise.all([
      db.from("doc_extratos_bancarios").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }),
      db.from("doc_empresa_arquivos").select("id, nome, doc_id, restrito_externo, arquivado"),
    ]);

    // ── EXTRATOS ───────────────────────────────────────────────────────────
    const extratos = (exRows || []) as any[];
    const vistosEx: any[] = [];
    const bloqEx: any[] = [];
    for (const r of extratos) {
      const label = `${r.banco || "(sem banco)"} — ${mesAno(r.mes, r.ano)}`;
      if (!acesso.docBancarios) { bloqEx.push({ id: r.id, label, motivo: "modulo" }); continue; }
      if (!bancoLiberado(acesso, r.banco)) { bloqEx.push({ id: r.id, label, motivo: "escopo" }); continue; }
      const ok = podeVerComoExterno(r, { ehExterno: true, profileId: pid, restritos, permitidos: permDe("doc_extratos_bancarios", r.id) });
      if (ok) vistosEx.push({ id: r.id, label });
      else bloqEx.push({ id: r.id, label, motivo: r.restrito_externo ? "documento" : "banco" });
    }

    // ── ARQUIVOS DA EMPRESA ────────────────────────────────────────────────
    const arquivos = ((arqRows || []) as any[]).filter((a) => !a.arquivado);
    const docIds = [...new Set(arquivos.map((a) => a.doc_id).filter(Boolean))];
    let docInfo: Record<string, { nome: string; categoria: string; arquivado: boolean }> = {};
    if (docIds.length) {
      const { data: docs } = await db.from("doc_empresa").select("id, nome, categoria, arquivado").in("id", docIds);
      docInfo = Object.fromEntries(((docs || []) as any[]).map((d) => [d.id, { nome: d.nome, categoria: d.categoria || "", arquivado: !!d.arquivado }]));
    }
    const rotulo = (a: any) => {
      const d = docInfo[a.doc_id];
      return d?.nome && d.nome !== a.nome ? `${d.nome} — ${a.nome}` : (a.nome || "arquivo");
    };
    const vistosArq: any[] = [];
    const bloqArq: any[] = [];
    for (const a of arquivos) {
      const label = rotulo(a);
      const d = docInfo[a.doc_id];
      if (!acesso.docEmpresa) { bloqArq.push({ id: a.id, label, motivo: "modulo" }); continue; }
      if (!d || d.arquivado || CATS_VEDADAS.has(d.categoria)) { bloqArq.push({ id: a.id, label, motivo: "categoria" }); continue; }
      const ok = podeVerComoExterno(a, { ehExterno: true, profileId: pid, restritos, permitidos: permDe("doc_empresa_arquivos", a.id) });
      if (ok) vistosArq.push({ id: a.id, label });
      else bloqArq.push({ id: a.id, label, motivo: "documento" });
    }

    // ── ALERTAS (o que provavelmente está errado na configuração) ──────────
    const alertas: string[] = [];
    if (!acesso.docEmpresa && !acesso.docBancarios) {
      alertas.push("Esta pessoa está sem NENHUM módulo liberado: ela consegue entrar no portal, mas não vê documento algum.");
    }
    if (acesso.docBancarios && acesso.bancosModo === "lista" && !acesso.bancos.length) {
      alertas.push("Documentos Bancários está ligado, mas nenhum banco foi escolhido — na prática ela não vê extrato nenhum.");
    }
    if (acesso.docBancarios && acesso.bancosModo === "todos") {
      alertas.push("Documentos Bancários está liberado para TODOS os bancos, inclusive os que forem cadastrados no futuro.");
    }
    const bancosVistos = [...new Set(vistosEx.map((x) => String(x.label).split(" — ")[0]))].sort();

    return jsonOk({
      ok: true,
      fornecedor: forn,
      acesso,
      resumo: resumoAcesso(acesso),
      alertas,
      bancosEscondidos: restritos,
      bancosQueEleVe: bancosVistos,
      ve: { extratos: vistosEx, arquivos: vistosArq },
      naoVe: { extratos: bloqEx, arquivos: bloqArq },
      contagem: {
        extratosTotal: extratos.length, extratosVisiveis: vistosEx.length,
        arquivosTotal: arquivos.length, arquivosVisiveis: vistosArq.length,
      },
    });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
