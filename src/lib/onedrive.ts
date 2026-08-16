// OneDrive / SharePoint da empresa — envio de arquivos pelo Microsoft Graph.
//
// Por que existe: o depósito do portal (Supabase, 1 GB) já opera perto do
// limite com RH, documentos e negócios. O acervo de relatórios da fundação
// passa de 1 GB sozinho. O Microsoft 365 da empresa já é pago e tem espaço —
// então o arquivo mora lá e o portal guarda o índice e o link.
//
// A autenticação é de APLICATIVO (client credentials): o portal age como um
// serviço, sem depender de ninguém estar logado. As credenciais ficam nas
// variáveis de ambiente da Vercel:
//
//   MS_TENANT_ID      — ID do diretório (Entra ID)
//   MS_CLIENT_ID      — ID do aplicativo registrado
//   MS_CLIENT_SECRET  — segredo do aplicativo
//   MS_DRIVE_ID       — drive (biblioteca) de destino
//   MS_PASTA_RAIZ     — pasta dentro do drive (padrão: "Portal CJR")

const GRAPH = "https://graph.microsoft.com/v1.0";

export type ArquivoOneDrive = {
  id: string;
  nome: string;
  webUrl: string;
  tamanho: number;
};

export function oneDriveConfigurado(): boolean {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID &&
            process.env.MS_CLIENT_SECRET && process.env.MS_DRIVE_ID);
}

/** Token de aplicativo. Vale ~1h; guardamos em memória para não pedir um novo
 *  a cada arquivo — numa importação de mil relatórios isso seria mil pedidos. */
let cache: { token: string; expira: number } | null = null;

export async function tokenGraph(): Promise<string> {
  if (cache && cache.expira > Date.now() + 60_000) return cache.token;

  const tenant = process.env.MS_TENANT_ID!;
  const corpo = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: corpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`Microsoft recusou a autenticação: ${j.error_description || j.error || r.status}`);
  }
  cache = { token: j.access_token, expira: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cache.token;
}

/** Cria a pasta se não existir e devolve o id. Aceita caminho com barras
 *  ("Portal CJR/Fundação/OBRA X") — cria nível por nível.
 *
 *  Primeiro procura, só cria se não achou. Criar com "replace" quebra em
 *  biblioteca do SharePoint ("General exception while processing"): lá o
 *  Graph não aceita substituir uma pasta que já existe. */
