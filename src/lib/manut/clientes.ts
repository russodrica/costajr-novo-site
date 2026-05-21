import { supabaseAdmin } from "../supabase";
import { hashSenha, verificarSenha, signToken, gerarSenhaInicial } from "../auth";
import { criarPreference } from "../mercadopago";
import { enviarSenhaTemporaria, enviarSenhaReset } from "../mailer";
import { inclusoesParaDuracao } from "./planos-inclusos";
import { regraIndicacaoPorDuracao } from "./indicacao-regras";

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
  if (!cli) return { ok: true, emailEnviado: false }; // não vaza existência
  const novaSenha = gerarSenhaInicial();
  await db()
    .from("manut_clientes")
    .update({ senha_hash: await hashSenha(novaSenha), senha_troca_obrigatoria: true })
    .eq("id", cli.id);
  try {
    await enviarSenhaReset(cli.email ?? email, cli.nome ?? "Cliente", novaSenha);
    return { ok: true, emailEnviado: true };
  } catch (e: any) {
    console.error("[mailer][reset]", e.message);
    return { ok: true, emailEnviado: false, emailErro: e.message };
  }
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
  cupom?: { codigo?: string };
}) {
  const { loja, plano, cadastro, cupom } = payload;
  if (!loja?.email || !loja?.nomeResp) throw new Error("Dados da loja obrigatórios");
  if (!plano?.id) throw new Error("Plano obrigatório");
  if (!cadastro?.cnpjCpf) throw new Error("Cadastro obrigatório");

  // Resolve cupom (se enviado) — apenas para registrar uso e creditar cashback ao dono
  let cupomData: any = null;
  if (cupom?.codigo) {
    const { data } = await db()
      .from("manut_cupons")
      .select("*")
      .eq("codigo", cupom.codigo.toUpperCase().trim())
      .eq("ativo", true)
      .maybeSingle();
    if (data) {
      const expirado = data.validade && new Date(data.validade) < new Date();
      const esgotado = data.usos_maximos && data.usos_atuais >= data.usos_maximos;
      if (!expirado && !esgotado) cupomData = data;
    }
  }

  const email = loja.email.toLowerCase();
  const { data: dup } = await db().from("manut_clientes").select("*").eq("email", email).maybeSingle();

  // Resolve inclusoes (visitas extras + emergenciais) com base na duracao do plano
  const inclusoes = inclusoesParaDuracao(plano.duracaoMeses ?? 1);

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
        extras_contratados: inclusoes.extras,
        emergenciais_contratados: inclusoes.emergenciais,
        extras_disponiveis: inclusoes.extras,
        emergenciais_disponiveis: inclusoes.emergenciais,
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
        extras_contratados: inclusoes.extras,
        emergenciais_contratados: inclusoes.emergenciais,
        extras_disponiveis: inclusoes.extras,
        emergenciais_disponiveis: inclusoes.emergenciais,
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

  // Mercado Pago — pagamento unico do valor total do plano (Checkout Pro).
  // Cliente paga 100% upfront via Pix/cartao/boleto na tela do MP.
  const externalRef = `CJR-MANUT-${cliente.id}-${pag?.id}`;
  const mp = await criarPreference({
    cliente: { id: cliente.id, email: cliente.email, nome: cliente.nome },
    plano: { nome: plano.nome, valor: valorCobranca },
    externalReference: externalRef
  }).catch(
    (e) => ({ ok: false, motivo: e.message, initPoint: null })
  );
  if (mp.ok && pag?.id) {
    // mercado_pago_id agora guarda o preference_id (init_point e tracking)
    const initPoint = (mp as any).initPoint || "";
    const prefId = initPoint.split("pref_id=")[1] || initPoint;
    await db()
      .from("manut_pagamentos")
      .update({ mercado_pago_id: prefId })
      .eq("id", pag.id);
  }

  // Registra uso do cupom + credita cashback no dono (cliente indicador OU representante)
  if (cupomData) {
    try {
      const tipoCupom = String(cupomData.tipo || "desconto");
      const representanteId: string | null = cupomData.representante_id || null;
      const clienteDonoId: string | null = cupomData.cliente_dono_id || null;

      // Para cupom de representante (programa Indique e Ganha), as regras NÃO vêm do registro
      // armazenado: cada cupom tem 1 código só, mas aplica regras diferentes por plano.
      // A tabela em ~/lib/manut/indicacao-regras define qual regra usar pra cada duração (3/6/12).
      // Pra cupons normais (tipo='desconto' ou 'indicacao'), usa os valores fixos do registro.
      let descontoPct: number;
      let duracaoCupomMeses: number;
      let cashbackPct: number;
      if (tipoCupom === "representante") {
        const regra = regraIndicacaoPorDuracao(duracaoMeses);
        descontoPct = Number(regra.desconto_pct || 0);
        duracaoCupomMeses = Number(regra.duracao_desconto_meses || 0);
        cashbackPct = Number(regra.comissao_pct || 0);
      } else {
        descontoPct = Number(cupomData.desconto_percentual || 0);
        duracaoCupomMeses = Math.max(1, Number(cupomData.duracao_meses || 1));
        cashbackPct = Number(cupomData.cashback_pct || 0);
      }

      const valorMensalPlano = Number(plano.valorMensal || 0);

      // Desconto sobre N parcelas mensais do plano (não sobre o total).
      // Se o plano é de 12 meses e o cupom é "20% por 2 meses", desconto = valorMensal × 20% × 2.
      // O frontend já aplica esse cálculo no valorTotal enviado — aqui registramos o valor histórico.
      const mesesDescontados = Math.min(duracaoCupomMeses, duracaoMeses);
      const descontoAplicado = valorMensalPlano > 0 && mesesDescontados > 0
        ? (valorMensalPlano * descontoPct * mesesDescontados) / 100
        : (descontoPct > 0 ? (valorCobranca * descontoPct) / 100 : 0); // fallback proporcional

      // Cashback do dono é calculado sobre o valor efetivamente pago pelo cliente (já com desconto aplicado).
      // Não credita cashback quando o dono == quem usa (cliente não pode ganhar comissão dele mesmo).
      const donoDiferenteDeQuemUsa = !clienteDonoId || clienteDonoId !== cliente.id;
      const cashbackGerado = cashbackPct > 0 && donoDiferenteDeQuemUsa && (representanteId || clienteDonoId)
        ? (valorCobranca * cashbackPct) / 100
        : 0;

      // Incrementa contador de usos
      await db()
        .from("manut_cupons")
        .update({ usos_atuais: (cupomData.usos_atuais || 0) + 1 })
        .eq("id", cupomData.id);

      // Histórico de uso (manut_cupons_usos só referencia cliente_dono — quando dono é representante,
      // cliente_dono_id fica null e o vínculo com o representante é via cupom_id → cupom.representante_id).
      await db().from("manut_cupons_usos").insert({
        cupom_id: cupomData.id,
        cliente_que_usou_id: cliente.id,
        cliente_dono_id: clienteDonoId,
        valor_compra: valorCobranca,
        cashback_gerado: cashbackGerado,
        desconto_aplicado: descontoAplicado,
      });

      // Credita cashback conforme tipo de dono
      if (cashbackGerado > 0) {
        if (tipoCupom === "representante" && representanteId) {
          // Crédito no representante (parceiro externo)
          const { creditarSaldoRepresentante } = await import("./representantes");
          await creditarSaldoRepresentante(representanteId, cashbackGerado);
        } else if (clienteDonoId) {
          // Crédito no cliente indicador (cashback de indicação cliente→cliente)
          const { data: dono } = await db()
            .from("manut_clientes")
            .select("saldo_cashback,nome")
            .eq("id", clienteDonoId)
            .maybeSingle();
          const saldoAnterior = Number(dono?.saldo_cashback || 0);
          const saldoNovo = Number((saldoAnterior + cashbackGerado).toFixed(2));
          await db()
            .from("manut_clientes")
            .update({ saldo_cashback: saldoNovo })
            .eq("id", clienteDonoId);
          await db().from("manut_cashback_movimentos").insert({
            cliente_id: clienteDonoId,
            tipo: "credito",
            valor: cashbackGerado,
            saldo_apos: saldoNovo,
            origem: `Indicação: ${cliente.nome || "novo cliente"}`,
            referencia_id: cliente.id,
          });
        }
      }
    } catch (e: any) {
      console.warn("[contratar][cupom]", e?.message);
    }
  }

  return {
    ok: true,
    clienteId: cliente.id,
    senhaInicial,
    linkPagamento: mp.initPoint,
    mpStatus: mp.ok ? "ok" : "fallback",
    mpMotivo: mp.ok ? null : mp.motivo,
    cupomAplicado: cupomData ? {
      codigo: cupomData.codigo,
      // Para cupom de representante, devolve o desconto efetivamente aplicado neste plano
      // (não o valor armazenado no registro, que é genérico).
      desconto: String(cupomData.tipo || "") === "representante"
        ? Number(regraIndicacaoPorDuracao(duracaoMeses).desconto_pct || 0)
        : Number(cupomData.desconto_percentual || 0),
    } : null,
  };
}

