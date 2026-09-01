import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, hashSenha, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { enviarSenhaFornecedor } from "../../../../lib/mailer";
import { salvarModulosFornecedor, salvarBancosFornecedor, resumoAcesso, type BancosModo } from "../../../../lib/fornecedorAcesso";
import { BANCOS } from "../../../../lib/bancos";

export const prerender = false;
const PERFIS = ["admin"]; // gestão de acesso externo é só do admin
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Senha forte legível (12 chars: letras maiúsc/minúsc + dígitos) — mostrada UMA vez. */
function gerarSenhaForte(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

// GET → lista os usuários fornecedores (role=fornecedor)
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data, error } = await db.from("portal_profiles")
      .select("id, display_name, empresa, email, approval_status, last_login_at, created_at")
      .eq("role", "fornecedor")
      .order("created_at", { ascending: false });
    if (error) return jsonErr(400, error.message);
    return jsonOk({ fornecedores: data || [] });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST → cria um usuário fornecedor { nome, empresa, email } — retorna a senha gerada (1x)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json();
    const nome = String(b.nome || "").trim();
    const empresa = String(b.empresa || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    if (!nome || !email) return jsonErr(400, "Informe nome e e-mail.");
    if (!EMAIL_RX.test(email)) return jsonErr(400, "E-mail inválido.");

    // ── LIBERAÇÕES (migration 115) ──────────────────────────────────────────
    // Passam a ser escolhidas AQUI, na criação. Nada de "cria e ajusta depois":
    // um acesso sem liberação nenhuma não serve para nada e um acesso amplo demais
    // é justamente o risco que se quer evitar.
    const docEmpresa = !!b.docEmpresa;
    const docBancarios = !!b.docBancarios;
    if (!docEmpresa && !docBancarios) return jsonErr(400, "Escolha ao menos um módulo que esta pessoa poderá acessar.");
    const bancosModo: BancosModo = String(b.bancosModo || "todos") === "lista" ? "lista" : "todos";
    const bancos: string[] = Array.isArray(b.bancos)
      ? b.bancos.map((x: any) => String(x)).filter((x: string) => BANCOS.includes(x))
      : [];
    if (docBancarios && bancosModo === "lista" && !bancos.length) {
      return jsonErr(400, "Você escolheu bancos específicos, mas não marcou nenhum.");
    }
    // Abas de dentro de Documentos Bancários (116): só existem se o módulo estiver ligado.
    const faturas = docBancarios && !!b.faturas;
    const emprestimos = docBancarios && !!b.emprestimos;

    const db = supabaseAdmin();
    const { data: ja } = await db.from("portal_profiles").select("id, role").eq("email", email).maybeSingle();
    if (ja) return jsonErr(409, "Já existe um usuário com este e-mail.");

    const senha = gerarSenhaForte();
    const { data: row, error } = await db.from("portal_profiles").insert({
      email, display_name: nome, empresa: empresa || null,
      role: "fornecedor", roles: ["fornecedor"],
      approval_status: "approved",
      senha_hash: await hashSenha(senha),
      senha_troca_obrigatoria: true, // provisória: troca no 1º acesso
    }).select("id").single();
    if (error) return jsonErr(400, error.message);

    // Escopo gravado ANTES de qualquer e-mail sair: se isto falhar, o acesso
    // nasce sem liberação (deny-by-default) em vez de nascer enxergando tudo.
    const acesso = { docEmpresa, docBancarios, bancosModo, bancos, faturas, emprestimos };
    try {
      await salvarModulosFornecedor(db, String(row!.id), { docEmpresa, docBancarios });
      await salvarBancosFornecedor(db, String(row!.id), bancosModo, bancos, admin.email || null, { faturas, emprestimos });
    } catch (e: any) {
      return jsonErr(500, `Usuário criado, mas as liberações não foram salvas (${e?.message || "erro"}). Abra "Acesso" na lista e salve de novo antes de passar a senha.`);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "portal_profiles", registro_id: row?.id ?? null,
      descricao: `Criou usuário FORNECEDOR ${nome}${empresa ? ` (${empresa})` : ""} <${email}> — acesso: ${resumoAcesso(acesso)}`,
      dados: { role: "fornecedor", empresa, acesso },
    }).catch(() => {});

    // Envia a senha provisória por e-mail (boas-vindas + link da intranet + instruções).
    let emailEnviado = false;
    let emailErro: string | undefined;
    try {
      await enviarSenhaFornecedor(email, nome, empresa || null, senha, "boas-vindas");
      emailEnviado = true;
    } catch (e: any) {
      emailErro = e?.message || "Falha ao enviar o e-mail.";
    }

    // Retorna a senha como FALLBACK (o admin repassa manualmente se o e-mail falhar).
    return jsonOk({ ok: true, id: row?.id, senha, emailEnviado, emailErro, acesso: resumoAcesso(acesso) });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
