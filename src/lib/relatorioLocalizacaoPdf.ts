import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

// Relatório mensal de LOCALIZAÇÃO das marcações de ponto (app/REP-P), para o RH.
// Capa com resumo + uma seção por colaborador: mapa com os pontos batidos +
// tabela (data/hora, coordenada, situação). Destaca batidas com GPS desligado.

export type MarcacaoPdf = { dataStr: string; lat: number; lng: number; temGps: boolean; gpsDesligado: boolean; suspeita: string };
export type PessoaPdf = { nome: string; marcacoes: MarcacaoPdf[]; mapaBytes: Uint8Array | null };
export type RelatorioArgs = {
  mesLabel: string; empresa: string; geradoEm: string;
  resumo: { pessoas: number; batidas: number; gpsDesligado: number };
  pessoas: PessoaPdf[];
  logoBytes?: Uint8Array | null;
};

const BRAND = rgb(0.77, 0.12, 0.23);
const INK = rgb(0.18, 0.18, 0.21);
const CINZA = rgb(0.42, 0.45, 0.5);
const VERM = rgb(0.79, 0.11, 0.16);
const FUNDO_ALERTA = rgb(0.99, 0.93, 0.93);

// pdf-lib (WinAnsi) não codifica emoji/alguns Unicode — sanitiza.
const SAFE: Record<string, string> = { "—": "-", "–": "-", "•": "-", "’": "'", "“": '"', "”": '"', "…": "...", "º": "o", "ª": "a" };
function san(s: any): string {
  return [...String(s ?? "")].map((c) => (c.codePointAt(0)! <= 0xff ? c : SAFE[c] ?? "")).join("").replace(/\s+/g, " ").trim();
}

export async function gerarRelatorioLocalizacaoPdf(args: RelatorioArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 42;
  const W = A4[0];

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const novaPagina = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const espaco = (n: number) => { if (y - n < M) novaPagina(); };
  const txt = (s: string, x: number, size: number, f: PDFFont = font, color = INK) => page.drawText(san(s), { x, y, size, font: f, color });

  // ── Capa ──────────────────────────────────────────────────────────────────
  let logo: PDFImage | null = null;
  if (args.logoBytes) { try { logo = await doc.embedPng(args.logoBytes); } catch { logo = null; } }
  if (logo) {
    const h = 40; const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: M, y: y - h, width: w, height: h }); y -= h + 14;
  }
  txt("Relatorio de Localizacao de Ponto", M, 18, bold, BRAND); y -= 24;
  txt(`Marcacoes via aplicativo (REP-P) - ${args.mesLabel}`, M, 12, bold); y -= 16;
  txt(args.empresa, M, 10, font, CINZA); y -= 13;
  txt(`Gerado em ${args.geradoEm}`, M, 9, font, CINZA); y -= 22;

  page.drawRectangle({ x: M, y: y - 56, width: W - 2 * M, height: 56, color: rgb(0.96, 0.97, 0.98) });
  txt(`${args.resumo.batidas} batidas`, M + 16, 16, bold, INK);
  page.drawText(`de ${args.resumo.pessoas} colaboradores`, { x: M + 16, y: y - 22, size: 9, font, color: CINZA });
  page.drawText(`${args.resumo.gpsDesligado}`, { x: W - M - 150, y, size: 16, font: bold, color: args.resumo.gpsDesligado ? VERM : INK });
  page.drawText("com GPS desligado", { x: W - M - 150, y: y - 22, size: 9, font, color: CINZA });
  y -= 56 + 10;
  txt("As batidas com GPS desligado (sem localizacao) estao destacadas em vermelho.", M, 8.5, font, CINZA); y -= 26;

  // ── Por colaborador ─────────────────────────────────────────────────────────
  for (const p of args.pessoas) {
    espaco(40);
    // faixa com o nome
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 22, color: BRAND });
    page.drawText(san(p.nome), { x: M + 10, y: y - 16, size: 11, font: bold, color: rgb(1, 1, 1) });
    const semGps = p.marcacoes.filter((m) => m.gpsDesligado).length;
    page.drawText(`${p.marcacoes.length} batidas${semGps ? ` - ${semGps} sem GPS` : ""}`, { x: W - M - 150, y: y - 16, size: 9, font, color: rgb(1, 1, 1) });
    y -= 22 + 10;

    // mapa
    if (p.mapaBytes) {
      try {
        const img = await doc.embedPng(p.mapaBytes);
        const w = 280; const h = (img.height / img.width) * w;
        espaco(h + 8);
        page.drawImage(img, { x: M, y: y - h, width: w, height: h });
        y -= h + 10;
      } catch { /* ignora mapa inválido */ }
    } else {
      txt("(mapa indisponivel - veja as coordenadas abaixo)", M, 8.5, font, CINZA); y -= 14;
    }

    // tabela
    const colData = M, colLoc = M + 130, colSit = W - M - 130;
    espaco(18);
    page.drawText("Data / Hora", { x: colData, y, size: 8.5, font: bold, color: CINZA });
    page.drawText("Localizacao (lat, lng)", { x: colLoc, y, size: 8.5, font: bold, color: CINZA });
    page.drawText("Situacao", { x: colSit, y, size: 8.5, font: bold, color: CINZA });
    y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.85, 0.86, 0.88) }); y -= 12;

    for (const m of p.marcacoes) {
      espaco(14);
      if (m.gpsDesligado) page.drawRectangle({ x: M - 3, y: y - 3, width: W - 2 * M + 6, height: 13, color: FUNDO_ALERTA });
      page.drawText(san(m.dataStr), { x: colData, y, size: 8.5, font, color: INK });
      page.drawText(m.temGps ? `${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}` : "-", { x: colLoc, y, size: 8.5, font, color: INK });
      const sit = m.gpsDesligado ? (m.suspeita || "GPS desligado") : "OK";
      page.drawText(san(sit), { x: colSit, y, size: 8.5, font: m.gpsDesligado ? bold : font, color: m.gpsDesligado ? VERM : rgb(0.13, 0.55, 0.27) });
      y -= 13;
    }
    y -= 16;
  }

  // rodapé em todas as páginas
  const paginas = doc.getPages();
  paginas.forEach((pg, i) => {
    pg.drawText(san(`Costa Junior Engenharia - Relatorio de localizacao de ponto - pag. ${i + 1}/${paginas.length}`),
      { x: M, y: 22, size: 7.5, font, color: CINZA });
  });

  return doc.save();
}
