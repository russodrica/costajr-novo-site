import { supabaseAdmin } from "../supabase";
import { hashSenha, verificarSenha, signToken, gerarSenhaInicial } from "../auth";
import { enviarBoasVindasRepresentante, enviarSenhaReset } from "../mailer";
import { listarRegrasIndicacao } from "./indicacao-regras";

const db = () => supabaseAdmin();

export interface Representante {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  chave_pix: string | null;
  tipo_chave_pix: "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | null;
  saldo_acumulado: number;
  ativo: boolean;
  senha_troca_obrigatoria: boolean;
  aprovado_em: string | null;
  last_login_at: string | null;
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

const SELECT_REP_FIELDS =
  "id, nome, email, telefone, chave_pix, tipo_chave_pix, saldo_acumulado, ativo, senha_troca_obrigatoria, aprovado_em, last_login_at, created_at, updated_at";

/** Lista todos os representantes (mais recentes primeiro). */
export async function listarRepresentantes(opts?: { somenteAtivos?: boolean }): Promise<Representante[]> {
  let q = db().from("manut_representantes").select(SELECT_REP_FIELDS).order("created_at", { ascending: false });
  if (opts?.somenteAtivos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Representante[];
}

/** Busca um representante por id (com cupons vinculados e últimos repasses). */
export async function buscarRepresentanteDetalhado(id: string) {
  const [rep, cupons, repasses] = await Promise.all([
    db().from("manut_representantes").select(SELECT_REP_FIELDS).eq("id", id).maybeSingle(),
    db().from("manut_cupons").select("id, codigo, descricao, desconto_percentual, cashback_pct, tipo, usos_atuais, usos_maximos, ativo, validade, created_at").eq("representante_id", id).order("created_at", { ascending: false }),
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
export async function criarRepresentante(input: { nome: string; email: string; telefone?: string; chavePix?: string; tipoChavePix?: Representante["tipo_chave_pix"] }): Promise<Representante> {
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
      chave_pix: input.chavePix?.trim() || null,
      tipo_chave_pix: input.tipoChavePix || null,
      saldo_acumulado: 0,
      ativo: true,
      senha_troca_obrigatoria: true,
    })
    .select(SELECT_REP_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as Representante;
}

/** Atualiza nome/email/telefone/PIX/ativo de um representante.
 *  Side effect 1: quando ATIVA um rep (patch.ativo=true), também ATIVA todos
 *  os cupons inativos vinculados a ele.
 *  Side effect 2: na primeira ativação (aprovado_em era null), gera senha
 *  inicial e envia EMAIL de boas-vindas com cupons + senha + link do portal.
 *  Desativação NÃO propaga (Adriana pode querer manter o rep ativo e pausar cupons separadamente).
 */
export async function atualizarRepresentante(
  id: string,
  patch: Partial<Pick<Representante, "nome" | "email" | "telefone" | "ativo" | "chave_pix" | "tipo_chave_pix">>,
  opts?: { feitoPor?: string }
): Promise<Representante & { senhaInicialGerada?: string; emailEnviado?: boolean; emailErro?: string }> {
  // Lê estado anterior pra detectar transições (ativo false→true = APROVAÇÃO)
  const { data: anterior } = await db()
    .from("manut_representantes")
    .select(SELECT_REP_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (!anterior) throw new Error("Representante não encontrado");

  const update: any = { updated_at: new Date().toISOString() };
  if (patch.nome !== undefined) update.nome = String(patch.nome).trim();
  if (patch.email !== undefined) update.email = String(patch.email).trim().toLowerCase();
  if (patch.telefone !== undefined) update.telefone = patch.telefone?.trim() || null;
  if (patch.ativo !== undefined) update.ativo = !!patch.ativo;
  if (patch.chave_pix !== undefined) update.chave_pix = patch.chave_pix?.trim() || null;
  if (patch.tipo_chave_pix !== undefined) update.tipo_chave_pix = patch.tipo_chave_pix || null;

  // Se email mudou, valida unicidade
  if (update.email) {
    const { data: dup } = await db().from("manut_representantes").select("id").ilike("email", update.email).neq("id", id).maybeSingle();
    if (dup) throw new Error("Já existe representante com esse email");
  }

  // Detecta primeira aprovação: estava inativo + agora vai ficar ativo + aprovado_em ainda null
  const ehPrimeiraAprovacao = patch.ativo === true && !anterior.ativo && !anterior.aprovado_em;
  let senhaInicialGerada: string | null = null;
  if (ehPrimeiraAprovacao) {
    senhaInicialGerada = gerarSenhaInicial();
    update.senha_hash = await hashSenha(senhaInicialGerada);
    update.senha_troca_obrigatoria = true;
    update.aprovado_em = new Date().toISOString();
    if (opts?.feitoPor) update.aprovado_por = opts.feitoPor;
  }

  const { data, error } = await db()
    .from("manut_representantes")
    .update(update)
    .eq("id", id)
    .select(SELECT_REP_FIELDS)
    .single();
  if (error) throw new Error(error.message);

  // Side effect: se ATIVOU o rep, propaga ativação pros cupons dele
  let cuponsAtivadosCodigos: string[] = [];
  if (patch.ativo === true) {
    const { data: cuponsAtivados, error: errCupom } = await db()
      .from("manut_cupons")
      .update({ ativo: true })
      .eq("representante_id", id)
      .eq("ativo", false)
      .select("codigo");
    if (errCupom) {
      console.warn("[representantes] falha ao ativar cupons:", errCupom.message);
    } else if (cuponsAtivados && cuponsAtivados.length > 0) {
      cuponsAtivadosCodigos = cuponsAtivados.map((c: any) => c.codigo);
      console.log(`[representantes] ${cuponsAtivados.length} cupom(ns) ativado(s) junto com representante ${id}:`, cuponsAtivadosCodigos.join(", "));
    }

    // Auditoria
    await db().from("manut_representantes_aprovacoes").insert({
      representante_id: id,
      acao: ehPrimeiraAprovacao ? "aprovado" : "reativado",
      feito_por: opts?.feitoPor || null,
      observacao: ehPrimeiraAprovacao ? `Senha inicial gerada · ${cuponsAtivadosCodigos.length} cupom(ns) liberado(s)` : `${cuponsAtivadosCodigos.length} cupom(ns) reativado(s)`,
    });
  } else if (patch.ativo === false && anterior.ativo) {
    await db().from("manut_representantes_aprovacoes").insert({
      representante_id: id,
      acao: "desativado",
      feito_por: opts?.feitoPor || null,
    });
  }

  // Email automático na primeira aprovação
  let emailEnviado = false;
  let emailErro: string | undefined;
  if (ehPrimeiraAprovacao && senhaInicialGerada) {
    // Se nenhum cupom inativo foi ativado nesta operação, busca os cupons ATIVOS atuais
    // (cobre caso em que a ativação não veio acompanhada de cupons recém-ativados).
    let codigosParaEmail = cuponsAtivadosCodigos;
    if (codigosParaEmail.length === 0) {
      const { data: cupAtivos } = await db()
        .from("manut_cupons")
        .select("codigo")
        .eq("representante_id", id)
        .eq("ativo", true)
        .order("created_at", { ascending: true });
      codigosParaEmail = (cupAtivos || []).map((c: any) => c.codigo);
    }

    try {
      await enviarBoasVindasRepresentante({
        email: data.email,
        nome: data.nome,
        codigos: codigosParaEmail,
        senhaInicial: senhaInicialGerada,
        regrasPorPlano: listarRegrasIndicacao(),
      });
      emailEnviado = true;
    } catch (e: any) {
      emailErro = e.message;
      console.error("[representantes] falha ao enviar email de boas-vindas:", e.message);
    }
  }

  return {
    ...(data as Representante),
    ...(ehPrimeiraAprovacao ? { senhaInicialGerada: senhaInicialGerada || undefined, emailEnviado, emailErro } : {}),
  };
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

// ─── Autenticação / Portal do Representante ────────────────────────────────

function serializeRep(r: any): Representante {
  const { senha_hash, ...rest } = r;
  return rest as Representante;
}

export async function representanteLogin({ email, senha }: { email: string; senha: string }) {
  const { data: rep } = await db()
    .from("manut_representantes")
    .select("*")
    .eq("email", String(email || "").toLowerCase())
    .maybeSingle();
  if (!rep) throw new Error("Email ou senha inválidos");
  if (!rep.senha_hash) throw new Error("Cadastro ainda não aprovado. Aguarde aprovação da Adriana.");
  if (!(await verificarSenha(senha, rep.senha_hash))) throw new Error("Email ou senha inválidos");
  if (!rep.ativo) throw new Error("Cadastro desativado. Entre em contato com a Costa Júnior.");

  await db().from("manut_representantes").update({ last_login_at: new Date().toISOString() }).eq("id", rep.id);

  const token = await signToken({
    sub: rep.id,
    tipo: "representante",
    email: rep.email,
    troca: rep.senha_troca_obrigatoria,
  });
  return { token, trocaObrigatoria: rep.senha_troca_obrigatoria, representante: serializeRep(rep) };
}

export async function representanteMe(repId: string) {
  const { data: rep } = await db().from("manut_representantes").select("*").eq("id", repId).maybeSingle();
  if (!rep) throw new Error("Representante não encontrado");
  return serializeRep(rep);
}

export async function representanteTrocarSenha(repId: string, senhaAtual: string, novaSenha: string) {
  if (!novaSenha || novaSenha.length < 6) throw new Error("Senha deve ter ao menos 6 caracteres");
  const { data: rep } = await db().from("manut_representantes").select("senha_hash").eq("id", repId).single();
  if (!rep || !rep.senha_hash || !(await verificarSenha(senhaAtual, rep.senha_hash))) {
    throw new Error("Senha atual incorreta");
  }
  await db()
    .from("manut_representantes")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: false, updated_at: new Date().toISOString() })
    .eq("id", repId);
  return { ok: true };
}

export async function representanteResetSenha(email: string) {
  const { data: rep } = await db()
    .from("manut_representantes")
    .select("id,nome,email")
    .eq("email", String(email || "").toLowerCase())
    .maybeSingle();
  if (!rep) return { ok: true, emailEnviado: false }; // não vaza existência
  const novaSenha = gerarSenhaInicial();
  await db()
    .from("manut_representantes")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: true, updated_at: new Date().toISOString() })
    .eq("id", rep.id);
  try {
    await enviarSenhaReset(rep.email, rep.nome || "Representante", novaSenha);
    return { ok: true, emailEnviado: true };
  } catch (e: any) {
    console.error("[representantes][reset]", e.message);
    return { ok: true, emailEnviado: false, emailErro: e.message };
  }
}

/** Atualiza o próprio perfil do rep (PIX + telefone). Não permite mudar email/ativo. */
export async function representanteAtualizarPerfil(repId: string, patch: { telefone?: string; chavePix?: string; tipoChavePix?: Representante["tipo_chave_pix"] }) {
  const update: any = { updated_at: new Date().toISOString() };
  if (patch.telefone !== undefined) update.telefone = patch.telefone?.trim() || null;
  if (patch.chavePix !== undefined) update.chave_pix = patch.chavePix?.trim() || null;
  if (patch.tipoChavePix !== undefined) update.tipo_chave_pix = patch.tipoChavePix || null;

  const { data, error } = await db()
    .from("manut_representantes")
    .update(update)
    .eq("id", repId)
    .select(SELECT_REP_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as Representante;
}

/** Dados do dashboard do rep: saldo, cupons, usos (vendas efetivadas) e repasses. */
export async function representanteDashboard(repId: string) {
  const [rep, cupons, repasses] = await Promise.all([
    db().from("manut_representantes").select(SELECT_REP_FIELDS).eq("id", repId).maybeSingle(),
    db().from("manut_cupons")
      .select("id, codigo, descricao, tipo, ativo, usos_atuais, usos_maximos, validade")
      .eq("representante_id", repId)
      .order("created_at", { ascending: false }),
    db().from("manut_representantes_repasses")
      .select("*")
      .eq("representante_id", repId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (rep.error) throw new Error(rep.error.message);
  if (!rep.data) throw new Error("Representante não encontrado");

  // Vendas efetivadas: cupons_usos vinculados aos cupons deste rep
  const cupomIds = (cupons.data || []).map((c: any) => c.id);
  let usos: any[] = [];
  if (cupomIds.length > 0) {
    const { data: usosData } = await db()
      .from("manut_cupons_usos")
      .select("id, cupom_id, cliente_que_usou_id, valor_compra, cashback_gerado, desconto_aplicado, created_at, cliente:cliente_que_usou_id(nome,email)")
      .in("cupom_id", cupomIds)
      .order("created_at", { ascending: false })
      .limit(100);
    usos = usosData || [];
  }

  // Métricas agregadas
  const totalVendas = usos.length;
  const valorTotalVendido = usos.reduce((a, u) => a + Number(u.valor_compra || 0), 0);
  const totalComissaoGerada = usos.reduce((a, u) => a + Number(u.cashback_gerado || 0), 0);
  const totalRepassado = (repasses.data || []).reduce((a: number, r: any) => a + Number(r.valor || 0), 0);

  return {
    representante: rep.data as Representante,
    cupons: cupons.data || [],
    vendas: usos,
    repasses: repasses.data || [],
    metricas: {
      totalVendas,
      valorTotalVendido,
      totalComissaoGerada,
      totalRepassado,
      saldoAtual: Number((rep.data as any).saldo_acumulado || 0),
    },
  };
}

/** Lista materiais de treinamento ativos (em ordem). Público pro portal do rep autenticado. */
export async function listarMateriaisRepresentante() {
  const { data, error } = await db()
    .from("manut_representantes_materiais")
    .select("id, titulo, descricao, tipo, url, conteudo, destaque, ordem")
    .eq("ativo", true)
    .order("destaque", { ascending: false })
    .order("ordem", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}
