// ════════════════════════════════════════════════════════════════════════
// Planilha financeira (ANALISE_FINANCEIRA_CJR.xlsx) SOB DEMANDA
// (decisão da Adriana, 09/10/2026 — opção A)
//
// POR QUE ASSIM: a geração diária no GitHub parou em 21/09 (franquia de
// minutos esgotada) e o Power Automate seguiu salvando a versão de 19/09 com a
// data do dia. A Adriana preferiu gerar só quando pedir — e no computador dela,
// sem depender do GitHub nem guardar o arquivo em nuvem nossa.
//
// COMO FUNCIONA
//   1. O botão do portal (/api/admin/vobi/planilha) ou o comando /planilha no
//      grupo financeiro do Telegram cria um PEDIDO aqui (telegram_sessoes,
//      chave "planilha:<id>" — mesmo padrão da ponte comercial; sem tabela nova).
//   2. A ponte do computador dela (scripts/planilha-ponte.mjs, a cada minuto)
//      pega o pedido em /api/integra/planilha-jobs, roda o gerador Python,
//      salva na pasta 02_Fluxos (OneDrive → SharePoint) e manda o arquivo no
//      grupo do Telegram. O arquivo NÃO passa pela Vercel nem pelo Supabase.
//
// COTA DA VOBI: cada planilha faz ~550 consultas, e a Vobi libera 1000 por
// hora para a integração INTEIRA (bot de baixas incluído). Por isso uma nova
// geração em menos de 1 hora pede confirmação ("forçar").
// ════════════════════════════════════════════════════════════════════════

export const PREFIXO_PEDIDO = "planilha:";
export const CHAVE_PONTE = "ponte:planilha";

/** Intervalo mínimo entre duas gerações sem confirmação (cota da Vobi). */
export const INTERVALO_MIN = 60;
/** Um pedido "gerando" parado há mais que isso é dado como perdido. */
const GERANDO_MAX_MIN = 25;
/** Um pedido "pendente" mais velho que isso não trava um pedido novo. */
const PENDENTE_MAX_MIN = 12 * 60;
/** A ponte é considerada ligada se respondeu nos últimos N minutos. */
const PONTE_ONLINE_MIN = 3;

export type EstadoPedido = "pendente" | "gerando" | "pronto" | "erro";

export interface PedidoPlanilha {
  id: string;
  estado: EstadoPedido;
  origem: "portal" | "telegram";
  solicitante: string;
  chat_id: string | null;
  pedido_em: string;
  iniciado_em?: string | null;
  concluido_em?: string | null;
  arquivo?: string | null;
  erro?: string | null;
  forcado?: boolean;
}

const minutosDesde = (iso?: string | null) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;

function linhaParaPedido(l: any): PedidoPlanilha {
  const d = l?.dados || {};
  return {
    id: String(l.telegram_user_id).slice(PREFIXO_PEDIDO.length),
    estado: l.estado as EstadoPedido,
    origem: d.origem === "telegram" ? "telegram" : "portal",
    solicitante: d.solicitante || "",
    chat_id: d.chat_id != null ? String(d.chat_id) : null,
    pedido_em: d.pedido_em || l.updated_at,
    iniciado_em: d.iniciado_em || null,
    concluido_em: d.concluido_em || null,
    arquivo: d.arquivo || null,
    erro: d.erro || null,
    forcado: !!d.forcado,
  };
}

/** Últimos pedidos, do mais novo para o mais velho. */
export async function listarPedidos(db: any, limite = 10): Promise<PedidoPlanilha[]> {
  const { data } = await db.from("telegram_sessoes")
    .select("telegram_user_id, estado, dados, updated_at")
    .like("telegram_user_id", PREFIXO_PEDIDO + "%")
    .order("updated_at", { ascending: false })
    .limit(limite);
  return (data || []).map(linhaParaPedido)
    .sort((a: PedidoPlanilha, b: PedidoPlanilha) => (b.pedido_em || "").localeCompare(a.pedido_em || ""));
}

