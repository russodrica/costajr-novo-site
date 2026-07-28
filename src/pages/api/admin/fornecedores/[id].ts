import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, hashSenha, invalidarSessoesPortal, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao, excluirComLixeira } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

function gerarSenhaForte(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

/** Carrega o perfil e garante que É um fornecedor (nunca tocar contas internas por aqui). */
async function fornecedorOu404(db: any, id: string) {
  const { data } = await db.from("portal_profiles").select("id, display_name, empresa, email, role, approval_status").eq("id", id).maybeSingle();
  if (!data || data.role !== "fornecedor") return null;
  return data;
}

// PATCH → { acao: "aprovar" | "bloquear" | "reset_senha" } (+ campos nome/empresa p/ editar)
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const forn = await fornecedorOu404(db, params.id!);
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");
    const b = await request.json().catch(() => ({}));
    const acao = String(b.acao || "");

    if (acao === "aprovar" || acao === "bloquear") {
      const status = acao === "aprovar" ? "approved" : "rejected";
      const { error } = await db.from("portal_profiles").update({ approval_status: status }).eq("id", forn.id);
      if (error) return jsonErr(400, error.message);
      if (status === "rejected") await invalidarSessoesPortal(forn.id); // derruba sessões ativas na hora
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "portal_profiles", registro_id: forn.id,
        descricao: `${status === "approved" ? "Aprovou" : "BLOQUEOU"} o acesso do fornecedor ${forn.display_name} <${forn.email}>`,
      }).catch(() => {});
      return jsonOk({ ok: true, approval_status: status });
    }

    if (acao === "reset_senha") {
      const senha = gerarSenhaForte();
      const { error } = await db.from("portal_profiles").update({ senha_hash: await hashSenha(senha) }).eq("id", forn.id);
      if (error) return jsonErr(400, error.message);
      await invalidarSessoesPortal(forn.id); // sessões antigas caem
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "portal_profiles", registro_id: forn.id,
        descricao: `Resetou a senha do fornecedor ${forn.display_name} <${forn.email}>`,
      }).catch(() => {});
      return jsonOk({ ok: true, senha }); // mostrada UMA vez
    }

    // edição simples de nome/empresa
    const upd: Record<string, any> = {};
    if (typeof b.nome === "string" && b.nome.trim()) upd.display_name = b.nome.trim();
    if (typeof b.empresa === "string") upd.empresa = b.empresa.trim() || null;
    if (!Object.keys(upd).length) return jsonErr(400, "Nada para atualizar.");
    const { error } = await db.from("portal_profiles").update(upd).eq("id", forn.id);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "portal_profiles", registro_id: forn.id,
      descricao: `Editou o fornecedor ${forn.display_name} <${forn.email}>`, dados: upd,
    }).catch(() => {});
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE → remove o fornecedor (lixeira 30 dias) e derruba sessões
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const forn = await fornecedorOu404(db, params.id!);
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");
    await invalidarSessoesPortal(forn.id);         // derruba sessões (token_version)
    try { await db.from("portal_sessoes").delete().eq("user_id", forn.id); } catch { /* tabela pode não existir */ }
    // excluirComLixeira NÃO lança — retorna {ok:false}. Checar o retorno (senão "some" em silêncio).
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "portal_profiles", idCol: "id", id: forn.id,
      descricao: `Excluiu o fornecedor ${forn.display_name} <${forn.email}>`,
    });
    if (!r.ok) {
      // FK de histórico impede apagar → bloqueia em vez de excluir (acesso morre igual — approval rejected).
      const { error: e2 } = await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", forn.id);
      if (e2) return jsonErr(400, r.error || "Falha ao excluir o fornecedor.");
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "portal_profiles", registro_id: forn.id,
        descricao: `Não pôde excluir o fornecedor ${forn.display_name} (histórico vinculado) — acesso BLOQUEADO`,
      }).catch(() => {});
      return jsonOk({ ok: true, bloqueado: true, aviso: "Havia histórico vinculado: o acesso foi bloqueado em vez de excluído." });
    }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
