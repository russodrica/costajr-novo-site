// Parser leve de arquivos OFX (extrato bancário) — sem dependência externa.
// OFX é SGML: tags frequentemente NÃO são fechadas (<MEMO>texto direto na linha).
// Estratégia: extrair blocos <STMTTRN>…</STMTTRN> (tolerante a fechamento ausente)
// e ler cada campo até o próximo "<" ou quebra de linha.

export interface OfxTransacao {
  fitid: string;
  data: string; // YYYY-MM-DD
  valor: number; // positivo = crédito, negativo = débito
  descricao: string;
}

export interface OfxResultado {
  conta: string;
  transacoes: OfxTransacao[];
}

/** Lê o valor de uma tag SGML: tudo após <TAG> até o próximo "<" ou fim de linha. */
function campo(bloco: string, tag: string): string {
  const m = bloco.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

/** TRNAMT pode vir "1234.56", "-1234,56" ou "1.234,56" (padrão BR). */
function parseValor(bruto: string): number {
  let t = bruto.trim().replace(/\s/g, "");
  if (t.includes(",") && t.includes(".")) {
    // formato BR com milhar: 1.234,56 → 1234.56
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(",", ".");
  }
  return parseFloat(t);
}

/** DTPOSTED vem como YYYYMMDD[HHMMSS[.XXX][TZ]] — só os 8 primeiros dígitos importam. */
function parseData(bruto: string): string | null {
  const m = bruto.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  const mn = Number(mes), dn = Number(dia);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return null;
  return `${ano}-${mes}-${dia}`;
}

/**
 * Parseia o texto de um arquivo OFX e retorna a conta (BANKID/ACCTID)
 * e as transações encontradas. Aceita a string como vier (qualquer encoding
 * já decodificado pelo chamador).
 */
export function parseOfx(texto: string): OfxResultado {
  const bankid = campo(texto, "BANKID");
  const acctid = campo(texto, "ACCTID");
  const conta = [bankid, acctid].filter(Boolean).join(" / ");

  // Cada bloco vai de <STMTTRN> até </STMTTRN>, o próximo <STMTTRN>,
  // o fim da lista ou o fim do arquivo (tolerante a tags não fechadas).
  const blocos = texto.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];

  const transacoes: OfxTransacao[] = [];
  for (const b of blocos) {
    const fitid = campo(b, "FITID");
    const data = parseData(campo(b, "DTPOSTED"));
    const valor = parseValor(campo(b, "TRNAMT"));
    if (!fitid || !data || !Number.isFinite(valor)) continue;
    const descricao = campo(b, "MEMO") || campo(b, "NAME") || "(sem descrição)";
    transacoes.push({ fitid, data, valor, descricao });
  }

  return { conta, transacoes };
}
