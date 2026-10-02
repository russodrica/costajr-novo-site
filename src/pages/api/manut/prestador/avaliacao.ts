import type { APIRoute } from "astro";
import { requirePrestador, jsonOk, jsonErr } from "~/lib/auth";
import { sortearProva, corrigir, temProva, QTD_PROVA } from "~/lib/manut/avaliacaoTecnica";
import { registrarAvaliacao } from "~/lib/manut/prestadores";
import { espValida, espLabel } from "~/lib/manut/especialidades";

export const prerender = false;

// GET ?especialidade=eletrica → sorteia a prova (SEM o gabarito).
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requirePrestador(request);
    const esp = url.searchParams.get("especialidade") || "";
    if (!espValida(esp) || !temProva(esp)) return jsonErr(400, "Especialidade sem prova disponível.");
    return jsonOk({ especialidade: esp, label: espLabel(esp), corte: 70, perguntas: sortearProva(esp, QTD_PROVA) });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};

// POST { especialidade, respostas:{ idPergunta: indiceEscolhido } } → corrige e grava.
export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requirePrestador(request);
    const { especialidade, respostas } = await request.json();
    if (!espValida(especialidade) || !temProva(especialidade)) return jsonErr(400, "Especialidade inválida.");
    if (!respostas || typeof respostas !== "object") return jsonErr(400, "Respostas ausentes.");
    const corr = corrigir(especialidade, respostas);
    if (corr.total === 0) return jsonErr(400, "Nenhuma resposta válida enviada.");
    const salvo = await registrarAvaliacao(claims.sub, especialidade, corr);
    return jsonOk({ especialidade, nota: salvo.nota, aprovado: salvo.aprovado, nivel: salvo.nivel, acertos: corr.acertos, total: corr.total });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};
