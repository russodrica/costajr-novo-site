import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr, type AdminClaims } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { dadosAoVivo, somaFornecedorVobi, type DadosAoVivo } from "../../../../lib/situacaoFinanceira";
import { VobiCotaError } from "../../../../lib/vobiBaixa";
import { msgDe, erroDeAcesso, erroDoBanco, lerCorpo, brl } from "../../../../lib/situacaoFinanceiraApi";

export const prerender = false;

// POST /api/admin/situacao-financeira/sincronizar   (corpo JSON: {} — content-type obrigatório por causa do CSRF)
// Regra da Adriana (14/10/2026): dívida = SÓ O VENCIDO; o que vence depois é despesa COMPROMETIDA (fora da dívida).
// Para cada dívida ATIVA e NÃO quitada com vobi_fornecedor_id cujo fornecedor APARECE com contas em aberto na
// leitura, grava: valor = vencido (vencimento antes de hoje) · valor_a_vencer = de hoje em diante · proximo_vencimento.
// NUNCA marca quitada sozinha: o fornecedor "sumir" da leitura não prova pagamento (nº errado, cadastro duplicado,
// parcelas canceladas ou em rateio que a API não lista, ou só contas de pessoa física). Essas linhas NÃO são
// mexidas e voltam em `paraConferir` — a Adriana confere e, se pagou, marca "✓ Quitei" com o valor pago.
// Vencido acima do teto (valor máximo) da linha: o teto é limpo (o PATCH recusa teto < vencido); fica no log.
// Usa a leitura AO VIVO já guardada (dadosAoVivo, cache de 1 h): o botão "Atualizar da Vobi" lê a Vobi primeiro
// (?forcar=1 no /aovivo) e depois chama esta rota — não gasta outra leitura da cota.
// Travas: não grava nada se a leitura da Vobi falhou (cópia velha com aviso) ou veio sem as contas em aberto (leitura
// cortada na paginação já falha em contasAbertas); dois cadastros com o MESMO fornecedor da Vobi são pulados (a soma
// entraria em dobro) e voltam em `conflitos`; se 5+ ligadas e mais da metade não aparecem na leitura, recusa (409) —
// cara de leitura incompleta.
// ATENÇÃO ao ligar uma linha a um fornecedor: só faz sentido se TODA a dívida daquela linha estiver lançada na Vobi.
// Resposta: { atualizadas, linhas: [linhas alteradas], paraConferir: [...], conflitos: [...], falhas, semMudanca, leituraEm }.
const MODULO = "situacao-financeira";
const TABELA = "fin_sf_dividas";
const LOTE = 8; // updates em paralelo

type Linha = {
  id: string; credor: string; identificacao: string | null; grupo: string; subgrupo: string | null;
  valor: number | null; valor_teto: number | null; valor_a_vencer: number | null; proximo_vencimento: string | null;
  vobi_fornecedor_id: number | null; quitada: boolean; ativo: boolean; observacao: string | null; situacao: string | null;
};

const n = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iguais = (a: unknown, b: unknown) => (n(a) ?? null) === (n(b) ?? null);
const dataIgual = (a: unknown, b: unknown) => (a == null ? null : String(a).slice(0, 10)) === (b == null ? null : String(b).slice(0, 10));
const ehPessoaFisica = (l: Linha) => /pessoa f[ií]sica|fora da empresa/i.test(String(l.subgrupo || ""));
const semAcento = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** Mesma regra da tela: "Em dia" (ou "Em acordo" com observação "em dia…") sem o a vencer separado = nada vencido. */
function vencidoNaTela(l: Linha): number {
  const k = semAcento(l.situacao).replace(/[\s-]+/g, "_");
  const emDia = k === "em_dia" || (k === "acordo" && /^em dia\b/.test(semAcento(l.observacao)));
  if (n(l.valor_a_vencer) == null && emDia) return 0;
  return Math.max(0, n(l.valor) ?? 0);
}

