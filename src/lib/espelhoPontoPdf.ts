import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Espelho de ponto MENSAL de UM colaborador, gerado a partir da apuração da
// ControliD (RHiD). Uma linha por dia do mês, com os horários batidos, o total
// do dia e a marcação de falta / saída não registrada. Fecha com o total do mês.
//
// Observação importante que aparece no rodapé do PDF: este documento é um
// espelho gerado pelo Portal a partir dos dados da ControliD — não substitui
// o relatório oficial do sistema de ponto para fins de fiscalização.

export type DiaEspelho = {
  data: string;        // YYYY-MM-DD
  trabalhou: boolean;
  falta: boolean;
  horasMin: number;
  semSaida: boolean;
  batidas: string[];   // HH:MM
};

export type EspelhoArgs = {
  colaborador: string;
  cargo?: string | null;
  cpf?: string | null;
  admissao?: string | null;
  mesLabel: string;      // ex.: "Julho / 2026"
  anoMes: string;        // YYYY-MM
  empresa: string;
  geradoEm: string;
  dias: DiaEspelho[];
  logoBytes?: Uint8Array | null;
};

const BRAND = rgb(0.77, 0.12, 0.23);
const INK = rgb(0.18, 0.18, 0.21);
const CINZA = rgb(0.42, 0.45, 0.5);
const VERM = rgb(0.79, 0.11, 0.16);
const LARANJA = rgb(0.85, 0.47, 0.05);
const LINHA = rgb(0.9, 0.91, 0.93);
const ZEBRA = rgb(0.975, 0.98, 0.985);

