// ============================================================================
// Cliente da API D4Sign — assinatura eletrônica de contratos e termos.
// Docs: https://docapi.d4sign.com.br
//
// Configuração no .env:
//   D4SIGN_TOKEN=...          (menu Dev API no painel D4Sign)
//   D4SIGN_CRYPT_KEY=...      (opcional — só se habilitada na conta)
//   D4SIGN_BASE_URL=...       (opcional — default produção; sandbox:
//                              https://sandbox.d4sign.com.br/api/v1)
//   D4SIGN_COFRE_UUID=...     (opcional — uuid do cofre padrão p/ termos)
// ============================================================================

const BASE = import.meta.env.D4SIGN_BASE_URL || "https://secure.d4sign.com.br/api/v1";
const TOKEN = import.meta.env.D4SIGN_TOKEN || "";
const CRYPT = import.meta.env.D4SIGN_CRYPT_KEY || "";

export function d4signConfigurado(): boolean {
  return Boolean(TOKEN);
}

function qs(): string {
  const p = new URLSearchParams({ tokenAPI: TOKEN });
  if (CRYPT) p.set("cryptKey", CRYPT);
  return p.toString();
}

async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (!TOKEN) throw new Error("D4Sign não configurada: defina D4SIGN_TOKEN no ambiente (menu Dev API no painel da D4Sign).");
  const res = await fetch(`${BASE}${path}?${qs()}`, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.mensagem_pt || text?.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`D4Sign ${method} ${path}: ${msg}`);
  }
  return data as T;
}

// ─── Cofres ──────────────────────────────────────────────────────────────────

export interface D4Cofre { uuid_safe: string; "name-safe": string }

export async function listarCofres(): Promise<D4Cofre[]> {
  const data = await req<any>("GET", "/safes");
  return Array.isArray(data) ? data : data?.safes || [];
}

// ─── Documentos ──────────────────────────────────────────────────────────────

export interface D4Documento {
  uuidDoc: string;
  nameDoc: string;
  statusId: string;
  statusName: string;
  statusComment?: string;
  whoCanceled?: string;
}

/** Status: 1 Processando · 2 Aguardando Signatários · 3 Aguardando Assinaturas
 *  4 Finalizado · 5 Arquivado · 6 Cancelado · 7 Editando */
export const D4_STATUS: Record<string, string> = {
  "1": "Processando",
  "2": "Aguardando signatários",
  "3": "Aguardando assinaturas",
  "4": "Finalizado",
  "5": "Arquivado",
  "6": "Cancelado",
  "7": "Editando",
};

export async function listarDocumentos(uuidCofre?: string): Promise<D4Documento[]> {
  const path = uuidCofre ? `/documents/${uuidCofre}/safe` : "/documents";
  const data = await req<any>("GET", path);
  const lista = Array.isArray(data) ? data : data?.documents || [];
  // o primeiro item costuma ser um cabeçalho com totais quando vem da listagem geral
  return lista.filter((d: any) => d?.uuidDoc);
}

export async function obterDocumento(uuidDoc: string): Promise<D4Documento | null> {
  const data = await req<any>("GET", `/documents/${uuidDoc}`);
  const doc = Array.isArray(data) ? data[0] : data;
  return doc?.uuidDoc ? doc : null;
}

/** Sobe um PDF (base64) para um cofre. Retorna o uuid do documento. */
export async function uploadPdf(uuidCofre: string, nomeArquivo: string, pdfBase64: string): Promise<string> {
  const data = await req<any>("POST", `/documents/${uuidCofre}/uploadbinary`, {
    base64_binary_file: pdfBase64,
    mime_type: "application/pdf",
    name: nomeArquivo,
  });
  const uuid = data?.uuid || data?.uuidDoc;
  if (!uuid) throw new Error(`D4Sign: upload não retornou uuid (${JSON.stringify(data).slice(0, 200)})`);
  return uuid;
}

export interface D4Signatario {
  email: string;
  /** 1 = assinar · 5 = assinar como parte · ver docs para outros papéis */
  act?: string;
  nome?: string;
}

export async function criarListaSignatarios(uuidDoc: string, signatarios: D4Signatario[]): Promise<void> {
  await req("POST", `/documents/${uuidDoc}/createlist`, {
    signers: signatarios.map((s) => ({
      email: s.email,
      act: s.act || "1",
      foreign: "0",
      certificadoicpbr: "0",
      assinatura_presencial: "0",
      ...(s.nome ? { embed_methodauth: "email", user_name: s.nome } : {}),
    })),
  });
}

export async function enviarParaAssinatura(uuidDoc: string, mensagem?: string): Promise<void> {
  await req("POST", `/documents/${uuidDoc}/sendtosigner`, {
    message: mensagem || "Você tem um documento da Costa Júnior Engenharia para assinar.",
    skip_email: "0",
    workflow: "0",
  });
}

export async function cancelarDocumento(uuidDoc: string, comentario?: string): Promise<void> {
  await req("POST", `/documents/${uuidDoc}/cancel`, { comment: comentario || "" });
}

/** Registra um webhook para o documento (D4Sign faz POST na URL a cada evento). */
export async function registrarWebhook(uuidDoc: string, url: string): Promise<void> {
  await req("POST", `/documents/${uuidDoc}/webhooks`, { url });
}

/** Link para download do documento (zip ou pdf). */
export async function linkDownload(uuidDoc: string): Promise<string | null> {
  const data = await req<any>("POST", `/documents/${uuidDoc}/download`, { type: "PDF", language: "pt" });
  return data?.url || null;
}
