import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { listarPessoas, rhidConfigurado } from "../../../../lib/rhid";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
export const maxDuration = 60;
const PERFIS = ["admin", "rh"];

const soDigitos = (s: any) => String(s || "").replace(/\D/g, "");
// mostra só o miolo do CPF (LGPD) — o suficiente para conferir visualmente
const cpfMasc = (s: any) => { const d = soDigitos(s); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : ""; };

// GET → pessoas da ControliD + colaboradores do Portal, já indicando quem casou
// automaticamente por CPF e quem está amarrado na mão.
export const GET: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    if (!rhidConfigurado()) return jsonErr(503, "Integração com ControlID não configurada (RHID_EMAIL / RHID_SENHA ausentes).");
    const db = supabaseAdmin();

    let pessoas: Awaited<ReturnType<typeof listarPessoas>> = [];
    try { pessoas = await listarPessoas(); }
    catch (e: any) { return jsonErr(503, `Falha ao conectar na ControliD: ${e.message}`); }

    const { data: colabs } = await db.from("rh_colaboradores")
      .select("id, nome, cpf, regime, status, rhid_person_id")
      .neq("status", "desligado").order("nome");

    const porCpf = new Map<string, number>();
    for (const p of pessoas) { const c = soDigitos(p.cpf); if (c) porCpf.set(c, p.id); }
    const nomePessoa = new Map<number, string>(pessoas.map((p) => [p.id, p.nome]));

    const lista = ((colabs || []) as any[]).map((c) => {
      const autoId = porCpf.get(soDigitos(c.cpf)) ?? null;
      const efetivo = c.rhid_person_id ?? autoId;
      return {
        id: c.id,
        nome: c.nome,
        regime: c.regime,
        status: c.status,
        cpf: cpfMasc(c.cpf),
        rhid_person_id: c.rhid_person_id ?? null,
        auto_por_cpf: autoId,
        // de onde veio o vínculo: manual > cpf > nenhum
        origem: c.rhid_person_id ? "manual" : autoId ? "cpf" : "nenhum",
        rhid_nome: efetivo ? nomePessoa.get(efetivo) || null : null,
      };
    });

    // quem da ControliD ainda não está ligado a ninguém
    const usados = new Set(lista.map((l) => l.rhid_person_id ?? l.auto_por_cpf).filter(Boolean) as number[]);
    const rhid = pessoas.map((p) => ({
      id: p.id, nome: p.nome, cpf: cpfMasc(p.cpf), matricula: p.matricula || "",
      ativo: !!p.ativo, jaLigado: usados.has(p.id),
    })).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));

    return jsonOk({ ok: true, colaboradores: lista, rhid });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

// POST { colaborador_id, rhid_person_id }  (rhid_person_id = null desfaz o vínculo manual)
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const b = await request.json().catch(() => ({}));
    const colabId = String(b.colaborador_id || "").trim();
    if (!colabId) return jsonErr(400, "Informe o colaborador.");
    const pid = b.rhid_person_id == null || b.rhid_person_id === "" ? null : Number(b.rhid_person_id);
    if (pid != null && !Number.isFinite(pid)) return jsonErr(400, "Pessoa da ControliD inválida.");

    const db = supabaseAdmin();
    const { data: c } = await db.from("rh_colaboradores").select("id, nome").eq("id", colabId).maybeSingle();
    if (!c) return jsonErr(404, "Colaborador não encontrado.");

    // uma pessoa da ControliD não pode estar ligada a dois colaboradores
    if (pid != null) {
      const { data: ja } = await db.from("rh_colaboradores").select("id, nome").eq("rhid_person_id", pid).neq("id", colabId).maybeSingle();
      if (ja) return jsonErr(409, `Essa pessoa da ControliD já está ligada a ${(ja as any).nome}. Desfaça o outro vínculo antes.`);
    }

    const { error } = await db.from("rh_colaboradores").update({ rhid_person_id: pid }).eq("id", colabId);
    if (error) return jsonErr(400, error.message);

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "rh_colaboradores", registro_id: colabId,
      descricao: pid == null ? `Desfez o vínculo de ${(c as any).nome} com a ControliD` : `Ligou ${(c as any).nome} à pessoa ${pid} da ControliD`,
      dados: { rhid_person_id: pid },
    }).catch(() => {});

    return jsonOk({ ok: true, colaborador_id: colabId, rhid_person_id: pid });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
