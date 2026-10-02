import { supabaseAdmin } from "../supabase";
import { hashSenha, verificarSenha, signToken, gerarSenhaInicial } from "../auth";
import { enviarSenhaReset } from "../mailer";
import { ESP_KEYS, TIPO_CLIENTE_KEYS, espValida } from "./especialidades";
import { nivelPorNota } from "./avaliacaoTecnica";

const db = () => supabaseAdmin();

export type CadastroPrestador = {
  nome: string; email: string; telefone?: string; senha: string;
  tipo_pessoa?: string; cpf_cnpj?: string; cidade?: string; uf?: string; bairro?: string; cep?: string;
  tem_veiculo?: boolean; raio_km?: number; atende_urgencia?: boolean; atende_fora_comercial?: boolean;
  horarios?: any; tipos_cliente?: string[]; especialidades?: string[]; bio?: string;
};

function limpar<T extends string[]>(arr: any, validos: T): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((x) => String(x)).filter((x) => (validos as string[]).includes(x)))];
}

export function serializePrestador(p: any) {
  if (!p) return null;
  const { senha_hash, ...resto } = p;
  return resto;
}

// ── Cadastro público ──────────────────────────────────────────────────────
export async function prestadorCadastrar(d: CadastroPrestador) {
  const nome = String(d.nome || "").trim();
  const email = String(d.email || "").trim().toLowerCase();
  const senha = String(d.senha || "");
  if (!nome || nome.length < 3) throw new Error("Informe seu nome completo.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
  if (senha.length < 6) throw new Error("A senha deve ter ao menos 6 caracteres.");

  const especialidades = limpar(d.especialidades, ESP_KEYS);
  if (!especialidades.length) throw new Error("Escolha ao menos uma especialidade.");
  const tiposCliente = limpar(d.tipos_cliente, TIPO_CLIENTE_KEYS);

  const { data: ja } = await db().from("manut_prestadores").select("id").eq("email", email).maybeSingle();
  if (ja) throw new Error("Já existe um cadastro com este e-mail. Faça login.");

  const { data: novo, error } = await db().from("manut_prestadores").insert({
    nome, email, telefone: d.telefone || null,
    tipo_pessoa: d.tipo_pessoa === "pj" ? "pj" : "pf",
    cpf_cnpj: d.cpf_cnpj || null, cidade: d.cidade || null, uf: d.uf || null,
    bairro: d.bairro || null, cep: d.cep || null,
    tem_veiculo: !!d.tem_veiculo, raio_km: Number.isFinite(+d.raio_km!) ? Math.max(0, Math.min(500, +d.raio_km!)) : 10,
    atende_urgencia: !!d.atende_urgencia, atende_fora_comercial: !!d.atende_fora_comercial,
    horarios: d.horarios && typeof d.horarios === "object" ? d.horarios : {},
    tipos_cliente: tiposCliente, bio: d.bio || null,
    senha_hash: await hashSenha(senha), status: "avaliacao",
  }).select().single();
  if (error) throw new Error(error.message);

  // uma linha de especialidade por área escolhida (ainda não avaliada)
  const linhas = especialidades.map((e) => ({ prestador_id: novo.id, especialidade: e, nivel: "nao_avaliado", aprovado: false }));
  await db().from("manut_prestador_especialidades").insert(linhas);

  const token = await signToken({ sub: novo.id, tipo: "prestador", email });
  return { token, prestador: serializePrestador(novo), especialidades };
}

// ── Login / sessão ────────────────────────────────────────────────────────
export async function prestadorLogin({ email, senha }: { email: string; senha: string }) {
  const { data: p } = await db().from("manut_prestadores").select("*").eq("email", String(email || "").toLowerCase()).maybeSingle();
  if (!p || !(await verificarSenha(senha, p.senha_hash))) throw new Error("E-mail ou senha inválidos.");
  if (p.status === "inativo") throw new Error("Cadastro inativo. Fale com o suporte.");
  await db().from("manut_prestadores").update({ last_login_at: new Date().toISOString() }).eq("id", p.id);
  const token = await signToken({ sub: p.id, tipo: "prestador", email: p.email, troca: p.senha_troca_obrigatoria });
  return { token, trocaObrigatoria: !!p.senha_troca_obrigatoria, prestador: serializePrestador(p) };
}

export async function prestadorResetSenha(email: string) {
  const { data: p } = await db().from("manut_prestadores").select("id,nome,email").eq("email", String(email || "").toLowerCase().trim()).maybeSingle();
  if (!p) return { ok: true, emailEnviado: false };
  const nova = gerarSenhaInicial();
  await db().from("manut_prestadores").update({ senha_hash: await hashSenha(nova), senha_troca_obrigatoria: true }).eq("id", p.id);
  try { await enviarSenhaReset(p.email, p.nome || "Prestador", nova, "/manutencao/prestador/login"); return { ok: true, emailEnviado: true }; }
  catch (e: any) { return { ok: true, emailEnviado: false, emailErro: e.message }; }
}

export async function prestadorMe(id: string) {
  const { data: p } = await db().from("manut_prestadores").select("*").eq("id", id).maybeSingle();
  if (!p) throw new Error("Prestador não encontrado.");
  const { data: esps } = await db().from("manut_prestador_especialidades").select("*").eq("prestador_id", id);
  return { ...serializePrestador(p), especialidades: esps || [], ranking: scoreRanking(p, esps || []) };
}

// ── Registro de uma avaliação técnica ─────────────────────────────────────
export async function registrarAvaliacao(prestadorId: string, especialidade: string, corr: { nota: number; aprovado: boolean; total: number; acertos: number; nivel: string; detalhe: any[] }) {
  if (!espValida(especialidade)) throw new Error("Especialidade inválida.");
  await db().from("manut_prestador_avaliacoes").insert({
    prestador_id: prestadorId, especialidade, nota: corr.nota, aprovado: corr.aprovado,
    total_perguntas: corr.total, acertos: corr.acertos, respostas: corr.detalhe,
  });
  // upsert do estado atual da especialidade (mantém a MELHOR nota)
  const { data: atual } = await db().from("manut_prestador_especialidades")
    .select("id,nota").eq("prestador_id", prestadorId).eq("especialidade", especialidade).maybeSingle();
  const notaFinal = Math.max(corr.nota, atual?.nota ?? 0);
  const nivelFinal = nivelPorNota(notaFinal);
  const aprovadoFinal = notaFinal >= 70;
  if (atual) {
    await db().from("manut_prestador_especialidades").update({ nota: notaFinal, nivel: nivelFinal, aprovado: aprovadoFinal, avaliado_em: new Date().toISOString() }).eq("id", atual.id);
  } else {
    await db().from("manut_prestador_especialidades").insert({ prestador_id: prestadorId, especialidade, nota: notaFinal, nivel: nivelFinal, aprovado: aprovadoFinal, avaliado_em: new Date().toISOString() });
  }
  await recomputarNotaGeral(prestadorId);
  return { nota: notaFinal, aprovado: aprovadoFinal, nivel: nivelFinal };
}

export async function recomputarNotaGeral(prestadorId: string) {
  const { data: esps } = await db().from("manut_prestador_especialidades").select("nota,aprovado").eq("prestador_id", prestadorId);
  const aprovadas = (esps || []).filter((e: any) => e.aprovado && Number.isFinite(e.nota));
  const media = aprovadas.length ? Math.round(aprovadas.reduce((s: number, e: any) => s + e.nota, 0) / aprovadas.length) : null;
  await db().from("manut_prestadores").update({ nota_geral: media, updated_at: new Date().toISOString() }).eq("id", prestadorId);
  return media;
}

// ── RANKING (V1) ──────────────────────────────────────────────────────────
// Sem histórico de jobs/avaliações do cliente ainda (isso entra na Fase 2).
// Por enquanto: nota técnica (60%) + prontidão/mobilidade (25%) + amplitude de
// especialidades aprovadas (15%). A reputação do cliente e a proximidade entram
// depois como pesos adicionais no matching.
export function scoreRanking(p: any, esps: any[]): number {
  const notaTec = Number.isFinite(p?.nota_geral) ? p.nota_geral : 0;          // 0-100
  const aprovadas = (esps || []).filter((e) => e.aprovado).length;
  const prontidao = (p?.tem_veiculo ? 34 : 0) + (p?.atende_urgencia ? 33 : 0) + (p?.atende_fora_comercial ? 33 : 0); // 0-100
  const amplitude = Math.min(100, aprovadas * 25);                             // 4+ áreas = 100
  return Math.round(notaTec * 0.6 + prontidao * 0.25 + amplitude * 0.15);
}

// ── Admin ─────────────────────────────────────────────────────────────────
export async function listarPrestadoresAdmin() {
  const { data: ps } = await db().from("manut_prestadores").select("*").order("criado_em", { ascending: false }).limit(2000);
  const ids = (ps || []).map((p: any) => p.id);
  let espsPorPrestador: Record<string, any[]> = {};
  if (ids.length) {
    const { data: esps } = await db().from("manut_prestador_especialidades").select("*").in("prestador_id", ids);
    for (const e of esps || []) (espsPorPrestador[e.prestador_id] ||= []).push(e);
  }
  return (ps || []).map((p: any) => {
    const esps = espsPorPrestador[p.id] || [];
    return { ...serializePrestador(p), especialidades: esps, ranking: scoreRanking(p, esps) };
  });
}

const STATUS_VALIDOS = ["cadastro", "avaliacao", "aprovado", "reprovado", "inativo"];
export async function setStatusPrestador(id: string, status: string, admin: { email?: string }) {
  if (!STATUS_VALIDOS.includes(status)) throw new Error("Status inválido.");
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (status === "aprovado") { patch.aprovado_em = new Date().toISOString(); patch.aprovado_por = admin?.email || null; }
  const { error } = await db().from("manut_prestadores").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
