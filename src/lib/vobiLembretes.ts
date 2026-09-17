// Lembretes de contas a pagar (Vobi -> Telegram, grupo CJR_ADM).
//
// Pedido da Adriana (16/09/2026):
//   - todo dia: os vencimentos DAQUELE DIA
//   - toda segunda-feira: os vencimentos DA SEMANA
//   - NÃO cobrar atrasados (o volume é alto demais e vira ruído). Atrasado só
//     aparece quando ela vai dar baixa numa conta específica.
//
// Roda pendurado no cron diário (Vercel Hobby só permite 2 crons e ambos já
// existem — padrão do projeto é fazer piggyback).

import { enviarTelegram, escTg } from "./telegram";
import { vencimentosNoPeriodo, recebimentosNoPeriodo, vobiBaixaConfigurada, type ParcelaAberta } from "./vobiBaixa";
import { separarPrioridades, classificarPrioridade, ICONE, ROTULO, ORDEM, ehEntradaDeCaixa } from "./prioridades";
import { caixaDisponivel } from "./saldoContas";

const CANAL = "ADM"; // grupo CJR_ADM

/** Data de hoje no fuso de São Paulo (o servidor da Vercel roda em UTC). */
export function hojeSP(): Date {
  const agora = new Date();
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somarDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBR(isoDate: string): string {
  const [a, m, d] = isoDate.split("-");
  return `${d}/${m}`;
}

const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Uma linha da lista: fornecedor, descrição e valor. */
function linhaParcela(p: ParcelaAberta, comData = false): string {
  const quem = p.fornecedor ? escTg(p.fornecedor) : "<i>sem fornecedor</i>";
  const desc = p.descricao && p.descricao !== quem ? ` — ${escTg(p.descricao.slice(0, 45))}` : "";
  const data = comData ? `<b>${dataBR(p.vencimento)}</b> · ` : "";
  // conta prioritaria (judicial / pessoas / FGTS) sai marcada no meio da lista
  const tipo = classificarPrioridade(p);
  const marca = tipo ? ICONE[tipo] : `•`;
  return `${marca} ${data}${quem}${desc}\n   ${brl(p.valor)}`;
}

/** Agrupa por dia (para o resumo da semana). */
function porDia(lista: ParcelaAberta[]): Map<string, ParcelaAberta[]> {
  const m = new Map<string, ParcelaAberta[]>();
  for (const p of lista) {
    if (!m.has(p.vencimento)) m.set(p.vencimento, []);
    m.get(p.vencimento)!.push(p);
  }
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function total(lista: ParcelaAberta[]): number {
  return lista.reduce((s, p) => s + p.valor, 0);
}

/** Corta a lista para não estourar o limite de 4096 caracteres do Telegram. */
function montarLista(lista: ParcelaAberta[], comData: boolean, maximo = 25): string {
  const mostradas = lista.slice(0, maximo);
  let txt = mostradas.map((p) => linhaParcela(p, comData)).join("\n");
  if (lista.length > maximo) {
    const resto = lista.slice(maximo);
    txt += `\n\n<i>… e mais ${resto.length} conta(s), somando ${brl(total(resto))}.</i>`;
  }
  return txt;
}

/**
 * Falha ao consultar a Vobi NAO pode virar silencio. Um aviso que existe para
 * dizer "nao pode atrasar" precisa gritar quando nao conseguiu olhar — senao o
 * grupo le a ausencia de mensagem como "nao ha nada a pagar".
 */
async function avisarFalhaVobi(e: any, oQue: string) {
  const motivo = `falha ao consultar a Vobi: ${e?.message || e}`;
  await enviarTelegram(
    `⚠️ <b>Não consegui montar ${escTg(oQue)}.</b>\n${escTg(String(e?.message || e)).slice(0, 220)}\n\n<i>Confira direto na Vobi — isto NÃO quer dizer que não há contas.</i>`,
    { canal: CANAL },
  );
  return { enviou: false, qtd: 0, motivo };
}

/** LEMBRETE DIÁRIO — o que vence hoje. */
export async function enviarVencimentosDoDia(): Promise<{ enviou: boolean; qtd: number; motivo?: string }> {
  if (!vobiBaixaConfigurada()) return { enviou: false, qtd: 0, motivo: "sem credenciais da Vobi" };
  const hoje = hojeSP();
  const hojeIso = iso(hoje);

  let lista: ParcelaAberta[];
  try {
    lista = await vencimentosNoPeriodo(hojeIso, hojeIso);
  } catch (e: any) {
    return await avisarFalhaVobi(e, "o lembrete de hoje");
  }

  const dia = DIA_SEMANA[hoje.getUTCDay()];
  const cab = `☀️ <b>Bom dia, Costa Júnior!</b>\n<i>${dia}, ${dataBR(hojeIso)}</i>\n\n`;

  // As prioridades saem num bloco a parte, antes de tudo: a Adriana precisa
  // ver de cara se o que vence hoje e judicial, de pessoal ou FGTS.
  const { prioritarias, demais } = separarPrioridades(lista);

  let corpo: string;
  if (!lista.length) {
    corpo = `✅ <b>Nenhuma conta vence hoje.</b>`;
  } else {
    corpo = `💸 <b>Vence HOJE — ${lista.length} conta(s) · ${brl(total(lista))}</b>\n`;
    if (prioritarias.length) {
      corpo +=
        `\n🔴 <b>PRIORIDADE — ${prioritarias.length} conta(s) · ${brl(total(prioritarias))}</b>\n` +
        `<i>não pode atrasar</i>\n` +
        montarLista(prioritarias, false, 12) +
        "\n";
    }
    if (demais.length) {
      corpo +=
        `\n<b>Demais — ${demais.length} conta(s) · ${brl(total(demais))}</b>\n` +
        montarLista(demais, false, 15) +
        "\n";
    }
    corpo += `\n<i>Pagou alguma? Toque no botão dela — ou mande o comprovante.</i>`;
  }
  const texto = cab + corpo;

  // Um botão "Paguei" por conta: tocar já abre a baixa daquela parcela, sem
  // precisar digitar valor e fornecedor. O id da parcela (uuid) cabe no
  // callback_data (limite de 64 bytes).
  const teclado = lista.length
    ? {
        inline_keyboard: [...prioritarias, ...demais].slice(0, 8).map((p) => [{
          text: `✅ Paguei: ${(p.fornecedor || p.descricao).slice(0, 24)} · ${brl(p.valor)}`.slice(0, 60),
          callback_data: `fbpago:${p.id}`,
        }]),
      }
    : undefined;

  const r = await enviarTelegram(texto, { canal: CANAL, teclado });
  return { enviou: !!r?.ok, qtd: lista.length, motivo: r?.ok ? undefined : r?.motivo };
}

/** LEMBRETE SEMANAL — segundas-feiras, o que vence na semana (hoje → domingo). */
export async function enviarVencimentosDaSemana(): Promise<{ enviou: boolean; qtd: number; motivo?: string }> {
  if (!vobiBaixaConfigurada()) return { enviou: false, qtd: 0, motivo: "sem credenciais da Vobi" };
  const hoje = hojeSP();
  const de = iso(hoje);
  const ate = iso(somarDias(hoje, 6));

  let lista: ParcelaAberta[];
  try {
    lista = await vencimentosNoPeriodo(de, ate);
  } catch (e: any) {
    return await avisarFalhaVobi(e, "a agenda da semana");
  }

  const cab = `📅 <b>Agenda da semana — Costa Júnior</b>\n<i>${dataBR(de)} a ${dataBR(ate)}</i>\n\n`;
  if (!lista.length) {
    const r = await enviarTelegram(cab + "✅ <b>Nenhuma conta vence nesta semana.</b>", { canal: CANAL });
    return { enviou: !!r?.ok, qtd: 0, motivo: r?.ok ? undefined : r?.motivo };
  }

  let corpo = `💸 <b>${lista.length} conta(s) · ${brl(total(lista))}</b>\n`;
  const grupos = porDia(lista);
  let mostradas = 0;
  const LIMITE = 30;
  for (const [dataIso, doDia] of grupos) {
    if (mostradas >= LIMITE) break;
    const d = new Date(dataIso + "T12:00:00Z");
    corpo += `\n<b>${DIA_SEMANA[d.getUTCDay()]} ${dataBR(dataIso)}</b> — ${brl(total(doDia))}\n`;
    for (const p of doDia) {
      if (mostradas >= LIMITE) break;
      corpo += linhaParcela(p) + "\n";
      mostradas++;
    }
  }
  if (mostradas < lista.length) {
    corpo += `\n<i>… e mais ${lista.length - mostradas} conta(s) na semana.</i>`;
  }

  const r = await enviarTelegram(cab + corpo, { canal: CANAL });
  return { enviou: !!r?.ok, qtd: lista.length, motivo: r?.ok ? undefined : r?.motivo };
}

/**
 * LEMBRETE DE PRIORIDADES — o caixa que precisa estar garantido.
 *
 * Pedido da Adriana (17/09/2026): judicial, pessoas e FGTS são prioridade e
 * "devem ter saldos para pagamento garantido". Por isso este aviso olha 30
 * dias para a frente, e não só a semana — é o prazo que dá para separar o
 * dinheiro. Fecha com o que entra no mesmo período, para a resposta ser
 * "dá" ou "não dá", e não apenas mais uma lista.
 */
export async function enviarPrioridades(dias = 30, listarVencidas = false): Promise<{ enviou: boolean; qtd: number; motivo?: string }> {
  if (!vobiBaixaConfigurada()) return { enviou: false, qtd: 0, motivo: "sem credenciais da Vobi" };
  const hoje = hojeSP();
  // Olhamos 180 dias para TRAS tambem: prioridade ja vencida e nao paga e a
  // mais perigosa que existe (acordo judicial vencido vira execucao, FGTS
  // vencido derruba a certidao) e some numa janela que so olha o futuro.
  const de = iso(somarDias(hoje, -180));
  const hojeIso = iso(hoje);
  const ate = iso(somarDias(hoje, dias));

  let lista: ParcelaAberta[];
  try {
    lista = await vencimentosNoPeriodo(de, ate);
  } catch (e: any) {
    return await avisarFalhaVobi(e, "o aviso de prioridades");
  }

  const { prioritarias } = separarPrioridades(lista);
  const vencidas = prioritarias.filter((p) => p.vencimento < hojeIso);
  const aVencer = prioritarias.filter((p) => p.vencimento >= hojeIso);
  const cab = `🔴 <b>Prioridades — caixa garantido</b>\n<i>próximos ${dias} dias</i>\n\n`;
  const paraListar = listarVencidas ? prioritarias : aVencer;
  if (!paraListar.length) {
    const r = await enviarTelegram(cab + `✅ <b>Nada judicial, de pessoal ou FGTS vencido nem nos próximos ${dias} dias.</b>`, { canal: CANAL });
    return { enviou: !!r?.ok, qtd: 0, motivo: r?.ok ? undefined : r?.motivo };
  }

  let corpo = "";
  if (listarVencidas && vencidas.length) {
    corpo += `🚨 <b>JÁ VENCIDO e não pago — ${vencidas.length} · ${brl(total(vencidas))}</b>\n`;
    for (const p of vencidas.slice(0, 10)) {
      const quem = p.fornecedor ? escTg(p.fornecedor) : escTg(p.descricao.slice(0, 36));
      const t = classificarPrioridade(p);
      corpo += `   ${t ? ICONE[t] : "•"} <b>${dataBR(p.vencimento)}</b> ${quem} — ${brl(p.valor)}\n`;
    }
    if (vencidas.length > 10) {
      corpo += `   <i>… e mais ${vencidas.length - 10}, somando ${brl(total(vencidas.slice(10)))}</i>\n`;
    }
    corpo += "\n";
  }

  const porTipoAVencer = separarPrioridades(listarVencidas ? aVencer : paraListar).porTipo;
  for (const tipo of ORDEM) {
    const doTipo = porTipoAVencer.get(tipo);
    if (!doTipo?.length) continue;
    corpo += `<b>${ROTULO[tipo]} — ${doTipo.length} · ${brl(total(doTipo))}</b>\n`;
    for (const p of doTipo.slice(0, 8)) {
      const quem = p.fornecedor ? escTg(p.fornecedor) : escTg(p.descricao.slice(0, 36));
      corpo += `   <b>${dataBR(p.vencimento)}</b> ${quem} — ${brl(p.valor)}\n`;
    }
    if (doTipo.length > 8) {
      corpo += `   <i>… e mais ${doTipo.length - 8}, somando ${brl(total(doTipo.slice(8)))}</i>\n`;
    }
    corpo += "\n";
  }

  // O vencido entra na conta: continua sendo divida a pagar.
  // so o que esta a vencer entra na conta (pedido da Adriana: "so futuro por
  // enquanto"). O vencido aparece em uma linha no rodape, sem somar.
  const precisa = listarVencidas ? total(prioritarias) : total(aVencer);
  let receber: ParcelaAberta[] | null = null;
  try {
    receber = (await recebimentosNoPeriodo(hojeIso, ate)).filter(ehEntradaDeCaixa);
  } catch {
    receber = null;
  }
  // o caixa que ela TEM entra na conta — foi o pedido: "lembre de considerar o
  // caixa (villela e santander)". As outras contas estao congeladas.
  const caixa = await caixaDisponivel().catch(() => null);
  corpo += `━━━━━━━━━━━━━━━\n`;
  if (caixa && !caixa.erro) {
    corpo += `<b>Em caixa hoje: ${brl(caixa.total)}</b>\n`;
    corpo += `   <i>${caixa.contas.map((c) => `${escTg(c.nome)} ${brl(c.saldo)}`).join(" · ")}</i>\n`;
  }
  corpo += `<b>A garantir: ${brl(precisa)}</b>\n`;
  if (receber) {
    const entra = total(receber);
    corpo += `Previsto a receber: ${brl(entra)}\n`;
    for (const p of receber.slice(0, 5)) {
      const quem = p.fornecedor ? escTg(p.fornecedor) : escTg(p.descricao.slice(0, 32));
      corpo += `   <i>${dataBR(p.vencimento)} ${quem} — ${brl(p.valor)}</i>\n`;
    }
    if (receber.length > 5) corpo += `   <i>… e mais ${receber.length - 5}</i>\n`;
    const disponivel = entra + (caixa && !caixa.erro ? caixa.total : 0);
    const falta = precisa - disponivel;
    corpo +=
      falta > 0
        ? `⚠️ <b>Faltam ${brl(falta)}</b> para cobrir tudo.\n`
        : `✅ <b>Cobre</b>, com ${brl(-falta)} de sobra.\n`;
    corpo += `<i>Caixa + a receber − prioridades. Contas congeladas ficam de fora.</i>\n`;
  }
  if (!listarVencidas && vencidas.length) {
    corpo += `\n<i>Fora disto há ${vencidas.length} prioridade(s) já vencida(s), somando ${brl(total(vencidas))} — não entram na conta acima.</i>\n`;
  }
  corpo += `\n<i>Judicial, pessoal e FGTS não podem atrasar — atraso aqui não se resolve pagando depois.</i>`;

  const r = await enviarTelegram(cab + corpo, { canal: CANAL });
  return { enviou: !!r?.ok, qtd: paraListar.length, motivo: r?.ok ? undefined : r?.motivo };
}

/**
 * ALERTA DO DIA — prioridade que vence HOJE.
 *
 * A Adriana pediu os dois tempos: "semanalmente no telegram e no dia do
 * vencimento enviar o alerta". O semanal (enviarPrioridades) serve para
 * separar dinheiro com antecedencia; este aqui e o ultimo aviso, no dia, e sai
 * como mensagem PROPRIA em vez de uma secao dentro da lista do dia — quem tem
 * 15 contas vencendo nao ve um bloco no meio, ve o titulo.
 *
 * So envia quando ha prioridade vencendo hoje. Dia sem prioridade nao gera
 * mensagem: alerta que toca todo dia deixa de ser alerta.
 */
export async function enviarPrioridadesDoDia(dataRef?: string): Promise<{ enviou: boolean; qtd: number; motivo?: string }> {
  if (!vobiBaixaConfigurada()) return { enviou: false, qtd: 0, motivo: "sem credenciais da Vobi" };
  // dataRef existe para teste e para responder "o que vence no dia X";
  // sem ela, e hoje no fuso de Sao Paulo.
  const hoje = dataRef ? new Date(dataRef + "T12:00:00Z") : hojeSP();
  const hojeIso = dataRef || iso(hoje);

  let doDia: ParcelaAberta[];
  try {
    doDia = await vencimentosNoPeriodo(hojeIso, hojeIso);
  } catch (e: any) {
    return await avisarFalhaVobi(e, "o alerta de prioridades de hoje");
  }
  const { porTipo, prioritarias } = separarPrioridades(doDia);
  if (!prioritarias.length) return { enviou: false, qtd: 0, motivo: "nenhuma prioridade vence hoje" };

  let corpo = `🚨 <b>VENCE HOJE — NÃO PODE ATRASAR</b>\n<i>${DIA_SEMANA[hoje.getUTCDay()]}, ${dataBR(hojeIso)}</i>\n\n`;
  for (const tipo of ORDEM) {
    const doTipo = porTipo.get(tipo);
    if (!doTipo?.length) continue;
    corpo += `<b>${ROTULO[tipo]}</b>\n`;
    for (const p of doTipo) {
      const quem = p.fornecedor ? escTg(p.fornecedor) : escTg(p.descricao.slice(0, 38));
      corpo += `   ${quem} — <b>${brl(p.valor)}</b>\n`;
    }
  }
  corpo += `\n<b>Total de hoje: ${brl(total(prioritarias))}</b>\n`;
  const caixaHoje = await caixaDisponivel().catch(() => null);
  if (caixaHoje && !caixaHoje.erro) {
    corpo += `Em caixa: <b>${brl(caixaHoje.total)}</b> <i>(${caixaHoje.contas.map((c) => `${escTg(c.nome)} ${brl(c.saldo)}`).join(" · ")})</i>\n`;
  }

  // as entradas dos proximos 7 dias, que e o que ela olha para decidir se paga
  try {
    const entra = (await recebimentosNoPeriodo(hojeIso, iso(somarDias(hoje, 7)))).filter(ehEntradaDeCaixa);
    if (entra.length) {
      corpo += `Previsto entrar em 7 dias: ${brl(total(entra))}\n`;
      for (const p of entra.slice(0, 4)) {
        const quem = p.fornecedor ? escTg(p.fornecedor) : escTg(p.descricao.slice(0, 30));
        corpo += `   <i>${dataBR(p.vencimento)} ${quem} — ${brl(p.valor)}</i>\n`;
      }
    } else {
      corpo += `<i>Nada previsto para entrar nos próximos 7 dias.</i>\n`;
    }
  } catch {
    corpo += `<i>(não consegui consultar as entradas agora)</i>\n`;
  }

  const teclado = {
    inline_keyboard: prioritarias.slice(0, 8).map((p) => [{
      text: `✅ Paguei: ${(p.fornecedor || p.descricao).slice(0, 24)} · ${brl(p.valor)}`.slice(0, 60),
      callback_data: `fbpago:${p.id}`,
    }]),
  };
  const r = await enviarTelegram(corpo, { canal: CANAL, teclado });
  return { enviou: !!r?.ok, qtd: prioritarias.length, motivo: r?.ok ? undefined : r?.motivo };
}

/**
 * Chamada única do cron diário: manda o do dia sempre e, se for segunda-feira,
 * manda também a agenda da semana e as prioridades dos próximos 30 dias.
 */
export async function enviarLembretesFinanceiros(): Promise<{ alerta?: any; dia: any; semana?: any; prioridades?: any }> {
  // o alerta do dia sai ANTES da lista geral: e o que nao pode passar batido
  const alerta = await enviarPrioridadesDoDia();
  const dia = await enviarVencimentosDoDia();
  const ehSegunda = hojeSP().getUTCDay() === 1;
  if (!ehSegunda) return { alerta, dia };
  const semana = await enviarVencimentosDaSemana();
  const prioridades = await enviarPrioridades(30);
  return { alerta, dia, semana, prioridades };
}
