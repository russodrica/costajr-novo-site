import { supabaseAdmin } from "../supabase";

const db = () => supabaseAdmin();

export async function listarEstoqueLoja(lojaId: string) {
  const { data } = await db()
    .from("manut_estoque")
    .select("*")
    .eq("loja_id", lojaId)
    .order("nome");
  return data || [];
}

export async function listarEstoqueDeLojas(lojaIds: string[]) {
  if (!lojaIds.length) return [];
  const { data } = await db()
    .from("manut_estoque")
    .select("*, manut_lojas(nome,cidade,uf), manut_clientes:manut_lojas(manut_clientes(nome))")
    .in("loja_id", lojaIds)
    .order("nome");
  return data || [];
}

export async function listarMovimentosDeLojas(lojaIds: string[]) {
  if (!lojaIds.length) return [];
  const { data } = await db()
    .from("manut_estoque_movimentos")
    .select("*, manut_estoque(nome,unidade,preco_unitario), manut_lojas(nome)")
    .in("loja_id", lojaIds)
    .order("created_at", { ascending: false })
    .limit(200);
  return data || [];
}

export async function listarEstoqueCliente(clienteId: string) {
  // Pega todas as lojas do cliente, depois o estoque de cada uma
  const { data: lojas } = await db()
    .from("manut_lojas")
    .select("id,nome")
    .eq("cliente_id", clienteId);
  if (!lojas?.length) return [];
  const lojaIds = lojas.map((l: any) => l.id);
  const { data: itens } = await db()
    .from("manut_estoque")
    .select("*, manut_lojas(nome)")
    .in("loja_id", lojaIds)
    .order("nome");
  return itens || [];
}

export async function listarMovimentosCliente(clienteId: string) {
  const { data: lojas } = await db()
    .from("manut_lojas")
    .select("id")
    .eq("cliente_id", clienteId);
  if (!lojas?.length) return [];
  const lojaIds = lojas.map((l: any) => l.id);
  const { data } = await db()
    .from("manut_estoque_movimentos")
    .select("*, manut_estoque(nome,unidade,preco_unitario), manut_lojas(nome), manut_tecnicos(nome)")
    .in("loja_id", lojaIds)
    .order("created_at", { ascending: false })
    .limit(200);
  return data || [];
}

export async function darBaixaItem(args: {
  estoqueId: string;
  preventivaId?: string | null;
  tecnicoId?: string | null;
  quantidade: number;
  observacao?: string;
}) {
  const { data: item, error: getErr } = await db()
    .from("manut_estoque")
    .select("*")
    .eq("id", args.estoqueId)
    .single();
  if (getErr || !item) throw new Error("Item de estoque não encontrado");

  const novaQtd = Math.max(0, Number(item.quantidade_atual) - args.quantidade);

  const { error: upErr } = await db()
    .from("manut_estoque")
    .update({ quantidade_atual: novaQtd, updated_at: new Date().toISOString() })
    .eq("id", args.estoqueId);
  if (upErr) throw new Error(upErr.message);

  const { data: mov, error: movErr } = await db()
    .from("manut_estoque_movimentos")
    .insert({
      estoque_id: args.estoqueId,
      loja_id: item.loja_id,
      preventiva_id: args.preventivaId || null,
      tecnico_id: args.tecnicoId || null,
      tipo: "baixa",
      quantidade: args.quantidade,
      observacao: args.observacao || null,
    })
    .select("*")
    .single();
  if (movErr) throw new Error(movErr.message);
  return { item: { ...item, quantidade_atual: novaQtd }, movimento: mov };
}

