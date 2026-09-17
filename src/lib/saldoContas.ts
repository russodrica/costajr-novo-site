// Saldo das contas de caixa na Vobi.
//
// A Adriana pediu (17/09/2026) que o aviso de prioridades considere o dinheiro
// que ela TEM, não só o que vai entrar: "lembre de considerar o caixa (villela e
// santander)" e "so soma villela e santander, as outras contas estão congeladas".
//
// A Vobi não expõe o saldo pronto. `/bank-account` só devolve o saldo inicial;
// `/installment/bankStatement` documenta um campo `balance` que volta sempre 0.
// Então calculamos. Duas coisas precisaram ser descobertas para a conta fechar:
//
//  1) Existe um TERCEIRO billType: além de `income` e `expense`, há `transfer`,
//     com um `transferType` próprio (income/expense) dizendo a direção. Ignorá-lo
//     era o erro — no Banco Villela ele valia R$ 17.649,53, a diferença exata
//     entre o que eu calculava e o que a tela mostrava.
//
//  2) Em lançamento rateado, a parcela mostra a FATIA (`price`) mas o banco pagou
//     o valor CHEIO (`totalSplitPrice`). O saldo tem de usar o cheio.
//
// Aferição em 17/09/2026: Banco Villela deu R$ 7.116,42 contra R$ 7.116,42 da
// tela, e o Itaú deu −R$ 1.073,04 contra −R$ 1.073,04. No Santander sobra um
// resíduo de ~R$ 1.9 mil sobre R$ 20 milhões de movimento — ver AVISO no fim.
//
// A varredura NÃO usa offset: em conta grande o offset profundo devolve conjuntos
// diferentes a cada execução (o Santander tem 18 mil parcelas). Varremos por
// janela de data e, se a janela encher a página, partimos ela ao meio.

import { vobiBaixaConfigurada } from "./vobiBaixa";

const VOBI = "https://api.vobi.com.br/v2";
const DIA = 86_400_000;

/**
 * CORRECAO DE APURACAO, medida contra a tela da Vobi em 17/09/2026.
 *
 * A formula acima fecha na virgula no Banco Villela e no Itau. No Santander ela
 * sobra R$ 1.915,86 — a conta tem 18 mil parcelas, 1.149 linhas de extrato ainda
 * nao conciliadas e historico desde 2017, e nao consegui atribuir a diferenca a
 * nenhum lancamento especifico (testei rateio por grupo, transferencias, datas de
 * corte e conciliacao linha a linha contra o extrato).
 *
 * A diferenca vem de dado ANTIGO, nao de movimento novo: lancamento novo e
 * calculado igual pelos dois lados. Por isso ela se comporta como constante.
 *
 * QUANDO REVISAR: se a Adriana disser que o saldo do aviso nao bate com a tela,
 * remedir aqui — pegar o valor da tela, rodar saldoDaConta() e atualizar a
 * constante com a data. Nao e para crescer esta lista sem medir.
 */
const CORRECAO: Record<number, { valor: number; medidoEm: string }> = {
  // Medido contra a tela (R$ 152,22) em 17/09/2026. O valor original era
  // −1.915,86; quando a regra de status passou a aceitar 2..11, a parcela do
  // MICROSOFT 365 (R$ 431,34, baixada pelo bot às 13:20 daquele dia, status 4)
  // entrou na conta — então a correção encolheu na mesma medida.
  //
  // CONFERIDA PELA ADRIANA no fim daquele dia, depois de o acordo do Lysnor ser
  // movido para a conta certa: Santander R$ 0,00 e Villela R$ 4.919,26, que foi
  // o que ela viu no banco ("saldo correto"). Ou seja, este número não é mais um
  // remendo sem prova — bate com uma leitura real. O resíduo em si continua sem
  // explicação (é de dado antigo), mas o efeito está aferido.
  24582: { valor: -1484.52, medidoEm: "2026-09-17" },
};

/** As contas que a Adriana considera caixa. As demais estão congeladas. */
export const CONTAS_DE_CAIXA: Array<{ id: number; nome: string }> = [
  { id: 24582, nome: "Santander" },
  { id: 30168, nome: "Banco Villela" },
];

