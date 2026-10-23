// ============================================================================
// Itens de Depósito — catálogo mostrado a credores por LINK PESSOAL.
//
// Cada link é gerado pela Adriana no painel (isso É a autorização), vale 24 h no
// máximo, leva o nome do credor (estampado como marca d'água na página) e pode
// ser revogado a qualquer momento. Tudo é registrado: quem abriu, quando, de
// onde e quando aceitou o aviso.
//
// Persistência SEM tabela nova: dois JSON num bucket PRIVADO do Storage
// (itens.json = o catálogo, links.json = links + acessos). Um único admin
// escreve, então a leitura-modificação-escrita é segura o bastante.
// ============================================================================
import { signToken, verifyToken } from "./auth";

export const ITENS_BUCKET = "itens-deposito";
export const VALIDADE_MAX_H = 24;

export type ItemDeposito = {
  n: number;
  nome: string;
  marca: string;
  qtd: number;
  un: string;
  cond: string; // Novo | Usado | A confirmar
  est: boolean; // quantidade aproximada
  valor: number | null;
  foto: string | null; // caminho dentro do bucket
  status: "disponivel" | "baixado";
};

export type AcessoLink = { em: string; tipo: "abriu" | "aceitou"; ip: string; ua: string };

export type LinkItens = {
  id: string;
  credor: string;
  criadoEm: string;
  criadoPor: string;
  expiraEm: string;
  mostrarValor: boolean;
  revogado: boolean;
  aceitouEm?: string;
  acessos: AcessoLink[];
};

async function lerJson<T>(db: any, caminho: string, padrao: T): Promise<T> {
  try {
    const { data, error } = await db.storage.from(ITENS_BUCKET).download(caminho);
    if (error || !data) return padrao;
    return JSON.parse(await data.text()) as T;
  } catch {
    return padrao;
  }
}

async function gravarJson(db: any, caminho: string, valor: unknown): Promise<void> {
  const body = new Blob([JSON.stringify(valor)], { type: "application/json" });
  const { error } = await db.storage.from(ITENS_BUCKET).upload(caminho, body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error("Não consegui gravar " + caminho + ": " + error.message);
}

export const lerItens = (db: any) => lerJson<ItemDeposito[]>(db, "itens.json", []);
export const gravarItens = (db: any, itens: ItemDeposito[]) => gravarJson(db, "itens.json", itens);
// Itens tirados do catálogo (extraviados etc.): ficam guardados aqui para poder restaurar.
export type ItemExcluido = ItemDeposito & { excluidoEm: string; excluidoPor: string; motivo: string };
export const lerExcluidos = (db: any) => lerJson<ItemExcluido[]>(db, "excluidos.json", []);
export const gravarExcluidos = (db: any, l: ItemExcluido[]) => gravarJson(db, "excluidos.json", l);
export const lerLinks = (db: any) => lerJson<LinkItens[]>(db, "links.json", []);
export const gravarLinks = (db: any, links: LinkItens[]) => gravarJson(db, "links.json", links);

export function novoIdLink(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function criarLink(
  db: any,
  p: { credor: string; horas: number; mostrarValor: boolean; criadoPor: string },
): Promise<{ link: LinkItens; token: string }> {
  const horas = Math.min(VALIDADE_MAX_H, Math.max(1, Math.floor(p.horas || VALIDADE_MAX_H)));
  const agora = Date.now();
  const link: LinkItens = {
    id: novoIdLink(),
    credor: p.credor.trim().slice(0, 80),
    criadoEm: new Date(agora).toISOString(),
    criadoPor: p.criadoPor,
    expiraEm: new Date(agora + horas * 3600_000).toISOString(),
    mostrarValor: !!p.mostrarValor,
    revogado: false,
    acessos: [],
  };
  const links = await lerLinks(db);
  links.push(link);
  await gravarLinks(db, links);
  const token = await signToken({ tipo: "itens", lid: link.id } as any, `${horas}h`);
  return { link, token };
}

export function estadoLink(l: LinkItens, agora = Date.now()): "ativo" | "expirado" | "revogado" {
  if (l.revogado) return "revogado";
  if (new Date(l.expiraEm).getTime() <= agora) return "expirado";
  return "ativo";
}

/** Valida o token E o registro do link (expiração, revogação). null = não vale. */
export async function validarLink(db: any, token: string): Promise<{ link: LinkItens; links: LinkItens[] } | null> {
  try {
    const c: any = await verifyToken<any>(token);
    if (c?.tipo !== "itens" || !c?.lid) return null;
    const links = await lerLinks(db);
    const link = links.find((l) => l.id === String(c.lid));
    if (!link || estadoLink(link) !== "ativo") return null;
    return { link, links };
  } catch {
    return null;
  }
}

export async function registrarAcessoLink(
  db: any,
  links: LinkItens[],
  link: LinkItens,
  tipo: "abriu" | "aceitou",
  req: Request,
): Promise<void> {
  const ip = String(req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0].trim();
  const ua = String(req.headers.get("user-agent") || "").slice(0, 160);
  const em = new Date().toISOString();
  link.acessos.push({ em, tipo, ip, ua });
  if (link.acessos.length > 200) link.acessos = link.acessos.slice(-200);
  if (tipo === "aceitou") link.aceitouEm = em;
  await gravarLinks(db, links);
}

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
