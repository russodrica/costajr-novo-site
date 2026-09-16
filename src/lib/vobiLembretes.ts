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
import { vencimentosNoPeriodo, vobiBaixaConfigurada, type ParcelaAberta } from "./vobiBaixa";

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
  return `• ${data}${quem}${desc}\n   ${brl(p.valor)}`;
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

/** LEMBRETE DIÁRIO — o que vence hoje. */
export async function enviarVencimentosDoDia(): Promise<{ enviou: boolean; qtd: number; motivo?: string }> {
  if (!vobiBaixaConfigurada()) return { enviou: false, qtd: 0, motivo: "sem credenciais da Vobi" };
  const hoje = hojeSP();
  const hojeIso = iso(hoje);

  let lista: ParcelaAberta[];
  try {
    lista = await vencimentosNoPeriodo(hojeIso, hojeIso);
  } catch (e: any) {
    return { enviou: false, qtd: 0, motivo: `falha ao consultar a Vobi: ${e?.message || e}` };
  }

  const dia = DIA_SEMANA[hoje.getUTCDay()];
  const cab = `☀️ <b>Bom dia, Costa Júnior!</b>\n<i>${dia}, ${dataBR(hojeIso)}</i>\n\n`;

  const texto = lista.length
    ? cab +
      `💸 <b>Vence HOJE — ${lista.length} conta(s) · ${brl(total(lista))}</b>\n\n` +
      montarLista(lista, false) +
      `\n\n<i>Pagou alguma? Responda aqui com o valor e o fornecedor (ou mande o comprovante) que eu dou baixa na Vobi.</i>`
    : cab + `✅ <b>Nenhuma conta vence hoje.</b>`;

  const r = await enviarTelegram(texto, { canal: CANAL });
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
    return { enviou: false, qtd: 0, motivo: `falha ao consultar a Vobi: ${e?.message || e}` };
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
 * Chamada única do cron diário: manda o do dia sempre e, se for segunda-feira,
 * manda também a agenda da semana.
 */
export async function enviarLembretesFinanceiros(): Promise<{ dia: any; semana?: any }> {
  const dia = await enviarVencimentosDoDia();
  const ehSegunda = hojeSP().getUTCDay() === 1;
  if (!ehSegunda) return { dia };
  const semana = await enviarVencimentosDaSemana();
  return { dia, semana };
}