// pdf-lib (WinAnsi) não codifica emoji/alguns Unicode — sanitiza.
const SAFE: Record<string, string> = { "—": "-", "–": "-", "•": "-", "’": "'", "“": '"', "”": '"', "…": "...", "º": "o", "ª": "a" };
function san(s: any): string {
  return [...String(s ?? "")].map((c) => (c.codePointAt(0)! <= 0xff ? c : SAFE[c] ?? "")).join("").replace(/\s+/g, " ").trim();
}
const hhmm = (min: number) => `${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
const DIA_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

export async function gerarEspelhoPontoPdf(args: EspelhoArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 42;
  const W = A4[0];

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const txt = (s: string, x: number, size: number, f: PDFFont = font, color = INK, yy = y) =>
    page.drawText(san(s), { x, y: yy, size, font: f, color });

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  if (args.logoBytes) {
    try {
      const logo = await doc.embedPng(args.logoBytes);
      const h = 34; const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
      y -= h + 12;
    } catch { /* sem logo, segue */ }
  }
  txt("Espelho de Ponto", M, 18, bold, BRAND); y -= 22;
  txt(args.mesLabel, M, 13, bold); y -= 18;
  txt(args.empresa, M, 9.5, font, CINZA); y -= 20;

  // dados do colaborador
  const cxH = args.cargo || args.cpf || args.admissao ? 52 : 34;
  page.drawRectangle({ x: M, y: y - cxH, width: W - 2 * M, height: cxH, color: rgb(0.96, 0.97, 0.98) });
  txt(args.colaborador, M + 14, 12.5, bold, INK, y - 18);
  // separador visível: o san() colapsa espaços múltiplos, então " · " (0xB7, que o
  // WinAnsi codifica) mantém os campos distinguíveis
  const infos = [
    args.cargo ? `Cargo: ${args.cargo}` : "",
    args.cpf ? `CPF: ${args.cpf}` : "",
    args.admissao ? `Admissao: ${args.admissao}` : "",
  ].filter(Boolean).join(" \u00b7 ");
  if (infos) txt(infos, M + 14, 8.5, font, CINZA, y - 34);
  y -= cxH + 16;

  // ── Tabela ────────────────────────────────────────────────────────────────
  const COL = { dia: M, sem: M + 42, bat: M + 78, tot: W - M - 108, sit: W - M - 60 };
  const cabecalho = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: rgb(0.93, 0.94, 0.95) });
    txt("Dia", COL.dia + 4, 8, bold, INK, y - 11.5);
    txt("", COL.sem, 8, bold, INK, y - 11.5);
    txt("Batidas (entrada / saida)", COL.bat, 8, bold, INK, y - 11.5);
    txt("Total", COL.tot, 8, bold, INK, y - 11.5);
    txt("Situacao", COL.sit, 8, bold, INK, y - 11.5);
    y -= 16;
  };
  cabecalho();

  const novaPagina = () => { page = doc.addPage(A4); y = A4[1] - M; cabecalho(); };

  // percorre TODOS os dias do mês (inclusive os sem registro), para o espelho
  // não ter buraco e ficar fácil conferir contra a escala
  const [ano, mes] = args.anoMes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const porData = new Map(args.dias.map((d) => [d.data, d]));

  let totalMin = 0, totalFaltas = 0, totalSemSaida = 0, totalDias = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    if (y - 15 < M + 60) novaPagina();
    const iso = `${args.anoMes}-${String(dia).padStart(2, "0")}`;
    const d = porData.get(iso);
    const dow = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
    const fimDeSemana = dow === 0 || dow === 6;

    const alturaLinha = 15;
    if (dia % 2 === 0) page.drawRectangle({ x: M, y: y - alturaLinha, width: W - 2 * M, height: alturaLinha, color: ZEBRA });
    const yl = y - 10.5;

    txt(String(dia).padStart(2, "0"), COL.dia + 4, 8.5, font, fimDeSemana ? CINZA : INK, yl);
    txt(DIA_SEM[dow], COL.sem, 8, font, CINZA, yl);

    if (d && d.batidas.length) {
      // mostra em pares entrada-saida (07:58-12:01 | 13:02-17:05); horário ímpar
      // sobrando aparece sozinho, que é justamente o caso de "sem saida"
      const pares: string[] = [];
      for (let i = 0; i < d.batidas.length; i += 2) {
        pares.push(d.batidas[i + 1] ? `${d.batidas[i]}-${d.batidas[i + 1]}` : `${d.batidas[i]}-  ?  `);
      }
      txt(pares.join(" | "), COL.bat, 8.5, font, INK, yl);
      txt(hhmm(d.horasMin), COL.tot, 8.5, d.horasMin ? bold : font, INK, yl);
      totalMin += d.horasMin; totalDias++;
      if (d.semSaida) { txt("sem saida", COL.sit, 7.5, font, LARANJA, yl); totalSemSaida++; }
    } else if (d && d.falta) {
      txt("-", COL.bat, 8.5, font, CINZA, yl);
      txt("FALTA", COL.sit, 7.5, bold, VERM, yl);
      totalFaltas++;
    } else {
      txt("-", COL.bat, 8.5, font, CINZA, yl);
      if (fimDeSemana) txt("folga", COL.sit, 7.5, font, CINZA, yl);
    }
    page.drawLine({ start: { x: M, y: y - alturaLinha }, end: { x: W - M, y: y - alturaLinha }, thickness: 0.4, color: LINHA });
    y -= alturaLinha;
  }

  // ── Totais ────────────────────────────────────────────────────────────────
  if (y - 70 < M) { page = doc.addPage(A4); y = A4[1] - M; }
  y -= 12;
  page.drawRectangle({ x: M, y: y - 46, width: W - 2 * M, height: 46, color: rgb(0.96, 0.97, 0.98) });
  txt("Total do mes", M + 14, 9, font, CINZA, y - 16);
  txt(`${hhmm(totalMin)} h`, M + 14, 15, bold, INK, y - 34);
  txt("Dias com batida", M + 150, 9, font, CINZA, y - 16);
  txt(String(totalDias), M + 150, 15, bold, INK, y - 34);
  txt("Faltas", M + 270, 9, font, CINZA, y - 16);
  txt(String(totalFaltas), M + 270, 15, bold, totalFaltas ? VERM : INK, y - 34);
  txt("Sem saida", M + 350, 9, font, CINZA, y - 16);
  txt(String(totalSemSaida), M + 350, 15, bold, totalSemSaida ? LARANJA : INK, y - 34);
  y -= 46 + 22;

  // ── Assinaturas ───────────────────────────────────────────────────────────
  if (y - 60 < M) { page = doc.addPage(A4); y = A4[1] - M - 40; }
  const larg = (W - 2 * M - 30) / 2;
  page.drawLine({ start: { x: M, y }, end: { x: M + larg, y }, thickness: 0.6, color: CINZA });
  page.drawLine({ start: { x: M + larg + 30, y }, end: { x: W - M, y }, thickness: 0.6, color: CINZA });
  txt("Colaborador", M, 8, font, CINZA, y - 12);
  txt("Responsavel - Costa Junior", M + larg + 30, 8, font, CINZA, y - 12);
  y -= 34;

  txt(`Gerado pelo Portal CJR em ${args.geradoEm}, a partir dos registros da ControliD.`, M, 7.5, font, CINZA, y);
  txt("Documento de conferencia interna - nao substitui o relatorio oficial do sistema de ponto.", M, 7.5, font, CINZA, y - 10);

  return await doc.save();
}