export async function criarItemEstoque(args: {
  lojaId: string;
  nome: string;
  unidade?: string;
  quantidadeAtual?: number;
  quantidadeMinima?: number;
  precoUnitario?: number | null;
}) {
  if (!args.nome?.trim()) throw new Error("Nome do item é obrigatório");
  const { data, error } = await db()
    .from("manut_estoque")
    .insert({
      loja_id: args.lojaId,
      nome: args.nome.trim(),
      unidade: args.unidade?.trim() || "un",
      quantidade_atual: args.quantidadeAtual ?? 0,
      quantidade_minima: args.quantidadeMinima ?? 1,
      preco_unitario: args.precoUnitario ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function adicionarItemEAplicarBaixa(args: {
  lojaId: string;
  nome: string;
  unidade?: string;
  quantidadeUsada: number;
  preventivaId?: string | null;
  tecnicoId?: string | null;
  observacao?: string;
}) {
  // Técnico precisou trazer/usar um item que não estava no kit:
  // cria o item com qtd 0 + movimento de baixa (já usado).
  const item = await criarItemEstoque({
    lojaId: args.lojaId,
    nome: args.nome,
    unidade: args.unidade,
    quantidadeAtual: 0,
    quantidadeMinima: 1,
  });

  const { data: mov, error: movErr } = await db()
    .from("manut_estoque_movimentos")
    .insert({
      estoque_id: item.id,
      loja_id: args.lojaId,
      preventiva_id: args.preventivaId || null,
      tecnico_id: args.tecnicoId || null,
      tipo: "adicao",
      quantidade: args.quantidadeUsada,
      observacao: args.observacao || "Item novo adicionado durante a preventiva",
    })
    .select("*")
    .single();
  if (movErr) throw new Error(movErr.message);
  return { item, movimento: mov };
}

export async function solicitarReposicao(movimentoId: string) {
  const { data, error } = await db()
    .from("manut_estoque_movimentos")
    .update({
      reposicao_status: "solicitada",
      reposicao_solicitada_em: new Date().toISOString(),
    })
    .eq("id", movimentoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Marca reposição como "vou comprar até a próxima visita".
// Calcula o valor a partir do preço unitário atual do item × quantidade do movimento.
export async function solicitarReposicaoProximaVisita(movimentoId: string) {
  const { data: mov } = await db()
    .from("manut_estoque_movimentos")
    .select("estoque_id,quantidade,manut_estoque(preco_unitario)")
    .eq("id", movimentoId)
    .single();
  if (!mov) throw new Error("Movimento não encontrado");
  const preco = Number((mov.manut_estoque as any)?.preco_unitario || 0);
  const valor = preco * Number(mov.quantidade);

  const { data, error } = await db()
    .from("manut_estoque_movimentos")
    .update({
      reposicao_status: "aguardando_visita",
      reposicao_metodo: "proxima_visita",
      reposicao_valor: valor || null,
      reposicao_solicitada_em: new Date().toISOString(),
    })
    .eq("id", movimentoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Marca como "pagamento_pendente" e armazena o Pix gerado
export async function registrarPixReposicao(movimentoId: string, pix: any, valor: number) {
  const { data, error } = await db()
    .from("manut_estoque_movimentos")
    .update({
      reposicao_status: "pagamento_pendente",
      reposicao_metodo: "pix",
      reposicao_valor: valor,
      reposicao_mp_pix: pix,
      reposicao_solicitada_em: new Date().toISOString(),
    })
    .eq("id", movimentoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Webhook do MP marca o pagamento da reposição como confirmado
export async function marcarReposicaoPaga(movimentoId: string) {
  await db()
    .from("manut_estoque_movimentos")
    .update({ reposicao_status: "pago" })
    .eq("id", movimentoId)
    .neq("reposicao_status", "atendida"); // não sobrescreve se já foi reposto fisicamente
}

// Lista reposições pendentes (pago ou aguardando_visita) das lojas indicadas.
// É o que o técnico vê quando vai repor.
export async function listarReposicoesPendentes(lojaIds: string[]) {
  if (!lojaIds.length) return [];
  const { data } = await db()
    .from("manut_estoque_movimentos")
    .select("*, manut_estoque(nome,unidade,preco_unitario), manut_lojas(nome)")
    .in("loja_id", lojaIds)
    .in("reposicao_status", ["pago", "aguardando_visita"])
    .order("reposicao_solicitada_em", { ascending: true });
  return data || [];
}

// Confirma reposição física: soma na qtd_atual e marca como atendida.
// tecnicoId opcional — quando null, foi confirmação automática (webhook Pix).
export async function confirmarReposicaoFisica(args: {
  movimentoId: string;
  tecnicoId?: string | null;
  quantidade?: number;
  observacao?: string;
}) {
  const { data: mov } = await db()
    .from("manut_estoque_movimentos")
    .select("estoque_id, quantidade, reposicao_status, loja_id")
    .eq("id", args.movimentoId)
    .single();
  if (!mov) throw new Error("Movimento não encontrado");
  if (mov.reposicao_status === "atendida") throw new Error("Reposição já foi confirmada");

  const qtdRepor = Number(args.quantidade ?? mov.quantidade);

  const { data: item } = await db()
    .from("manut_estoque")
    .select("quantidade_atual")
    .eq("id", mov.estoque_id)
    .single();
  if (!item) throw new Error("Item não encontrado");

  // Soma no estoque
  await db()
    .from("manut_estoque")
    .update({
      quantidade_atual: Number(item.quantidade_atual) + qtdRepor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mov.estoque_id);

  // Marca movimento como atendido
  const { data, error } = await db()
    .from("manut_estoque_movimentos")
    .update({
      reposicao_status: "atendida",
      reposicao_atendida_em: new Date().toISOString(),
      reposto_em: new Date().toISOString(),
    })
    .eq("id", args.movimentoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // Cria também um movimento de "reposicao" para histórico claro
  await db().from("manut_estoque_movimentos").insert({
    estoque_id: mov.estoque_id,
    loja_id: mov.loja_id,
    tecnico_id: args.tecnicoId || null,
    tipo: "reposicao",
    quantidade: qtdRepor,
    observacao: args.observacao || (args.tecnicoId ? "Reposição confirmada pelo técnico" : "Reposição automática (Pix pago)"),
    reposicao_status: "atendida",
  });

  return data;
}

export async function atenderReposicao(movimentoId: string, quantidade: number) {
  // Quando admin/técnico repõe, soma na qtd_atual do item e marca movimento como atendido
  const { data: mov } = await db()
    .from("manut_estoque_movimentos")
    .select("estoque_id,quantidade")
    .eq("id", movimentoId)
    .single();
  if (!mov) throw new Error("Movimento não encontrado");

  const { data: item } = await db()
    .from("manut_estoque")
    .select("quantidade_atual")
    .eq("id", mov.estoque_id)
    .single();
  if (!item) throw new Error("Item não encontrado");

  await db()
    .from("manut_estoque")
    .update({
      quantidade_atual: Number(item.quantidade_atual) + quantidade,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mov.estoque_id);

  const { data, error } = await db()
    .from("manut_estoque_movimentos")
    .update({
      reposicao_status: "atendida",
      reposicao_atendida_em: new Date().toISOString(),
    })
    .eq("id", movimentoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
