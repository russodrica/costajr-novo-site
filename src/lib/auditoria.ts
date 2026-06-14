// ════════════════════════════════════════════════════════════════════════
// Auditoria + Lixeira
//   registrarAcao()      → grava no audit_log (rastreio de inclusão/edição/exclusão)
//   excluirComLixeira()  → busca a linha, guarda na lixeira (30 dias), apaga e loga
//   restaurarDaLixeira() → re-insere a linha original e loga
//   expurgarLixeira()    → remove itens vencidos (>30 dias) — chamado pelo cron
// O log NUNCA derruba a operação principal (try/catch silencioso).
// ════════════════════════════════════════════════════════════════════════

export type AuditCtx = { req?: Request; admin?: { email?: string; role?: string } | null };
export type AuditAcao = "criar" | "editar" | "excluir" | "restaurar";

export function ipDe(req?: Request): string | null {
  if (!req) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || req.headers.get("x-vercel-forwarded-for") || null;
}

export async function registrarAcao(
  db: any,
  ctx: AuditCtx,
  p: { acao: AuditAcao; entidade: string; registro_id?: string | null; descricao?: string; dados?: any },
): Promise<void> {
  try {
    await db.from("audit_log").insert({
      usuario_email: ctx.admin?.email || null,
      usuario_role: ctx.admin?.role || null,
      acao: p.acao,
      entidade: p.entidade,
      registro_id: p.registro_id != null ? String(p.registro_id) : null,
      descricao: p.descricao ?? null,
      dados: p.dados ?? null,
      ip: ipDe(ctx.req),
    });
  } catch (e: any) {
    console.warn("[auditoria] falha ao registrar log:", e?.message || e);
  }
}

/**
 * Exclui um registro com rede de segurança: lê a linha, guarda na lixeira por
 * 30 dias, apaga da tabela e registra no log. Use no lugar de db.delete() direto.
 */
export async function excluirComLixeira(
  db: any,
  ctx: AuditCtx,
  p: { tabela: string; id: string; idCol?: string; entidade?: string; descricao?: string },
): Promise<{ ok: boolean; dados?: any; error?: string }> {
  const idCol = p.idCol || "id";
  const entidade = p.entidade || p.tabela;
  const { data: linha, error: e1 } = await db.from(p.tabela).select("*").eq(idCol, p.id).maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!linha) return { ok: false, error: "Registro não encontrado" };

  const { error: e2 } = await db.from("lixeira").insert({
    entidade,
    registro_id: String(p.id),
    dados: linha,
    descricao: p.descricao || `${entidade} ${p.id}`,
    excluido_por: ctx.admin?.email || null,
  });
  if (e2) return { ok: false, error: "Falha ao mover para a lixeira: " + e2.message };

  const { error: e3 } = await db.from(p.tabela).delete().eq(idCol, p.id);
  if (e3) return { ok: false, error: e3.message };

  await registrarAcao(db, ctx, {
    acao: "excluir", entidade, registro_id: String(p.id),
    descricao: p.descricao || `Excluiu ${entidade} ${p.id}`, dados: linha,
  });
  return { ok: true, dados: linha };
}

/** Restaura um item da lixeira de volta para a tabela de origem. */
export async function restaurarDaLixeira(
  db: any,
  ctx: AuditCtx,
  lixeiraId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: item } = await db.from("lixeira").select("*").eq("id", lixeiraId).maybeSingle();
  if (!item) return { ok: false, error: "Item não encontrado na lixeira" };
  if (item.restaurado) return { ok: false, error: "Item já restaurado" };

  const { error } = await db.from(item.entidade).insert(item.dados);
  if (error) return { ok: false, error: "Falha ao restaurar (a tabela mudou ou já existe): " + error.message };

  await db.from("lixeira").update({
    restaurado: true, restaurado_em: new Date().toISOString(), restaurado_por: ctx.admin?.email || null,
  }).eq("id", lixeiraId);

  await registrarAcao(db, ctx, {
    acao: "restaurar", entidade: item.entidade, registro_id: item.registro_id,
    descricao: `Restaurou ${item.entidade} ${item.registro_id}`, dados: item.dados,
  });
  return { ok: true };
}

/** Remove da lixeira os itens vencidos (>30 dias) e não restaurados. Cron diário. */
export async function expurgarLixeira(db: any): Promise<{ removidos: number }> {
  const agora = new Date().toISOString();
  const { data } = await db.from("lixeira").delete().lt("expira_em", agora).eq("restaurado", false).select("id");
  return { removidos: data?.length || 0 };
}
