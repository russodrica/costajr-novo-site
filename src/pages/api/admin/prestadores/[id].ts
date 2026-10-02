import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "~/lib/auth";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";
import { setStatusPrestador } from "~/lib/manut/prestadores";
import { supabaseAdmin } from "~/lib/supabase";
import { registrarAcao } from "~/lib/auditoria";

export const prerender = false;
const PERFIS = ["admin", "operacional", "manutencao_operacao", "manutencao_administrativo"];

// PATCH { status?, observacao_admin? } → aprova/reprova/inativa o prestador ou anota observação.
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSoLeitura(admin, "prestadores"); if (ro) return ro;
    const db = supabaseAdmin();
    const { data: p } = await db.from("manut_prestadores").select("id,nome,status").eq("id", params.id!).maybeSingle();
    if (!p) return jsonErr(404, "Prestador não encontrado.");
    const b = await request.json();
    if (typeof b.observacao_admin === "string") {
      await db.from("manut_prestadores").update({ observacao_admin: b.observacao_admin, updated_at: new Date().toISOString() }).eq("id", params.id!);
    }
    if (b.status) {
      await setStatusPrestador(params.id!, String(b.status), admin);
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "manut_prestadores", registro_id: params.id!,
        descricao: `Prestador "${p.nome}" → ${b.status}`, dados: { de: p.status, para: b.status },
      }).catch(() => {});
    }
    return jsonOk({ ok: true });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 400, e.message);
  }
};
