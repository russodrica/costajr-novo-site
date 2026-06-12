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

export const PERFIS = ["admin", "coordenador", "financeiro", "comercial", "rh", "operacional"] as const;

export interface PermissaoPerfil { perfil: string; areas: string[]; categorias_kb: string[] }

const TODAS_AREAS = AREAS_PORTAL.map((a) => a.id);

/** Permissões efetivas do usuário (união de todos os seus perfis).
 *  Admin sempre tem tudo. Se a tabela não existir/estiver vazia, libera o padrão seguro. */
export async function permissoesDoUsuario(claims: AdminClaims): Promise<{ areas: string[]; categoriasKb: string[] }> {
  const perfis = perfisDe(claims);
  if (perfis.includes("admin")) return { areas: [...TODAS_AREAS], categoriasKb: [...CATEGORIAS_KB] };

  const db = supabaseAdmin();
  const { data, error } = await db.from("portal_permissoes").select("perfil, areas, categorias_kb").in("perfil", perfis);
  if (error || !data?.length) {
    // fallback (tabela ausente): áreas básicas, sem comercial/gestão
    return { areas: ["onboarding", "treinamentos", "forum", "documentos", "meus-equipamentos"], categoriasKb: ["Geral"] };
  }
  const areas = new Set<string>();
  const cats = new Set<string>();
  for (const p of data) {
    for (const a of p.areas || []) areas.add(a);
    for (const c of p.categorias_kb || []) cats.add(c);
  }
  return { areas: [...areas], categoriasKb: [...cats] };
}

/** Lança erro 403 amigável quando o usuário não tem a área liberada. */
export async function exigirArea(claims: AdminClaims, area: string): Promise<void> {
  const { areas } = await permissoesDoUsuario(claims);
  if (!areas.includes(area)) {
    const rotulo = AREAS_PORTAL.find((a) => a.id === area)?.label || area;
    throw Object.assign(new Error(`Seu perfil não tem acesso a ${rotulo}. Fale com o administrador.`), { http: 403 });
  }
}
