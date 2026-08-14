import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import {
  climaValido, condicaoValida, empresaValida, limparOcorrencias,
  BUCKET_OBRAS, storageObras, garantirBucketObras,
} from "../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

/** Teto por foto e por relatório. O depósito é compartilhado com Documentos e
 *  Novos Negócios: uma importação sem limite derrubaria o portal inteiro. */
const MAX_FOTO_BYTES = 8 * 1024 * 1024;
const MAX_FOTOS = 60;

// POST /api/admin/obras/diario/importar
//
// Traz um relatório do app Diário de Obra para dentro do portal. O relatório
// entra COMO REGISTRO (pesquisável, imprime no padrão novo), marcado como
// `importado` — a tela o abre em somente leitura.
//
// As fotos chegam por URL e quem baixa é o SERVIDOR: o navegador não consegue
// ler imagem de outro domínio para reenviar (política de origem), e assim a
// importação não depende da máquina de quem está operando.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Envie os dados do relatório.");

    const fundacao_id = String(b.fundacao_id || "").trim();
    if (!fundacao_id) return jsonErr(400, "Obra de fundação não informada.");
    const { data: obra } = await db.from("obras_fundacao")
      .select("id, nome").eq("id", fundacao_id).maybeSingle();
    if (!obra) return jsonErr(404, "Obra de fundação não encontrada.");

    const data = String(b.data || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return jsonErr(400, "Data do relatório inválida.");
    const numero_origem = String(b.numero || "").trim().slice(0, 30) || null;

    // Já importado? Devolve o que existe — a importação pode ser repetida sem
    // medo de duplicar o histórico.
    const { data: ja } = await db.from("obras_rdo").select("id")
      .eq("fundacao_id", fundacao_id).eq("data", data).eq("origem", "importado")
      .eq("numero_origem", numero_origem ?? "").maybeSingle();
    if (ja) return jsonOk({ id: ja.id, jaExistia: true, fotos: 0 });

    const { data: novo, error } = await db.from("obras_rdo").insert({
      area: "fundacao",
      fundacao_id,
      obra_id: null,
      data,
      status: "publicado",
      publicado_em: new Date().toISOString(),
      origem: "importado",
      numero_origem,
      link_origem: String(b.link || "").slice(0, 500) || null,
      empresa: empresaValida(b.empresa || "consultoria"),
      responsavel: String(b.responsavel || "").trim().slice(0, 200) || null,
      clima_manha: climaValido(b.clima_manha),
      clima_tarde: climaValido(b.clima_tarde),
      condicao: condicaoValida(b.condicao),
      atividades: String(b.atividades || "").trim() || null,
      observacoes: String(b.observacoes || "").trim() || null,
      ocorrencias_itens: limparOcorrencias(b.ocorrencias),
      criado_por: admin.email || null,
    }).select("id").single();
    if (error) {
      console.error("[importar-rdo] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, `Não deu para importar: ${error.message}`);
    }

    // ── fotos ────────────────────────────────────────────────────────────────
    const fotos: { url: string; legenda?: string }[] = Array.isArray(b.fotos) ? b.fotos.slice(0, MAX_FOTOS) : [];
    let salvas = 0;
    const problemas: string[] = [];

    if (fotos.length) {
      const erroBucket = await garantirBucketObras();
      if (erroBucket) problemas.push(`depósito: ${erroBucket}`);
      else {
        for (const [i, f] of fotos.entries()) {
          const url = String(f?.url || "").trim();
          if (!/^https?:\/\//i.test(url)) continue;
          try {
            const r = await fetch(url);
            if (!r.ok) { problemas.push(`foto ${i + 1}: HTTP ${r.status}`); continue; }
            const tipo = r.headers.get("content-type") || "image/jpeg";
            if (!tipo.startsWith("image/")) { problemas.push(`foto ${i + 1}: não é imagem`); continue; }
            const buf = new Uint8Array(await r.arrayBuffer());
            if (buf.byteLength > MAX_FOTO_BYTES) { problemas.push(`foto ${i + 1}: ${Math.round(buf.byteLength / 1048576)} MB — grande demais`); continue; }

            const ext = (tipo.split("/")[1] || "jpg").replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
            const path = `rdo/${fundacao_id}/${novo.id}/imp-${i + 1}-${Date.now()}.${ext}`;
            const { error: eUp } = await storageObras().storage
              .from(BUCKET_OBRAS).upload(path, buf, { contentType: tipo, upsert: false });
            if (eUp) { problemas.push(`foto ${i + 1}: ${eUp.message}`); continue; }

            await db.from("obras_rdo_fotos").insert({
              rdo_id: novo.id,
              storage_path: path,
              nome_arquivo: `importada-${i + 1}.${ext}`,
              content_type: tipo,
              tamanho: buf.byteLength,
              legenda: String(f?.legenda || "").trim().slice(0, 300) || null,
              ordem: i,
              criado_por: admin.email || null,
            });
            salvas++;
          } catch (e: any) {
            problemas.push(`foto ${i + 1}: ${e?.message || "falhou"}`);
          }
        }
      }
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "obras_rdo", registro_id: novo.id,
      descricao: `Importado do Diário de Obra — ${obra.nome} ${data}${numero_origem ? ` (nº ${numero_origem})` : ""}`,
    });

    return jsonOk({ id: novo.id, fotos: salvas, problemas }, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