// Converte saldo de cashback do cliente em um cupom de renovação único
// (uso típico: quando o plano vai vencer e o cliente quer aplicar o saldo)
export async function gerarCupomRenovacao(clienteId: string) {
  const { data: cli } = await db()
    .from("manut_clientes")
    .select("id,nome,saldo_cashback,valor_mensal_contratado")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cli) throw new Error("Cliente não encontrado");
  const saldo = Number(cli.saldo_cashback || 0);
  if (saldo <= 0) throw new Error("Sem saldo de cashback disponível");

  // Estimativa do valor mensal pra calcular percentual (mantém em 100% se desconhecido)
  const valorRef = Number(cli.valor_mensal_contratado || 0) || saldo;
  let pct = (saldo / valorRef) * 100;
  pct = Math.min(100, Math.max(1, Math.round(pct * 100) / 100));

  const codigo = `CASH-${(cli.nome || "CJR").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const validade = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: cupom, error } = await db().from("manut_cupons").insert({
    codigo,
    descricao: `Cashback acumulado de ${cli.nome || "cliente"} (R$ ${saldo.toFixed(2).replace(".", ",")})`,
    desconto_percentual: pct,
    duracao_meses: 1,
    usos_maximos: 1,
    cliente_dono_id: clienteId,
    tipo: "indicacao", // gerado a partir de cashback acumulado por indicações
    cashback_pct: 0,
    ativo: true,
    validade,
  }).select("*").single();
  if (error) throw new Error(error.message);

  // Zera saldo + registra débito
  await db().from("manut_clientes").update({ saldo_cashback: 0 }).eq("id", clienteId);
  await db().from("manut_cashback_movimentos").insert({
    cliente_id: clienteId,
    tipo: "debito",
    valor: saldo,
    saldo_apos: 0,
    origem: `Convertido em cupom ${codigo}`,
    referencia_id: cupom.id,
  });

  return { cupom, valorConvertido: saldo, descontoPct: pct };
}

function serializeCliente(c: any) {
  const { senha_hash, ...rest } = c;
  return rest;
}
