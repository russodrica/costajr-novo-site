// ════════════════════════════════════════════════════════════════════════
// Fluxo "Comercial" — hoje acessível de dentro da própria JunIA (@CjrJunIA_bot,
// modo "junia": comando /comercial ou botão após identificação). Também dá
// suporte a um bot "processos" dedicado (modo "processos"), caso a Adriana
// decida separar depois — mas por ora o plano é "a JunIA faz tudo", um único
// assistente (decisão de 30/07/2026, ver histórico da sessão).
// Primeira área implementada do assistente multi-departamento da Costa Júnior
// (financeiro/operacional entram depois).
//
// Acesso restrito: só quem tem perfil "comercial" (ou "admin") no Portal.
//
// Roteiro ATUAL (reescrito em 05/08/2026 — "está fazendo muitas perguntas"):
//   manda os arquivos → o bot LÊ → pergunta SÓ o nome do cliente → CARD de
//   confirmação já preenchido (o que saiu dos arquivos + os padrões da casa)
//   → toca no campo que quiser ajustar → CONFIRMA → gera a Proposta em
//   PowerPoint (modelo real da empresa) + cria a oportunidade na Vobi (aba
//   Oportunidades) + manda o arquivo aqui no chat.
//
// Padrões que entram sozinhos (e só mudam se a pessoa tocar no campo):
//   prazo de obra 10 dias úteis · mobilização 10 (Comercial) / 5 (JunIA) ·
//   pagamento 50% sinal + 50% entrega · valor "conforme negociação" — o número
//   real vem do orçamento, não do Telegram.
//
// Roteiro anterior (30/07/2026), aposentado por ser longo demais: cliente →
// endereço → projeto? → planilha? → escopo curto → escopo detalhado → prazo
// obra → prazo mobilização → valor → % sinal → % medição → % entrega.
//
// A quantificação automática do projeto (2ª etapa, ainda não implementada)
// SEMPRE vai gerar um RASCUNHO dentro da Vobi pra um engenheiro revisar antes
// de virar orçamento oficial — nunca envia nada oficial sozinha.
// ════════════════════════════════════════════════════════════════════════
import { escTg } from "./telegram";
import {
  type Bot, type Sessao,
  enviar, inline, btnCancelar, botaoTelefone, tg,
  getSessao, salvarSessao, identificar, baixarArquivoTg,
} from "./telegramBot";
import { gerarPropostaPptx, type DadosProposta } from "./propostaPptx";
import { vobiEscritaConfigurada, vobiCriarOportunidade, vobiMudarEtapa } from "./vobiEscrita";
import { gerarTextoLLM, llmConfigurado, extrairJson } from "./llm";

