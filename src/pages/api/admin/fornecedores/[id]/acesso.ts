import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import {
  acessoFornecedor, salvarModulosFornecedor, salvarBancosFornecedor,
  resumoAcesso, MODULOS_FORNECEDOR, type BancosModo,
} from "../../../../../lib/fornecedorAcesso";
import { BANCOS } from "../../../../../lib/bancos";

export const prerender = false;
const PERFIS = ["admin"]; // quem decide o que o externo enxerga é só o admin

async function carregarForn(db: any, id: string) {
  const { data } = await db.from("portal_profiles")
    .select("id, display_name, empresa, email, role, roles")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const rs = ((data as any).roles?.length ? (data as any).roles : [(data as any).role]).filter(Boolean);
  return rs.includes("fornecedor") ? data : null;
}

// GET → liberações atuais desta pessoa + catálogo (módulos e bancos) para a tela.
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const forn = await carregarForn(db, params.id!);
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");
    const acesso = await acessoFornecedor(db, String((forn as any).id));
    return jsonOk({ ok: true, fornecedor: forn, acesso, catalogo: { modulos: MODULOS_FORNECEDOR, bancos: BANCOS } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST → grava as liberações { docEmpresa, docBancarios, bancosModo, bancos }.
// Não existe "salvar sem escolher": ou tem módulo marcado, ou o acesso fica vazio
// de propósito (e a tela avisa).
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const forn = await carregarForn(db, params.id!);
    if (!forn) return jsonErr(404, "Fornecedor não encontrado.");
    const pid = String((forn as any).id);

    const b = await request.json().catch(() => ({}));
    const docEmpresa = !!b.docEmpresa;
    const docBancarios = !!b.docBancarios;
    const bancosModo: BancosModo = String(b.bancosModo || "todos") === "lista" ? "lista" : "todos";
    const bancos: string[] = Array.isArray(b.bancos)
      ? b.bancos.map((x: any) => String(x)).filter((x: string) => BANCOS.includes(x))
      : [];
    if (docBancarios && bancosModo === "lista" && !bancos.length) {
      return jsonErr(400, "Você escolheu bancos específicos, mas não marcou nenhum.");
    }

    const antes = await acessoFornecedor(db, pid);
    await salvarModulosFornecedor(db, pid, { docEmpresa, docBancarios });
    await salvarBancosFornecedor(db, pid, bancosModo, bancos, admin.email || null);
    const depois = await acessoFornecedor(db, pid);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "portal_profiles", registro_id: pid,
      descricao: `Mudou o acesso do fornecedor ${(forn as any).display_name || (forn as any).email}: de "${resumoAcesso(antes)}" para "${resumoAcesso(depois)}"`,
      dados: { antes, depois },
    }).catch(() => {});

    return jsonOk({ ok: true, acesso: depois, resumo: resumoAcesso(depois) });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