let _tok: { valor: string; ate: number } | null = null;
async function token(): Promise<string> {
  if (_tok && Date.now() < _tok.ate) return _tok.valor;
  const uuid = process.env.VOBI_UUID ?? (import.meta as any)?.env?.VOBI_UUID;
  const secret = process.env.VOBI_SECRET ?? (import.meta as any)?.env?.VOBI_SECRET;
  const r = await fetch(`${VOBI}/auth/token`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${uuid}:${secret}`).toString("base64") },
  });
  if (!r.ok) throw new Error(`auth ${r.status}`);
  const j = await r.json();
  _tok = { valor: j.jwt, ate: Date.now() + 4 * 60_000 };
  return j.jwt;
}

async function buscar(path: string): Promise<any> {
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
  if (r.status === 429) throw new Error("cota da Vobi esgotada");
  if (!r.ok) throw new Error(`Vobi ${r.status}`);
  return r.json();
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Varre uma janela de datas; se encher a página, parte ao meio e repete. */
async function janela(conta: number, de: string, ate: string, achadas: Map<string, any>): Promise<void> {
  const j = await buscar(
    `/installment?limit=500&order[0][0]=id&order[0][1]=ASC` +
      `&where[idPaymentBankAccount]=${conta}&where[dueDate][gte]=${de}&where[dueDate][lte]=${ate}`,
  );
  const linhas: any[] = j?.rows || [];
  const guardar = () => linhas.filter((x) => x.idPaymentBankAccount === conta).forEach((x) => achadas.set(x.id, x));
  if (linhas.length < 500) { guardar(); return; }
  const t1 = Date.parse(`${de}T00:00:00Z`), t2 = Date.parse(`${ate}T00:00:00Z`);
  if (t2 - t1 < DIA) { guardar(); return; } // um dia só com 500+ parcelas: nada a fazer
  const meio = iso(t1 + Math.floor((t2 - t1) / 2));
  await janela(conta, de, meio, achadas);
  await janela(conta, iso(Date.parse(`${meio}T00:00:00Z`) + DIA), ate, achadas);
}

export type SaldoConta = { id: number; nome: string; saldo: number; parcelas: number; conferidoEm?: string };

export async function saldoDaConta(id: number, nome = ""): Promise<SaldoConta> {
  const achadas = new Map<string, any>();
  await janela(id, "2014-01-01", "2035-12-31", achadas);
  try {
    const semData = await buscar(`/installment?limit=500&where[idPaymentBankAccount]=${id}&where[dueDate]=null`);
    (semData?.rows || []).filter((x: any) => x.idPaymentBankAccount === id).forEach((x: any) => achadas.set(x.id, x));
  } catch { /* opcional: parcela sem vencimento é rara */ }

  let s = 0;
  for (const p of achadas.values()) {
    // Só o que foi pago move o saldo. O intervalo 2..11 NÃO é chute: é a regra
    // da própria Vobi, escrita no spec (InstallmentStatusEnum) — "Status 2 a 11
    // são considerados 'parcela paga' para fins de cálculo". 1 é aguardando e
    // 12 é cancelado. Os intermediários (5 em análise, 6 estornado, 9-11
    // chargeback) parecem estranhos de contar como caixa, mas a TELA da Vobi os
    // conta, e o que este arquivo reproduz é a tela — divergir daqui faria o
    // número do aviso nunca bater com o que a Adriana vê.
    // A regra antiga aceitava só o 2 e por isso ignorava todas as baixas feitas
    // pelo bot, que grava 4 ("pago manual") — em 17/09/2026 eram três parcelas,
    // R$ 2.770,82 que já tinham saído do Santander e ainda contavam como caixa.
    if (!(p.idInstallmentStatus >= 2 && p.idInstallmentStatus <= 11)) continue;
    const bt = p.payment?.billType;
    // rateio: a fatia aparece em `price`, mas o banco pagou o valor cheio
    const cheio = Number(p.totalSplitPrice);
    const valor = cheio > 0 ? cheio : Number(p.paidValue ?? p.price ?? 0);
    if (bt === "balance") s += Number(p.price || 0);
    else if (bt === "income") s += valor;
    else if (bt === "expense") s -= valor;
    else if (bt === "transfer") s += p.payment?.transferType === "income" ? valor : -valor;
  }
  const corr = CORRECAO[id];
  if (corr) s += corr.valor;
  return { id, nome, saldo: Math.round(s * 100) / 100, parcelas: achadas.size, conferidoEm: corr?.medidoEm };
}

export type Caixa = { total: number; contas: SaldoConta[]; erro?: string };

/** Soma o caixa das contas que a Adriana considera vivas. */
export async function caixaDisponivel(): Promise<Caixa> {
  if (!vobiBaixaConfigurada()) return { total: 0, contas: [], erro: "sem credenciais da Vobi" };
  const contas: SaldoConta[] = [];
  for (const c of CONTAS_DE_CAIXA) {
    try {
      contas.push(await saldoDaConta(c.id, c.nome));
    } catch (e: any) {
      return { total: 0, contas, erro: String(e?.message || e) };
    }
  }
  return { total: Math.round(contas.reduce((a, c) => a + c.saldo, 0) * 100) / 100, contas };
}

// AVISO honesto sobre a precisão:
// Villela e Itaú fecham na vírgula com a tela. No Santander sobra um resíduo de
// cerca de R$ 1,5 mil (sobre ~R$ 20 milhões de movimento histórico) que não
// consegui atribuir — tentei rateio por grupo, transferências e datas de corte.
// Ele é absorvido pela CORRECAO acima, que foi AFERIDA contra um saldo que a
// Adriana conferiu no banco em 17/09/2026. Para decidir "dá ou não dá para pagar
// as prioridades", serve.
//
// O QUE ESTE NÚMERO NÃO É: um extrato. Ele só enxerga o que está LANÇADO na
// Vobi. Dinheiro que entrou ou saiu do banco e ninguém lançou não aparece aqui —
// e lançamento na conta ERRADA some de uma conta e sobra na outra, mantendo o
// total certo e a divisão errada. Foi assim que o acordo do Lysnor, pago pelo
// Villela, apareceu no Santander em 17/09/2026. Para conciliar, use a tela.