// Converte texto livre em reais ("R$ 594.696,95", "594696,95", "594696.95")
// pra número. Retorna null se não conseguir interpretar.
function parseValorReais(texto: string): number | null {
  const limpo = String(texto || "").replace(/[^\d.,]/g, "");
  if (!limpo) return null;
  // formato BR "594.696,95" (ponto=milhar, vírgula=decimal)
  let normalizado = limpo;
  if (limpo.includes(",")) normalizado = limpo.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Padrões da proposta (decisão da Adriana, 05/08/2026) ───────────────────
// "está fazendo muitas perguntas": o bot NÃO pergunta mais prazo, valor nem
// percentuais. Entra com estes padrões e a pessoa ajusta o que quiser tocando
// no campo dentro do card de confirmação.
const PADRAO_PRAZO_OBRA = "10";
const PADRAO_MOB_COMERCIAL = "10";   // mobilização mínima do bot Comercial
const PADRAO_MOB_JUNIA = "5";
const PADRAO_PCT_SINAL = 50;         // 50/50 — sinal na assinatura + entrega
const PADRAO_PCT_ENTREGA = 50;
const VALOR_A_DEFINIR = "Conforme negociação";
const padraoMob = (B: Bot) => (B.modo === "comercial" ? PADRAO_MOB_COMERCIAL : PADRAO_MOB_JUNIA);

// Medição é opcional: no padrão 50/50 essa linha nem aparece na proposta.
function formatarValorRemuneracao(valorTotalTexto: string, pctSinal: number, pctMedicao: number, pctEntrega: number): string {
  const linhas = [`VALOR ESTIMADO: ${valorTotalTexto}`, `SINAL: ${pctSinal}% na assinatura`];
  if (pctMedicao > 0) linhas.push(`MEDIÇÃO: ${pctMedicao}% ao longo da execução`);
  linhas.push(`ENTREGA: ${pctEntrega}% na conclusão`);
  return linhas.join("\n");
}

// Texto de remuneração a partir do que estiver na sessão (já com padrões).
function montarValorFinal(d: any): string {
  return formatarValorRemuneracao(
    d.valorTotalTexto || VALOR_A_DEFINIR,
    Number(d.pctSinal ?? PADRAO_PCT_SINAL),
    Number(d.pctMedicao ?? 0),
    Number(d.pctEntrega ?? PADRAO_PCT_ENTREGA),
  );
}

// Completa a sessão com o que a leitura dos arquivos achou (`sug`) e com os
// padrões acima — é o que permite ir DIRETO ao card, sem perguntar item a item.
function completarComPadroes(B: Bot, d: any): any {
  const s = d?.sug || {};
  const out: any = { ...d };
  if (!out.endereco && s.endereco) out.endereco = s.endereco;
  if (!out.escopoCurto && s.escopoCurto) out.escopoCurto = s.escopoCurto;
  if (!out.escopoDetalhado && s.escopoDetalhado) out.escopoDetalhado = s.escopoDetalhado;
  if (!out.prazoObraDias) out.prazoObraDias = PADRAO_PRAZO_OBRA;
  if (!out.prazoMobilizacaoDias) out.prazoMobilizacaoDias = padraoMob(B);
  if (out.pctSinal == null) out.pctSinal = PADRAO_PCT_SINAL;
  if (out.pctEntrega == null) out.pctEntrega = PADRAO_PCT_ENTREGA;
  if (out.pctMedicao == null) out.pctMedicao = 0;
  // O valor NÃO é adivinhado a partir dos arquivos: fica "conforme negociação"
  // até sair do orçamento. Se a leitura achou um total, ele vira só uma dica
  // com botão no card (com:usar_valor_lido).
  out.valor = montarValorFinal(out);
  return out;
}

// ── Permissão: só perfil "comercial" (ou "admin") ───────────────────────
export async function ehComercial(db: any, colaboradorId: string): Promise<boolean> {
  try {
    if (!colaboradorId) return false;
    const { data: c } = await db.from("rh_colaboradores").select("profile_id").eq("id", colaboradorId).maybeSingle();
    if (!c?.profile_id) return false;
    const { data: p } = await db.from("portal_profiles").select("role, roles").eq("id", c.profile_id).maybeSingle();
    const roles = [p?.role, ...(Array.isArray(p?.roles) ? p.roles : [])].filter(Boolean);
    return roles.includes("admin") || roles.includes("comercial");
  } catch { return false; }
}

// `grupo_autorizado` viaja junto: no grupo liberado a pessoa NÃO tem
// colaborador_id (não se identificou por telefone), então é essa marca que
// mantém ela reconhecida entre uma mensagem e outra — inclusive nos botões.
const idBaseDe = (d: any) => ({
  colaborador_id: d.colaborador_id, colaborador_nome: d.colaborador_nome, colaborador_email: d.colaborador_email,
  ...(d.grupo_autorizado ? { grupo_autorizado: true } : {}),
  // arquivos guardados sobrevivem ao "recomeçar" — foi assim que a pessoa
  // começou a conversa (jogou os arquivos antes de abrir o menu).
  ...(Array.isArray(d.arquivos) && d.arquivos.length ? { arquivos: d.arquivos } : {}),
});

// Quem já pode usar o roteiro: identificado por telefone OU dentro do grupo
// liberado (nesse caso a autorização é estar no grupo).
const jaLiberado = (d: any) => !!(d?.colaborador_id || d?.grupo_autorizado);

// ── Arquivos jogados no chat ANTES de começar a proposta ────────────────
// É o jeito natural de usar (a pessoa encaminha o projeto + a planilha e
// espera que o bot siga dali). Antes isso era ignorado em silêncio e parecia
// que o bot tinha morrido. Agora ficam guardados na sessão e viram um botão
// no passo do anexo.
type ArqGuardado = { file_id: string; nome: string; ct: string };
const arquivosGuardados = (d: any): ArqGuardado[] => (Array.isArray(d?.arquivos) ? d.arquivos : []);

function arqDaMsg(msg: any): ArqGuardado | null {
  if (msg.document) return { file_id: msg.document.file_id, nome: msg.document.file_name || "arquivo", ct: msg.document.mime_type || "application/octet-stream" };
  if (msg.photo?.length) return { file_id: msg.photo[msg.photo.length - 1].file_id, nome: "foto-telegram.jpg", ct: "image/jpeg" };
  return null;
}

const ehPlanilha = (nome: string) => /\.(xlsx|xlsm|xls|csv|ods)$/i.test(nome);

// Arquivos que vão no serviço do orçamento (só a referência do Telegram).
const dadosFinais_arquivos = (d: any) =>
  (Array.isArray(d?.arquivosAnexados) ? d.arquivosAnexados : [])
    .filter((a: any) => a?.file_id)
    .map((a: any) => ({ file_id: a.file_id, nome: a.nome, ct: a.ct, campo: a.campo }));

// "ainda não tenho preço" — vira "conforme negociação" em vez de travar.
// Antes exigia terminar em "negocia" — quem escrevia "conforme negociação"
// (o texto que o próprio bot usa) não era reconhecido e ficava preso.
const SEM_VALOR = /^\s*(n[ãa]o\s*(tenho|tem|sei|h[áa]|fechei|fechou|definimos)|sem\s*(valor|pre[çc]o)|a\s*(definir|combinar)|ainda\s*n[ãa]o.*|conforme\s*negocia\S*|pular|-)\s*$/i;
const PERGUNTA_VALOR = "💰 Qual o <b>valor</b> da proposta? (ex.: \"R$ 38.500,00\")\n\nSe ainda não fechou preço, escreva <b>não tenho</b> — fica \"conforme negociação\" e o número entra quando o orçamento ficar pronto.";

// Comando do Telegram — em GRUPO ele chega com o nome do bot colado
// ("/proposta@cjrcomercial_bot"), então não dá pra comparar direto.
function cmd(texto: string, ...nomes: string[]): boolean {
  const t = String(texto || "").trim().toLowerCase();
  return nomes.some((n) => t === `/${n}` || t.startsWith(`/${n} `) || t.startsWith(`/${n}@`));
}

// ── Grupo liberado = autorização ────────────────────────────────────────
// Decisão da Adriana (2026-08-04): "pode aceitar quem está no grupo pois eu
// só vou inserir quem tem autorização". Então dentro do grupo ninguém precisa
// se identificar pelo telefone — a porta é o próprio grupo (mesmo padrão já
// usado no grupo de documentos do RH).
// A TRAVA: só vale no grupo que um ADMIN liberou com /ativar_comercial. Sem
// isso, qualquer pessoa poderia adicionar o bot a outro grupo (inclusive um
// com cliente dentro) e sair gerando proposta.
function chaveGrupoComercial(B: Bot) { return `${B.pre}grupo_comercial`; }

async function grupoComercialAtivo(db: any, B: Bot, chatId: number): Promise<boolean> {
  try {
    const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", chaveGrupoComercial(B)).maybeSingle();
    return data?.dados?.chat_id != null && String(data.dados.chat_id) === String(chatId);
  } catch { return false; }
}

async function ehAdminDoGrupo(B: Bot, chatId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  const r = await tg(B, "getChatMember", { chat_id: chatId, user_id: userId });
  const st = r?.result?.status;
  return st === "creator" || st === "administrator";
}

// Nome de quem falou, pro grupo (não há ficha do RH por trás).
function nomeNoGrupo(from: any): string {
  const n = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return n || (from?.username ? "@" + from.username : "colega");
}

// ── Anti-repetição no grupo ─────────────────────────────────────────────
// No grupo o bot responde a QUALQUER mensagem (decisão da Adriana), então sem
// isso ele repetiria o menu a cada linha de uma conversa. Guarda o horário do
// último menu por grupo em telegram_sessoes (chave própria, não colide com
// sessão de pessoa). Comandos (/proposta, /menu) NUNCA passam por aqui — são
// a válvula de escape durante a pausa.
const PAUSA_MENU_GRUPO_MS = 3 * 60 * 1000;
async function podeFalarNoGrupo(db: any, B: Bot, chatId: number): Promise<boolean> {
  const chave = `${B.pre}grupo:${chatId}`;
  try {
    const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", chave).maybeSingle();
    const ultimo = Number(data?.dados?.ultimo_menu || 0);
    if (Date.now() - ultimo < PAUSA_MENU_GRUPO_MS) return false;
  } catch { /* se a leitura falhar, prefere responder a ficar mudo */ }
  await salvarSessao(db, { telegram_user_id: chave, chat_id: String(chatId), estado: "grupo", dados: { ultimo_menu: Date.now() } });
  return true;
}

// ── Menu de áreas (chamado por identificar() no modo "processos") ──────
export async function mostrarMenuAreas(db: any, B: Bot, chatId: number, sessKey: string, dados: any) {
  const nome = dados?.colaborador_nome || "colega";
  if (!(await ehComercial(db, dados?.colaborador_id))) {
    await enviar(B, chatId,
      `Oi, <b>${escTg(nome)}</b>! Este bot ainda só atende o time <b>Comercial</b>. Se você precisa de acesso, fale com a Adriana.`);
    return;
  }
  await salvarSessao(db, { telegram_user_id: sessKey, nome, chat_id: String(chatId), estado: "proc_menu", dados: idBaseDe(dados) });
  await enviar(B, chatId, `Olá, <b>${escTg(nome)}</b>! 👋\nQual área você quer usar?`, inline([
    [{ text: "💼 Comercial", callback_data: "area:comercial" }],
    [{ text: "💰 Financeiro (em breve)", callback_data: "area:embreve" }],
    [{ text: "🏗️ Operacional (em breve)", callback_data: "area:embreve" }],
  ]));
}

export async function mostrarMenuComercial(db: any, B: Bot, sessao: Sessao, chatId: number) {
  // chat_id marca ONDE a pessoa está operando (privado x grupo) — o roteiro
  // depois só aceita respostas vindas desse mesmo chat.
  await salvarSessao(db, { ...sessao, chat_id: String(chatId), estado: "proc_menu", dados: idBaseDe(sessao.dados || {}) });
  await enviar(B, chatId, "💼 <b>Comercial</b> — o que você quer fazer?", inline([
    [{ text: "📋 Nova proposta comercial", callback_data: "com:nova" }],
  ]));
}

function pergunta(texto: string, pularCb?: string, extras: { text: string; callback_data: string }[][] = []) {
  const linhas = [...extras];
  if (pularCb) linhas.push([{ text: "⏭️ Pular", callback_data: pularCb }]);
  linhas.push(btnCancelar);
  return { texto, botoes: inline(linhas) };
}

// Qual campo da leitura dos arquivos responde cada pergunta do roteiro.
const CAMPO_SUG: Record<string, string> = {
  com_cliente: "cliente",
  com_endereco: "endereco",
  com_escopo_curto: "escopoCurto",
  com_escopo_detalhado: "escopoDetalhado",
  com_valor: "valor",
};

// Botão "✅ Usar: <o que a IA achou>" na pergunta correspondente.
function botaoSugestao(dados: any, estado: string): { text: string; callback_data: string }[][] {
  const campo = CAMPO_SUG[estado];
  const v = campo ? dados?.sug?.[campo] : null;
  if (!v) return [];
  const s = String(v).replace(/\s+/g, " ").trim();
  return [[{ text: `✅ Usar: ${s.length > 40 ? s.slice(0, 37) + "…" : s}`, callback_data: "com:sugestao" }]];
}

// O botão só repete a sugestão como se a pessoa tivesse digitado — assim a
// validação de cada passo (valor, percentuais…) continua valendo igual.
async function aceitarSugestao(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const estado = sessao.estado || "";
  const campo = CAMPO_SUG[estado];
  const v = campo ? sessao.dados?.sug?.[campo] : null;
  if (!v) { await enviar(B, chatId, "Essa sugestão não vale mais aqui — pode digitar a resposta."); return; }
  await enviar(B, chatId, `✅ ${escTg(String(v))}`);
  return await onTextoComercial(db, B, sessao, chatId, estado, String(v));
}

// Inicia o roteiro (chamado pelo botão "Nova proposta comercial" e pelo
// comando /comercial — tanto no bot de Processos quanto de dentro da JunIA).
export async function iniciarNovaProposta(db: any, B: Bot, sessao: Sessao, chatId: number) {
  let dados: any = idBaseDe(sessao.dados);
  // Se a pessoa já jogou os arquivos, LÊ eles ANTES de começar a perguntar
  // (pedido da Adriana: "primeiro analisar os arquivos e depois fazer
  // pergunta"). Assim as respostas já vêm sugeridas.
  const guardados = arquivosGuardados(sessao.dados);
  if (guardados.length) {
    await enviar(B, chatId, "📋 <b>Nova proposta comercial</b>\n\n🔎 Lendo os arquivos que você mandou… (uns segundos)");
    try {
      dados = { ...dados, ...(await anexarEAnalisar(db, B, chatId, guardados)) };
    } catch {
      await enviar(B, chatId, "⚠️ Não consegui processar os arquivos agora — seguimos no modo pergunta/resposta.");
    }
  } else {
    await enviar(B, chatId, "📋 <b>Nova proposta comercial</b>");
  }
  await salvarSessao(db, { ...sessao, chat_id: String(chatId), estado: "com_cliente", dados });
  const { texto, botoes } = pergunta("Qual o <b>nome do cliente</b>?", undefined, botaoSugestao(dados, "com_cliente"));
  await enviar(B, chatId, texto, botoes);
}

// ── Passos de texto do roteiro (estado com_*) — compartilhado entre o bot
// de Processos e o atalho "/comercial" dentro da JunIA. ──
// ── Campos que dá pra ajustar tocando no card de confirmação ───────────────
const CAMPOS_EDITAVEIS: Record<string, { label: string; pergunta: string }> = {
  cliente:    { label: "Cliente",       pergunta: "🏢 Qual o <b>nome do cliente</b>?" },
  endereco:   { label: "Endereço",      pergunta: "📍 Qual o <b>endereço</b> da obra?" },
  escopo:     { label: "Escopo",        pergunta: "✏️ Resuma o <b>escopo</b> em uma frase (ex.: \"Impermeabilização da laje de cobertura do bloco B\"):" },
  detalhe:    { label: "Detalhamento",  pergunta: "📝 Manda o <b>detalhamento do escopo</b> — uma linha por item:" },
  prazo_obra: { label: "Prazo de obra", pergunta: "🗓️ <b>Prazo de obra</b> em dias úteis. Manda só o número (ex.: 15):" },
  prazo_mob:  { label: "Mobilização",   pergunta: "🚚 <b>Prazo de mobilização</b> em dias úteis. Manda só o número (ex.: 10):" },
  valor:      { label: "Valor",         pergunta: PERGUNTA_VALOR },
  pagto:      { label: "Pagamento",     pergunta: "📐 <b>Percentuais de pagamento.</b>\n\nDois números = sinal e entrega (ex.: <b>50 50</b>).\nTrês números = sinal, medição e entrega (ex.: <b>30 40 30</b>)." },
};

// Aplica o patch, completa com sug+padrões e mostra o card. É pra onde todo
// caminho do roteiro desemboca — não existe mais fila de perguntas.
async function irParaCard(db: any, B: Bot, sessao: Sessao, chatId: number, patch: any = {}) {
  const dados = completarComPadroes(B, { ...(sessao.dados || {}), ...patch });
  await salvarSessao(db, { ...sessao, chat_id: String(chatId), estado: "com_confirma", dados });
  return await mostrarConfirmacao(db, B, chatId, dados);
}

// Resposta a um campo aberto pelo card (estado com_ed_<campo>). Valida e volta
// pro card — nunca encadeia numa próxima pergunta.
async function onEdicaoCampo(db: any, B: Bot, sessao: Sessao, chatId: number, estado: string, texto: string) {
  const campo = estado.slice("com_ed_".length);
  switch (campo) {
    case "cliente":  return await irParaCard(db, B, sessao, chatId, { cliente: texto });
    case "endereco": return await irParaCard(db, B, sessao, chatId, { endereco: texto });
    case "escopo":   return await irParaCard(db, B, sessao, chatId, { escopoCurto: texto });
    case "detalhe":  return await irParaCard(db, B, sessao, chatId, { escopoDetalhado: texto });
    case "prazo_obra": {
      const n = texto.replace(/\D/g, "");
      if (!n) { await enviar(B, chatId, "Manda só o número de dias úteis (ex.: 15)."); return; }
      return await irParaCard(db, B, sessao, chatId, { prazoObraDias: n });
    }
    case "prazo_mob": {
      const n = texto.replace(/\D/g, "");
      if (!n) { await enviar(B, chatId, "Manda só o número de dias úteis (ex.: 10)."); return; }
      if (B.modo === "comercial" && Number(n) < 10) {
        await enviar(B, chatId, "⚠️ A mobilização mínima é de <b>10 dias úteis</b>. Manda um número igual ou maior.");
        return;
      }
      return await irParaCard(db, B, sessao, chatId, { prazoMobilizacaoDias: n });
    }
    case "valor": {
      // "não tenho" / "a definir" volta pro padrão em vez de travar cobrando.
      if (SEM_VALOR.test(texto)) return await irParaCard(db, B, sessao, chatId, { valorTotalTexto: null, valorNumerico: null });
      const valorNumerico = parseValorReais(texto);
      if (!valorNumerico) { await enviar(B, chatId, "Não entendi esse valor. Manda algo como <b>R$ 594.696,95</b>, ou escreva <b>não tenho</b>."); return; }
      return await irParaCard(db, B, sessao, chatId, { valorTotalTexto: texto.trim(), valorNumerico });
    }
    case "pagto": {
      const ns = (texto.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(",", ".")));
      if (ns.length !== 2 && ns.length !== 3) {
        await enviar(B, chatId, "Manda <b>2 números</b> (sinal e entrega) ou <b>3</b> (sinal, medição e entrega). Ex.: <b>50 50</b>.");
        return;
      }
      const pctSinal = ns[0];
      const pctMedicao = ns.length === 3 ? ns[1] : 0;
      const pctEntrega = ns.length === 3 ? ns[2] : ns[1];
      const soma = pctSinal + pctMedicao + pctEntrega;
      if (Math.abs(soma - 100) > 0.01) { await enviar(B, chatId, `⚠️ Os percentuais precisam somar <b>100%</b> (deu ${soma}%).`); return; }
      return await irParaCard(db, B, sessao, chatId, { pctSinal, pctMedicao, pctEntrega });
    }
    default:
      return await irParaCard(db, B, sessao, chatId, {});
  }
}

