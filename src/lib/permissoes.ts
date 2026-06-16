// Central de permissões por perfil (matriz editável em /admin/permissoes).
import { supabaseAdmin } from "./supabase";
import { perfisDe, type AdminClaims } from "./auth";

export const AREAS_PORTAL = [
  { id: "onboarding", label: "Onboarding" },
  { id: "treinamentos", label: "Treinamentos" },
  { id: "forum", label: "Fórum" },
  { id: "documentos", label: "Documentos" },
  { id: "comercial", label: "Gestão Comercial" },
  { id: "gestao", label: "Gestão Manutenção" },
  { id: "meus-equipamentos", label: "Meus Equipamentos" },
] as const;

export const CATEGORIAS_KB = [
  "Geral", "Administrativo", "Financeiro", "Trabalhista", "Segurança do Trabalho",
  "RH", "Recrutamento", "Comercial", "Operacional",
] as const;

// Os 8 PERFIS do portal (= as áreas da empresa). "operacional" é a chave histórica
// do perfil rotulado "Operação" (mantida para não migrar dados). "coordenador" foi
// REMOVIDO (decisão da Adriana, 14/06/2026) — só fica no mapa de rótulos p/ exibir
// dados legados sem quebrar.
export const PERFIS = [
  "admin",
  "manutencao_operacao",
  "manutencao_administrativo",
  "operacional",
  "rh",
  "financeiro",
  "comercial",
  "juridico",
] as const;

/** Rótulo amigável de cada perfil (o que aparece na tela). */
export const PERFIL_LABEL: Record<string, string> = {
  admin: "Administrador",
  manutencao_operacao: "Manutenção - Operação",
  manutencao_administrativo: "Manutenção - Administrativo",
  operacional: "Operação",
  rh: "RH / DP",
  financeiro: "Financeiro",
  comercial: "Comercial",
  juridico: "Jurídico",
  coordenador: "Coordenador (legado)", // só p/ exibir dados antigos
};

/** Classe de badge (cor) de cada perfil. */
export const PERFIL_BADGE: Record<string, string> = {
  admin: "badge-red",
  manutencao_operacao: "badge-blue",
  manutencao_administrativo: "badge-gray",
  operacional: "badge-gray",
  rh: "badge-green",
  financeiro: "badge-yellow",
  comercial: "badge-orange",
  juridico: "badge-purple",
  coordenador: "badge-gray",
};

/** Lista de perfis válidos para acessar o painel admin (= PERFIS). */
export const PERFIS_PAINEL: string[] = [...PERFIS];
/** true se a chave é um perfil válido do portal. */
export function ehPerfilValido(role: string): boolean {
  return (PERFIS as readonly string[]).includes(role);
}
/** Rótulo do perfil (cai na própria chave se desconhecido). */
export function rotuloPerfil(role: string): string {
  return PERFIL_LABEL[role] || role;
}

export interface PermissaoPerfil { perfil: string; areas: string[]; categorias_kb: string[] }

const TODAS_AREAS = AREAS_PORTAL.map((a) => a.id);

/** Permissões efetivas do usuário (união de todos os seus perfis).
 *  Admin sempre tem tudo. Se a tabela não existir/estiver vazia, libera o padrão seguro. */
export async function permissoesDoUsuario(claims: AdminClaims): Promise<{ areas: string[]; categoriasKb: string[]; perfis: string[] }> {
  const db = supabaseAdmin();
  // Perfis FRESCOS do banco — refletem mudança de perfil SEM o usuário precisar relogar.
  // (fallback nos perfis do token se a consulta falhar)
  let perfis = perfisDe(claims);
  try {
    const { data: prof } = await db.from("portal_profiles").select("role, roles").eq("id", claims.sub).maybeSingle();
    if (prof) {
      const fresh = ((prof.roles && prof.roles.length) ? prof.roles : [prof.role]).filter(Boolean);
      if (fresh.length) perfis = fresh;
    }
  } catch { /* mantém os perfis do token */ }

  if (perfis.includes("admin")) return { areas: [...TODAS_AREAS], categoriasKb: [...CATEGORIAS_KB], perfis };

  const { data, error } = await db.from("portal_permissoes").select("perfil, areas, categorias_kb").in("perfil", perfis);
  if (error || !data?.length) {
    // fallback (sem linha na matriz): áreas básicas, sem comercial/gestão
    return { areas: ["onboarding", "treinamentos", "forum", "documentos", "meus-equipamentos"], categoriasKb: ["Geral"], perfis };
  }
  const areas = new Set<string>();
  const cats = new Set<string>();
  for (const p of data) {
    for (const a of p.areas || []) areas.add(a);
    for (const c of p.categorias_kb || []) cats.add(c);
  }
  return { areas: [...areas], categoriasKb: [...cats], perfis };
}

