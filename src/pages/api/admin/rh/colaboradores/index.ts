import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { registrarAcao } from "../../../../../lib/auditoria";

export const prerender = false;

const REGIMES = ["clt", "pj", "estagio", "temporario", "socio", "diarista"];
const STATUS = ["ativo", "ferias", "afastado", "desligado"];

// GET /api/admin/rh/colaboradores?status=&setor=&busca=
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);
    const db = supabaseAdmin();
    let q = db.from("rh_colaboradores").select("*").order("nome", { ascending: true }).limit(1000);

    const status = url.searchParams.get("status");
    const setor = url.searchParams.get("setor");
    const busca = url.searchParams.get("busca");

    if (status && status !== "todos") q = q.eq("status", status);
    if (setor) q = q.eq("setor", setor);
    if (busca) {
      const b = busca.replace(/[%,()]/g, " ").trim();
      // CPF NÃO entra na busca por substring (LGPD — evita enumeração de CPF).
      // Se o termo for um CPF completo (com 11 dígitos), faz match exato.
      const soDigitos = b.replace(/\D/g, "");
      if (soDigitos.length === 11) {
        q = q.or(`nome.ilike.%${b}%,email.ilike.%${b}%,cargo.ilike.%${b}%,cpf.eq.${b}`);
      } else {
        q = q.or(`nome.ilike.%${b}%,email.ilike.%${b}%,cargo.ilike.%${b}%`);
      }
    }

    const { data, error } = await q;
    if (error) return jsonErr(500, error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST /api/admin/rh/colaboradores — cria colaborador
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const body = await request.json();
    if (!body.nome) return jsonErr(400, "Nome é obrigatório");
    if (body.regime && !REGIMES.includes(body.regime)) return jsonErr(400, "Regime inválido");
    if (body.status && !STATUS.includes(body.status)) return jsonErr(400, "Status inválido");

    const campos = [
      "profile_id", "nome", "email", "telefone", "telefone_pessoal", "cpf", "rg", "data_nascimento", "foto_url",
      "cargo", "setor", "regime", "salario", "data_admissao", "data_desligamento", "status",
      "endereco", "cidade", "uf", "contato_emergencia_nome", "contato_emergencia_telefone",
      "pix", "banco", "agencia", "conta", "observacoes",
    ];
    const row: Record<string, unknown> = { criado_por: admin.email };
    for (const c of campos) if (body[c] !== undefined && body[c] !== "") row[c] = body[c];

    const db = supabaseAdmin();
    const { data, error } = await db.from("rh_colaboradores").insert(row).select().single();
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "criar",
      entidade: "rh_colaboradores",
      registro_id: data?.id ?? null,
      descricao: `Criou colaborador "${body.nome}"`,
      dados: data,
    });

    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
