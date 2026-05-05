import { supabaseAdmin } from "../supabase";
import { hashSenha, verificarSenha, signToken, gerarSenhaInicial } from "../auth";
import { criarPreapproval } from "../mercadopago";
import { enviarSenhaTemporaria, enviarSenhaReset } from "../mailer";

const db = () => supabaseAdmin();

// ─── Login / autenticação cliente ──────────────────────────────────────────
export async function clienteLogin({ email, senha }: { email: string; senha: string }) {
  const { data: cli } = await db()
    .from("manut_clientes")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!cli) throw new Error("Email ou senha inválidos");
  if (!(await verificarSenha(senha, cli.senha_hash))) throw new Error("Email ou senha inválidos");
  if (cli.status === "cancelado") throw new Error("Cadastro cancelado. Contate o suporte.");

  await db().from("manut_clientes").update({ last_login_at: new Date().toISOString() }).eq("id", cli.id);

  const token = await signToken({
    sub: cli.id,
    tipo: "cliente",
    email: cli.email,
    troca: cli.senha_troca_obrigatoria
  });
  return { token, trocaObrigatoria: cli.senha_troca_obrigatoria, cliente: serializeCliente(cli) };
}

export async function clienteMe(clienteId: string) {
  const { data: cli } = await db().from("manut_clientes").select("*").eq("id", clienteId).maybeSingle();
  if (!cli) throw new Error("Cliente não encontrado");
  return serializeCliente(cli);
}

export async function clienteTrocarSenha(clienteId: string, senhaAtual: string, novaSenha: string) {
  if (!novaSenha || novaSenha.length < 6) throw new Error("Senha deve ter ao menos 6 caracteres");
  const { data: cli } = await db().from("manut_clientes").select("senha_hash").eq("id", clienteId).single();
  if (!cli || !(await verificarSenha(senhaAtual, cli.senha_hash))) throw new Error("Senha atual incorreta");
  await db()
    .from("manut_clientes")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: false })
    .eq("id", clienteId);
  return { ok: true };
}

export async function clienteResetSenha(email: string) {
  const { data: cli } = await db()
    .from("manut_clientes")
    .select("id,nome,email")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!cli) return { ok: true }; // não vaza existência
  const novaSenha = gerarSenhaInicial();
  await db()
    .from("manut_clientes")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: true })
    .eq("id", cli.id);
  await enviarSenhaReset(cli.email ?? email, cli.nome ?? "Cliente", novaSenha).catch(
    (e) => console.error("[mailer][reset]", e.message)
  );
  return { ok: true };
}

// ─── Dashboard / dados básicos ─────────────────────────────────────────────
export async function clienteDashboard(clienteId: string) {
  const [lojas, chamadosTotal, preventivasProx, materiaisPend] = await Promise.all([
    db().from("manut_lojas").select("id,nome,status,endereco,cidade,uf,cep,tamanho_m2,especialidades").eq("cliente_id", clienteId),
    db()
      .from("manut_chamados")
      .select("id,tipo,status")
      .eq("cliente_id", clienteId)
      .in("status", ["aberto", "em_andamento", "aguardando_material"]),
    db()
      .from("manut_preventivas")
      .select("id,data_agendada,loja_id,status")
      .eq("cliente_id", clienteId)
      .gte("data_agendada", new Date().toISOString())
      .order("data_agendada", { ascending: true })
      .limit(5),
    db()
      .from("manut_materiais")
      .select("id,descricao,valor,status")
      .eq("cliente_id", clienteId)
      .eq("status", "pendente_aprovacao")
  ]);

  // Distribuição de chamados por tipo
  const dist = { eletrica: 0, hidraulica: 0, civil: 0 } as Record<string, number>;
  (chamadosTotal.data || []).forEach((c: any) => { dist[c.tipo] = (dist[c.tipo] || 0) + 1; });

  return {
    lojas: lojas.data || [],
    chamadosAbertos: (chamadosTotal.data || []).length,
    distribuicao: dist,
    proximasPreventivas: preventivasProx.data || [],
    materiaisPendentes: materiaisPend.data || []
  };
}

