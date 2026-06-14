import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { sincronizarLojasDoTecnico } from "../../../../lib/manut/tecnicos";
import { excluirComLixeira, registrarAcao } from "../../../../lib/auditoria";

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();
    // Nunca atualizar senha_hash via PATCH genérico
    delete body.senha_hash;
    delete body.senha;
    // lojas é gerenciado em tabela separada
    const lojas: string[] | undefined = Array.isArray(body.lojas) ? body.lojas : undefined;
    delete body.lojas;
    const db = supabaseAdmin();
    let data: any = null;
    if (Object.keys(body).length > 0) {
      const r = await db.from("manut_tecnicos").update(body).eq("id", id).select().single();
      if (r.error) return jsonErr(400, r.error.message);
      data = r.data;
      await registrarAcao(db, { req: request, admin }, { acao: "editar", entidade: "manut_tecnicos", registro_id: id, descricao: `Editou técnico "${data?.nome ?? id}"`, dados: body });
    } else {
      const r = await db.from("manut_tecnicos").select("*").eq("id", id).single();
      if (r.error) return jsonErr(400, r.error.message);
      data = r.data;
    }
    if (lojas) {
      await sincronizarLojasDoTecnico(id, lojas);
    }
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: tec } = await db.from("manut_tecnicos").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_tecnicos", id, idCol: "id", entidade: "manut_tecnicos",
      descricao: tec ? `Excluiu técnico "${tec.nome}"` : `Excluiu técnico ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (body.action !== "delete") return jsonErr(400, "Ação inválida");
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: tec } = await db.from("manut_tecnicos").select("nome").eq("id", id).maybeSingle();
    const r = await excluirComLixeira(db, { req: request, admin }, {
      tabela: "manut_tecnicos", id, idCol: "id", entidade: "manut_tecnicos",
      descricao: tec ? `Excluiu técnico "${tec.nome}"` : `Excluiu técnico ${id}`,
    });
    if (!r.ok) return jsonErr(400, r.error || "Falha ao excluir");
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
