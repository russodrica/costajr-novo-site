import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

// GET /api/admin/rh/colaboradores/[id] — ficha completa (colaborador + ausências + documentos)
export const GET: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminCookie(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const [{ data: colaborador, error }, { data: ausencias }, { data: documentos }] = await Promise.all([
      db.from("rh_colaboradores").select("*").eq("id", id).maybeSingle(),
      db.from("rh_ausencias").select("*").eq("colaborador_id", id).order("data_inicio", { ascending: false }).limit(500),
      db.from("rh_documentos").select("*").eq("colaborador_id", id).order("created_at", { ascending: false }).limit(500),
    ]);
    if (error) return jsonErr(500, error.message);
    if (!colaborador) return jsonErr(404, "Colaborador não encontrado");

    // membro vinculado (acesso ao portal), se houver
    let membro: any = null;
    if (colaborador.profile_id) {
      const { data: m } = await db.from("portal_profiles")
        .select("id, email, role, roles, approval_status").eq("id", colaborador.profile_id).maybeSingle();
      if (m) membro = m;
    }

    return jsonOk({ colaborador, ausencias: ausencias || [], documentos: documentos || [], membro });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// PATCH /api/admin/rh/colaboradores/[id] — atualiza dados cadastrais
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const admin = await requireAdminCookie(request);
    const id = params.id!;
    const body = await request.json();

    // valida só quando o valor está presente E não vazio (evita barrar edições legítimas)
    if (body.regime && !["clt", "pj", "estagio", "temporario", "socio", "diarista"].includes(body.regime)) return jsonErr(400, "Regime inválido");
    if (body.status && !["ativo", "ferias", "afastado", "desligado"].includes(body.status)) return jsonErr(400, "Status inválido");

    const editaveis = [
      "profile_id", "nome", "email", "telefone", "telefone_pessoal", "cpf", "rg", "data_nascimento", "foto_url",
      "cargo", "setor", "regime", "salario", "data_admissao", "data_desligamento", "status", "status_juridico",
      "endereco", "cidade", "uf", "contato_emergencia_nome", "contato_emergencia_telefone",
      "pix", "banco", "agencia", "conta", "observacoes",
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of editaveis) if (body[c] !== undefined) patch[c] = body[c] === "" ? null : body[c];
    // salário sempre numérico (ou null) — evita erro de tipo no banco
    if ("salario" in patch) {
      if (patch.salario === null) { /* ok */ }
      else { const n = Number(String(patch.salario).replace(/\./g, "").replace(",", ".")); patch.salario = isNaN(n) ? null : n; }
    }
    if (Object.keys(patch).length <= 1) return jsonErr(400, "Nada para atualizar");
    if (patch.nome === null) return jsonErr(400, "Nome não pode ficar vazio");

    const db = supabaseAdmin();
    // GATE: não permite mudar status PARA "desligado" por aqui — o desligamento
    // só pode ocorrer pelo fluxo travado (devolução de Ativos/EPIs + passos do
    // regime), via /api/admin/rh/desligamentos/finalizar.
    if (patch.status === "desligado") {
      const { data: atual } = await db.from("rh_colaboradores").select("status").eq("id", id).maybeSingle();
      if (atual && atual.status !== "desligado") {
        return jsonErr(400, "Use o botão Desligar — o desligamento só conclui após conferir a devolução de Ativos/EPIs e os passos do regime.");
      }
    }
    const { data, error } = await db.from("rh_colaboradores").update(patch).eq("id", id).select().single();
    if (error) return jsonErr(400, error.message);

    const desligando = patch.status === "desligado";
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "rh_colaboradores", registro_id: id,
      descricao: desligando ? `Desligou colaborador "${data.nome}"` : `Editou colaborador "${data.nome}"`,
      dados: patch,
    });

    // Ao DESLIGAR, revoga o acesso ao portal: bloqueia o login (approval_status)
    // e encerra as sessões ativas. Isso também o tira de comunicados/notificações.
    if (desligando && data.profile_id) {
      await db.from("portal_profiles").update({ approval_status: "rejected" }).eq("id", data.profile_id);
      await db.from("portal_sessoes").delete().eq("user_id", data.profile_id);
      await registrarAcao(db, { req: request, admin }, {
        acao: "editar", entidade: "acesso_portal", registro_id: data.profile_id,
        descricao: `Revogou acesso ao portal de "${data.nome}" (colaborador desligado)`,
      });
    }
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