// ─── Contratação pública ───────────────────────────────────────────────────
export async function contratarSubmit(payload: {
  loja: { email: string; nomeResp: string; nomeLoja: string; telefone?: string; tamanho?: number; especialidades?: string[] };
  plano: { id: string; nome: string; valorMensal: number; valorTotal?: number; duracaoMeses?: number; visitas: number };
  cadastro: { cnpjCpf: string; endereco?: string; cidade?: string; uf?: string; cep?: string };
}) {
  const { loja, plano, cadastro } = payload;
  if (!loja?.email || !loja?.nomeResp) throw new Error("Dados da loja obrigatórios");
  if (!plano?.id) throw new Error("Plano obrigatório");
  if (!cadastro?.cnpjCpf) throw new Error("Cadastro obrigatório");

  const email = loja.email.toLowerCase();
  const { data: dup } = await db().from("manut_clientes").select("*").eq("email", email).maybeSingle();

  let cliente: any;
  let senhaInicial: string | null = null;

  if (dup) {
    // Atualiza nome, telefone e plano — mantém senha e código existentes
    const { data } = await db()
      .from("manut_clientes")
      .update({
        nome: loja.nomeResp,
        telefone: loja.telefone || dup.telefone,
        plano_selecionado: plano.id,
        valor_mensal_contratado: plano.valorMensal,
        visitas_contratadas: plano.visitas,
        ...(dup.status === "cancelado" ? { status: "pendente" } : {})
      })
      .eq("id", dup.id)
      .select("*")
      .single();
    cliente = data || dup;
  } else {
    senhaInicial = gerarSenhaInicial();
    const codigo = "CLI-" + String(Date.now()).slice(-6);
    const { data, error } = await db()
      .from("manut_clientes")
      .insert({
        nome: loja.nomeResp,
        email,
        codigo,
        telefone: loja.telefone,
        cnpj_cpf: cadastro.cnpjCpf,
        status: "pendente",
        senha_hash: await hashSenha(senhaInicial),
        senha_troca_obrigatoria: true,
        plano_selecionado: plano.id,
        valor_mensal_contratado: plano.valorMensal,
        visitas_contratadas: plano.visitas,
        data_contratacao: new Date().toISOString()
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    cliente = data;
    await enviarSenhaTemporaria(email, loja.nomeResp, senhaInicial!).catch(
      (e) => console.error("[mailer][contratar]", e.message)
    );
  }

  // Loja
  await db().from("manut_lojas").insert({
    cliente_id: cliente.id,
    nome: loja.nomeLoja,
    endereco: cadastro.endereco,
    cidade: cadastro.cidade,
    uf: cadastro.uf || "SP",
    cep: cadastro.cep,
    tamanho_m2: loja.tamanho,
    especialidades: loja.especialidades || [],
    status: "pendente"
  });

  const valorCobranca = plano.valorTotal ?? plano.valorMensal;
  const duracaoMeses = plano.duracaoMeses ?? 1;

  // Pagamento pendente
  const { data: pag } = await db()
    .from("manut_pagamentos")
    .insert({
      cliente_id: cliente.id,
      valor: valorCobranca,
      referencia: new Date().toISOString().slice(0, 7),
      status: "pendente",
      data_vencimento: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();

  // Mercado Pago — assinatura cobrada a cada duracaoMeses meses pelo valorTotal
  const externalRef = `CJR-MANUT-${cliente.id}-${pag?.id}`;
  const mp = await criarPreapproval({
    cliente,
    plano: { ...plano, valorCobranca, duracaoMeses },
    externalReference: externalRef
  }).catch(
    (e) => ({ ok: false, motivo: e.message, initPoint: null, preapprovalId: null })
  );
  if (mp.ok && pag?.id) {
    await db()
      .from("manut_pagamentos")
      .update({ mercado_pago_id: mp.preapprovalId })
      .eq("id", pag.id);
  }

  return {
    ok: true,
    clienteId: cliente.id,
    senhaInicial,
    linkPagamento: mp.initPoint,
    mpStatus: mp.ok ? "ok" : "fallback",
    mpMotivo: mp.ok ? null : mp.motivo
  };
}

function serializeCliente(c: any) {
  const { senha_hash, ...rest } = c;
  return rest;
}
