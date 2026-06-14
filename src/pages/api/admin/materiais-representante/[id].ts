import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { atualizarMaterial } from "~/lib/manut/representantes";
import { excluirComLixeira, registrarAcao } from "~/lib/auditoria";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = String(params.id);
    const body = await request.json();
    const m = await atualizarMaterial(id, body);
    const db = supabaseAdmin();
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "manut_representantes_materiais", registro_id: id,
      descricao: `Editou material do representante "${m?.titulo ?? id}"`, dados: body,
    });
    return jsonOk(m);
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = String(params.id);
    const db = supabaseAdmin();
    const { data: mat } = await db
      .from("manut_representantes_materiais")
      .select("titulo")
      .eq("id", id)
      .maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_representantes_materiais", id, idCol: "id",
      entidade: "manut_representantes_materiais",
      descricao: mat ? `Excluiu material do representante "${mat.titulo}"` : `Excluiu material do representante ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    const code = e.message === "Não autenticado" ? 401 : 400;
    return jsonErr(code, e.message);
  }
};
