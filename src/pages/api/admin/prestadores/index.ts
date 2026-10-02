import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "~/lib/auth";
import { bloqueioSeSemLeitura } from "~/lib/permissoes";
import { listarPrestadoresAdmin } from "~/lib/manut/prestadores";

export const prerender = false;
const PERFIS = ["admin", "operacional", "manutencao_operacao", "manutencao_administrativo"];

// GET → lista de prestadores (cadastro + especialidades/notas + ranking) p/ a tela admin.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSemLeitura(admin, "prestadores"); if (ro) return ro;
    return jsonOk(await listarPrestadoresAdmin());
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
