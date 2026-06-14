import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Gera o PDF da Ficha de EPI (A4 retrato) para impressão e assinatura.
export type EpiFichaItem = {
  epi: string; ca?: string | null; tamanho?: string | null;
  data_entrega?: string | null; data_validade?: string | null; data_devolucao?: string | null;
};
export type EpiFichaDados = {
  colaborador: string; cargo?: string | null; setor?: string | null; cpf?: string | null;
  tipo?: string; data_geracao: string; numero?: string | null; itens: EpiFichaItem[];
};

const BR = (d?: string | null) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

export async function gerarEpiFichaPdf(d: EpiFichaDados): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 42;
  const brand = rgb(0.77, 0.12, 0.23);
  const cinza = rgb(0.42, 0.45, 0.5);
  const tinta = rgb(0.12, 0.13, 0.16);

  let pagina = doc.addPage(A4);
  let y = A4[1] - M;
  const txt = (s: string, x: number, yy: number, size = 9, f = fonte, color = tinta) =>
    pagina.drawText(s ?? "", { x, y: yy, size, font: f, color });

  // Cabeçalho
  txt("COSTA JÚNIOR ENGENHARIA E CONSTRUÇÕES", M, y, 13, bold, brand); y -= 16;
  txt("FICHA DE CONTROLE E ENTREGA DE EPI" + (d.tipo === "reposicao" ? " — REPOSIÇÃO" : ""), M, y, 10, bold, tinta); y -= 12;
  pagina.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: brand }); y -= 18;

  // Dados do colaborador
  txt("Colaborador:", M, y, 9, bold); txt(d.colaborador || "", M + 62, y, 9);
  txt("Data:", A4[0] - M - 110, y, 9, bold); txt(BR(d.data_geracao), A4[0] - M - 80, y, 9); y -= 14;
  txt("Cargo:", M, y, 9, bold); txt(d.cargo || "—", M + 38, y, 9);
  txt("Setor:", M + 240, y, 9, bold); txt(d.setor || "—", M + 278, y, 9); y -= 14;
  if (d.cpf) { txt("CPF:", M, y, 9, bold); txt(d.cpf, M + 28, y, 9); y -= 14; }
  y -= 4;

  // Tabela
  const cols = [
    { t: "EPI", w: 130 }, { t: "CA", w: 55 }, { t: "Tam.", w: 38 },
    { t: "Entrega", w: 60 }, { t: "Validade", w: 60 }, { t: "Devolução", w: 62 }, { t: "Assinatura", w: 106 },
  ];
  const startX = M;
  const rowH = 26;
  // header
  let x = startX;
  pagina.drawRectangle({ x: startX, y: y - rowH + 8, width: cols.reduce((s, c) => s + c.w, 0), height: rowH, color: rgb(0.96, 0.97, 0.98) });
  for (const c of cols) { txt(c.t, x + 4, y - 8, 8.5, bold, cinza); x += c.w; }
  y -= rowH;
  // linhas
  for (const it of d.itens) {
    if (y < M + 80) { pagina = doc.addPage(A4); y = A4[1] - M; }
    x = startX;
    const vals = [it.epi || "", it.ca || "", it.tamanho || "", BR(it.data_entrega), BR(it.data_validade), BR(it.data_devolucao), ""];
    for (let i = 0; i < cols.length; i++) {
      pagina.drawRectangle({ x, y: y - rowH + 8, width: cols[i].w, height: rowH, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 0.7 });
      let v = vals[i];
      // corta texto que excede a coluna
      while (v && fonte.widthOfTextAtSize(v, 8.5) > cols[i].w - 8) v = v.slice(0, -1);
      txt(v, x + 4, y - 9, 8.5);
      x += cols[i].w;
    }
    y -= rowH;
  }
  y -= 18;

  // Termo + assinatura
  const termo = "Declaro ter recebido gratuitamente os Equipamentos de Proteção Individual (EPI) acima, devidamente orientado quanto ao uso correto, guarda e conservação, comprometendo-me a utilizá-los durante a jornada de trabalho e a devolvê-los quando solicitado.";
  const palavras = termo.split(" "); let linha = ""; const larg = A4[0] - M * 2;
  for (const p of palavras) {
    const t = linha ? `${linha} ${p}` : p;
    if (fonte.widthOfTextAtSize(t, 8.5) > larg) { txt(linha, M, y, 8.5, fonte, cinza); y -= 12; linha = p; } else linha = t;
  }
  if (linha) { txt(linha, M, y, 8.5, fonte, cinza); y -= 12; }
  y -= 36;
  pagina.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 0.8, color: tinta });
  pagina.drawLine({ start: { x: A4[0] - M - 200, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: tinta });
  txt("Assinatura do Colaborador", M, y - 12, 8, fonte, cinza);
  txt("Responsável — RH / Segurança do Trabalho", A4[0] - M - 200, y - 12, 8, fonte, cinza);

  return await doc.save();
}