// ── Roteiro curto (05/08/2026) ─────────────────────────────────────────────
// Antes eram 11 perguntas em fila — a Adriana: "está fazendo muitas
// perguntas". Agora o bot pergunta UMA (o nome do cliente, que é o campo em
// que a leitura automática mais erra) e vai direto pro card já preenchido.
// Tudo o mais se ajusta tocando no campo. Compartilhado entre o bot Comercial
// e o atalho /comercial de dentro da JunIA.
async function onTextoComercial(db: any, B: Bot, sessao: Sessao, chatId: number, estado: string, texto: string) {
  if (estado === "com_cliente") return await irParaCard(db, B, sessao, chatId, { cliente: texto });
  if (estado.startsWith("com_ed_")) return await onEdicaoCampo(db, B, sessao, chatId, estado, texto);
  // Texto solto no passo de anexo = "não tenho arquivo": segue pro card.
  if (estado === "com_projeto" || estado === "com_planilha") return await irParaCard(db, B, sessao, chatId, {});
  // No card, texto solto não faz nada (a pessoa deve tocar num campo). E
  // qualquer estado com_* antigo (sessão que ficou aberta antes desta versão)
  // cai no card em vez de morrer num passo que não existe mais.
  if (estado === "com_confirma") return;
  if (estado.startsWith("com_")) return await irParaCard(db, B, sessao, chatId, {});
}

