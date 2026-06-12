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

  // Limite só aplica a chamados "normais"
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

  // Saldo incluso no plano (decrementa antes de cobrar)
  let inclusoNoPlano = false;
  if (tipoChamado === "extra" || tipoChamado === "emergencial") {
    const { data: cli } = await db()
      .from("manut_clientes")
      .select("extras_disponiveis,emergenciais_disponiveis")
      .eq("id", args.clienteId)
      .maybeSingle();
    const saldoExtras = Number(cli?.extras_disponiveis || 0);
    const saldoEmerg = Number(cli?.emergenciais_disponiveis || 0);
    if (tipoChamado === "extra" && saldoExtras > 0) {
      inclusoNoPlano = true;
      await db()
        .from("manut_clientes")
        .update({ extras_disponiveis: saldoExtras - 1 })
        .eq("id", args.clienteId);
    } else if (tipoChamado === "emergencial" && saldoEmerg > 0) {
      inclusoNoPlano = true;
      await db()
        .from("manut_clientes")
        .update({ emergenciais_disponiveis: saldoEmerg - 1 })
        .eq("id", args.clienteId);
    }
  }

  // Valor e prazo
  let valorChamado: number | null = null;
  let prazoAtendimento: string | null = null;
  let prioridade: "normal" | "alta" | "urgente" = "normal";
  if (tipoChamado === "extra") {
    valorChamado = inclusoNoPlano ? null : VALOR_CHAMADO_EXTRA;
    prazoAtendimento = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    prioridade = "alta";
  } else if (tipoChamado === "emergencial") {
    valorChamado = inclusoNoPlano ? null : VALOR_CHAMADO_EMERGENCIAL;
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
      incluso_no_plano: inclusoNoPlano,
      // Chamados inclusos no plano ja saem marcados como "pagos" para nao gerar fluxo Pix
      ...(inclusoNoPlano ? { pago_em: new Date().toISOString() } : {}),
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
  if ((chamado as any).incluso_no_plano) throw new Error("Chamado já incluso no plano — sem cobrança");
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
  motivoPendencia?: string;
  fotosEvidencia?: string[];
  fotosAntes?: string[];
  fotosDepois?: string[];
  geo?: { lat: number; lng: number };
  // true apenas no fluxo do técnico: exige foto ANTES p/ iniciar e foto DEPOIS p/ concluir.
  // Fluxos admin / chamados antigos não passam por essa exigência.
  exigirFotos?: boolean;
}) {
  const updates: any = { status: args.status };

  // Busca fotos já registradas para mesclar (e validar obrigatoriedade)
  let atuais: { fotos_antes?: string[] | null; fotos_depois?: string[] | null; fotos_evidencia?: string[] | null } = {};
  if (args.exigirFotos || args.fotosAntes?.length || args.fotosDepois?.length || args.fotosEvidencia?.length) {
    const { data: atual } = await db()
      .from("manut_chamados")
      .select("fotos_antes,fotos_depois,fotos_evidencia")
      .eq("id", args.chamadoId)
      .maybeSingle();
    atuais = atual || {};
  }
  const totalAntes = (atuais.fotos_antes?.length || 0) + (args.fotosAntes?.length || 0);
  const totalDepois = (atuais.fotos_depois?.length || 0) + (args.fotosDepois?.length || 0);

  if (args.exigirFotos && args.status === "em_andamento" && totalAntes < 1) {
    throw new Error("Tire pelo menos 1 foto do local ANTES de iniciar o serviço");
  }
  if (args.exigirFotos && args.status === "concluido" && totalDepois < 1) {
    throw new Error("Tire pelo menos 1 foto do local DEPOIS do serviço para concluir o chamado");
  }

  if (args.fotosAntes?.length) updates.fotos_antes = [...(atuais.fotos_antes || []), ...args.fotosAntes];
  if (args.fotosDepois?.length) updates.fotos_depois = [...(atuais.fotos_depois || []), ...args.fotosDepois];
  if (args.geo && Number.isFinite(args.geo.lat) && Number.isFinite(args.geo.lng)) {
    updates.geo_lat = args.geo.lat;
    updates.geo_lng = args.geo.lng;
    updates.geo_registrado_em = new Date().toISOString();
  }

  if (args.status === "concluido") {
    updates.data_conclusao = new Date().toISOString();
    if (args.observacao) updates.observacao_conclusao = args.observacao;
    if (args.fotosEvidencia?.length) {
      // Mescla com dedup: mantém retrocompatibilidade com o fluxo antigo (que enviava a lista completa)
      updates.fotos_evidencia = [...new Set([...(atuais.fotos_evidencia || []), ...args.fotosEvidencia])];
    }
  }
  if (args.status === "aguardando_material" && args.motivoPendencia) {
    updates.motivo_pendencia = args.motivoPendencia;
  }
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

// Upload de foto para o bucket "chamados".
// tipo "evidencia" (padrão): grava direto em fotos_evidencia (comportamento antigo).
// tipo "antes" / "depois": só sobe o arquivo e devolve a URL — a gravação nas colunas
// fotos_antes/fotos_depois acontece na mudança de status (atualizarStatusChamado).
export async function uploadFotoEvidencia(args: {
  chamadoId: string;
  tecnicoId: string;
  mime: string;
  dataBase64: string;
  tipo?: "evidencia" | "antes" | "depois";
}) {
  const tipo = args.tipo || "evidencia";

  // Valida chamado pertence ao técnico
  const { data: c } = await db()
    .from("manut_chamados")
    .select("id,tecnico_atribuido_id,fotos_evidencia")
    .eq("id", args.chamadoId)
    .maybeSingle();
  if (!c || c.tecnico_atribuido_id !== args.tecnicoId) throw new Error("Chamado não encontrado ou não atribuído a você");

  const ext = (args.mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const path = `${args.chamadoId}/${tipo === "evidencia" ? "" : `${tipo}_`}${Date.now()}.${ext}`;
  const buf = Buffer.from(args.dataBase64, "base64");

  const { error: upErr } = await db()
    .storage.from("chamados")
    .upload(path, buf, { contentType: args.mime, upsert: false });
  if (upErr) throw new Error("Falha no upload: " + upErr.message);

  const { data: pub } = db().storage.from("chamados").getPublicUrl(path);
  const url = pub.publicUrl;

  if (tipo !== "evidencia") return { url, fotos: [url] };

  const fotos = [...(c.fotos_evidencia || []), url];
  await db()
    .from("manut_chamados")
    .update({ fotos_evidencia: fotos })
    .eq("id", args.chamadoId);

  return { url, fotos };
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