export const POST: APIRoute = async ({ request }) => {
  let admin: AdminClaims;
  try {
    admin = await requireAdminCookie(request);
  } catch (e) {
    return erroDeAcesso(e);
  }
  try {
    const ro = await bloqueioSeSoLeitura(admin, MODULO);
    if (ro) return ro;
  } catch (e) {
    return jsonErr(500, "Não consegui conferir a sua permissão agora. Tente de novo em instantes.", msgDe(e));
  }
  // corpo só para exigir o content-type JSON (CSRF do Astro); o conteúdo é ignorado
  const corpo = await lerCorpo(request, 2000);
  if (!corpo.ok) return jsonErr(corpo.status, corpo.erro);

  // 1) leitura da Vobi (a mesma que o botão acabou de fazer; cache de 1 h)
  let vivo: DadosAoVivo;
  try {
    vivo = await dadosAoVivo(false);
  } catch (e) {
    if (e instanceof VobiCotaError || /limite de consultas|\b429\b/i.test(msgDe(e))) {
      return jsonErr(429, "A Vobi atingiu o limite de consultas desta hora e não há leitura guardada. Nada foi sincronizado; tente mais tarde.");
    }
    return jsonErr(502, "Não consegui ler a Vobi agora; nada foi sincronizado.", msgDe(e).slice(0, 300));
  }
  if (vivo.aviso) {
    return jsonErr(409, `A leitura da Vobi não está em dia (${vivo.aviso}) — não sincronizei para não gravar números velhos.`);
  }
  const aberto = vivo.aberto;
  if (!aberto || !Array.isArray(aberto.porFornecedor) || !aberto.porFornecedor.length) {
    return jsonErr(409, "A leitura da Vobi veio sem as contas em aberto por fornecedor — nada foi sincronizado.");
  }

  // 2) dívidas ligadas a um fornecedor da Vobi
  const db = supabaseAdmin();
  const { data, error } = await db.from(TABELA)
    .select("id, credor, identificacao, grupo, subgrupo, valor, valor_teto, valor_a_vencer, proximo_vencimento, vobi_fornecedor_id, quitada, ativo, observacao, situacao")
    .not("vobi_fornecedor_id", "is", null)
    .eq("ativo", true)
    .limit(2000);
  if (error) return erroDoBanco(error);
  const linhas = ((data || []) as Linha[]).filter((l) => l.quitada !== true && Number.isInteger(Number(l.vobi_fornecedor_id)));

  // mesmo fornecedor em 2 linhas: a soma da Vobi entraria em dobro — pula e avisa
  const porId = new Map<number, Linha[]>();
  for (const l of linhas) {
    const id = Number(l.vobi_fornecedor_id);
    porId.set(id, [...(porId.get(id) || []), l]);
  }
  const conflitos: Array<{ vobi_fornecedor_id: number; credores: string[] }> = [];
  const paraConferir: Array<{ id: string; credor: string; vobi_fornecedor_id: number; vencido: number; aVencer: number }> = [];
  type Mud = { linha: Linha; upd: Record<string, unknown>; antes: Record<string, unknown>; depois: Record<string, unknown>; tetoLimpo: boolean };
  const mudancas: Mud[] = [];
  let semMudanca = 0;

  for (const [idForn, ls] of porId) {
    if (ls.length > 1) {
      conflitos.push({ vobi_fornecedor_id: idForn, credores: ls.map((l) => l.credor) });
      continue;
    }
    const l = ls[0];
    const s = somaFornecedorVobi(aberto, idForn, ehPessoaFisica(l));
    if (!s.achou) {
      // não apareceu com nada em aberto: NÃO é prova de pagamento — não mexe; ela confere e marca "✓ Quitei"
      paraConferir.push({
        id: l.id, credor: l.credor, vobi_fornecedor_id: idForn,
        vencido: vencidoNaTela(l), aVencer: Math.max(0, n(l.valor_a_vencer) ?? 0),
      });
      continue;
    }
    const upd: Record<string, unknown> = {};
    if (!iguais(l.valor, s.vencido)) upd.valor = s.vencido;
    if (!iguais(l.valor_a_vencer, s.aVencer)) upd.valor_a_vencer = s.aVencer;
    if (!dataIgual(l.proximo_vencimento, s.proximoAVencer)) upd.proximo_vencimento = s.proximoAVencer;
    // o vencido cresce com o tempo (as parcelas vão vencendo): teto menor que o vencido fica inválido — limpa
    const teto = n(l.valor_teto);
    const tetoLimpo = teto != null && s.vencido > teto;
    if (tetoLimpo) upd.valor_teto = null;
    if (!Object.keys(upd).length) { semMudanca++; continue; }
    const antes: Record<string, unknown> = {};
    for (const k of Object.keys(upd)) antes[k] = (l as Record<string, unknown>)[k] ?? null;
    mudancas.push({ linha: l, upd, antes, depois: { ...upd }, tetoLimpo });
  }

  // trava: muitas ligadas sem nada em aberto de uma vez costuma ser leitura incompleta da Vobi
  if (paraConferir.length >= 5 && paraConferir.length > linhas.length / 2) {
    return jsonErr(409, `${paraConferir.length} de ${linhas.length} dívidas ligadas não apareceram em aberto na leitura da Vobi — parece leitura incompleta. Nada foi gravado; tente de novo mais tarde.`);
  }

  // 3) grava (em lotes pequenos); uma falha não esconde as outras
  const agora = new Date().toISOString();
  const gravadas: Record<string, unknown>[] = [];
  const falhas: Array<{ id: string; credor: string; erro: string }> = [];
  for (let i = 0; i < mudancas.length; i += LOTE) {
    const lote = mudancas.slice(i, i + LOTE);
    const res = await Promise.all(lote.map((m) =>
      db.from(TABELA).update({ ...m.upd, updated_at: agora, atualizado_por: admin.email || null })
        .eq("id", m.linha.id).eq("quitada", false).select("*").maybeSingle()));
    res.forEach((r, k) => {
      const m = lote[k];
      if (r.error) falhas.push({ id: m.linha.id, credor: m.linha.credor, erro: r.error.message });
      else if (r.data) gravadas.push(r.data as Record<string, unknown>);
    });
  }
  // coluna da migration 120 ainda não existe: devolve o 503 de sempre
  if (!gravadas.length && falhas.length) {
    const e0 = falhas[0].erro;
    if (/column|schema cache|does not exist/i.test(e0)) return erroDoBanco({ message: e0, code: "42703" });
  }

  const idsGravados = new Set(gravadas.map((g) => String(g.id)));
  const feitas = mudancas.filter((m) => idsGravados.has(m.linha.id));
  const tetos = feitas.filter((m) => m.tetoLimpo);
  if (feitas.length || conflitos.length || falhas.length || paraConferir.length) {
    const resumoConf = paraConferir.length
      ? `; ${paraConferir.length} sem nada em aberto na Vobi, NÃO mexida(s) (conferir): ${paraConferir.slice(0, 8).map((p) => `${p.credor} (vencido na tela ${brl(p.vencido)})`).join(", ")}${paraConferir.length > 8 ? "…" : ""}`
      : "";
    const resumoTeto = tetos.length
      ? `; teto limpo (o vencido passou do valor máximo): ${tetos.slice(0, 8).map((m) => `${m.linha.credor} (teto ${brl(m.antes.valor_teto)}, vencido ${brl(m.upd.valor ?? m.linha.valor)})`).join(", ")}`
      : "";
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: TABELA,
      registro_id: "sincronizar-vobi",
      descricao: `Situação Financeira — sincronizou com a Vobi: ${feitas.length} dívida(s) atualizada(s) (vencido / a vencer / próximo vencimento)${resumoConf}${resumoTeto}${conflitos.length ? `; ${conflitos.length} fornecedor(es) ligado(s) a mais de uma linha, pulado(s)` : ""}${falhas.length ? `; ${falhas.length} falha(s) ao gravar` : ""}`,
      dados: {
        leitura_vobi_em: vivo.atualizadoEm,
        alteracoes: feitas.map((m) => ({ id: m.linha.id, credor: m.linha.credor, antes: m.antes, depois: m.depois })),
        para_conferir: paraConferir,
        conflitos,
        falhas,
      },
    });
  }

  return jsonOk({
    atualizadas: feitas.length,
    linhas: gravadas,
    paraConferir: paraConferir.map((p) => ({ id: p.id, credor: p.credor, vobi_fornecedor_id: p.vobi_fornecedor_id })),
    conflitos,
    falhas: falhas.map((f) => ({ id: f.id, credor: f.credor })),
    semMudanca,
    leituraEm: vivo.atualizadoEm,
  });
};