// Roteiro exclusivo do bot Comercial dedicado (@cjrcomercial_bot, modo
// "comercial") — sem menu de áreas (esse bot só atende Comercial) e sem
// atalho pra dentro da JunIA. Separado de onMessageProcessos de propósito:
// as regras de negócio deste bot (mobilização mínima, remuneração em 3
// percentuais, valor de ganho na Vobi) são diferentes das do JunIA/Processos
// (decisão da Adriana, 2026-08-04 — "estará fora da JunIA").
//
// ATENDE TAMBÉM EM GRUPO (decisão da Adriana, 2026-08-04): qualquer mensagem
// no grupo abre o menu, e o roteiro inteiro roda ali mesmo (o PowerPoint e os
// valores ficam à vista do grupo — foi a escolha dela, é o grupo do time
// Comercial). Requer a Privacidade do bot DESLIGADA no BotFather, senão o
// Telegram nem entrega as mensagens comuns do grupo pro bot.
export async function onMessageComercial(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  if (!chat) return;
  const ehGrupo = chat.type !== "private";
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  // Identificação por telefone só existe no privado (ninguém compartilha
  // contato em grupo) — no grupo a pessoa é reconhecida pela sessão que ela
  // já criou uma vez no privado deste bot.
  if (msg.contact) {
    if (ehGrupo) return;
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor."); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const sessao = await getSessao(db, B, userId);
  const texto = String(msg.text || "").trim();

  // Em grupo chegam eventos sem conteúdo (alguém entrou/saiu, fixaram uma
  // mensagem…). Isso não é conversa — o bot fica quieto.
  if (ehGrupo && !texto && !msg.photo && !msg.document) return;

  // ── Liberar ESTE grupo (uma vez, por um administrador do grupo) ────────
  if (ehGrupo && cmd(texto, "ativar_comercial")) {
    if (!(await ehAdminDoGrupo(B, chatId, msg.from?.id))) {
      await enviar(B, chatId, "Só um <b>administrador do grupo</b> pode liberar as propostas aqui.");
      return;
    }
    await salvarSessao(db, {
      telegram_user_id: chaveGrupoComercial(B), chat_id: String(chatId),
      estado: "ativo", dados: { chat_id: chatId, titulo: chat.title || "" },
    });
    await enviar(B, chatId,
      "✅ <b>Grupo liberado para propostas comerciais!</b>\n\nQuem está aqui já pode usar — <b>a porta é o próprio grupo</b>, ninguém precisa se identificar pelo telefone.\n\n⚠️ Por isso, cuide de quem entra: qualquer pessoa do grupo consegue gerar proposta e gravar oportunidade na Vobi.\n\nÉ só mandar uma mensagem (ou <b>/proposta</b>) que eu abro o menu. 🙂");
    return;
  }

  const grupoLiberado = ehGrupo ? await grupoComercialAtivo(db, B, chatId) : false;

  // Grupo NÃO liberado: o bot fica quieto de propósito.
  if (ehGrupo && !grupoLiberado) {
    if (cmd(texto, "start", "menu", "proposta")) {
      await enviar(B, chatId, "Este grupo ainda não está liberado para propostas. Um <b>administrador do grupo</b> precisa mandar <code>/ativar_comercial</code> uma vez.");
    }
    return;
  }

  // No grupo liberado a pessoa entra pelo nome do Telegram, sem telefone.
  // Se ela JÁ se identificou alguma vez no privado, a identidade real vence.
  let s: Sessao | null = sessao;
  if (grupoLiberado && !sessao?.dados?.colaborador_id) {
    const nomeTg = nomeNoGrupo(msg.from);
    s = {
      ...(sessao || { telegram_user_id: B.pre + userId }),
      nome: nomeTg, chat_id: String(chatId),
      dados: { ...(sessao?.dados || {}), grupo_autorizado: true, colaborador_nome: nomeTg },
    };
  }

  if (!jaLiberado(s?.dados)) {
    // Só chega aqui no PRIVADO. O BOTÃO é obrigatório: é ele que pede o
    // contato ao Telegram. Sem ele a pessoa fica presa num loop ("toque em
    // /start" → mesma mensagem), porque /start também cai aqui.
    await enviar(B, chatId,
      "👋 <b>Bot Comercial — Costa Júnior</b>\n\nPra liberar as propostas eu preciso te identificar pelo <b>telefone cadastrado na sua ficha do RH</b>.\n\nToque no botão abaixo 👇",
      botaoTelefone);
    return;
  }
  const ss = s as Sessao;

  const estado = ss.estado || "pronto";
  // Uma proposta em andamento fica PRESA ao chat onde começou: assim o roteiro
  // do grupo não é respondido por engano no privado (e vice-versa).
  const chatDaProposta = String(ss.chat_id || "");
  const mesmoChat = !chatDaProposta || chatDaProposta === String(chatId);
  const noMeioDaProposta = estado.startsWith("com_") && mesmoChat;

  // Em grupo os comandos chegam como "/proposta@cjrcomercial_bot".
  if (cmd(texto, "cancelar")) return await mostrarMenuComercial(db, B, ss, chatId);
  if (cmd(texto, "start", "menu", "proposta")) return await mostrarMenuComercial(db, B, ss, chatId);
  // "pode mudar de etapa" em texto livre só no privado: no grupo alguém
  // comentando isso numa conversa não deve disparar o comando.
  if (cmd(texto, "etapa") || (!ehGrupo && /mudar\s+de\s+etapa/i.test(texto))) return await perguntarEtapa(db, B, ss, chatId);

  if (msg.photo || msg.document) {
    if (noMeioDaProposta && (estado === "com_projeto" || estado === "com_planilha")) return await onArquivoRoteiro(db, B, ss, chatId, msg, estado);
    // Fora do passo de anexo: guarda e oferece começar a proposta com eles.
    return await guardarArquivoSolto(db, B, ss, chatId, msg);
  }
  if (!texto) return;
  if (noMeioDaProposta) return await onTextoComercial(db, B, ss, chatId, estado, texto);
  // Mensagem solta: abre o menu. No grupo, com uma pausa entre um menu e outro
  // pra não repetir o menu a cada linha de uma conversa.
  if (ehGrupo && !(await podeFalarNoGrupo(db, B, chatId))) return;
  return await mostrarMenuComercial(db, B, ss, chatId);
}

// ── Comando "pode mudar de etapa" (Adriana, 2026-08-04) — só no bot
// Comercial dedicado. Age sobre a ÚLTIMA oportunidade criada nesta conversa
// (guardada em dados.ultimoIdRefurbish pelo executarProposta). ──
async function perguntarEtapa(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const idRefurbish = sessao.dados?.ultimoIdRefurbish;
  if (!idRefurbish) {
    await enviar(B, chatId, "Não achei nenhuma oportunidade criada por aqui ainda nesta conversa. Gere uma proposta primeiro (/menu).");
    return;
  }
  await enviar(B, chatId, `🔀 Mudar a etapa de <b>${escTg(sessao.dados?.ultimoNomeOportunidade || `oportunidade ${idRefurbish}`)}</b> — para <b>Visita</b> ou para <b>Em Orçamento</b>?`, inline([
    [{ text: "🚶 Visita", callback_data: `etapa:visita:${idRefurbish}` }],
    [{ text: "💰 Em Orçamento", callback_data: `etapa:orcamento:${idRefurbish}` }],
    btnCancelar,
  ]));
}

// Callback do comando de etapa — chamado direto pelo onCallback do
// telegramBot.ts quando B.modo === "comercial" e data começa com "etapa:".
export async function onCallbackEtapa(db: any, B: Bot, sessao: Sessao | null, chatId: number, data: string) {
  if (!sessao || !jaLiberado(sessao.dados)) { await enviar(B, chatId, "Sessão expirada. Toque em /start."); return; }
  if (data === "cancel") { await enviar(B, chatId, "Ok, sem mudança de etapa."); return; }
  const partes = data.split(":"); // etapa:visita:123  |  etapa:orcamento:123
  const acao = partes[1];
  const idRefurbish = Number(partes[2]);
  if (!idRefurbish) { await enviar(B, chatId, "Não identifiquei qual oportunidade — recomeça com /etapa."); return; }
  try {
    if (acao === "visita") {
      await vobiMudarEtapa(idRefurbish, "VISITA");
      await enviar(B, chatId, "🚶 Etapa alterada para <b>Visita</b>. O orçamento continua como estava — nada foi enviado ao cliente.");
      return;
    }
    if (acao === "orcamento") {
      await vobiMudarEtapa(idRefurbish, "EM ORÇAMENTO");
      await enviar(B, chatId, "💰 Etapa alterada para <b>Em Orçamento</b>. O valor de ganho já está gravado na Oportunidade.");
      return;
    }
  } catch (e: any) {
    await enviar(B, chatId, `⚠️ Não consegui confirmar a mudança de etapa na Vobi: ${escTg(e?.message || e)}. Confira manualmente por lá.`);
  }
}

// Roteiro completo (identificação + menu) — usado pelo bot de Processos.
export async function onMessageProcessos(db: any, B: Bot, msg: any) {
  const chat = msg.chat;
  if (!chat || chat.type !== "private") return;
  const userId = String(msg.from?.id || "");
  const chatId = chat.id;
  if (!userId) return;

  if (msg.contact) {
    if (String(msg.contact.user_id || "") !== userId) { await enviar(B, chatId, "Compartilhe o <b>seu próprio</b> contato, por favor."); return; }
    return await identificar(db, B, userId, chatId, msg.contact.phone_number);
  }

  const sessao = await getSessao(db, B, userId);
  if (!sessao?.dados?.colaborador_id) {
    // Mesmo motivo do bot Comercial: sem o botão não existe como se identificar.
    await enviar(B, chatId,
      "👋 <b>Bot de Processos — Costa Júnior</b>\n\nPreciso te identificar pelo <b>telefone cadastrado na sua ficha do RH</b>.\n\nToque no botão abaixo 👇",
      botaoTelefone);
    return;
  }
  const texto = String(msg.text || "").trim();
  if (/^\/cancelar/i.test(texto)) return await mostrarMenuComercial(db, B, sessao, chatId);
  if (/^\/(start|menu)/i.test(texto)) return await mostrarMenuAreas(db, B, chatId, sessao.telegram_user_id, sessao.dados);

  const estado = sessao.estado || "proc_menu";

  if (msg.photo || msg.document) {
    if (estado === "com_projeto" || estado === "com_planilha") return await onArquivoRoteiro(db, B, sessao, chatId, msg, estado);
    await enviar(B, chatId, "Não esperava um arquivo agora — se quiser recomeçar, mande /cancelar.");
    return;
  }
  if (!texto) return;
  if (estado.startsWith("com_")) return await onTextoComercial(db, B, sessao, chatId, estado, texto);
  return await mostrarMenuAreas(db, B, chatId, sessao.telegram_user_id, sessao.dados);
}

// Só o roteiro (sem identificação/menu de áreas) — usado de dentro da JunIA,
// que já cuida da identificação e do resto do chat livre. Retorna true se a
// mensagem foi tratada aqui (ou seja, o chamador NÃO deve cair no chat livre).
export async function onMessageComercialRoteiro(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any): Promise<boolean> {
  const estado = sessao.estado || "";
  if (!estado.startsWith("com_")) return false;

  const texto = String(msg.text || "").trim();
  if (/^\/cancelar/i.test(texto)) {
    await salvarSessao(db, { ...sessao, estado: "pronto", dados: idBaseDe(sessao.dados || {}) });
    await enviar(B, chatId, "Ok, proposta cancelada. Pode me perguntar qualquer outra coisa. 🙂");
    return true;
  }
  if (msg.photo || msg.document) {
    if (estado === "com_projeto" || estado === "com_planilha") { await onArquivoRoteiro(db, B, sessao, chatId, msg, estado); return true; }
    await enviar(B, chatId, "Não esperava um arquivo agora — se quiser recomeçar a proposta, mande /cancelar.");
    return true;
  }
  if (!texto) return true;
  await onTextoComercial(db, B, sessao, chatId, estado, texto);
  return true;
}

async function avancar(db: any, B: Bot, sessao: Sessao, chatId: number, patch: any, proximoEstado: string, textoPergunta: string, pularCb?: string, extras?: { text: string; callback_data: string }[][]) {
  const dados = { ...sessao.dados, ...patch };
  await salvarSessao(db, { ...sessao, estado: proximoEstado, dados });
  // se a leitura dos arquivos já respondeu essa pergunta, oferece em 1 toque
  const { texto, botoes } = pergunta(textoPergunta, pularCb, [...botaoSugestao(dados, proximoEstado), ...(extras || [])]);
  await enviar(B, chatId, texto, botoes);
}

// Arquivo mandado FORA do passo de anexo (ex.: a pessoa encaminha o projeto e
// a planilha assim que abre o chat). Guarda na sessão e oferece começar.
async function guardarArquivoSolto(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any) {
  const arq = arqDaMsg(msg);
  if (!arq) return;
  const atuais = arquivosGuardados(sessao.dados);
  const lista = atuais.some((a) => a.file_id === arq.file_id) ? atuais : [...atuais, arq];
  // Um álbum (vários arquivos de uma vez) chega como VÁRIAS mensagens com o
  // mesmo media_group_id — guarda todas, mas responde só na primeira.
  const album = String(msg.media_group_id || "");
  const jaRespondi = !!album && album === String(sessao.dados?.ultimoAlbum || "");
  await salvarSessao(db, {
    ...sessao, chat_id: String(chatId),
    dados: { ...(sessao.dados || {}), arquivos: lista.slice(-8), ultimoAlbum: album || null },
  });
  if (jaRespondi) return;
  await enviar(B, chatId,
    "📎 Recebi seus arquivos e guardei aqui.\n\nQuer que eu monte uma <b>proposta comercial</b> com eles? Eu pergunto o cliente, o endereço e o escopo — e no passo do anexo já uso esses arquivos.",
    inline([[{ text: "📋 Começar proposta", callback_data: "com:nova" }], btnCancelar]));
}

// ── LER os arquivos antes de perguntar (pedido da Adriana, 2026-08-04) ──
// Ela mandou o projeto + a planilha e respondeu "pegar nos arquivos" nas
// perguntas — o certo é o bot ler primeiro e só perguntar o que faltar.
// PDF: camada de texto via unpdf (planta de CAD quase sempre tem o carimbo
// em texto). XLSX: é um ZIP — dá pra ler as células com o jszip que já existe
// no projeto, sem dependência nova.
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

async function textoDeXlsx(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  // sharedStrings.xml guarda os textos; as células referenciam por índice.
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeXml(Array.from(si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join("")));
    }
  }
  const linhas: string[] = [];
  const sheets = zip.file(/xl\/worksheets\/sheet\d+\.xml/) || [];
  for (const sheet of sheets.slice(0, 8)) {
    const xml = await sheet.async("string");
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celulas: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const tipo = (c[1].match(/\st="([^"]+)"/) || [])[1];
        let val = "";
        if (tipo === "inlineStr") val = decodeXml(Array.from(c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join(""));
        else {
          const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v != null) val = tipo === "s" ? (shared[Number(v)] ?? "") : decodeXml(v);
        }
        if (val) celulas.push(val);
      }
      if (celulas.length) linhas.push(celulas.join(" | "));
      if (linhas.length > 400) break;
    }
    if (linhas.length > 400) break;
  }
  return linhas.join("\n").slice(0, 9000);
}

