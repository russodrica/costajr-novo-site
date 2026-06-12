// Gera o PDF de um termo de responsabilidade (texto puro → A4 com cabeçalho CJR).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function gerarTermoPdf(conteudo: string, titulo = "Termo de Responsabilidade"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const margem = 56;
  const larguraUtil = A4[0] - margem * 2;
  const tamanho = 10.5;
  const altLinha = 15;

  let pagina = doc.addPage(A4);
  let y = A4[1] - margem;

  // Cabeçalho
  pagina.drawText("COSTA JÚNIOR ENGENHARIA E CONSTRUÇÕES", { x: margem, y, size: 13, font: fonteBold, color: rgb(0.77, 0.12, 0.23) });
  y -= 18;
  pagina.drawText(titulo, { x: margem, y, size: 10, font: fonte, color: rgb(0.35, 0.37, 0.42) });
  y -= 10;
  pagina.drawLine({ start: { x: margem, y }, end: { x: A4[0] - margem, y }, thickness: 1, color: rgb(0.77, 0.12, 0.23) });
  y -= 24;

  function novaPagina() {
    pagina = doc.addPage(A4);
    y = A4[1] - margem;
  }

  function quebrarLinha(texto: string): string[] {
    if (!texto) return [""];
    const palavras = texto.split(" ");
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) > larguraUtil) {
        if (atual) linhas.push(atual);
        atual = p;
      } else {
        atual = tentativa;
      }
    }
    linhas.push(atual);
    return linhas;
  }

  for (const linhaOriginal of conteudo.split("\n")) {
    const negrito = /^[A-ZÀ-Ú0-9 ():.,/-]+:?$/.test(linhaOriginal.trim()) && linhaOriginal.trim().length > 3;
    for (const linha of quebrarLinha(linhaOriginal)) {
      if (y < margem + altLinha) novaPagina();
      pagina.drawText(linha, { x: margem, y, size: tamanho, font: negrito ? fonteBold : fonte, color: rgb(0.12, 0.13, 0.16) });
      y -= altLinha;
    }
  }

  return doc.save();
}