export async function garantirPasta(caminho: string): Promise<string> {
  const token = await tokenGraph();
  const drive = process.env.MS_DRIVE_ID!;
  const partes = caminho.split("/").map((p) => p.trim()).filter(Boolean);
  const cab = { authorization: `Bearer ${token}` };

  let paiId = "root";
  let percorrido = "";
  for (const nome of partes) {
    percorrido = percorrido ? `${percorrido}/${nome}` : nome;

    // já existe?
    const rota = percorrido.split("/").map(encodeURIComponent).join("/");
    const busca = await fetch(`${GRAPH}/drives/${drive}/root:/${rota}`, { headers: cab });
    if (busca.ok) {
      const achado = await busca.json().catch(() => ({}));
      if (achado?.id) { paiId = achado.id; continue; }
    }

    const r = await fetch(`${GRAPH}/drives/${drive}/items/${paiId}/children`, {
      method: "POST",
      headers: { ...cab, "content-type": "application/json" },
      body: JSON.stringify({
        name: nome,
        folder: {},
        // corrida entre dois envios ao mesmo tempo: fica com a que já está lá
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.id) { paiId = j.id; continue; }

    // alguém criou no meio do caminho — procura de novo
    if (r.status === 409) {
      const denovo = await fetch(`${GRAPH}/drives/${drive}/root:/${rota}`, { headers: cab });
      const achado = await denovo.json().catch(() => ({}));
      if (denovo.ok && achado?.id) { paiId = achado.id; continue; }
    }
    throw new Error(`Não deu para preparar a pasta "${nome}": ${j.error?.message || r.status}`);
  }
  return paiId;
}

/** Envia o arquivo. Até 4 MB vai direto; acima disso usa sessão de upload,
 *  que é como o Graph aceita arquivo grande. */
export async function enviarArquivo(
  pastaId: string,
  nome: string,
  bytes: Uint8Array,
  contentType = "application/pdf",
): Promise<ArquivoOneDrive> {
  const token = await tokenGraph();
  const drive = process.env.MS_DRIVE_ID!;
  const nomeSeguro = nome.replace(/[\\/:*?"<>|#%]/g, "-").slice(0, 240);

  if (bytes.byteLength <= 4 * 1024 * 1024) {
    const r = await fetch(
      `${GRAPH}/drives/${drive}/items/${pastaId}:/${encodeURIComponent(nomeSeguro)}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": contentType }, body: bytes },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(`Envio recusado: ${j.error?.message || r.status}`);
    return { id: j.id, nome: j.name, webUrl: j.webUrl, tamanho: Number(j.size) || bytes.byteLength };
  }

  // arquivo grande: abre a sessão e manda em pedaços de 4 MB
  const rs = await fetch(
    `${GRAPH}/drives/${drive}/items/${pastaId}:/${encodeURIComponent(nomeSeguro)}:/createUploadSession`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    },
  );
  const sessao = await rs.json().catch(() => ({}));
  if (!rs.ok || !sessao.uploadUrl) throw new Error(`Não deu para abrir o envio: ${sessao.error?.message || rs.status}`);

  const PEDACO = 4 * 1024 * 1024;
  for (let ini = 0; ini < bytes.byteLength; ini += PEDACO) {
    const fim = Math.min(ini + PEDACO, bytes.byteLength) - 1;
    const parte = bytes.slice(ini, fim + 1);
    const rp = await fetch(sessao.uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(parte.byteLength),
        "content-range": `bytes ${ini}-${fim}/${bytes.byteLength}`,
      },
      body: parte,
    });
    if (rp.status === 200 || rp.status === 201) {
      const j = await rp.json().catch(() => ({}));
      return { id: j.id, nome: j.name, webUrl: j.webUrl, tamanho: Number(j.size) || bytes.byteLength };
    }
    if (rp.status !== 202) {
      const j = await rp.json().catch(() => ({}));
      throw new Error(`Pedaço recusado: ${j.error?.message || rp.status}`);
    }
  }
  throw new Error("O envio terminou sem confirmação da Microsoft.");
}

/** Teste de configuração: usado pela tela para dizer o que está faltando. */
export async function diagnosticoOneDrive(): Promise<{ ok: boolean; mensagem: string; pasta?: string }> {
  if (!oneDriveConfigurado()) {
    const faltando = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_DRIVE_ID"]
      .filter((v) => !process.env[v]);
    return { ok: false, mensagem: `Faltam as credenciais: ${faltando.join(", ")}.` };
  }
  try {
    const token = await tokenGraph();
    // a biblioteca responde? diz qual é, para conferir se é a certa
    const rd = await fetch(`${GRAPH}/drives/${process.env.MS_DRIVE_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const drive = await rd.json().catch(() => ({}));
    if (!rd.ok) {
      // as permissões do aplicativo, para saber se falta consentimento
      let escopos = "";
      try {
        const corpo = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        escopos = [corpo.roles?.join(" "), corpo.scp].filter(Boolean).join(" ") || "(nenhuma)";
      } catch { /* token opaco */ }
      return {
        ok: false,
        mensagem: `A biblioteca não respondeu (HTTP ${rd.status}${drive?.error?.code ? `, ${drive.error.code}` : ""}): ` +
          `${drive?.error?.message || "sem detalhe"}. Permissões do aplicativo: ${escopos || "não deu para ler"}.`,
      };
    }
    const raiz = process.env.MS_PASTA_RAIZ || "Portal CJR";
    const id = await garantirPasta(raiz);
    const onde = [drive?.owner?.user?.displayName || drive?.owner?.group?.displayName, drive?.name]
      .filter(Boolean).join(" / ");
    return { ok: true, mensagem: `OneDrive conectado — ${onde || "biblioteca"} › ${raiz}.`, pasta: id };
  } catch (e: any) {
    return { ok: false, mensagem: e?.message || "Falha ao conectar." };
  }
}