async function textoDoArquivo(buf: Buffer, nome: string, ct: string): Promise<string> {
  const n = String(nome || "").toLowerCase();
  try {
    if (n.endsWith(".pdf") || String(ct).includes("pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text || "").replace(/\s+/g, " ").trim().slice(0, 7000);
    }
    if (/\.(xlsx|xlsm)$/.test(n)) return await textoDeXlsx(buf);
  } catch { /* arquivo sem camada de texto (escaneado/imagem) → segue sem */ }
  return "";
}

// Manda o conteúdo lido pra IA e devolve o que ela conseguiu identificar.
async function extrairDadosDaProposta(trechos: { nome: string; texto: string }[]): Promise<any | null> {
  if (!llmConfigurado() || !trechos.length) return null;
  const system = `Você lê documentos de um serviço de engenharia/reforma (plantas em PDF e planilha de orçamento) e extrai dados para uma proposta comercial da construtora Costa Júnior.
Responda APENAS JSON, sem comentários:
{"cliente":"","endereco":"","escopo_curto":"","escopo_detalhado":"","valor":""}
REGRAS:
- Só preencha o que estiver EXPLÍCITO nos documentos. O que não achar, deixe "".
- NUNCA invente endereço, valor ou nome de cliente.
- "valor" = valor TOTAL do orçamento (o total geral, não itens soltos), formato "R$ 0.000,00".
- "escopo_curto" = UMA frase objetiva do serviço.
- "escopo_detalhado" = lista curta do que inclui (uma linha por item), se der pra saber.`;
  const corpo = trechos.map((t) => `### Arquivo: ${t.nome}\n${t.texto}`).join("\n\n").slice(0, 20000);
  try {
    const raw = await gerarTextoLLM(system, [{ role: "user", content: corpo }]);
    return raw ? extrairJson(raw) : null;
  } catch { return null; }
}

// LÊ os arquivos (sem guardar em nuvem nenhuma) e devolve o patch pra sessão.
// REGRA DA ADRIANA (05/08/2026): "não é pra subir isso pra nenhuma nuvem" — o
// arquivo fica no Telegram e vai direto pra pasta dela (`_CLAUDE COMERCIAL`)
// quando o Claude vier buscar pelo /api/integra/comercial-jobs. Aqui os bytes
// só passam pela memória pra extrair o texto; nada é persistido.
async function anexarEAnalisar(db: any, B: Bot, chatId: number, arquivos: ArqGuardado[]): Promise<any> {
  const patch: any = { arquivos: [], analisado: true };
  const anexados: { file_id: string; nome: string; ct: string; campo: string }[] = [];
  const falhou: string[] = [];
  const trechos: { nome: string; texto: string }[] = [];
  for (const a of arquivos) {
    const buf = await baixarArquivoTg(B, a.file_id);
    if (!buf) { falhou.push(a.nome); continue; }
    const campo = ehPlanilha(a.nome) ? "planilha" : "projeto";
    anexados.push({ file_id: a.file_id, nome: a.nome, ct: a.ct, campo });
    const texto = await textoDoArquivo(buf, a.nome, a.ct);
    if (texto) trechos.push({ nome: a.nome, texto });
  }
  patch.arquivosAnexados = anexados;

  const linhas = anexados.map((a) => `• ${escTg(a.nome)} → ${a.campo === "planilha" ? "planilha" : "projeto"}`).join("\n");
  const aviso = falhou.length ? `\n⚠️ Não consegui baixar: ${falhou.map(escTg).join(", ")}` : "";
  await enviar(B, chatId, anexados.length ? `📎 Arquivos recebidos:\n${linhas}${aviso}` : `⚠️ Não consegui receber os arquivos.${aviso}`);

  if (!trechos.length) {
    if (anexados.length) await enviar(B, chatId, "🔎 Não consegui ler o conteúdo (os arquivos parecem ser só imagem/escaneados) — o card vem em branco, é só tocar em cada campo pra preencher.");
    return patch;
  }
  const achado = await extrairDadosDaProposta(trechos);
  if (!achado) {
    await enviar(B, chatId, "🔎 Li os arquivos mas não consegui extrair os dados automaticamente — o card vem em branco, é só tocar em cada campo pra preencher.");
    return patch;
  }
  const sug: any = {};
  if (achado.cliente) sug.cliente = String(achado.cliente).trim();
  if (achado.endereco) sug.endereco = String(achado.endereco).trim();
  if (achado.escopo_curto) sug.escopoCurto = String(achado.escopo_curto).trim();
  if (achado.escopo_detalhado) sug.escopoDetalhado = String(achado.escopo_detalhado).trim();
  if (achado.valor) sug.valor = String(achado.valor).trim();
  patch.sug = sug;

  const rot: Record<string, string> = { cliente: "Cliente", endereco: "Endereço", escopoCurto: "Escopo", escopoDetalhado: "Detalhamento", valor: "Valor" };
  const achados = Object.keys(sug).map((k) => `• <b>${rot[k]}:</b> ${escTg(sug[k].length > 160 ? sug[k].slice(0, 157) + "…" : sug[k])}`).join("\n");
  await enviar(B, chatId, achados
    ? `🔎 <b>Li os arquivos.</b> Achei isto:\n${achados}\n\nVou montar o card com esses dados — confira antes de confirmar, porque saiu dos documentos.`
    : "🔎 Li os arquivos, mas não achei cliente/endereço/escopo explícitos — é só tocar em cada campo do card pra preencher.");
  return patch;
}

async function usarArquivosGuardados(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const arquivos = arquivosGuardados(sessao.dados);
  if (!arquivos.length) {
    await enviar(B, chatId, "Não tenho arquivo guardado por aqui. Pode me enviar agora, ou tocar em pular.");
    return;
  }
  await enviar(B, chatId, "📎 Guardando e lendo os arquivos… (uns segundos)");
  const patch = await anexarEAnalisar(db, B, chatId, arquivos);
  return await irParaCard(db, B, sessao, chatId, patch);
}

async function onArquivoRoteiro(db: any, B: Bot, sessao: Sessao, chatId: number, msg: any, estado: "com_projeto" | "com_planilha") {
  let fileId = "", nome = "arquivo", ct = "application/octet-stream";
  if (msg.document) { fileId = msg.document.file_id; nome = msg.document.file_name || "arquivo"; ct = msg.document.mime_type || ct; }
  else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; nome = "foto-telegram.jpg"; ct = "image/jpeg"; }
  if (!fileId) { await enviar(B, chatId, "Não consegui ler esse arquivo."); return; }
  await enviar(B, chatId, "📎 Recebendo…");
  const buf = await baixarArquivoTg(B, fileId);
  if (!buf) { await enviar(B, chatId, "❌ Não consegui baixar o arquivo. Tente de novo, ou pule."); return; }
  // Nada vai pra nuvem: guarda só a referência do Telegram + lê o texto.
  const campo = estado === "com_projeto" ? "projeto" : "planilha";
  const anexados = [...(sessao.dados?.arquivosAnexados || []), { file_id: fileId, nome, ct, campo }];
  const patch: any = { arquivosAnexados: anexados };
  const texto = await textoDoArquivo(buf, nome, ct);
  if (texto) {
    const achado = await extrairDadosDaProposta([{ nome, texto }]);
    if (achado) {
      const sug: any = { ...(sessao.dados?.sug || {}) };
      if (achado.cliente && !sug.cliente) sug.cliente = String(achado.cliente).trim();
      if (achado.endereco && !sug.endereco) sug.endereco = String(achado.endereco).trim();
      if (achado.escopo_curto && !sug.escopoCurto) sug.escopoCurto = String(achado.escopo_curto).trim();
      if (achado.escopo_detalhado && !sug.escopoDetalhado) sug.escopoDetalhado = String(achado.escopo_detalhado).trim();
      if (achado.valor && !sug.valor) sug.valor = String(achado.valor).trim();
      patch.sug = sug;
    }
  }
  if (estado === "com_projeto") {
    return await avancar(db, B, sessao, chatId, patch, "com_planilha",
      "✅ Projeto recebido.\n\n📊 Tem uma <b>planilha de orçamento padrão</b> pra esse tipo de serviço? Envie ou pule.",
      "com:pular_planilha");
  }
  await enviar(B, chatId, "✅ Planilha recebida.");
  return await irParaCard(db, B, sessao, chatId, patch);
}

