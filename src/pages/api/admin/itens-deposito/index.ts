import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr, signToken } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { criarLink, estadoLink, gravarExcluidos, gravarItens, gravarLinks, lerExcluidos, lerItens, lerLinks } from "../../../../lib/itensDeposito";

export const prerender = false;
// Quem gera/revoga links e mexe no catálogo: só administrador.
const PERFIS = ["admin"];
const SITE = (import.meta.env.SITE_BASE_URL || "https://www.costajr.com.br").replace(/\/$/, "");
const urlDoLink = (token: string) => `${SITE}/itens/${token}`;

export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const [itens, links] = await Promise.all([lerItens(db), lerLinks(db)]);
    const agora = Date.now();
    return jsonOk({
      ok: true,
      itens,
      links: links
        .map((l) => ({ ...l, estado: estadoLink(l, agora) }))
        .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao carregar.");
  }
};

// POST { acao }:
//   gerar   { credor, horas?, mostrarValor }  → cria o link (a autorização) e devolve a URL
//   url     { id }                            → reemite a URL de um link ainda válido
//   revogar { id }                            → corta o acesso na hora
//   item    { n, status?, valor? }            → baixa/retorna item ou ajusta o valor
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSoLeitura(admin, "itens-deposito"); if (ro) return ro;
    const b = await request.json().catch(() => ({}));
    const db = supabaseAdmin();
    const ctx = { req: request, admin };

    if (b.acao === "gerar") {
      const credor = String(b.credor || "").trim();
      if (credor.length < 2) return jsonErr(400, "Informe o nome do credor.");
      const { link, token } = await criarLink(db, {
        credor, horas: Number(b.horas) || 24, mostrarValor: !!b.mostrarValor, criadoPor: admin.email || "admin",
      });
      await registrarAcao(db, ctx, {
        acao: "criar", entidade: "itens_deposito_link", registro_id: link.id,
        descricao: `Autorizou acesso aos Itens de Depósito para "${link.credor}" até ${link.expiraEm}`,
        dados: { credor: link.credor, expiraEm: link.expiraEm, mostrarValor: link.mostrarValor },
      });
      return jsonOk({ ok: true, link, url: urlDoLink(token) });
    }

    if (b.acao === "url") {
      const links = await lerLinks(db);
      const l = links.find((x) => x.id === String(b.id));
      if (!l || estadoLink(l) !== "ativo") return jsonErr(400, "Este link já não está ativo.");
      const segs = Math.max(60, Math.floor((new Date(l.expiraEm).getTime() - Date.now()) / 1000));
      const token = await signToken({ tipo: "itens", lid: l.id } as any, `${segs}s`);
      return jsonOk({ ok: true, url: urlDoLink(token) });
    }

    if (b.acao === "revogar") {
      const links = await lerLinks(db);
      const l = links.find((x) => x.id === String(b.id));
      if (!l) return jsonErr(404, "Link não encontrado.");
      l.revogado = true;
      await gravarLinks(db, links);
      await registrarAcao(db, ctx, {
        acao: "editar", entidade: "itens_deposito_link", registro_id: l.id,
        descricao: `Revogou o acesso de "${l.credor}" aos Itens de Depósito`,
      });
      return jsonOk({ ok: true });
    }

    if (b.acao === "item") {
      const itens = await lerItens(db);
      const it = itens.find((x) => x.n === Number(b.n));
      if (!it) return jsonErr(404, "Item não encontrado.");
      if (b.status === "disponivel" || b.status === "baixado") it.status = b.status;
      if (b.valor === null || b.valor === "") it.valor = null;
      else if (b.valor !== undefined) {
        const v = Number(b.valor);
        if (!Number.isFinite(v) || v < 0) return jsonErr(400, "Valor inválido.");
        it.valor = Math.round(v * 100) / 100;
      }
      if (b.qtd !== undefined && b.qtd !== "") {
        const q = Number(b.qtd);
        if (!Number.isFinite(q) || q < 0 || q > 100000) return jsonErr(400, "Quantidade inválida.");
        it.qtd = Math.round(q * 100) / 100;
        it.est = false; // quantidade conferida por você: deixa de ser "aproximada"
      }
      await gravarItens(db, itens);
      await registrarAcao(db, ctx, {
        acao: "editar", entidade: "itens_deposito_item", registro_id: String(it.n),
        descricao: `Item #${it.n} (${it.nome}): ${it.status}, qtd ${it.qtd}${it.valor != null ? ", valor " + it.valor : ""}`,
      });
      return jsonOk({ ok: true });
    }

    // Tira o item do catálogo (ex.: extraviado). A cópia fica em excluidos.json para restaurar.
    if (b.acao === "excluir") {
      const itens = await lerItens(db);
      const it = itens.find((x) => x.n === Number(b.n));
      if (!it) return jsonErr(404, "Item não encontrado.");
      const motivo = String(b.motivo || "Extraviado").trim().slice(0, 200);
      const excl = await lerExcluidos(db);
      excl.push({ ...it, excluidoEm: new Date().toISOString(), excluidoPor: admin.email || "admin", motivo });
      await gravarExcluidos(db, excl);
      await gravarItens(db, itens.filter((x) => x.n !== it.n));
      await registrarAcao(db, ctx, {
        acao: "excluir", entidade: "itens_deposito_item", registro_id: String(it.n),
        descricao: `Excluiu o item #${it.n} (${it.nome}), qtd ${it.qtd}. Motivo: ${motivo}`,
        dados: it,
      });
      return jsonOk({ ok: true });
    }

    if (b.acao === "restaurar") {
      const excl = await lerExcluidos(db);
      const idx = excl.map((x) => x.n).lastIndexOf(Number(b.n));
      if (idx < 0) return jsonErr(404, "Item excluído não encontrado.");
      const { excluidoEm, excluidoPor, motivo, ...it } = excl[idx];
      const itens = await lerItens(db);
      if (itens.some((x) => x.n === it.n)) return jsonErr(400, "Já existe um item com esse número.");
      itens.push(it);
      itens.sort((a, c) => a.n - c.n);
      await gravarItens(db, itens);
      await gravarExcluidos(db, excl.filter((_, k) => k !== idx));
      await registrarAcao(db, ctx, {
        acao: "restaurar", entidade: "itens_deposito_item", registro_id: String(it.n),
        descricao: `Restaurou o item #${it.n} (${it.nome})`,
      });
      return jsonOk({ ok: true });
    }

    return jsonErr(400, "Ação inválida.");
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao salvar.");
  }
};
