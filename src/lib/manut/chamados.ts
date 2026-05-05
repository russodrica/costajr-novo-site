import { supabaseAdmin } from "../supabase";
const db = () => supabaseAdmin();

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
}) {
  // Limite: 4 chamados abertos por tipo
  const { count } = await db()
    .from("manut_chamados")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", args.clienteId)
    .eq("tipo", args.tipo)
    .in("status", ["aberto", "em_andamento", "aguardando_material"]);
  if ((count || 0) >= 4) throw new Error(`Limite de 4 chamados abertos por tipo (${args.tipo})`);

  const { data, error } = await db()
    .from("manut_chamados")
    .insert({
      cliente_id: args.clienteId,
      loja_id: args.lojaId,
      tipo: args.tipo,
      local_loja: args.localLoja,
      descricao: args.descricao,
      status: "aberto",
      prioridade: "normal",
      data_abertura: new Date().toISOString()
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listarChamadosTecnico(tecnicoId: string) {
  const { data } = await db()
    .from("manut_chamados")
    .select("*, manut_lojas(nome,endereco,cidade)")
    .eq("tecnico_atribuido_id", tecnicoId)
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