// ── Callbacks (botões) ──────────────────────────────────────────────────
// Passo em que cada botão do roteiro faz sentido (ver a trava logo abaixo).
const ESTADO_DO_BOTAO: Record<string, string> = {
  "com:pular_projeto": "com_projeto",
  "com:pular_planilha": "com_planilha",
  "com:confirmar": "com_confirma",
  "com:anexar": "com_confirma",
  "com:usar_valor_lido": "com_confirma",
  "com:ed:cliente": "com_confirma",
  "com:ed:endereco": "com_confirma",
  "com:ed:escopo": "com_confirma",
  "com:ed:detalhe": "com_confirma",
  "com:ed:prazo_obra": "com_confirma",
  "com:ed:prazo_mob": "com_confirma",
  "com:ed:valor": "com_confirma",
  "com:ed:pagto": "com_confirma",
};

export async function onCallbackProcessos(db: any, B: Bot, sessao: Sessao | null, chatId: number, userId: string, data: string) {
  if (!sessao || !jaLiberado(sessao.dados)) { await enviar(B, chatId, "Sessão expirada. Toque em /start."); return; }
  // Cada botão só vale no passo em que foi criado. Em GRUPO todo mundo enxerga
  // (e consegue tocar) os botões da proposta alheia — sem esta trava, tocar no
  // "Pular"/"Confirmar" de outra pessoa embaralharia o próprio roteiro de quem
  // clicou. Vale também no privado, contra botão de mensagem antiga.
  const passoDoBotao = ESTADO_DO_BOTAO[data];
  if (passoDoBotao && (sessao.estado || "") !== passoDoBotao) {
    await enviar(B, chatId, "Esse botão é de <b>outra proposta</b> (ou de um passo que já passou). Mande <b>/proposta</b> pra começar a sua.");
    return;
  }
  if (data === "cancel") return await mostrarMenuComercial(db, B, sessao, chatId);
  if (data === "area:embreve") { await enviar(B, chatId, "🚧 Ainda não disponível — só o Comercial por enquanto."); return; }
  // No grupo liberado a autorização é estar no grupo — não há ficha do RH
  // pra checar perfil. No privado, segue valendo o perfil Comercial/admin.
  if ((data === "area:comercial" || data === "com:nova") && !sessao.dados.grupo_autorizado) {
    if (!(await ehComercial(db, sessao.dados.colaborador_id))) { await enviar(B, chatId, "Recurso restrito ao time Comercial."); return; }
  }
  if (data === "area:comercial") return await mostrarMenuComercial(db, B, sessao, chatId);
  if (data === "com:nova") return await iniciarNovaProposta(db, B, sessao, chatId);
  if (data === "com:usar_arquivos") return await usarArquivosGuardados(db, B, sessao, chatId);
  if (data === "com:sugestao") return await aceitarSugestao(db, B, sessao, chatId);
  if (data === "com:pular_projeto") return await avancar(db, B, sessao, chatId, {}, "com_planilha",
    "📊 Tem uma <b>planilha de orçamento padrão</b> pra esse tipo de serviço? Envie ou pule.", "com:pular_planilha");
  if (data === "com:pular_planilha") return await irParaCard(db, B, sessao, chatId, {});
  if (data === "com:anexar") return await avancar(db, B, sessao, chatId, {}, "com_projeto",
    "📎 Manda o <b>projeto</b> (planta/PDF). A planilha, se tiver, eu peço logo depois.", "com:pular_projeto");
  // Tocar num campo do card abre a pergunta SÓ daquele campo — e volta pro card.
  if (data.startsWith("com:ed:")) {
    const campo = data.slice("com:ed:".length);
    const def = CAMPOS_EDITAVEIS[campo];
    if (!def) return;
    await salvarSessao(db, { ...sessao, chat_id: String(chatId), estado: `com_ed_${campo}`, dados: sessao.dados });
    await enviar(B, chatId, def.pergunta, inline([[{ text: "↩️ Voltar sem mudar", callback_data: "com:voltar_card" }], btnCancelar]));
    return;
  }
  if (data === "com:voltar_card") return await irParaCard(db, B, sessao, chatId, {});
  // O total que a leitura achou nos arquivos só entra se a pessoa mandar.
  if (data === "com:usar_valor_lido") {
    const v = sessao.dados?.sug?.valor;
    const n = v ? parseValorReais(String(v)) : null;
    if (!n) { await enviar(B, chatId, "Não consegui aproveitar esse valor — toque em <b>Valor</b> pra digitar."); return; }
    return await irParaCard(db, B, sessao, chatId, { valorTotalTexto: String(v).trim(), valorNumerico: n });
  }
  if (data === "com:confirmar") return await executarProposta(db, B, sessao, chatId);
}

