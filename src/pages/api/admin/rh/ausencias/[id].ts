import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";

export const prerender = false;

// PATCH /api/admin/rh/ausencias/[id] — aprova/rejeita/conclui e edita demais campos
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "rh"); if (_ro) return _ro;
    const id = params.id!;
    const body = await request.json();

    const TIPOS = ["ferias", "atestado", "falta", "licenca", "folga", "outro"];
    const STATUS = ["solicitada", "aprovada", "rejeitada", "concluida"];
    if (body.tipo !== undefined && !TIPOS.includes(body.tipo)) return jsonErr(400, "Tipo de ausência inválido");
    if (body.status !== undefined && !STATUS.includes(body.status)) return jsonErr(400, "Status inválido");

    const editaveis = ["tipo", "data_inicio", "data_fim", "motivo", "status", "observacoes"];
    const patch: Record<string, unknown> = {};
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];

    // recalcula dias no servidor se as datas mudaram
    const db = supabaseAdmin();
    if (patch.data_inicio || patch.data_fim) {
      const { data: atual } = await db.from("rh_ausencias").select("data_inicio, data_fim").eq("id", id).maybeSingle();
      const ini = (patch.data_inicio as string) || atual?.data_inicio;
      const fim = (patch.data_fim as string) || atual?.data_fim;
      if (ini && fim) {
        const i = new Date(`${ini}T00:00:00Z`).getTime(), f = new Date(`${fim}T00:00:00Z`).getTime();
        if (isNaN(i) || isNaN(f) || f < i) return jsonErr(400, "Período inválido: data de fim anterior à de início");
        patch.dias = Math.round((f - i) / 86400000) + 1;
      }
    }

    // Quem mudou o status (aprovada/rejeitada/concluida) fica registrado
    if (body.status && ["aprovada", "rejeitada", "concluida"].includes(body.status)) {
      patch.aprovado_por = admin.email;
    }

    if (!Object.keys(patch).length) return jsonErr(400, "Nada para atualizar");

    const { data, error } = await db.from("rh_ausencias").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