/** Quando a ponte do computador respondeu pela última vez. */
export async function statusPonte(db: any): Promise<{ online: boolean; visto_em: string | null; maquina: string | null }> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", CHAVE_PONTE).maybeSingle();
  const visto = data?.dados?.visto_em || null;
  return { online: minutosDesde(visto) <= PONTE_ONLINE_MIN, visto_em: visto, maquina: data?.dados?.maquina || null };
}

/** Pedido em andamento de verdade (ignora os que ficaram parados). */
function emAndamento(p: PedidoPlanilha): boolean {
  if (p.estado === "gerando") return minutosDesde(p.iniciado_em || p.pedido_em) <= GERANDO_MAX_MIN;
  if (p.estado === "pendente") return minutosDesde(p.pedido_em) <= PENDENTE_MAX_MIN;
  return false;
}

export type ResultadoPedido =
  | { tipo: "criado"; pedido: PedidoPlanilha; ponte: Awaited<ReturnType<typeof statusPonte>> }
  | { tipo: "em_andamento"; pedido: PedidoPlanilha; ponte: Awaited<ReturnType<typeof statusPonte>> }
  | { tipo: "recente"; pedido: PedidoPlanilha; minutos: number; libera_em: string; ponte: Awaited<ReturnType<typeof statusPonte>> };

/**
 * Cria o pedido — a menos que já haja um em andamento, ou que uma planilha
 * tenha ficado pronta há menos de INTERVALO_MIN minutos (aí só com `forcar`).
 */