function resumoLinha(label: string, valor?: string, padrao?: string): string {
  if (valor) return `${label}: <b>${escTg(valor)}</b>`;
  return `${label}: <i>não informado${padrao ? ` (mantém ${escTg(padrao)})` : ""}</i>`;
}

async function mostrarConfirmacao(db: any, B: Bot, chatId: number, dados: any) {
  const d = dados || {};
  const arqs = Array.isArray(d.arquivosAnexados) ? d.arquivosAnexados : [];
  const temProjeto = arqs.some((a: any) => a.campo === "projeto");
  const temPlanilha = arqs.some((a: any) => a.campo === "planilha");
  const nItens = String(d.escopoDetalhado || "").split(/\r?\n/).filter((l: string) => l.trim()).length;
  const pagamento = Number(d.pctMedicao) > 0
    ? `${d.pctSinal}% sinal / ${d.pctMedicao}% medição / ${d.pctEntrega}% entrega`
    : `${d.pctSinal}% sinal / ${d.pctEntrega}% entrega`;

  const linhas = [
    resumoLinha("🏢 Cliente", d.cliente),
    resumoLinha("📍 Endereço", d.endereco),
    resumoLinha("✏️ Escopo", d.escopoCurto),
    resumoLinha("📝 Detalhamento", nItens ? `${nItens} item(ns)` : undefined, "fica marcado p/ ajustar depois"),
    resumoLinha("🗓️ Prazo de obra", `${d.prazoObraDias} dias úteis`),
    resumoLinha("🚚 Mobilização", `${d.prazoMobilizacaoDias} dias úteis`),
    resumoLinha("💰 Valor", d.valorTotalTexto || VALOR_A_DEFINIR),
    resumoLinha("📐 Pagamento", pagamento),
    resumoLinha("📎 Arquivos", arqs.length ? `${arqs.length} (${temProjeto ? "projeto" : "sem projeto"}${temPlanilha ? " + planilha" : ""})` : undefined, "nenhum anexado"),
  ].join("\n");

  const temValorLido = !d.valorTotalTexto && !!d.sug?.valor;
  const dica = temValorLido
    ? `\n\n💡 Achei <b>${escTg(String(d.sug.valor))}</b> nos arquivos. Só entra na proposta se você mandar.`
    : "";

  const botoes: { text: string; callback_data: string }[][] = [
    [{ text: "✅ Confirmar e gerar", callback_data: "com:confirmar" }],
    [{ text: "🏢 Cliente", callback_data: "com:ed:cliente" }, { text: "📍 Endereço", callback_data: "com:ed:endereco" }],
    [{ text: "✏️ Escopo", callback_data: "com:ed:escopo" }, { text: "📝 Detalhamento", callback_data: "com:ed:detalhe" }],
    [{ text: "🗓️ Prazo obra", callback_data: "com:ed:prazo_obra" }, { text: "🚚 Mobilização", callback_data: "com:ed:prazo_mob" }],
    [{ text: "💰 Valor", callback_data: "com:ed:valor" }, { text: "📐 Pagamento", callback_data: "com:ed:pagto" }],
  ];
  if (temValorLido) botoes.push([{ text: "💡 Usar o valor que li", callback_data: "com:usar_valor_lido" }]);
  if (!arqs.length) botoes.push([{ text: "📎 Anexar arquivos", callback_data: "com:anexar" }]);
  botoes.push(btnCancelar);

  await enviar(B, chatId,
    `📋 <b>Confirma os dados da proposta?</b>\n\n${linhas}${dica}\n\nToque num campo pra ajustar — ou confirme, que eu gero o PowerPoint e crio a oportunidade na Vobi.`,
    inline(botoes));
}

