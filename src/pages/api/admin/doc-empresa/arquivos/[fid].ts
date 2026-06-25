import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico", "comercial"]; // comercial = leitura (middleware barra mutação)

// GET /api/admin/doc-empresa/arquivos/[fid] → redireciona para URL assinada (10 min).
// Bucket PRIVADO — documentos sensíveis (LGPD).
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("storage_path").eq("id", params.fid!).maybeSingle();
    if (!arq?.storage_path) return jsonErr(404, "Arquivo não encontrado");
    const { data: assinada, error } = await db.storage.from("doc-empresa").createSignedUrl(arq.storage_path, 600);
    if (error || !assinada?.signedUrl) return jsonErr(500, error?.message || "Falha ao assinar URL");
    return new Response(null, { status: 302, headers: { location: assinada.signedUrl, "cache-control": "no-store" } });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/doc-empresa/arquivos/[fid] → arquiva/reativa uma VERSÃO do documento.
// Arquivar = mandar a versão antiga p/ o histórico (some do painel; só o vigente aparece).
// Reativar = trazer de volta. Não apaga nada — só alterna o flag (recuperável).
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json().catch(() => ({}));
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("id, nome, doc_id, storage_path, competencia").eq("id", params.fid!).maybeSingle();
    if (!arq) return jsonErr(404, "Arquivo não encontrado");

    // ── MOVER para outro documento (foi anexado no lugar errado) ──
    if (typeof b.doc_id === "string" && b.doc_id) {
      const destinoId = b.doc_id;
      if (destinoId === (arq as any).doc_id) return jsonErr(400, "O arquivo já está neste documento.");
      const { data: origem } = await db.from("doc_empresa").select("id, nome").eq("id", (arq as any).doc_id).maybeSingle();
      const { data: destino } = await db.from("doc_empresa").select("id, nome, categoria, arquivado").eq("id", destinoId).maybeSingle();
      if (!destino) return jsonErr(404, "Documento de destino não encontrado.");
      if ((destino as any).arquivado) return jsonErr(400, "O documento de destino está arquivado. Reative-o antes de mover arquivos para ele.");

      // Destino PERIÓDICO (organiza por competência/mês) + arquivo sem competência → entra no HISTÓRICO
      // do destino, para não "roubar" o slot do mês vigente. Lá a usuária define o mês via "Anexar".
      const CATS_PERIODICAS = ["Guias e Obrigações Fiscais", "Documentos Contábeis"];
      const destinoPeriodico = CATS_PERIODICAS.includes((destino as any).categoria || "");
      const semCompetencia = !((arq as any).competencia);

      // tenta mover o OBJETO no storage para a "pasta" do novo documento (storage_path = <doc_id>/<arquivo>).
      // Se o move falhar, mantém o caminho antigo (download continua válido) — a associação lógica é o que importa.
      const oldPath = String((arq as any).storage_path || "");
      const base = oldPath.includes("/") ? oldPath.slice(oldPath.lastIndexOf("/") + 1) : oldPath;
      const newPath = `${destinoId}/${base}`;
      const update: Record<string, any> = { doc_id: destinoId };
      if (destinoPeriodico && semCompetencia) { update.arquivado = true; update.arquivado_em = new Date().toISOString(); }
      let storageMovido = false;
      if (oldPath && base && newPath !== oldPath) {
        const { error: mvErr } = await db.storage.from("doc-empresa").move(oldPath, newPath);
        if (!mvErr) { update.storage_path = newPath; storageMovido = true; }
      }
      const { error } = await db.from("doc_empresa_arquivos").update(update).eq("id", params.fid!);
      if (error) return jsonErr(400, error.message);
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "doc_empresa_arquivos", registro_id: params.fid!,
        descricao: `Moveu o arquivo "${(arq as any).nome}" de "${(origem as any)?.nome || "?"}" para "${(destino as any).nome}"`,
        dados: { de: (arq as any).doc_id, para: destinoId, storage_movido: storageMovido, em_historico: !!update.arquivado },
      }).catch(() => {});
      return jsonOk({ ok: true, movido: true, doc_id: destinoId, arquivado: !!update.arquivado });
    }

    // ── ARQUIVAR / REATIVAR versão ──
    const arquivado = !!b.arquivado;
    const { error } = await db.from("doc_empresa_arquivos")
      .update({ arquivado, arquivado_em: arquivado ? new Date().toISOString() : null })
      .eq("id", params.fid!);
    if (error) return jsonErr(400, error.message);
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "doc_empresa_arquivos", registro_id: params.fid!,
      descricao: `${arquivado ? "Arquivou" : "Reativou"} a versão "${(arq as any).nome}"`,
    }).catch(() => {});
    return jsonOk({ ok: true, arquivado });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/doc-empresa/arquivos/[fid] → remove anexo (linha + arquivo do storage).
// Anexo de storage: só registrarAcao (sem lixeira) — convenção do projeto.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const db = supabaseAdmin();
    const { data: arq } = await db.from("doc_empresa_arquivos").select("*").eq("id", params.fid!).maybeSingle();
    if (!arq) return jsonErr(404, "Arquivo não encontrado");
    const { error } = await db.from("doc_empresa_arquivos").delete().eq("id", params.fid!);
    if (error) return jsonErr(400, error.message);
    await db.storage.from("doc-empresa").remove([arq.storage_path]).catch(() => {});
    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "doc_empresa_arquivos", registro_id: params.fid!,
      descricao: `Removeu o anexo "${arq.nome}"`, dados: arq,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
