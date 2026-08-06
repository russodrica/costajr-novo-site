import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { rhidConfigurado } from "../../../../lib/rhid";
import { gerarEArquivarEspelho, colaboradoresComPonto, pessoasControliD } from "../../../../lib/espelhoPonto";

export const prerender = false;
export const maxDuration = 300; // vários meses x pessoas: pode demorar
const PERFIS = ["admin", "rh"];

// POST /api/admin/rh/espelho-ponto
//   { colaborador_ids?: string[], meses: ["2026-07", ...] }  ou  { de: "2026-01", ate: "2026-07" }
// Gera o espelho de cada mês e arquiva na ficha. Repetir é seguro: o espelho
// daquele mês é substituído, não duplicado.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    if (!rhidConfigurado()) return jsonErr(503, "Integração com ControlID não configurada (RHID_EMAIL / RHID_SENHA ausentes).");
    const b = await request.json().catch(() => ({}));

    let meses: string[] = Array.isArray(b.meses) ? b.meses.filter((m: any) => /^\d{4}-\d{2}$/.test(String(m))) : [];
    if (!meses.length && /^\d{4}-\d{2}$/.test(String(b.de || "")) && /^\d{4}-\d{2}$/.test(String(b.ate || ""))) {
      meses = intervaloMeses(String(b.de), String(b.ate));
    }
    if (!meses.length) return jsonErr(400, "Informe os meses (YYYY-MM).");
    if (meses.length > 36) return jsonErr(400, "No máximo 36 meses por vez.");

    const ids: string[] = Array.isArray(b.colaborador_ids) ? b.colaborador_ids.map(String).filter(Boolean) : [];
    const colabs = await colaboradoresComPonto(supabaseAdmin(), ids.length ? ids : undefined);
    if (!colabs.length) return jsonErr(404, "Nenhum colaborador encontrado.");

    const db = supabaseAdmin();
    const pessoas = await pessoasControliD();
    const autor = admin.email || "Portal";
    const resultados: any[] = [];
    // sequencial de propósito: a API da ControliD não gosta de rajada
    for (const c of colabs) {
      for (const mes of meses.slice().sort()) {
        try { resultados.push(await gerarEArquivarEspelho(db, c, mes, pessoas, autor)); }
        catch (e: any) { resultados.push({ ok: false, colaborador: c.nome, anoMes: mes, motivo: e?.message || "erro inesperado" }); }
      }
    }
    const gerados = resultados.filter((r) => r.ok).length;
    return jsonOk({ ok: true, gerados, total: resultados.length, resultados });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao gerar o espelho.");
  }
};

function intervaloMeses(de: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = de.split("-").map(Number);
  const [af, mf] = ate.split("-").map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; a++; }
    if (out.length > 36) break;
  }
  return out;
}
