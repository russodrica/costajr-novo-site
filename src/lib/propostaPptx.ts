// Gera a Proposta Comercial em PowerPoint a partir do MODELO real da empresa
// (a última proposta fechada, clonada e ajustada — não é um formulário com
// campos genéricos). O modelo fica no Supabase Storage (bucket `comercial`,
// arquivo `templates/proposta-comercial-base.pptx`) — subido uma única vez
// pelo script `scripts/upload-template-proposta.mjs`.
//
// Técnica: o .pptx é um .zip de XML (Office Open XML). Em vez de reconstruir o
// slide do zero (o que perderia a marca/layout), abrimos o zip com JSZip e
// trocamos só os trechos de texto conhecidos (<a:t>...</a:t>) dentro dos
// slides certos, e removemos as caixas amarelas "AJUSTAR" dos campos que já
// foram preenchidos — a mesma lógica testada e validada manualmente antes de
// entrar em produção (ver sessão de 30/07/2026).
import JSZip from "jszip";
import { supabaseAdmin } from "./supabase";
import { nomeCurtoCliente } from "./siglasClientes";

export const COMERCIAL_BUCKET = "comercial";
const TEMPLATE_PATH = "templates/proposta-comercial-base.pptx";

export type DadosProposta = {
  cliente: string;
  endereco: string;
  escopoCurto: string;
  escopoDetalhado?: string;
  prazoObraDias?: string; // ex.: "15" — se ausente, mantém o valor do modelo (10)
  prazoMobilizacaoDias?: string; // ex.: "5" — se ausente, mantém o valor do modelo (5)
  valor?: string; // texto livre, ex.: "VALOR ESTIMADO: R$ 38.500,00" — se ausente, mantém "CONFORME NEGOCIAÇÃO"
  codigo?: string; // código do orçamento, pro nome do arquivo
};

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Remove um <p:sp>...</p:sp> inteiro cujo <p:cNvPr .../> tenha name="NOME".
// Usado pra tirar o aviso amarelo "AJUSTAR" de campos que já foram preenchidos.
function removerShapePorNome(xml: string, nome: string): string {
  const marcador = `name="${nome}"`;
  const idxNome = xml.indexOf(marcador);
  if (idxNome === -1) return xml;
  const idxSpAbre = xml.lastIndexOf("<p:sp>", idxNome);
  const idxSpFecha = xml.indexOf("</p:sp>", idxNome);
  if (idxSpAbre === -1 || idxSpFecha === -1) return xml;
  return xml.slice(0, idxSpAbre) + xml.slice(idxSpFecha + "</p:sp>".length);
}

let _templateCache: Buffer | null = null;
async function baixarTemplate(db: any): Promise<Buffer> {
  if (_templateCache) return _templateCache;
  const { data, error } = await db.storage.from(COMERCIAL_BUCKET).download(TEMPLATE_PATH);
  if (error || !data) throw new Error(`Não consegui baixar o modelo da proposta (${error?.message || "não encontrado"}).`);
  const arrayBuf = await data.arrayBuffer();
  _templateCache = Buffer.from(arrayBuf);
  return _templateCache;
}

