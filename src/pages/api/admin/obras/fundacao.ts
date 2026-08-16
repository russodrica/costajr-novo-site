import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura, bloqueioSeSemLeitura } from "../../../../lib/permissoes";
import { statusObraValido } from "../../../../lib/rdo";

export const prerender = false;
// A trava central deduz o módulo do primeiro segmento depois de /api/admin —
// aqui é "obras", a mesma equipe que cuida da carteira de fundação.
const MODULO = "obras-fundacao";

/** Nome de obra e de cliente entram sempre em MAIÚSCULO: é o padrão da
 *  carteira e evita a mesma obra cadastrada de três jeitos diferentes. */
const maiusculo = (t: unknown, max: number) =>
  String(t ?? "").trim().slice(0, max).toLocaleUpperCase("pt-BR");

const camposDaObra = (b: any) => ({
  nome: maiusculo(b?.nome, 200),
  codigo: String(b?.codigo ?? "").trim().slice(0, 60) || null,
  cliente: maiusculo(b?.cliente, 200) || null,
  endereco: String(b?.endereco ?? "").trim().slice(0, 300) || null,
  cidade: String(b?.cidade ?? "").trim().slice(0, 120) || null,
  uf: String(b?.uf ?? "").trim().toUpperCase().slice(0, 2) || null,
  status: statusObraValido(b?.status),
  data_inicio: String(b?.data_inicio ?? "").slice(0, 10) || null,
  data_fim_prevista: String(b?.data_fim_prevista ?? "").slice(0, 10) || null,
  data_fim_real: String(b?.data_fim_real ?? "").slice(0, 10) || null,
  responsavel_nome: String(b?.responsavel_nome ?? "").trim().slice(0, 200) || null,
  observacoes: String(b?.observacoes ?? "").trim().slice(0, 2000) || null,
});

// GET /api/admin/obras/fundacao — lista para o modal do relatório recarregar
// sem precisar dar refresh na página inteira.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const ro = await bloqueioSeSemLeitura(admin, MODULO); if (ro) return ro;
    const db = supabaseAdmin();
    const { data } = await db.from("obras_fundacao")
      .select("id, nome, cliente, status").order("nome").limit(1000);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/obras/fundacao — cadastra uma obra da carteira de fundação.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const b = await request.json().catch(() => null);
    const campos = camposDaObra(b);
    if (!campos.nome) return jsonErr(400, "Informe o nome da obra.");

    const { data, error } = await db.from("obras_fundacao")
      .insert({ ...campos, criado_por: admin.email || null })
      .select("id, nome, cliente, status").single();
    if (error) {
      console.error("[obras_fundacao] insert falhou:", error.code, error.message, error.details);
      return jsonErr(400, "Não deu para cadastrar a obra agora.");
    }

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar", entidade: "obras_fundacao", registro_id: data.id,
      descricao: `Obra de fundação "${data.nome}"`,
    });
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
