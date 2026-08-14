import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { BUCKET_OBRAS, storageObras, garantirBucketObras } from "../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";
const MAX_PDF = 25 * 1024 * 1024;

// POST /api/admin/obras/fundacao/anexos
//   { fundacao_id, url, data?, numero?, titulo?, responsavel?, origem_link? }
//
// Guarda o PDF do relatório emitido no sistema anterior como ANEXO da obra.
// Quem baixa o arquivo é o SERVIDOR: o navegador não consegue ler um arquivo de
// outro domínio para reenviar, e assim a importação não depende da máquina de
// quem está operando.
//
// O arquivo entra como está. O portal não reescreve, não reimprime e não
// reabre: é histórico.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    const fundacao_id = String(b?.fundacao_id || "").trim();
    const url = String(b?.url || "").trim();
    if (!fundacao_id) return jsonErr(400, "Obra não informada.");
    if (!/^https?:\/\//i.test(url)) return jsonErr(400, "Endereço do arquivo inválido.");

    const { data: obra } = await db.from("obras_fundacao")
      .select("id, nome").eq("id", fundacao_id).maybeSingle();
    if (!obra) return jsonErr(404, "Obra não encontrada.");

    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.data || "")) ? String(b.data) : null;
    const numero = String(b?.numero || "").trim().slice(0, 30) || null;

    // repetiu a importação? devolve o que já está guardado
    if (data && numero) {
      const { data: ja } = await db.from("obras_fundacao_anexos")
        .select("id, tamanho").eq("fundacao_id", fundacao_id)
        .eq("data", data).eq("numero", numero).maybeSingle();
      if (ja) return jsonOk({ id: ja.id, jaExistia: true, kb: Math.round((ja.tamanho || 0) / 1024) });
    }

    const erroBucket = await garantirBucketObras();
    if (erroBucket) return jsonErr(500, `Depósito indisponível: ${erroBucket}`);

    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; PortalCJR/1.0)", accept: "application/pdf,*/*" },
    });
    if (!r.ok) return jsonErr(502, `Origem respondeu HTTP ${r.status}.`);
    const buf = new Uint8Array(await r.arrayBuffer());

    // "%PDF" no início: sem isso o que veio é página de erro ou de login
    const ehPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (!ehPdf) {
      return jsonErr(422, `O endereço não devolveu um PDF (${buf.byteLength} bytes, tipo "${r.headers.get("content-type") || "?"}").`);
    }
    if (buf.byteLength > MAX_PDF) return jsonErr(413, `PDF de ${Math.round(buf.byteLength / 1048576)} MB — acima do limite.`);

    const limpo = (t: string) => t.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
    const nome_arquivo = `${data || "sem-data"}_RV_${limpo(obra.nome)}${numero ? `_n${numero}` : ""}.pdf`;
    const path = `historico/${fundacao_id}/${data || "sem-data"}-${numero || Date.now()}.pdf`;

    const { error: eUp } = await storageObras().storage
      .from(BUCKET_OBRAS).upload(path, buf, { contentType: "application/pdf", upsert: true });
    if (eUp) return jsonErr(500, `Não deu para guardar: ${eUp.message}`);

    const { data: novo, error } = await db.from("obras_fundacao_anexos").insert({
      fundacao_id,
      tipo: "relatorio",
      data,
      numero,
      titulo: String(b?.titulo || "").trim().slice(0, 200) || null,
      responsavel: String(b?.responsavel || "").trim().slice(0, 200) || null,
      storage_path: path,
      nome_arquivo,
      tamanho: buf.byteLength,
      origem_link: String(b?.origem_link || "").slice(0, 500) || null,
      criado_por: admin.email || null,
    }).select("id, tamanho").single();
    if (error) {
      console.error("[anexo-fundacao] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, `Não deu para registrar: ${error.message}`);
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "obras_fundacao_anexos", registro_id: novo.id,
      descricao: `Histórico anexado — ${obra.nome}${data ? ` ${data}` : ""}${numero ? ` (nº ${numero})` : ""}`,
    });

    return jsonOk({ id: novo.id, kb: Math.round(buf.byteLength / 1024) }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
