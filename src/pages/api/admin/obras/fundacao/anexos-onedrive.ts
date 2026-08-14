import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { garantirPasta, enviarArquivo, oneDriveConfigurado, diagnosticoOneDrive } from "../../../../../lib/onedrive";

export const prerender = false;
const MODULO = "obras";

// GET — diagnóstico: diz se as credenciais do OneDrive estão de pé.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    return jsonOk(await diagnosticoOneDrive());
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/obras/fundacao/anexos-onedrive
//   { fundacao_id, url, data?, numero?, responsavel? }
//
// Traz o PDF do relatório do sistema antigo e guarda no ONEDRIVE da empresa,
// numa pasta por obra. No portal fica o índice com o link.
//
// Quem baixa e quem envia é o servidor: o navegador não consegue ler arquivo de
// outro domínio para reenviar, e assim a importação não depende da máquina de
// quem está operando.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    if (!oneDriveConfigurado()) {
      return jsonErr(503, "OneDrive ainda não configurado no portal (faltam as credenciais do Microsoft 365).");
    }
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    const fundacao_id = String(b?.fundacao_id || "").trim();
    const url = String(b?.url || "").trim();
    if (!fundacao_id) return jsonErr(400, "Obra não informada.");
    if (!/^https?:\/\//i.test(url)) return jsonErr(400, "Endereço do arquivo inválido.");

    const { data: obra } = await db.from("obras_fundacao")
      .select("id, nome, status").eq("id", fundacao_id).maybeSingle();
    if (!obra) return jsonErr(404, "Obra não encontrada.");

    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.data || "")) ? String(b.data) : null;
    const numero = String(b?.numero || "").trim().slice(0, 30) || null;

    // repetiu a importação? devolve o que já está guardado
    if (data && numero) {
      const { data: ja } = await db.from("obras_fundacao_anexos")
        .select("id, web_url").eq("fundacao_id", fundacao_id)
        .eq("data", data).eq("numero", numero).maybeSingle();
      if (ja) return jsonOk({ id: ja.id, jaExistia: true, web_url: ja.web_url });
    }

    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; PortalCJR/1.0)", accept: "application/pdf,*/*" },
    });
    if (!r.ok) return jsonErr(502, `Origem respondeu HTTP ${r.status}.`);
    const bytes = new Uint8Array(await r.arrayBuffer());

    // "%PDF" no início: sem isso o que veio é página de erro ou de login
    const ehPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!ehPdf) {
      return jsonErr(422, `O endereço não devolveu um PDF (${bytes.byteLength} bytes, tipo "${r.headers.get("content-type") || "?"}").`);
    }

    // uma pasta por obra, dentro da pasta raiz configurada
    const raiz = process.env.MS_PASTA_RAIZ || "Portal CJR";
    const limpo = (t: string) => t.replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim();
    const pastaId = await garantirPasta(`${raiz}/Relatorios de Visita/${limpo(obra.nome)}`);

    const nomeArquivo = `${data || "sem-data"}_RV_${limpo(obra.nome)}${numero ? `_n${numero}` : ""}.pdf`;
    const arquivo = await enviarArquivo(pastaId, nomeArquivo, bytes);

    const { data: novo, error } = await db.from("obras_fundacao_anexos").insert({
      fundacao_id,
      tipo: "relatorio",
      data,
      numero,
      responsavel: String(b?.responsavel || "").trim().slice(0, 200) || null,
      armazenamento: "onedrive",
      web_url: arquivo.webUrl,
      item_id: arquivo.id,
      storage_path: null,
      nome_arquivo: arquivo.nome,
      tamanho: arquivo.tamanho,
      origem_link: String(b?.origem_link || "").slice(0, 500) || null,
      criado_por: admin.email || null,
    }).select("id").single();
    if (error) {
      console.error("[anexo-onedrive] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, `Arquivo enviado, mas não deu para registrar: ${error.message}`);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "obras_fundacao_anexos", registro_id: novo.id,
      descricao: `Histórico no OneDrive — ${obra.nome}${data ? ` ${data}` : ""}${numero ? ` (nº ${numero})` : ""}`,
    });

    return jsonOk({ id: novo.id, kb: Math.round(arquivo.tamanho / 1024), web_url: arquivo.webUrl }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
