// ============================================================================
// Leitura da Ficha/Termo de Entrega de EPI → atualiza os EPIs do colaborador.
// Quando a ficha é anexada (Telegram / Caixa de Entrada), lê os itens entregues
// (EPI + CA) de dentro do documento e faz upsert em epi_entregas, puxando o
// vencimento do CA conhecido (a validade do certificado é a mesma p/ qualquer
// pessoa, então reaproveita a já cadastrada; CA novo fica sem validade p/ definir).
// ============================================================================
import { EPI_CATALOGO } from "./epi";
import { gerarTextoLLM, lerDocumentoGemini, geminiConfigurado, extrairJson } from "./llm";

const normCA = (s: any) => String(s || "").replace(/[.\s]/g, "").trim();
const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function dataISO(s: any): string | null {
  const t = String(s || "");
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

async function textoDoDoc(buf: Buffer, ct: string, nome: string): Promise<string> {
  try {
    if (ct.includes("pdf") || /\.pdf$/i.test(nome)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text || "").replace(/\s+/g, " ").trim();
    }
  } catch { /* escaneado/sem texto */ }
  return "";
}

// Casa o nome extraído com o catálogo fixo (fuzzy leve por keyword).
export function casarEpi(nome: string): string {
  const n = semAcento(nome);
  for (const e of EPI_CATALOGO) { const en = semAcento(e); if (n.includes(en) || en.includes(n)) return e; }
  const kw: [string, string][] = [
    ["mascar", "Máscara respiratória"], ["respirad", "Máscara respiratória"], ["pff", "Máscara respiratória"],
    ["auric", "Protetor auricular"], ["abafador", "Protetor auricular"],
    ["oculos", "Óculos de proteção"], ["botina", "Botina"], ["bota", "Botina"], ["capacete", "Capacete"],
    ["solar", "Protetor solar"], ["raspa", "Luva de raspa"], ["vaqueta", "Luva de raspa"],
    ["borracha", "Luva de borracha"], ["quimic", "Luva de proteção química"], ["mecanic", "Luva de proteção mecânica"],
    ["pigment", "Luva pigmentada"], ["luva", "Luva pigmentada"], ["calca", "Calça"], ["camiseta", "Camiseta"],
  ];
  for (const [k, e] of kw) if (n.includes(k)) return e;
  return nome.trim();
}

export type ItemEpi = { epi: string; ca: string; data_entrega?: string | null };

// Lê os itens (EPI + CA + data) de dentro da ficha. Usa o texto do PDF quando há;
// senão, OCR via Gemini (se configurado). Sem texto e sem Gemini → retorna [].
export async function extrairItensEpi(buf: Buffer, ct: string, nome: string): Promise<ItemEpi[]> {
  const catalogo = EPI_CATALOGO.join("; ");
  const sys = `Você lê uma FICHA/TERMO DE ENTREGA DE EPI da Costa Júnior Engenharia e extrai os itens ENTREGUES. Para CADA item com número de CA, retorne: o EPI (mapeie para um destes nomes quando possível: ${catalogo}; se não casar, use o nome do documento), o número do CA (Certificado de Aprovação — APENAS dígitos) e a data de entrega se houver. Ignore linhas sem CA, cabeçalhos e assinaturas. Responda APENAS JSON: {"itens":[{"epi":"","ca":"","data_entrega":"AAAA-MM-DD ou vazio"}]}`;
  const texto = await textoDoDoc(buf, ct, nome);
  let raw: string | null = null;
  try {
    if (texto && texto.length > 40) {
      raw = await gerarTextoLLM(sys, [{ role: "user", content: "Documento:\n" + texto.slice(0, 7000) }]);
    } else if (geminiConfigurado() && (ct.includes("pdf") || ct.startsWith("image/"))) {
      raw = await lerDocumentoGemini(sys, "Extraia os itens de EPI entregues.", buf.toString("base64"), ct);
    }
  } catch { raw = null; }
  const o = raw ? extrairJson(raw) : null;
  const lista: ItemEpi[] = (o?.itens || [])
    .map((i: any) => ({ epi: String(i?.epi || "").trim(), ca: normCA(i?.ca), data_entrega: dataISO(i?.data_entrega) }))
    .filter((i: ItemEpi) => i.epi && i.ca && i.ca.length >= 3);
  // dedup por EPI casado (mantém o primeiro)
  const seen = new Set<string>(); const out: ItemEpi[] = [];
  for (const i of lista) { const k = casarEpi(i.epi).toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push({ ...i, epi: casarEpi(i.epi) }); }
  return out;
}

export type EpiAplicado = {
  epi: string; ca: string; validade: string | null; novoCA: boolean;
  antesCA?: string | null; antesValidade?: string | null; // p/ alertar troca suspeita (erro de leitura)
};

// Aplica a entrega: upsert em epi_entregas (1 por colaborador+epi). Vencimento = validade
// conhecida do CA (entrega mais recente com esse CA, de qualquer colaborador); CA novo → null.
// Se o CA lido for DIFERENTE do que já estava cadastrado p/ aquele EPI, devolve o CA anterior
// (antesCA) para avisar — pega erro de OCR que troca dígitos do CA num documento escaneado.
export async function aplicarEntregaEpiDaFicha(
  db: any, colaboradorId: string, buf: Buffer, ct: string, nome: string,
): Promise<EpiAplicado[]> {
  const itens = await extrairItensEpi(buf, ct, nome);
  if (!itens.length) return [];
  const hoje = new Date().toISOString().slice(0, 10);
  const aplicados: EpiAplicado[] = [];
  for (const it of itens) {
    // estado atual desse EPI (p/ detectar troca suspeita de CA)
    let antesCA: string | null = null, antesValidade: string | null = null;
    try {
      const { data: cur } = await db.from("epi_entregas")
        .select("ca, data_validade").eq("colaborador_id", colaboradorId).eq("epi", it.epi).limit(1);
      if (cur && cur[0]) { antesCA = normCA(cur[0].ca) || null; antesValidade = cur[0].data_validade || null; }
    } catch { /* sem registro anterior */ }
    // validade conhecida do CA novo
    let validade: string | null = null;
    try {
      const comPonto = it.ca.length > 3 ? `${it.ca.slice(0, -3)}.${it.ca.slice(-3)}` : it.ca;
      const { data: ja } = await db.from("epi_entregas")
        .select("data_validade").or(`ca.eq.${it.ca},ca.eq.${comPonto}`)
        .not("data_validade", "is", null).order("data_validade", { ascending: false }).limit(1);
      if (ja && ja[0]) validade = ja[0].data_validade;
    } catch { /* sem validade conhecida */ }
    await db.from("epi_entregas").upsert({
      colaborador_id: colaboradorId, epi: it.epi, ca: it.ca,
      data_entrega: it.data_entrega || hoje, data_validade: validade,
      status: "ativo", aviso_15: false, updated_at: new Date().toISOString(),
    }, { onConflict: "colaborador_id,epi" });
    const trocou = !!antesCA && antesCA !== it.ca;
    aplicados.push({ epi: it.epi, ca: it.ca, validade, novoCA: !validade, antesCA: trocou ? antesCA : null, antesValidade: trocou ? antesValidade : null });
  }
  return aplicados;
}
