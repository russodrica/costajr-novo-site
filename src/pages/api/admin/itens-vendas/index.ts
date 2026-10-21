import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { lerItens } from "../../../../lib/itensDeposito";
import { gravarPerguntas, lerPerguntas, montarAnuncio, sugerirResposta, type Pergunta } from "../../../../lib/itensVendas";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const [itens, perguntas] = await Promise.all([lerItens(db), lerPerguntas(db)]);
    const anuncios = itens.filter((i) => i.status === "disponivel").map((i) => ({ n: i.n, ...montarAnuncio(i) }));
    return jsonOk({ ok: true, anuncios, perguntas: perguntas.sort((a, b) => b.em.localeCompare(a.em)) });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message || "Falha ao carregar.");
  }
};

// POST { acao }: sugerir {pergunta,n,canal,comprador} | status {id,status,resposta?} | excluir {id}
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSoLeitura(admin, "itens-vendas");
    if (ro) return ro;
    const b = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    if (b.acao === "sugerir") {
      const texto = String(b.pergunta || "").trim();
      if (texto.length < 2) return jsonErr(400, "Cole a pergunta do comprador.");
      const itens = await lerItens(db);
      const it = b.n ? itens.find((i) => i.n === Number(b.n)) || null : null;
      const s = await sugerirResposta(texto, it);
      const lista = await lerPerguntas(db);
      const p: Pergunta = {
        id: Math.random().toString(36).slice(2, 10),
        em: new Date().toISOString(),
        canal: ["Marketplace", "OLX", "Outro"].includes(b.canal) ? b.canal : "Marketplace",
        n: it ? it.n : null,
        comprador: String(b.comprador || "").slice(0, 80),
        pergunta: texto.slice(0, 1000),
        resposta: s.resposta,
        tipo: s.tipo,
        status: s.status,
      };
      lista.push(p);
      await gravarPerguntas(db, lista);
      return jsonOk({ ok: true, pergunta: p });
    }

    const lista = await lerPerguntas(db);
    const p = lista.find((x) => x.id === String(b.id));
    if (!p) return jsonErr(404, "Pergunta não encontrada.");
    if (b.acao === "status") {
      if (!["pendente", "decidir", "respondida"].includes(b.status)) return jsonErr(400, "Status inválido.");
      p.status = b.status;
      if (typeof b.resposta === "string") p.resposta = b.resposta.slice(0, 2000);
      await gravarPerguntas(db, lista);
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "itens_vendas_pergunta", registro_id: p.id, descricao: `Pergunta ${p.canal}: ${p.status}`,
      });
      return jsonOk({ ok: true });
    }
    if (b.acao === "excluir") {
      await gravarPerguntas(db, lista.filter((x) => x.id !== p.id));
      return jsonOk({ ok: true });
    }
    return jsonErr(400, "Ação inválida.");
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message || "Falha ao salvar.");
  }
};
