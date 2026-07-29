import type { APIRoute } from "astro";
import { gerarSenhaInicial, hashSenha, invalidarSessoesPortal, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarSenhaReset, enviarSenhaFornecedor } from "~/lib/mailer";

export const prerender = false;

// Perfis que podem acessar o painel administrativo (+ coordenador legado tolerado).
const ROLES_PAINEL = ["admin", "manutencao_operacao", "manutencao_administrativo", "operacional", "rh", "financeiro", "comercial", "juridico", "coordenador"];

// Rate limit simples em memória (anti-abuso): 5 pedidos por e-mail a cada 15 min.
const tentativas = new Map<string, { count: number; resetAt: number }>();
function limitar(chave: string): boolean {
  const now = Date.now();
  const b = tentativas.get(chave);
  if (!b || b.resetAt <= now) {
    tentativas.set(chave, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  b.count += 1;
  return b.count <= 5;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") return jsonErr(400, "Informe o e-mail.");
    const alvo = email.toLowerCase().trim();

    // Descobre de qual tela veio o pedido para mandar o link de login correto.
    // /admin/login (admin) ou /portal/login (colaborador) usam o mesmo backend.
    const referer = request.headers.get("referer") || "";
    const loginPath = referer.includes("/admin") ? "/admin/login" : "/portal/login";

    if (!limitar(alvo)) {
      return jsonErr(429, "Muitas solicitações. Aguarde alguns minutos e tente novamente.");
    }

    const db = supabaseAdmin();
    const { data: perfil } = await db
      .from("portal_profiles")
      .select("id, email, display_name, full_name, empresa, role, approval_status")
      .eq("email", alvo)
      .maybeSingle();

    // Resposta SEMPRE genérica — não revela se o e-mail existe (anti-enumeração).
    const respostaGenerica = jsonOk({
      ok: true,
      message: "Se o e-mail estiver cadastrado, enviaremos uma senha temporária em instantes.",
    });

    // Fornecedor (externo) também pode se auto-recuperar — a senha é a única
    // credencial dele. Sem isso, o link "Esqueci minha senha" fingia sucesso e
    // nunca enviava e-mail (beco sem saída).
    const ehFornecedor = !!perfil && perfil.role === "fornecedor";
    if (
      !perfil ||
      perfil.approval_status !== "approved" ||
      (!ROLES_PAINEL.includes(perfil.role) && !ehFornecedor)
    ) {
      return respostaGenerica;
    }

    // Gera nova senha temporária e grava (obriga troca no próximo acesso)
    const novaSenha = gerarSenhaInicial();
    const senha_hash = await hashSenha(novaSenha);
    await db
      .from("portal_profiles")
      .update({ senha_hash, senha_troca_obrigatoria: true })
      .eq("id", perfil.id);

    const nome = perfil.display_name || perfil.full_name || (ehFornecedor ? "Fornecedor" : "Colaborador");
    try {
      if (ehFornecedor) {
        // Derruba sessões antigas e manda o e-mail do Portal do Fornecedor (link da intranet).
        await invalidarSessoesPortal(perfil.id);
        await enviarSenhaFornecedor(perfil.email, nome, (perfil as any).empresa || null, novaSenha, "reset");
      } else {
        await enviarSenhaReset(perfil.email, nome, novaSenha, loginPath);
      }
    } catch (e: any) {
      console.error("[admin/forgot-senha] e-mail falhou:", e?.message);
      // Mantém resposta genérica mesmo se o e-mail falhar.
    }

    return respostaGenerica;
  } catch (e: any) {
    return jsonErr(500, e.message);
  }
};