async function enviarDocumentoTg(B: Bot, chatId: number, buffer: Buffer, filename: string, caption?: string): Promise<any> {
  if (!B.token) return { ok: false };
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
    form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), filename);
    const r = await fetch(`https://api.telegram.org/bot${B.token}/sendDocument`, { method: "POST", body: form });
    return await r.json().catch(() => ({}));
  } catch { return { ok: false }; }
}

async function executarProposta(db: any, B: Bot, sessao: Sessao, chatId: number) {
  const d = sessao.dados || {};
  await enviar(B, chatId, "⏳ Gerando a proposta e criando a oportunidade na Vobi…");

  const dadosProposta: DadosProposta = {
    cliente: d.cliente, endereco: d.endereco, escopoCurto: d.escopoCurto,
    escopoDetalhado: d.escopoDetalhado, prazoObraDias: d.prazoObraDias,
    prazoMobilizacaoDias: d.prazoMobilizacaoDias, valor: d.valor,
  };

  let pptx: { buffer: Buffer; nomeArquivo: string; pendencias: string[] } | null = null;
  try {
    pptx = await gerarPropostaPptx(dadosProposta);
  } catch (e: any) {
    await enviar(B, chatId, `❌ Não consegui gerar o PowerPoint: ${escTg(e?.message || e)}\n\nAvise a Adriana — provavelmente o modelo ainda não foi carregado no sistema.`);
  }

  let vobiMsg = "";
  let dadosFinais: any = idBaseDe(d);
  if (vobiEscritaConfigurada()) {
    try {
      const r = await vobiCriarOportunidade({
        nomeCliente: d.cliente,
        escopoResumo: d.escopoCurto,
        enderecoTexto: d.endereco,
        ...(B.modo === "comercial" && d.valorNumerico ? { valorGanho: d.valorNumerico } : {}),
      });
      const valorMsg = B.modo === "comercial"
        ? (d.valorNumerico ? (r.valorGravado ? " Valor de ganho gravado." : " ⚠️ não consegui confirmar o valor de ganho, confira lá dentro.") : "")
        : "";
      vobiMsg = `\n\n🏗️ Oportunidade criada na Vobi (id ${r.idRefurbish})${r.stepEncontrada ? "" : " — não achei a etapa \"NOVA\", conferir a etapa lá dentro"}.${valorMsg}`;
      if (B.modo === "comercial") {
        dadosFinais = { ...dadosFinais, ultimoIdRefurbish: r.idRefurbish, ultimoNomeOportunidade: `${d.cliente} - ${d.escopoCurto}` };
        vobiMsg += `\n\nQuando quiser mudar a etapa (Visita ou Em Orçamento), é só mandar <b>/etapa</b>.`;
      }
    } catch (e: any) {
      vobiMsg = `\n\n⚠️ Não consegui criar a oportunidade na Vobi: ${escTg(e?.message || e)}. Crie manualmente por lá.`;
    }
  } else {
    vobiMsg = "\n\n⚠️ Integração com a Vobi não está configurada — crie a oportunidade manualmente por lá.";
  }

  if (pptx) {
    await enviarDocumentoTg(B, chatId, pptx.buffer, pptx.nomeArquivo, "📄 Proposta gerada — confira antes de exportar o PDF e enviar ao cliente.");
    const pend = pptx.pendencias.length ? `\n\n📌 <b>Ainda precisa ajustar:</b>\n• ${pptx.pendencias.map(escTg).join("\n• ")}` : "";
    await enviar(B, chatId, `✅ Pronto! Baixe o PDF a partir do PowerPoint e envie ao cliente.${pend}${vobiMsg}`);
  } else if (vobiMsg) {
    await enviar(B, chatId, vobiMsg.trim());
  }

  // ── Registra o SERVIÇO pro Claude montar o orçamento ────────────────────
  // A Vercel não alcança a pasta da Adriana (`_CLAUDE COMERCIAL`), então aqui
  // só fica o registro (texto + file_id); o Claude vem buscar pelo endpoint
  // /api/integra/comercial-jobs, baixa os arquivos e salva direto na pasta.
  const arquivosJob = dadosFinais_arquivos(d);
  if (arquivosJob.length) {
    try {
      const jobId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await salvarSessao(db, {
        telegram_user_id: "jobcom:" + jobId,
        chat_id: String(chatId),
        estado: "pendente",
        dados: {
          chat_id: chatId,
          solicitante: d.colaborador_nome || null,
          proposta: {
            cliente: d.cliente, endereco: d.endereco,
            escopoCurto: d.escopoCurto, escopoDetalhado: d.escopoDetalhado,
            prazoObraDias: d.prazoObraDias, prazoMobilizacaoDias: d.prazoMobilizacaoDias,
            valor: d.valor, valorNumerico: d.valorNumerico ?? null,
            pctSinal: d.pctSinal ?? null, pctMedicao: d.pctMedicao ?? null, pctEntrega: d.pctEntrega ?? null,
            idRefurbish: dadosFinais.ultimoIdRefurbish ?? null,
          },
          arquivos: arquivosJob,
        },
      });
      await enviar(B, chatId, "🧮 Mandei os arquivos e os dados pro <b>Claude montar o orçamento</b> na pasta do Comercial. Assim que ficar pronto, ele avisa aqui.");
    } catch { /* nunca derruba o fluxo da proposta por causa disso */ }
  }

  await salvarSessao(db, { ...sessao, estado: "pronto", dados: dadosFinais });
}
