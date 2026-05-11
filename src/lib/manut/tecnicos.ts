import { supabaseAdmin } from "../supabase";
import { verificarSenha, hashSenha, signToken, gerarSenhaInicial } from "../auth";

const db = () => supabaseAdmin();

export async function tecnicoLogin({ email, senha }: { email: string; senha: string }) {
  const { data: tec } = await db()
    .from("manut_tecnicos")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!tec) throw new Error("Email ou senha inválidos");
  if (!(await verificarSenha(senha, tec.senha_hash))) throw new Error("Email ou senha inválidos");
  if (tec.status === "inativo") throw new Error("Conta inativa. Contate o suporte.");

  await db().from("manut_tecnicos").update({ last_login_at: new Date().toISOString() }).eq("id", tec.id);
  const token = await signToken({ sub: tec.id, tipo: "tecnico", email: tec.email, troca: tec.senha_troca_obrigatoria });
  return { token, trocaObrigatoria: tec.senha_troca_obrigatoria, tecnico: serializeTecnico(tec) };
}

export async function tecnicoMe(tecnicoId: string) {
  const { data } = await db().from("manut_tecnicos").select("*").eq("id", tecnicoId).maybeSingle();
  if (!data) throw new Error("Técnico não encontrado");
  const lojas = await listarLojasDoTecnico(tecnicoId);
  return { ...serializeTecnico(data), lojas };
}

// ─── Vínculo técnico ↔ lojas (N:N) ─────────────────────────────────────────
export async function listarLojaIdsDoTecnico(tecnicoId: string): Promise<string[]> {
  const { data } = await db()
    .from("manut_tecnico_lojas")
    .select("loja_id")
    .eq("tecnico_id", tecnicoId);
  return (data || []).map((r: any) => r.loja_id);
}

export async function listarLojasDoTecnico(tecnicoId: string) {
  const ids = await listarLojaIdsDoTecnico(tecnicoId);
  if (ids.length === 0) return [];
  const { data } = await db()
    .from("manut_lojas")
    .select("id,nome,endereco,cidade,uf,cliente_id,manut_clientes(nome)")
    .in("id", ids);
  return data || [];
}

export async function sincronizarLojasDoTecnico(tecnicoId: string, lojaIds: string[]) {
  const atual = await listarLojaIdsDoTecnico(tecnicoId);
  const novos = lojaIds.filter((id) => !atual.includes(id));
  const removidos = atual.filter((id) => !lojaIds.includes(id));
  if (novos.length) {
    const rows = novos.map((loja_id) => ({ tecnico_id: tecnicoId, loja_id }));
    const { error } = await db().from("manut_tecnico_lojas").insert(rows);
    if (error) throw new Error(error.message);
  }
  if (removidos.length) {
    const { error } = await db()
      .from("manut_tecnico_lojas")
      .delete()
      .eq("tecnico_id", tecnicoId)
      .in("loja_id", removidos);
    if (error) throw new Error(error.message);
  }
}

export async function tecnicoTrocarSenha(tecnicoId: string, senhaAtual: string, novaSenha: string) {
  if (!novaSenha || novaSenha.length < 6) throw new Error("Senha deve ter ao menos 6 caracteres");
  const { data: tec } = await db().from("manut_tecnicos").select("senha_hash").eq("id", tecnicoId).single();
  if (!tec || !(await verificarSenha(senhaAtual, tec.senha_hash))) throw new Error("Senha atual incorreta");
  await db()
    .from("manut_tecnicos")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: false })
    .eq("id", tecnicoId);
  return { ok: true };
}

function serializeTecnico(t: any) {
  const { senha_hash, ...rest } = t;
  return rest;
}