export async function pedirPlanilha(
  db: any,
  o: { origem: "portal" | "telegram"; solicitante: string; chatId: string | number | null; forcar?: boolean },
): Promise<ResultadoPedido> {
  const ponte = await statusPonte(db);
  const pedidos = await listarPedidos(db, 20);

  const andando = pedidos.find(emAndamento);
  if (andando) return { tipo: "em_andamento", pedido: andando, ponte };

  const ultimoPronto = pedidos.find((p) => p.estado === "pronto");
  const min = minutosDesde(ultimoPronto?.concluido_em);
  if (ultimoPronto && min < INTERVALO_MIN && !o.forcar) {
    const libera = new Date(new Date(ultimoPronto.concluido_em!).getTime() + INTERVALO_MIN * 60000).toISOString();
    return { tipo: "recente", pedido: ultimoPronto, minutos: Math.floor(min), libera_em: libera, ponte };
  }

  // pedidos que ficaram parados viram "erro" para não confundir a lista
  for (const p of pedidos) {
    if ((p.estado === "gerando" || p.estado === "pendente") && !emAndamento(p)) {
      await db.from("telegram_sessoes").update({
        estado: "erro",
        dados: { ...(await dadosDe(db, p.id)), erro: "Ficou parado sem resposta do computador.", concluido_em: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq("telegram_user_id", PREFIXO_PEDIDO + p.id);
    }
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const agora = new Date().toISOString();
  const dados = {
    origem: o.origem,
    solicitante: o.solicitante || "",
    chat_id: o.chatId != null ? String(o.chatId) : null,
    pedido_em: agora,
    forcado: !!o.forcar,
  };
  await db.from("telegram_sessoes").insert({
    telegram_user_id: PREFIXO_PEDIDO + id,
    chat_id: dados.chat_id,
    estado: "pendente",
    dados,
    updated_at: agora,
  });
  return { tipo: "criado", pedido: linhaParaPedido({ telegram_user_id: PREFIXO_PEDIDO + id, estado: "pendente", dados, updated_at: agora }), ponte };
}

async function dadosDe(db: any, id: string): Promise<any> {
  const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", PREFIXO_PEDIDO + id).maybeSingle();
  return data?.dados || {};
}

/** A ponte avisa que está viva (a cada chamada). */
export async function registrarPonte(db: any, maquina: string | null) {
  const agora = new Date().toISOString();
  await db.from("telegram_sessoes").upsert(
    { telegram_user_id: CHAVE_PONTE, estado: "ativo", dados: { visto_em: agora, maquina: maquina || null }, updated_at: agora },
    { onConflict: "telegram_user_id" },
  );
}

/**
 * A ponte pega o pedido mais antigo pendente e o marca como "gerando".
 * A troca de estado é condicional (só se ainda estiver "pendente") para que
 * duas execuções da ponte não peguem o mesmo pedido.
 */
export async function pegarProximoPedido(db: any): Promise<PedidoPlanilha | null> {
  const { data } = await db.from("telegram_sessoes")
    .select("telegram_user_id, estado, dados, updated_at")
    .like("telegram_user_id", PREFIXO_PEDIDO + "%")
    .eq("estado", "pendente")
    .order("updated_at", { ascending: true })
    .limit(5);
  for (const l of data || []) {
    const p = linhaParaPedido(l);
    if (!emAndamento(p)) continue; // pendente velho demais: deixa para a limpeza
    const agora = new Date().toISOString();
    const { data: pego } = await db.from("telegram_sessoes")
      .update({ estado: "gerando", dados: { ...(l.dados || {}), iniciado_em: agora }, updated_at: agora })
      .eq("telegram_user_id", l.telegram_user_id)
      .eq("estado", "pendente")
      .select("telegram_user_id, estado, dados, updated_at");
    if (pego && pego.length) return linhaParaPedido(pego[0]);
  }
  return null;
}

/** A ponte fecha o pedido. */
export async function concluirPedido(db: any, id: string, r: { ok: boolean; arquivo?: string; erro?: string }) {
  const dados = await dadosDe(db, id);
  const agora = new Date().toISOString();
  await db.from("telegram_sessoes").update({
    estado: r.ok ? "pronto" : "erro",
    dados: { ...dados, concluido_em: agora, arquivo: r.arquivo || null, erro: r.ok ? null : (r.erro || "erro desconhecido").slice(0, 500) },
    updated_at: agora,
  }).eq("telegram_user_id", PREFIXO_PEDIDO + id);
}

const fmtHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";

/** Texto de resposta (Telegram, HTML) para o resultado de um pedido. */
export function mensagemPedido(r: ResultadoPedido): string {
  const aviso = r.ponte.online ? "" :
    "\n\n⚠️ O computador que gera a planilha <b>não responde há algum tempo</b> (está desligado ou sem ninguém logado). " +
    "O pedido fica guardado e sai assim que ele ligar.";
  if (r.tipo === "criado") {
    return "📊 <b>Pedido recebido.</b> Vou gerar a planilha financeira com os dados da Vobi de agora " +
      "(leva uns 3 minutos) e mando o arquivo aqui. Ela também fica salva na pasta <b>02_Fluxos</b>." + aviso;
  }
  if (r.tipo === "em_andamento") {
    return `⏳ Já tem uma planilha ${r.pedido.estado === "gerando" ? "sendo gerada" : "na fila"} ` +
      `(pedida às ${fmtHora(r.pedido.pedido_em)}). Assim que ficar pronta eu mando aqui.` + aviso;
  }
  return `ℹ️ A última planilha ficou pronta há <b>${r.minutos} min</b> (às ${fmtHora(r.pedido.concluido_em)})` +
    (r.pedido.arquivo ? ` — <code>${r.pedido.arquivo}</code>` : "") + ".\n\n" +
    "Cada geração usa ~550 das 1000 consultas por hora que a Vobi libera, e as baixas de pagamento aqui do grupo usam a mesma cota. " +
    `Uma nova sai sem conflito a partir das <b>${fmtHora(r.libera_em)}</b>.\n\n` +
    "Se precisar agora mesmo, mande <code>/planilha forcar</code>.";
}
