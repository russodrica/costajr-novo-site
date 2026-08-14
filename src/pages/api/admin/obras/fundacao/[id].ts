import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import { statusObraValido } from "../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras";

// PATCH /api/admin/obras/fundacao/[id] — edita a obra da carteira de fundação.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("obras_fundacao").select("id, nome").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Obra não encontrada.");

    const b = await request.json().catch(() => null);
    if (!b) return jsonErr(400, "Envie o que alterar.");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const texto = (k: string, max: number) => {
      if (b[k] === undefined) return;
      patch[k] = String(b[k] ?? "").trim().slice(0, max) || null;
    };
    // nome e cliente sempre em maiúsculo — mesmo padrão do cadastro
    const maiusculo = (t: unknown, max: number) =>
      String(t ?? "").trim().slice(0, max).toLocaleUpperCase("pt-BR");

    if (b.nome !== undefined) {
      const nome = maiusculo(b.nome, 200);
      if (!nome) return jsonErr(400, "O nome da obra não pode ficar em branco.");
      patch.nome = nome;
    }
    if (b.cliente !== undefined) patch.cliente = maiusculo(b.cliente, 200) || null;
    texto("codigo", 60); texto("endereco", 300);
    texto("cidade", 120); texto("responsavel_nome", 200); texto("observacoes", 2000);
    if (b.uf !== undefined) patch.uf = String(b.uf ?? "").trim().toUpperCase().slice(0, 2) || null;
    if (b.status !== undefined) patch.status = statusObraValido(b.status);
    for (const d of ["data_inicio", "data_fim_prevista", "data_fim_real"]) {
      if (b[d] !== undefined) patch[d] = String(b[d] ?? "").slice(0, 10) || null;
    }

    const { error } = await db.from("obras_fundacao").update(patch).eq("id", id);
    if (error) {
      console.error("[obras_fundacao] update falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para salvar agora.");
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "obras_fundacao", registro_id: id,
      descricao: `Obra de fundação "${patch.nome || atual.nome}"`,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// DELETE /api/admin/obras/fundacao/[id]
// Obra com relatório de visita não é apagada: o relatório é registro do que
// foi visto em campo. Nesse caso o caminho é marcar a obra como concluída.
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();
    const id = params.id!;

    const { data: atual } = await db.from("obras_fundacao").select("id, nome").eq("id", id).maybeSingle();
    if (!atual) return jsonErr(404, "Obra não encontrada.");

    const { count } = await db.from("obras_rdo")
      .select("*", { count: "exact", head: true }).eq("fundacao_id", id);
    if (count) {
      return jsonErr(400, `Esta obra já tem ${count} relatório(s) de visita. Marque como concluída em vez de excluir.`);
    }

    const { error } = await db.from("obras_fundacao").delete().eq("id", id);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "excluir", entidade: "obras_fundacao", registro_id: id,
      descricao: `Obra de fundação "${atual.nome}"`,
    });
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
