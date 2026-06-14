import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Gera o PDF da Ficha de EPI no formato OFICIAL da Costa Júnior
// ("Controle de Entrega de Equipamento de Proteção Individual E.P.I."):
// logo + cabeçalho de dados + DECLARAÇÃO + Base Legal (NR1/NR6) + tabela de itens
// (SEM coluna de validade) + assinatura. A validade é controlada internamente no
// sistema (alertas), mas NÃO aparece no formulário impresso.
export type EpiFichaItem = {
  epi: string; ca?: string | null; tamanho?: string | null; quantidade?: string | number | null;
  data_entrega?: string | null; data_validade?: string | null; data_devolucao?: string | null;
};
export type EpiFichaDados = {
  colaborador: string; cargo?: string | null; setor?: string | null; cpf?: string | null;
  rg?: string | null; data_admissao?: string | null; data_demissao?: string | null;
  tipo?: string; data_geracao: string; numero?: string | null; itens: EpiFichaItem[];
  logoBytes?: Uint8Array | null;
};

const BR = (d?: string | null) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

// pdf-lib (Helvetica/WinAnsi) não codifica emoji nem alguns símbolos Unicode.
// Mantém Latin-1 (inclui acentos), troca pontuação comum e remove o resto.
const SAFE_EXTRA: Record<string, string> = { "—": "-", "–": "-", "•": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", "₂": "2" };
function san(s: any): string {
  return [...String(s ?? "")].map((ch) => {
    const cp = ch.codePointAt(0) || 0;
    if (cp <= 0xff) return ch;
    return SAFE_EXTRA[ch] ?? "";
  }).join("").replace(/\s+/g, " ").trim();
}

const DECLARACAO = "Declaro para todos os fins de direito que recebi gratuitamente, após orientação de uso e aplicação, os Equipamentos de Proteção Individual – EPIs abaixo descritos, os quais me comprometo a utilizar durante a realização de minhas atividades. Declaro ter ciência de que: a) Os EPIs deverão ser utilizados unicamente para a finalidade a qual se destinam; b) Qualquer alteração que os torne parcial ou totalmente inadequados para o uso deverá ser comunicado por mim; c) O não uso dos EPIs fornecidos pela empresa constitui ato faltoso sujeito às sanções disciplinares previstas na Legislação e no Regulamento Interno, aplicáveis ao assunto, inclusive a demissão por justa causa. Responsabilizar-me-ei, integralmente, pela guarda e conservação dos EPIs que me forem entregues. Em caso de perda, extravio ou inutilização proposital, comprometo-me a ressarcir a empresa conforme previsto no parágrafo 1º do Artigo 462 da CLT, inclusive no que couber a título de indenização por rescisão de contrato de trabalho, a importância correspondente ao valor do material.";

const NR1 = "NR 1 (Portaria MTb 3214 de 08/06/1978), item 1.8 — Cabe ao empregado: a) cumprir as disposições legais e regulamentares sobre segurança e medicina do trabalho, inclusive ordens de serviço; b) usar o EPI fornecido pelo empregador; c) submeter-se aos exames médicos previstos nas NRs; d) colaborar com a empresa na aplicação das NRs.";
const NR6 = "NR 6 (Portaria MTb 3214 de 08/06/1978), item 6.7.1 — Cabe ao empregado quanto ao EPI: a) utilizá-lo apenas para a finalidade a que se destina; b) responsabilizar-se pela guarda e conservação; c) comunicar ao empregador qualquer alteração que o torne impróprio para o uso; d) cumprir as determinações do empregador sobre o uso adequado.";

// quebra um texto em linhas que cabem na largura
function wrap(font: PDFFont, txt: string, size: number, maxW: number): string[] {
  const out: string[] = []; let linha = "";
  for (const p of txt.split(" ")) {
    const t = linha ? `${linha} ${p}` : p;
    if (font.widthOfTextAtSize(t, size) > maxW) { if (linha) out.push(linha); linha = p; } else linha = t;
  }
  if (linha) out.push(linha);
  return out;
}

export async function gerarEpiFichaPdf(d: EpiFichaDados): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 40;
  const brand = rgb(0.77, 0.12, 0.23);
  const cinza = rgb(0.42, 0.45, 0.5);
  const tinta = rgb(0.12, 0.13, 0.16);
  const linhaCor = rgb(0.8, 0.82, 0.86);
  const larg = A4[0] - M * 2;

  let pagina: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const txt = (s: string, x: number, yy: number, size = 9, f = fonte, color = tinta) =>
    pagina.drawText(san(s), { x, y: yy, size, font: f, color });
  const novaPaginaSePreciso = (alturaNecessaria: number) => {
    if (y - alturaNecessaria < M + 40) { pagina = doc.addPage(A4); y = A4[1] - M; }
  };

  // ── Cabeçalho: logo + título ──
  let logo: any = null;
  if (d.logoBytes && d.logoBytes.length) { try { logo = await doc.embedPng(d.logoBytes); } catch { logo = null; } }
  if (logo) {
    const lw = 96; const lh = (logo.height / logo.width) * lw;
    pagina.drawImage(logo, { x: M, y: y - lh + 4, width: lw, height: Math.min(lh, 42) });
  } else {
    txt("COSTA JÚNIOR", M, y - 8, 15, bold, brand);
    txt("ENGENHARIA E CONSTRUÇÕES", M, y - 20, 7, bold, cinza);
  }
  txt("Controle de Entrega de Equipamento de", A4[0] - M - 250, y - 6, 11, bold, tinta);
  txt("Proteção Individual E.P.I." + (d.tipo === "reposicao" ? "  (REPOSIÇÃO)" : ""), A4[0] - M - 250, y - 19, 11, bold, tinta);
  y -= 50;

  // ── Caixa de dados ──
  const boxTop = y;
  const rowH = 17;
  pagina.drawRectangle({ x: M, y: y - rowH * 2, width: larg, height: rowH * 2, borderColor: linhaCor, borderWidth: 0.8 });
  pagina.drawLine({ start: { x: M, y: y - rowH }, end: { x: M + larg, y: y - rowH }, thickness: 0.6, color: linhaCor });
  const c2 = M + larg * 0.6, c3 = M + larg * 0.8;
  pagina.drawLine({ start: { x: c2, y: boxTop }, end: { x: c2, y: boxTop - rowH * 2 }, thickness: 0.6, color: linhaCor });
  pagina.drawLine({ start: { x: c3, y: boxTop }, end: { x: c3, y: boxTop - rowH * 2 }, thickness: 0.6, color: linhaCor });
  txt("Nome: ", M + 4, y - 12, 9, bold); txt(d.colaborador || "", M + 38, y - 12, 9);
  txt("Data Admissão", c2 + 4, y - 12, 8, bold, cinza); txt(BR(d.data_admissao), c3 + 4, y - 12, 9);
  txt("Função: ", M + 4, y - 12 - rowH, 9, bold); txt(d.cargo || "—", M + 46, y - 12 - rowH, 9);
  txt("RG: ", c2 + 4, y - 12 - rowH, 8, bold, cinza); txt(d.rg || "—", c2 + 24, y - 12 - rowH, 9);
  y -= rowH * 2 + 14;

  // ── DECLARAÇÃO ──
  txt("DECLARAÇÃO", M, y, 9.5, bold, brand); y -= 13;
  for (const ln of wrap(fonte, DECLARACAO, 8.3, larg)) { novaPaginaSePreciso(12); txt(ln, M, y, 8.3, fonte, tinta); y -= 10.5; }
  y -= 8;

  // ── Base Legal ──
  txt("Base Legal", M, y, 9, bold, brand); y -= 12;
  for (const bloco of [NR1, NR6]) {
    for (const ln of wrap(fonte, bloco, 7.6, larg)) { novaPaginaSePreciso(11); txt(ln, M, y, 7.6, fonte, cinza); y -= 9.6; }
    y -= 4;
  }
  y -= 6;

  // ── Tabela de itens (SEM coluna de validade) ──
  const cols = [
    { t: "Quant.", w: 42 }, { t: "Descrição do EPI (Tipo, Material)", w: 184 }, { t: "Nº do CA", w: 56 },
    { t: "Data da Entrega", w: 72 }, { t: "Assinatura do Colaborador", w: 110 }, { t: "Data da Devolução", w: 51 },
  ];
  const tabW = cols.reduce((s, c) => s + c.w, 0);
  const linhaH = 24;
  const header = () => {
    let x = M;
    pagina.drawRectangle({ x: M, y: y - 16, width: tabW, height: 16, color: rgb(0.95, 0.96, 0.97) });
    for (const c of cols) {
      for (const ln of wrap(bold, c.t, 7.2, c.w - 6).slice(0, 2)) { txt(ln, x + 3, y - 11, 7.2, bold, cinza); }
      x += c.w;
    }
    y -= 16;
  };
  novaPaginaSePreciso(16 + linhaH * 2);
  header();
  const itens = d.itens && d.itens.length ? d.itens : [{ epi: "", ca: "", quantidade: "" }];
  for (const it of itens) {
    if (y - linhaH < M + 70) { pagina = doc.addPage(A4); y = A4[1] - M; header(); }
    let x = M;
    const qtd = it.quantidade != null && String(it.quantidade) !== "" ? String(it.quantidade) : (it.epi ? "01" : "");
    const vals = [qtd, it.epi || "", it.ca || "", BR(it.data_entrega) || BR(d.data_geracao), "", BR(it.data_devolucao)].map(san);
    for (let i = 0; i < cols.length; i++) {
      pagina.drawRectangle({ x, y: y - linhaH, width: cols[i].w, height: linhaH, borderColor: linhaCor, borderWidth: 0.7 });
      let v = vals[i];
      while (v && fonte.widthOfTextAtSize(v, 8) > cols[i].w - 6) v = v.slice(0, -1);
      txt(v, x + 3, y - 15, 8);
      x += cols[i].w;
    }
    y -= linhaH;
  }
  y -= 26;

  // ── Encerramento + assinatura ──
  novaPaginaSePreciso(70);
  for (const ln of wrap(fonte, "Finalmente, declaro que estou de acordo com todos os termos presentes, razão pela qual assumo, nesta data, por livre e espontânea vontade.", 8.3, larg)) { txt(ln, M, y, 8.3, fonte, tinta); y -= 11; }
  y -= 30;
  pagina.drawLine({ start: { x: M, y }, end: { x: M + 250, y }, thickness: 0.8, color: tinta });
  txt("Assinatura do Empregado", M, y - 12, 8, fonte, cinza);
  txt("Data: ___/___/______", M + 300, y - 12, 8.5, fonte, cinza);

  // ── Rodapé institucional ──
  txt("contato@costajr.com.br  ·  (11) 2369-6462 / (11) 4872-2377", M, M - 6, 7.5, fonte, cinza);
  txt("Av. Eng. Luís Carlos Berrini, 1140 - 7º andar - Brooklin - São Paulo/SP - CEP 04571-930", M, M - 16, 7.5, fonte, cinza);

  return await doc.save();
}
