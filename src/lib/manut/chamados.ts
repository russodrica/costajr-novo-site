import { supabaseAdmin } from "../supabase";
import { criarPagamentoPixChamado } from "../mercadopago";
import { enviarEmailChamadoAdmin } from "../mailer";

const db = () => supabaseAdmin();

export const VALOR_CHAMADO_EXTRA = 250;
export const VALOR_CHAMADO_EMERGENCIAL = 350;

export async function listarChamadosCliente(clienteId: string) {
  const { data } = await db()
    .from("manut_chamados")
    .select("*, manut_lojas(nome), manut_tecnicos(nome)")
    .eq("cliente_id", clienteId)
    .order("data_abertura", { ascending: false });
  return data || [];
}

export async function criarChamadoCliente(args: {
  clienteId: string; lojaId: string; tipo: "eletrica"|"hidraulica"|"civil";
  localLoja?: string; descricao: string;
  tipoChamado?: "normal"|"extra"|"emergencial";
}) {
  const tipoChamado = args.tipoChamado || "normal";

  // Limite só aplica a chamados "normais" (extra/emergencial são únicos e pagos)
  if (tipoChamado === "normal") {
    const { count } = await db()
      .from("manut_chamados")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", args.clienteId)
      .eq("tipo", args.tipo)
      .eq("tipo_chamado", "normal")
      .in("status", ["aberto", "em_andamento", "aguardando_material"]);
    if ((count || 0) >= 4) throw new Error(`Limite de 4 chamados normais abertos por tipo (${args.tipo})`);
  }

  // Valor e prazo
  let valorChamado: number | null = null;
  let prazoAtendimento: string | null = null;
  let prioridade: "normal" | "alta" | "urgente" = "normal";
  if (tipoChamado === "extra") {
    valorChamado = VALOR_CHAMADO_EXTRA;
    prazoAtendimento = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    prioridade = "alta";
  } else if (tipoChamado === "emergencial") {
    valorChamado = VALOR_CHAMADO_EMERGENCIAL;
    prazoAtendimento = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    prioridade = "urgente";
  }

  const { data, error } = await db()
    .from("manut_chamados")
    .insert({
      cliente_id: args.clienteId,
      loja_id: args.lojaId,
      tipo: args.tipo,
      local_loja: args.localLoja,
      descricao: args.descricao,
      status: "aberto",
      prioridade,
      data_abertura: new Date().toISOString(),
      tipo_chamado: tipoChamado,
      valor_chamado: valorChamado,
      prazo_atendimento: prazoAtendimento,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Gera Pix para chamados pagos (extra/emergencial)
export async function gerarPixChamado(chamadoId: string, clienteId: string) {
  const { data: chamado } = await db()
    .from("manut_chamados")
    .select("*, manut_lojas(nome), manut_clientes(nome,email,cnpj_cpf)")
    .eq("id", chamadoId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!chamado) throw new Error("Chamado não encontrado");
  if (chamado.tipo_chamado === "normal") throw new Error("Chamado normal não requer pagamento");
  if (chamado.pago_em) throw new Error("Chamado já pago");

  const cli: any = (chamado as any).manut_clientes;
  const loja: any = (chamado as any).manut_lojas;

  const pix = await criarPagamentoPixChamado({
    cliente: { email: cli?.email, nome: cli?.nome, cnpjCpf: cli?.cnpj_cpf },
    chamado: {
      id: chamado.id,
      tipo: chamado.tipo_chamado as "extra" | "emergencial",
      loja: loja?.nome || "Loja",
      valor: Number(chamado.valor_chamado),
    },
  });
  if (!pix.ok) throw new Error(pix.motivo || "Falha ao gerar Pix");

  await db()
    .from("manut_chamados")
    .update({ mp_pix: pix as any })
    .eq("id", chamadoId);

  // Email admin (não bloqueia o retorno)
  try {
    await enviarEmailChamadoAdmin({
      tipoChamado: chamado.tipo_chamado as "extra" | "emergencial",
      clienteNome: cli?.nome || "Cliente",
      lojaNome: loja?.nome || "Loja",
      disciplina: chamado.tipo,
      descricao: chamado.descricao,
      valor: Number(chamado.valor_chamado),
      chamadoId: chamado.id,
    });
  } catch (e: any) {
    console.warn("[chamados] email admin falhou:", e?.message);
  }

  return { pix, chamado };
}

// Marca chamado como pago (chamado pelo webhook MP)
export async function marcarChamadoPago(chamadoId: string, mpId?: string) {
  const updates: any = { pago_em: new Date().toISOString() };
  if (mpId) updates.mp_pix = { ...((await db().from("manut_chamados").select("mp_pix").eq("id", chamadoId).maybeSingle()).data?.mp_pix || {}), paymentId: mpId };
  await db()
    .from("manut_chamados")
    .update(updates)
    .eq("id", chamadoId)
    .is("pago_em", null);
}

export async function listarChamadosTecnico(tecnicoId: string) {
  // Técnico vê: chamados atribuídos diretamente a ele + chamados de qualquer loja vinculada.
  const { listarLojaIdsDoTecnico } = await import("./tecnicos");
  const lojaIds = await listarLojaIdsDoTecnico(tecnicoId);

  const filtros: string[] = [`tecnico_atribuido_id.eq.${tecnicoId}`];
  if (lojaIds.length > 0) filtros.push(`loja_id.in.(${lojaIds.join(",")})`);

  const { data } = await db()
    .from("manut_chamados")
    .select("*, manut_lojas(nome,endereco,cidade), manut_clientes(nome)")
    .or(filtros.join(","))
    .in("status", ["aberto", "em_andamento", "aguardando_material"])
    .order("prioridade", { ascending: false });
  return data || [];
}

export async function atualizarStatusChamado(args: {
  chamadoId: string; tecnicoId: string;
  status: "em_andamento"|"aguardando_material"|"concluido";
  observacao?: string;
}) {
  const updates: any = { status: args.status };
  if (args.status === "concluido") updates.data_conclusao = new Date().toISOString();
  const { data, error } = await db()
    .from("manut_chamados")
    .update(updates)
    .eq("id", args.chamadoId)
    .eq("tecnico_atribuido_id", args.tecnicoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── Admin ─────────────────────────────────────────────────────────────────
export async function adminListarChamados(filtroStatus?: string) {
  let q = db().from("manut_chamados").select("*, manut_clientes(nome,email), manut_lojas(nome), manut_tecnicos(nome)");
  if (filtroStatus) q = q.eq("status", filtroStatus);
  const { data } = await q.order("data_abertura", { ascending: false }).limit(200);
  return data || [];
}

export async function adminAtribuirChamado(chamadoId: string, tecnicoId: string) {
  const { data, error } = await db()
    .from("manut_chamados")
    .update({ tecnico_atribuido_id: tecnicoId, status: "em_andamento" })
    .eq("id", chamadoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