export async function gerarPropostaPptx(dados: DadosProposta): Promise<{ buffer: Buffer; nomeArquivo: string; pendencias: string[] }> {
  const db = supabaseAdmin();
  const templateBuf = await baixarTemplate(db);
  const zip = await JSZip.loadAsync(templateBuf);
  const pendencias: string[] = [];

  // ---- Slide 2 — Boas-vindas ----
  let s2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
  s2 = s2.replace(
    '<a:t> Troca do telhado do Cond. Francisca Miquelina, Localizado na rua Francisca Miquelina, 297 - Bela Vista, SP."</a:t>',
    `<a:t> ${xmlEscape(dados.escopoCurto)}, localizado(a) em ${xmlEscape(dados.endereco)}.</a:t>`
  );
  s2 = s2.replace("<a:t>Cliente</a:t>", `<a:t>${xmlEscape(dados.cliente)}</a:t>`);
  s2 = removerShapePorNome(s2, "Retângulo 1");
  s2 = removerShapePorNome(s2, "Retângulo 2");
  zip.file("ppt/slides/slide2.xml", s2);

  // ---- Slide 5 — Escopo ----
  let s5 = await zip.file("ppt/slides/slide5.xml")!.async("string");
  s5 = s5.replace(
    "<a:t>Corrigir pontos de infiltração provenientes do telhado.</a:t>",
    `<a:t>${xmlEscape(dados.escopoCurto)}</a:t>`
  );
  if (dados.escopoDetalhado) {
    const paragrafos = dados.escopoDetalhado
      .split("\n")
      .filter((l) => l.trim())
      .map((linha) => `<a:p><a:r><a:rPr lang="pt-BR" sz="1200"><a:latin typeface="Open Sans"/></a:rPr><a:t>${xmlEscape(linha)}</a:t></a:r></a:p>`)
      .join("");
    const novoShape = `<p:sp><p:nvSpPr><p:cNvPr id="9001" name="Escopo Detalhado (gerado)"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="338666" y="1800000"/><a:ext cx="3060700" cy="3600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragrafos}</p:txBody></p:sp>`;
    s5 = s5.replace("</p:spTree>", novoShape + "</p:spTree>");
    s5 = removerShapePorNome(s5, "Retângulo 6");
  } else {
    pendencias.push("Escopo detalhado (slide ESCOPO) — ainda marcado como AJUSTAR, ninguém informou o detalhamento.");
  }
  zip.file("ppt/slides/slide5.xml", s5);

  // ---- Slide 6 — Cronograma / Organograma ----
  let s6 = await zip.file("ppt/slides/slide6.xml")!.async("string");
  if (dados.prazoObraDias) {
    s6 = s6.replace("<a:t>OBRA: ATÉ 10 DIAS ÚTEIS</a:t>", `<a:t>OBRA: ATÉ ${xmlEscape(dados.prazoObraDias)} DIAS ÚTEIS</a:t>`);
  }
  if (dados.prazoMobilizacaoDias) {
    s6 = s6.replace("<a:t>MOBILIZAÇÃO: 5 DIAS ÚTEIS</a:t>", `<a:t>MOBILIZAÇÃO: ${xmlEscape(dados.prazoMobilizacaoDias)} DIAS ÚTEIS</a:t>`);
  }
  s6 = removerShapePorNome(s6, "Retângulo 1"); // cronograma foi ajustado (ou mantido no padrão, de qualquer forma é intencional)
  pendencias.push("Organograma da equipe (slide CRONOGRAMA) — ainda marcado como AJUSTAR, preencher com os nomes de quem vai tocar a obra.");
  zip.file("ppt/slides/slide6.xml", s6);

  // ---- Slide 7 — Remuneração ----
  if (dados.valor) {
    let s7 = await zip.file("ppt/slides/slide7.xml")!.async("string");
    s7 = s7.replace(
      "<a:t>À SER PAGO: CONFORME NEGOCIAÇÃO ENTRE AS PARTE</a:t>",
      `<a:t>${xmlEscape(dados.valor)}</a:t>`
    );
    zip.file("ppt/slides/slide7.xml", s7);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const cod = (dados.codigo || "S_COD").replace(/[^\w-]+/g, "_");
  // Sigla do cliente recorrente (CRF, STD, CHB, SFT) só no NOME do arquivo —
  // dentro dos slides o cliente continua por extenso, que é o que ele lê.
  const clienteArq = nomeCurtoCliente(dados.cliente).replace(/[^\w\sÀ-ÿ-]+/g, "").trim().replace(/\s+/g, "_");
  const escopoArq = dados.escopoCurto.replace(/[^\w\sÀ-ÿ-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 40);
  const nomeArquivo = `ORCAMENTO_${cod}_${clienteArq}_${escopoArq}_R00.pptx`;
  return { buffer, nomeArquivo, pendencias };
}
