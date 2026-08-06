import type { APIRoute } from "astro";
import { jsonOk, jsonErr } from "../../../lib/auth";
import { supabaseAdmin } from "../../../lib/supabase";
import { rhidConfigurado } from "../../../lib/rhid";
import { gerarEArquivarEspelho, colaboradoresComPonto, pessoasControliD, rotuloMes } from "../../../lib/espelhoPonto";

export const prerender = false;
export const maxDuration = 300;

// GET /api/integra/rhid-espelho-mensal?key=...&mes=YYYY-MM
// Chamado pelo GitHub Actions todo dia 10: arquiva na ficha o espelho do MÊS
// ANTERIOR (já fechado e ajustado). Sem `mes`, usa o mês anterior.
// Repetir é seguro — o espelho daquele mês é substituído, não duplicado.
export const GET: APIRoute = async ({ url }) => {
  try {
    const key = url.searchParams.get("key") || "";
    const esperado = import.meta.env.INTEGRA_TELEGRAM_SECRET || process.env.INTEGRA_TELEGRAM_SECRET || "";
    if (!esperado || key !== esperado) return jsonErr(401, "Chave inválida.");
    if (!rhidConfigurado()) return jsonErr(503, "Integração com ControlID não configurada.");

    let mes = url.searchParams.get("mes") || "";
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      // mês anterior no fuso de São Paulo
      const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const d = new Date(Date.UTC(agora.getFullYear(), agora.getMonth() - 1, 1));
      mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }

    const db = supabaseAdmin();
    const colabs = await colaboradoresComPonto(db);
    if (!colabs.length) return jsonOk({ ok: true, mes, gerados: 0, aviso: "Nenhum colaborador com ponto." });

    const pessoas = await pessoasControliD();
    const resultados: any[] = [];
    for (const c of colabs) {
      try { resultados.push(await gerarEArquivarEspelho(db, c, mes, pessoas, "Rotina automática (dia 10)")); }
      catch (e: any) { resultados.push({ ok: false, colaborador: c.nome, anoMes: mes, motivo: e?.message || "erro inesperado" }); }
    }
    const gerados = resultados.filter((r) => r.ok).length;
    const falhas = resultados.filter((r) => !r.ok);
    return jsonOk({ ok: true, mes: rotuloMes(mes), gerados, falhas: falhas.length, resultados });
  } catch (e: any) {
    return jsonErr(500, e?.message || "Falha ao gerar os espelhos.");
  }
};
