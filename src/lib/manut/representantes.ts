import { supabaseAdmin } from "../supabase";

const db = () => supabaseAdmin();

export interface Representante {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  saldo_acumulado: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Repasse {
  id: string;
  representante_id: string;
  valor: number;
  data_repasse: string;
  observacao: string | null;
  created_at: string;
}

/** Lista todos os representantes (mais recentes primeiro). */
export async function listarRepresentantes(opts?: { somenteAtivos?: boolean }): Promise<Representante[]> {
  let q = db().from("manut_representantes").select("*").order("created_at", { ascending: false });
  if (opts?.somenteAtivos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Representante[];
}

/** Busca um representante por id (com cupons vinculados e últimos repasses). */
export async function buscarRepresentanteDetalhado(id: string) {
  const [rep, cupons, repasses] = await Promise.all([
    db().from("manut_representantes").select("*").eq("id", id).maybeSingle(),
    db().from("manut_cupons").select("id, codigo, descricao, desconto_percentual, cashback_pct, usos_atuais, usos_maximos, ativo, validade, created_at").eq("representante_id", id).order("created_at", { ascending: false }),
    db().from("manut_representantes_repasses").select("*").eq("representante_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (rep.error) throw new Error(rep.error.message);
  if (!rep.data) return null;
  return {
    representante: rep.data as Representante,
    cupons: cupons.data || [],
    repasses: (repasses.data || []) as Repasse[],
  };
}

/** Cria um novo representante. Email deve ser único (case-insensitive). */
export async function criarRepresentante(input: { nome: string; email: string; telefone?: string }): Promise<Representante> {
  const nome = String(input.nome || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!nome) throw new Error("Nome obrigatório");
  if (!email || !email.includes("@")) throw new Error("Email inválido");

  const { data: dup } = await db().from("manut_representantes").select("id").ilike("email", email).maybeSingle();
  if (dup) throw new Error("Já existe representante com esse email");

  const { data, error } = await db()
    .from("manut_representantes")
    .insert({
      nome,
      email,
      telefone: input.telefone?.trim() || null,
      saldo_acumulado: 0,
      ativo: true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Representante;
}

/** Atualiza nome/email/telefone/ativo de um representante. */
export async function atualizarRepresentante(id: string, patch: Partial<Pick<Representante, "nome" | "email" | "telefone" | "ativo">>): Promise<Representante> {
  const update: any = { updated_at: new Date().toISOString() };
  if (patch.nome !== undefined) update.nome = String(patch.nome).trim();
  if (patch.email !== undefined) update.email = String(patch.email).trim().toLowerCase();
  if (patch.telefone !== undefined) update.telefone = patch.telefone?.trim() || null;
  if (patch.ativo !== undefined) update.ativo = !!patch.ativo;

  // Se email mudou, valida unicidade
  if (update.email) {
    const { data: dup } = await db().from("manut_representantes").select("id").ilike("email", update.email).neq("id", id).maybeSingle();
    if (dup) throw new Error("Já existe representante com esse email");
  }

  const { data, error } = await db()
    .from("manut_representantes")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Representante;
}

/** Registra um repasse de comissão e subtrai do saldo do representante. */
export async function registrarRepasse(representanteId: string, input: { valor: number; dataRepasse?: string; observacao?: string }): Promise<{ repasse: Repasse; saldoNovo: number }> {
  const valor = Number(input.valor);
  if (!valor || valor <= 0) throw new Error("Valor do repasse deve ser positivo");

  // Lê saldo atual
  const { data: rep, error: e1 } = await db()
    .from("manut_representantes")
    .select("id, saldo_acumulado")
    .eq("id", representanteId)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!rep) throw new Error("Representante não encontrado");

  const saldoAtual = Number(rep.saldo_acumulado || 0);
  if (valor > saldoAtual) throw new Error(`Valor do repasse (R$ ${valor.toFixed(2)}) excede saldo acumulado (R$ ${saldoAtual.toFixed(2)})`);

  const saldoNovo = Number((saldoAtual - valor).toFixed(2));

  // Insere repasse
  const { data: repasse, error: e2 } = await db()
    .from("manut_representantes_repasses")
    .insert({
      representante_id: representanteId,
      valor,
      data_repasse: input.dataRepasse || new Date().toISOString().slice(0, 10),
      observacao: input.observacao?.trim() || null,
    })
    .select("*")
    .single();
  if (e2) throw new Error(e2.message);

  // Atualiza saldo
  const { error: e3 } = await db()
    .from("manut_representantes")
    .update({ saldo_acumulado: saldoNovo, updated_at: new Date().toISOString() })
    .eq("id", representanteId);
  if (e3) throw new Error(e3.message);

  return { repasse: repasse as Repasse, saldoNovo };
}

/** Credita valor no saldo de um representante (chamado quando um cupom dele é usado). */
export async function creditarSaldoRepresentante(representanteId: string, valor: number): Promise<number> {
  if (!valor || valor <= 0) return 0;
  const { data, error } = await db()
    .from("manut_representantes")
    .select("saldo_acumulado")
    .eq("id", representanteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Representante não encontrado");

  const saldoNovo = Number((Number(data.saldo_acumulado || 0) + valor).toFixed(2));
  const { error: e2 } = await db()
    .from("manut_representantes")
    .update({ saldo_acumulado: saldoNovo, updated_at: new Date().toISOString() })
    .eq("id", representanteId);
  if (e2) throw new Error(e2.message);
  return saldoNovo;
}
