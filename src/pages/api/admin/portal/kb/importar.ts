import type { APIRoute } from "astro";
import { supabaseAdmin } from "~/lib/supabase";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;

const TAMANHO_BLOCO = 1500;

function limparHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

/** Divide o texto em blocos de ~1500 caracteres respeitando fim de frase. */
function dividirBlocos(texto: string): string[] {
  const blocos: string[] = [];
  let resto = texto.replace(/\s+/g, " ").trim();
  while (resto.length > 0) {
    if (resto.length <= TAMANHO_BLOCO) { blocos.push(resto); break; }
    let corte = resto.lastIndexOf(". ", TAMANHO_BLOCO);
    if (corte < TAMANHO_BLOCO * 0.5) corte = resto.lastIndexOf(" ", TAMANHO_BLOCO);
    if (corte <= 0) corte = TAMANHO_BLOCO;
    blocos.push(resto.slice(0, corte + 1).trim());
    resto = resto.slice(corte + 1).trim();
  }
  return blocos.filter(b => b.length > 40);
}

// POST { titulo, categoria, access_roles?, url? | arquivo_base64? }
// Extrai o texto (PDF ou página web), divide em blocos e alimenta a portal_kb.
export const POST: APIRoute = async ({ request }) => {
  let claims;
  try { claims = await requireAdminCookie(request); }
  catch { return jsonErr(401, "Não autenticado."); }

  try {
    const { titulo, categoria, access_roles, url, arquivo_base64 } = await request.json();
    if (!titulo || !categoria) return jsonErr(400, "Informe título e categoria.");
    if (!url && !arquivo_base64) return jsonErr(400, "Envie um PDF ou informe uma URL.");

    let texto = "";
    let fonte = url || "upload";

    if (arquivo_base64) {
      const buf = Buffer.from(arquivo_base64, "base64");
      if (buf.length > 8 * 1024 * 1024) return jsonErr(400, "PDF muito grande (máx. 8MB). Hospede o arquivo e importe pela URL.");
      const { extractText } = await import("unpdf");
      const res = await extractText(new Uint8Array(buf), { mergePages: true });
      texto = String(res.text || "");
    } else {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (PortalCJR)" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) return jsonErr(400, `Não consegui acessar a URL (HTTP ${res.status}).`);
      const tipo = res.headers.get("content-type") || "";
      if (tipo.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
        const buf = Buffer.from(await res.arrayBuffer());
        const { extractText } = await import("unpdf");
        const r = await extractText(new Uint8Array(buf), { mergePages: true });
        texto = String(r.text || "");
      } else {
        texto = limparHtml(await res.text());
      }
    }

    texto = texto.trim();
    if (texto.length < 80) return jsonErr(400, "Não encontrei texto suficiente nesse conteúdo (PDFs escaneados/imagem não são suportados).");

    const blocos = dividirBlocos(texto);
    if (!blocos.length) return jsonErr(400, "O texto extraído ficou vazio após a limpeza.");

    const sb = supabaseAdmin();
    const linhas = blocos.map((b, i) => ({
      question: blocos.length > 1 ? `${titulo} (parte ${i + 1} de ${blocos.length})` : titulo,
      answer: b,
      category: categoria,
      access_roles: access_roles?.length ? access_roles : ["all"],
      created_by: claims.sub,
      source: fonte,
    }));

    // `source` pode não existir na tabela — tenta com e sem
    let { error } = await sb.from("portal_kb").insert(linhas);
    if (error && /source/.test(error.message)) {
      ({ error } = await sb.from("portal_kb").insert(linhas.map(({ source: _s, ...resto }) => resto)));
    }
    if (error) return jsonErr(500, error.message);

    await registrarAcao(sb, { req: request, admin: claims }, {
      acao: "criar",
      entidade: "portal_kb",
      registro_id: null,
      descricao: `Importou ${blocos.length} bloco(s) na base de conhecimento "${titulo}" (categoria ${categoria}) a partir de ${fonte}`,
      dados: { criados: blocos.length, atualizados: 0, titulo, categoria, fonte, caracteres: texto.length },
    });

    return jsonOk({ ok: true, blocos: blocos.length, caracteres: texto.length }, 201);
  } catch (e: any) {
    return jsonErr(500, `Falha na importação: ${e?.message || e}`);
  }
};
