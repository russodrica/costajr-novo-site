import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSemLeitura } from "../../../../lib/permissoes";

export const prerender = false;
// Quem MEXE nessa regra: só admin. Financeiro/jurídico veem os documentos, mas
// não decidem o que o contador enxerga — isso é decisão de quem administra.
const PERFIS = ["admin"];

const TABELAS: Record<string, { tabela: string; rotulo: string }> = {
  extrato: { tabela: "doc_extratos_bancarios", rotulo: "extrato" },
  fatura: { tabela: "doc_cartao_faturas", rotulo: "fatura de cartão" },
  emprestimo: { tabela: "doc_emprestimos", rotulo: "contrato de empréstimo" },
  arquivo: { tabela: "doc_empresa_arquivos", rotulo: "arquivo da empresa" },
};

// GET  → lista os usuários EXTERNOS (fornecedores) e, se vier ?tipo=&id=,
//        diz também como está a regra daquele documento.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();

    const { data: profs } = await db.from("portal_profiles").select("id, nome, email, role, roles");
    const externos = ((profs || []) as any[])
      .filter((p) => {
        const rs = (p.roles && p.roles.length ? p.roles : [p.role]).filter(Boolean);
        return rs.includes("fornecedor");
      })
      .map((p) => ({ id: String(p.id), nome: p.nome || p.email || "(sem nome)", email: p.email || "" }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const tipo = String(url.searchParams.get("tipo") || "");
    const id = String(url.searchParams.get("id") || "");
    let restrito = false;
    let permitidos: string[] = [];
    const cfg = TABELAS[tipo];
    if (cfg && id) {
      const { data: row } = await db.from(cfg.tabela).select("*").eq("id", id).maybeSingle();
      restrito = !!(row as any)?.restrito_externo;
      const { data: perm } = await db.from("doc_externo_permitido").select("profile_id").eq("tabela", cfg.tabela).eq("registro_id", id);
      permitidos = ((perm || []) as any[]).map((r) => String(r.profile_id));
    }
    return jsonOk({ ok: true, externos, restrito, permitidos });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao carregar.");
  }
};

// POST → salva a regra de UM documento:
//   { tipo, id, restrito: bool, permitidos: string[] }
// restrito=false  → todos os externos voltam a ver (a lista de exceções é apagada)
// restrito=true   → nenhum externo vê, exceto os `permitidos`
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "doc-bancarios"); if (ro) return ro;
    const b = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    // ── regra por BANCO/CARTÃO inteiro ──
    if (typeof b.banco === "string" && b.banco.trim()) {
      const banco = b.banco.trim().slice(0, 120);
      const restrito = !!b.restrito;
      const { data: ja } = await db.from("doc_bancos_sigilosos").select("banco").eq("banco", banco).maybeSingle();
      if (ja) {
        const { error } = await db.from("doc_bancos_sigilosos").update({ restrito_externo: restrito }).eq("banco", banco);
        if (error) return jsonErr(400, error.message);
      } else {
        // ainda não existia regra para esse banco: cria já sem bloquear o envio
        const { error } = await db.from("doc_bancos_sigilosos").insert({ banco, restrito_externo: restrito, bloqueia_envio: false, criado_por: admin.email || null });
        if (error) return jsonErr(400, error.message);
      }
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "doc_bancos_sigilosos", registro_id: banco,
        descricao: `${restrito ? "Escondeu" : "Liberou"} os documentos de "${banco}" para os usuários externos (contador)`,
      }).catch(() => {});
      return jsonOk({ ok: true, banco, restrito });
    }

    // ── regra por DOCUMENTO ──
    const cfg = TABELAS[String(b.tipo || "")];
    if (!cfg) return jsonErr(400, "Tipo de documento inválido.");
    const id = String(b.id || "").trim();
    if (!id) return jsonErr(400, "Informe o documento.");
    const restrito = !!b.restrito;
    const permitidos: string[] = Array.isArray(b.permitidos) ? b.permitidos.map((x: any) => String(x)).filter(Boolean) : [];

    const { data: row } = await db.from(cfg.tabela).select("id").eq("id", id).maybeSingle();
    if (!row) return jsonErr(404, "Documento não encontrado.");

    const { error: eUp } = await db.from(cfg.tabela).update({ restrito_externo: restrito }).eq("id", id);
    if (eUp) return jsonErr(400, eUp.message);

    // regrava a lista de exceções (apaga as antigas e insere as atuais)
    await db.from("doc_externo_permitido").delete().eq("tabela", cfg.tabela).eq("registro_id", id);
    if (restrito && permitidos.length) {
      const linhas = permitidos.map((pid) => ({ tabela: cfg.tabela, registro_id: id, profile_id: pid, criado_por: admin.email || null }));
      const { error: eIns } = await db.from("doc_externo_permitido").insert(linhas);
      if (eIns) return jsonErr(400, eIns.message);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: cfg.tabela, registro_id: id,
      descricao: restrito
        ? `Escondeu o ${cfg.rotulo} dos usuários externos${permitidos.length ? ` (liberado para ${permitidos.length} pessoa(s))` : ""}`
        : `Liberou o ${cfg.rotulo} para todos os usuários externos`,
      dados: { restrito_externo: restrito, permitidos },
    }).catch(() => {});

    return jsonOk({ ok: true, id, restrito, permitidos });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao salvar.");
  }
};
