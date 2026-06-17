import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { listarPessoas, apuracaoMensal, rhidConfigurado } from "../../../../lib/rhid";

export const prerender = false;
export const maxDuration = 60;

// GET /api/admin/rh/ponto-mensal?mes=YYYY-MM
export const GET: APIRoute = async ({ request, url }) => {
  try {
    await requireAdminCookie(request);

    const mes = url.searchParams.get("mes");
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return jsonErr(400, "Parâmetro mes inválido (use YYYY-MM)");
    if (!rhidConfigurado()) return jsonErr(503, "Integração com ControlID não configurada (RHID_EMAIL / RHID_SENHA ausentes)");

    // Busca colaboradores CLT + sócio ativos do banco
    const db = supabaseAdmin();
    const { data: colabs, error } = await db
      .from("rh_colaboradores")
      .select("id, nome, cpf, regime, status")
      .in("regime", ["clt", "socio"])
      .neq("status", "desligado")
      .order("nome");
    if (error) return jsonErr(500, error.message);
    if (!colabs?.length) return jsonOk({ mes, colaboradores: [] });

    // Busca pessoas do RHiD e monta mapa CPF -> id
    let rhidPessoas: Awaited<ReturnType<typeof listarPessoas>> = [];
    try { rhidPessoas = await listarPessoas(); } catch (e: any) {
      return jsonErr(503, `Falha ao conectar ao ControlID: ${e.message}`);
    }
    const cpfParaId = new Map<string, number>();
    for (const p of rhidPessoas) {
      const cpf = p.cpf.replace(/\D/g, "");
      if (cpf) cpfParaId.set(cpf, p.id);
    }

    // Processa cada colaborador em paralelo (limitado a 5 simultâneos)
    const resultado: any[] = [];
    const limite = 5;
    for (let i = 0; i < colabs.length; i += limite) {
      const lote = colabs.slice(i, i + limite);
      const parcial = await Promise.all(lote.map(async (c) => {
        const cpf = (c.cpf || "").replace(/\D/g, "");
        const rhidId = cpfParaId.get(cpf);
        if (!rhidId) return { id: c.id, nome: c.nome, regime: c.regime, encontrado: false, resumo: null };

        const dias = await apuracaoMensal(rhidId, mes);
        const diasTrabalhados = dias.filter((d) => d.trabalhou).length;
        const faltas = dias.filter((d) => d.falta).length;
        const horasMin = dias.reduce((sum, d) => sum + d.horasMin, 0);
        const diasComEscala = dias.filter((d) => d.trabalhou || d.falta).length;
        const saldoBancoMin = horasMin - diasComEscala * 480; // 8h/dia = 480min

        return {
          id: c.id,
          nome: c.nome,
          regime: c.regime,
          encontrado: true,
          rhidId,
          resumo: { diasTrabalhados, faltas, horasMin, saldoBancoMin, diasComEscala },
          dias,
        };
      }));
      resultado.push(...parcial);
    }

    return jsonOk({ mes, colaboradores: resultado });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
