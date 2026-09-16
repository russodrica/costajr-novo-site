// Diz qual commit está REALMENTE no ar.
//
// Existe porque a pergunta "o deploy já subiu?" custou várias rodadas de teste
// no escuro: a Adriana testava o bot, o comportamento era o antigo, e não havia
// como distinguir "código velho" de "bug novo". A Vercel injeta o SHA do commit
// no build, então basta devolvê-lo. Expõe só o hash — nada sensível.
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () => {
  const env: any = { ...(process.env || {}), ...((import.meta as any).env || {}) };
  const sha = String(env.VERCEL_GIT_COMMIT_SHA || "");
  return new Response(
    JSON.stringify({
      commit: sha.slice(0, 7) || "desconhecido",
      mensagem: String(env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0].slice(0, 120),
      ambiente: String(env.VERCEL_ENV || "local"),
    }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
};