/** Lança erro 403 amigável quando o usuário não tem a área liberada. */
export async function exigirArea(claims: AdminClaims, area: string): Promise<void> {
  const { areas } = await permissoesDoUsuario(claims);
  if (!areas.includes(area)) {
    const rotulo = AREAS_PORTAL.find((a) => a.id === area)?.label || area;
    throw Object.assign(new Error(`Seu perfil não tem acesso a ${rotulo}. Fale com o administrador.`), { http: 403 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PERMISSÃO GRANULAR POR USUÁRIO (módulos do admin) — ver/editar, sobrescreve perfil
// ════════════════════════════════════════════════════════════════════════════

export type NivelPerm = "nenhum" | "ver" | "editar";
export type ModuloAdmin = { key: string; label: string; icon: string; href: string };
export type GrupoAdmin = { id: string; label: string | null; itens: ModuloAdmin[] };

// FONTE ÚNICA do menu/módulos do admin (Admin.astro, a matriz e o enforcement importam daqui).
export const GRUPOS_ADMIN: GrupoAdmin[] = [
  { id: "geral", label: null, itens: [
    { key: "dashboard", label: "Dashboard", icon: "📊", href: "/admin/dashboard" },
    { key: "analytics", label: "Análise do Site", icon: "📈", href: "/admin/analytics" },
  ] },
  // "Meu Espaço" — módulos colaborador-facing (cada um vê os SEUS dados). SEM entrada
  // em GRUPO_ROLES de propósito => liberado para todo usuário logado (autoatendimento).
  { id: "meu-espaco", label: "Meu Espaço", itens: [
    { key: "meu-onboarding", label: "Onboarding", icon: "✅", href: "/admin/meu-onboarding" },
    { key: "junia", label: "Fórum / JunIA", icon: "🤖", href: "/admin/junia" },
    { key: "documentos-portal", label: "Documentos", icon: "📄", href: "/admin/documentos-portal" },
    { key: "meus-equipamentos", label: "Meus Equipamentos", icon: "🎒", href: "/admin/meus-equipamentos" },
  ] },
  { id: "manutencao", label: "Manutenção", itens: [
    { key: "clientes", label: "Clientes", icon: "👥", href: "/admin/clientes" },
    { key: "tecnicos", label: "Técnicos", icon: "🔧", href: "/admin/tecnicos" },
    { key: "chamados", label: "Chamados", icon: "📋", href: "/admin/chamados" },
    { key: "preventivas", label: "Preventivas", icon: "🗓️", href: "/admin/preventivas" },
    { key: "pagamentos", label: "Pagamentos", icon: "💰", href: "/admin/pagamentos" },
    { key: "materiais", label: "Materiais", icon: "🔩", href: "/admin/materiais" },
    { key: "estoque-alteracoes", label: "Alt. Preço Estoque", icon: "💲", href: "/admin/estoque-alteracoes" },
    { key: "leads", label: "Pré-cadastros", icon: "📣", href: "/admin/leads" },
    { key: "cupons", label: "Cupons & Cashback", icon: "🎁", href: "/admin/cupons" },
    { key: "representantes", label: "Representantes", icon: "🤝", href: "/admin/representantes" },
    { key: "materiais-representante", label: "Materiais Indique", icon: "📚", href: "/admin/materiais-representante" },
    { key: "parametrizacao", label: "Parametrização", icon: "⚙️", href: "/admin/parametrizacao" },
  ] },
  { id: "operacoes", label: "Operações & Obras", itens: [
    { key: "ativos", label: "Ativos Patrimoniais", icon: "🏷️", href: "/admin/ativos" },
    { key: "obras", label: "Obras & Projetos", icon: "🏗️", href: "/admin/obras" },
    { key: "depositos", label: "Depósitos", icon: "📦", href: "/admin/depositos" },
    { key: "orcamentos", label: "Orçamentos", icon: "🧮", href: "/admin/orcamentos" },
  ] },
  { id: "rh", label: "RH & Pessoas", itens: [
    { key: "rh", label: "RH — Pessoas", icon: "🧑‍💼", href: "/admin/rh" },
    { key: "recrutamento", label: "Recrutamento (R&S)", icon: "🧲", href: "/admin/recrutamento" },
    { key: "avaliacoes", label: "Avaliação de Desempenho", icon: "📊", href: "/admin/avaliacoes" },
    { key: "clima", label: "Pesquisa de Clima", icon: "🌡️", href: "/admin/clima" },
    { key: "rh-analytics", label: "People Analytics (RH)", icon: "📈", href: "/admin/rh-analytics" },
  ] },
  { id: "financeiro", label: "Financeiro", itens: [
    { key: "financeiro", label: "Financeiro", icon: "🏦", href: "/admin/financeiro" },
    { key: "fin-conciliacao", label: "Conciliação (OFX)", icon: "🔄", href: "/admin/fin-conciliacao" },
  ] },
  { id: "comercial", label: "Comercial", itens: [
    { key: "comercial", label: "Comercial (CRM)", icon: "📊", href: "/admin/comercial" },
  ] },
  { id: "juridico", label: "Jurídico & Documentos", itens: [
    { key: "doc-empresa", label: "Documentos da Empresa", icon: "📑", href: "/admin/doc-empresa" },
    { key: "assinaturas", label: "Assinaturas (D4Sign)", icon: "✍️", href: "/admin/assinaturas" },
  ] },
  { id: "portal", label: "Portal Colaborador", itens: [
    { key: "membros", label: "Membros", icon: "🪪", href: "/admin/membros" },
    { key: "permissoes", label: "Permissões de Acesso", icon: "🔐", href: "/admin/permissoes" },
    { key: "portal-comunicados", label: "Comunicados", icon: "📢", href: "/admin/portal-comunicados" },
    { key: "portal-kb", label: "Base de Conhecimento", icon: "🔍", href: "/admin/portal-kb" },
    { key: "perguntas", label: "Perguntas (JunIA)", icon: "🤖", href: "/admin/perguntas" },
    { key: "portal-onboarding", label: "Onboarding", icon: "✅", href: "/admin/portal-onboarding" },
    { key: "portal-treinamentos", label: "Treinamentos", icon: "🎬", href: "/admin/portal-treinamentos" },
    { key: "portal-integracao", label: "Docs Integração", icon: "📄", href: "/admin/portal-integracao" },
  ] },
  { id: "institucional", label: "Institucional", itens: [
    { key: "suporte", label: "Suporte", icon: "💬", href: "/admin/suporte" },
    { key: "blog", label: "Blog", icon: "📝", href: "/admin/blog" },
  ] },
  { id: "sistema", label: "Sistema", itens: [
    { key: "logs", label: "Auditoria (Logs)", icon: "🧾", href: "/admin/logs" },
    { key: "lixeira", label: "Lixeira", icon: "🗑️", href: "/admin/lixeira" },
    { key: "telegram", label: "Bot Telegram", icon: "🤖", href: "/admin/telegram" },
  ] },
  { id: "conta", label: "Conta", itens: [
    { key: "minha-conta", label: "Minha Conta", icon: "🙍", href: "/admin/minha-conta" },
  ] },
];

// Quais perfis veem cada GRUPO por PADRÃO (espelha o Doc 07). Admin vê tudo.
// Grupos sem entrada (conta) ficam liberados para todos. O override por usuário ajusta.
export const GRUPO_ROLES: Record<string, string[]> = {
  geral:      ["admin", "financeiro", "comercial", "operacional", "manutencao_operacao", "manutencao_administrativo"],
  manutencao: ["admin", "operacional", "manutencao_operacao", "manutencao_administrativo"],
  operacoes:  ["admin", "operacional", "manutencao_operacao", "manutencao_administrativo"],
  rh:         ["admin", "rh"],
  financeiro: ["admin", "financeiro"],
  comercial:  ["admin", "comercial"],
  juridico:   ["admin", "juridico", "financeiro"],
  portal:     ["admin"],
  institucional: ["admin"],
  sistema:    ["admin"],
};

// Mapa key do módulo -> id do grupo.
export const MODULO_GRUPO: Record<string, string> = Object.fromEntries(
  GRUPOS_ADMIN.flatMap((g) => g.itens.map((m) => [m.key, g.id])),
);
// Mapa key do módulo -> label (para mensagens).
export const MODULO_LABEL: Record<string, string> = Object.fromEntries(
  GRUPOS_ADMIN.flatMap((g) => g.itens.map((m) => [m.key, m.label])),
);

/** Nível padrão de um módulo conforme os perfis (sem override do usuário):
 *  'editar' se o grupo do módulo é liberado para algum perfil; senão 'nenhum'. */
export function nivelPadraoPerfil(grupoId: string, perfis: string[]): NivelPerm {
  if (perfis.includes("admin")) return "editar";
  const roles = GRUPO_ROLES[grupoId];
  const liberado = !roles || roles.some((r) => perfis.includes(r));
  return liberado ? "editar" : "nenhum";
}

/** Nível EFETIVO de um módulo: override do usuário, senão padrão do perfil.
 *  Admin nunca é travado (sempre 'editar'). */
export function nivelEfetivo(moduloKey: string, perfis: string[], overrides: Record<string, NivelPerm>): NivelPerm {
  if (perfis.includes("admin")) return "editar";
  const ov = overrides[moduloKey];
  if (ov === "nenhum" || ov === "ver" || ov === "editar") return ov;
  return nivelPadraoPerfil(MODULO_GRUPO[moduloKey] || "", perfis);
}

/** Perfis FRESCOS do usuário (lidos do banco; fallback no token). */
export async function perfisFrescos(claims: AdminClaims): Promise<string[]> {
  let perfis = perfisDe(claims);
  try {
    const db = supabaseAdmin();
    const { data: prof } = await db.from("portal_profiles").select("role, roles").eq("id", claims.sub).maybeSingle();
    if (prof) {
      const fresh = ((prof.roles && prof.roles.length) ? prof.roles : [prof.role]).filter(Boolean);
      if (fresh.length) perfis = fresh;
    }
  } catch { /* mantém os perfis do token */ }
  return perfis;
}

/** Overrides por-usuário de um profile_id -> { moduloKey: nivel }. */
export async function carregarOverridesUsuario(profileId: string): Promise<Record<string, NivelPerm>> {
  const map: Record<string, NivelPerm> = {};
  try {
    const db = supabaseAdmin();
    const { data } = await db.from("portal_perm_usuario").select("modulo, nivel").eq("profile_id", profileId);
    for (const r of data || []) map[r.modulo] = r.nivel as NivelPerm;
  } catch { /* tabela ausente -> sem overrides (herda perfil) */ }
  return map;
}

/** Nível efetivo do usuário logado em um módulo (lê perfis + overrides frescos do banco). */
export async function nivelModuloUsuario(claims: AdminClaims, moduloKey: string): Promise<NivelPerm> {
  const perfis = await perfisFrescos(claims);
  if (perfis.includes("admin")) return "editar";
  const overrides = await carregarOverridesUsuario(claims.sub);
  return nivelEfetivo(moduloKey, perfis, overrides);
}

/** Guard para endpoints de MUTAÇÃO: lança 403 se o usuário não tem 'editar' no módulo. */
export async function exigirEdicao(claims: AdminClaims, moduloKey: string): Promise<void> {
  const nivel = await nivelModuloUsuario(claims, moduloKey);
  if (nivel !== "editar") {
    const rotulo = MODULO_LABEL[moduloKey] || moduloKey;
    throw Object.assign(new Error(`Você tem acesso somente de leitura em "${rotulo}". Fale com o administrador.`), { http: 403 });
  }
}

/** Mapeia uma rota /api/admin/<...> para a KEY do módulo (ou null se não for um módulo gated).
 *  Usado pelo middleware para a trava central de "somente-leitura". */
export function moduloDaRotaApi(pathname: string): string | null {
  const m = pathname.match(/^\/api\/admin\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const seg = m[1].replace(/\.ts$/, "");
  const rest = m[2] || "";
  // endpoints de auth não são módulos
  if (["login", "logout", "forgot-senha"].includes(seg)) return null;
  // especiais (a pasta não bate com a key do módulo)
  if (seg === "fin") return "financeiro";
  if (seg === "d4sign" || seg === "termos") return "assinaturas";
  if (seg === "permissoes" || seg === "permissoes-usuarios") return "permissoes";
  if (seg === "portal") {
    const sub = (rest.split("/")[0] || "").replace(/\.ts$/, "");
    const map: Record<string, string> = { comunicados: "portal-comunicados", integracao: "portal-integracao", kb: "portal-kb", onboarding: "portal-onboarding", treinamentos: "portal-treinamentos", "upload-url": "portal-comunicados" };
    return map[sub] || "membros";
  }
  if (seg === "rh") {
    const sub = (rest.split("/")[0] || "").replace(/\.ts$/, "");
    if (["vagas", "candidatos", "cargos"].includes(sub)) return "recrutamento";
    if (sub === "avaliacoes") return "avaliacoes";
    if (sub === "clima") return "clima";
    return "rh";
  }
  // demais: o 1º segmento já é a key do módulo (ativos, obras, clientes, leads, ...)
  return MODULO_GRUPO[seg] ? seg : null;
}

/** Guard de MUTAÇÃO que retorna uma Response 403 (ou null se pode editar).
 *  Uso no topo do handler:  const b = await bloqueioSeSoLeitura(admin, "ativos"); if (b) return b;
 *  Mais limpo que throw — não depende do catch do endpoint para o status correto. */
export async function bloqueioSeSoLeitura(claims: AdminClaims, moduloKey: string): Promise<Response | null> {
  const nivel = await nivelModuloUsuario(claims, moduloKey);
  if (nivel === "editar") return null;
  const rotulo = MODULO_LABEL[moduloKey] || moduloKey;
  return new Response(
    JSON.stringify({ error: `Você tem acesso somente de leitura em "${rotulo}". Fale com o administrador.` }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}
