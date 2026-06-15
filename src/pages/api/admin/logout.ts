import type { APIRoute } from "astro";

export const POST: APIRoute = ({ cookies }) => {
  cookies.delete("admin_token", { path: "/" });
  // Limpa também o cookie-ponte do RH embutido no portal (escopo de domínio,
  // vale apex+www). Sem isso, a sessão "emprestada" do colaborador fica grudada
  // e o botão Sair não desloga de fato.
  cookies.delete("admin_token", { path: "/", domain: ".costajr.com.br" });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
};
