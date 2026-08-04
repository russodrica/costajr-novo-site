// Integração de ESCRITA com a API Vobi v2 — usada pelo fluxo "Nova proposta
// comercial" do bot de Telegram (@cjr_processos_bot) para criar a oportunidade
// e montar um RASCUNHO de orçamento dentro dela.
//
// Companheiro de `vobi.ts` (que é só leitura) — mantidos SEPARADOS de propósito:
// vobi.ts alimenta os dashboards administrativos (read-only), este arquivo é o
// único lugar do sistema que ESCREVE na Vobi. Se algo der errado aqui, não afeta
// os dashboards.
//
// Credenciais: VOBI_UUID / VOBI_SECRET (mesmas do .env já usado por vobi.ts).
// Endpoints confirmados no spec OpenAPI da Vobi (D:/temp/vobi_openapi.json,
// baixado em sessão anterior): POST /refurbish (cria oportunidade), POST
// /refurbish-items (cria item de orçamento: nível/produto/serviço), POST
// /company-customer (cria cliente).

const VOBI = "https://api.vobi.com.br/v2";

function creds() {
  const uuid = process.env.VOBI_UUID ?? import.meta.env.VOBI_UUID;
  const secret = process.env.VOBI_SECRET ?? import.meta.env.VOBI_SECRET;
  return { uuid, secret };
}
export function vobiEscritaConfigurada(): boolean {
  const { uuid, secret } = creds();
  return !!(uuid && secret);
}

let _token: string | null = null;
let _tokenAt = 0;
async function token(): Promise<string> {
  if (_token && Date.now() - _tokenAt < 4 * 60 * 1000) return _token;
  const { uuid, secret } = creds();
  if (!uuid || !secret) throw new Error("Credenciais da Vobi (VOBI_UUID/VOBI_SECRET) não configuradas.");
  const basic = Buffer.from(`${uuid}:${secret}`).toString("base64");
  const r = await fetch(`${VOBI}/auth/token`, { method: "POST", headers: { authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Autenticação na Vobi falhou (HTTP ${r.status}).`);
  const j: any = await r.json();
  _token = j.jwt || j.token;
  _tokenAt = Date.now();
  if (!_token) throw new Error("Token da Vobi não retornado.");
  return _token;
}

async function vGet(path: string): Promise<any> {
  const t = await token();
  const r = await fetch(`${VOBI}${path}`, { headers: { authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`Vobi GET ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function vPost(path: string, body: any): Promise<any> {
  const t = await token();
  const r = await fetch(`${VOBI}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vobi POST ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
/** Pagina um endpoint de listagem (limit 500, cap de 20 páginas = 10k registros). */
async function vGetAll(endpoint: string, extra = ""): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  for (let p = 0; p < 20; p++) {
    const j = await vGet(`/${endpoint}?limit=500&offset=${offset}${extra}`);
    const rows = j?.rows || j?.data || (Array.isArray(j) ? j : []);
    out.push(...rows);
    if (rows.length < 500) break;
    offset += 500;
  }
  return out;
}

// ── Entidade (CNPJ) da Costa Júnior na Vobi — assume a primeira cadastrada.
// Cache de processo: não muda durante a vida da função serverless. ──
let _idEntidade: number | null = null;
async function idEntidadePadrao(): Promise<number> {
  if (_idEntidade != null) return _idEntidade;
  const rows = await vGetAll("company-entity");
  if (!rows.length) throw new Error("Nenhuma entidade (CNPJ) cadastrada na Vobi.");
  _idEntidade = rows[0].id;
  return _idEntidade!;
}

// ── Etapa do funil pelo NOME (ex.: "NOVA") — cache de processo. ──
const _stepCache = new Map<string, number>();
async function idStepPorNome(nomeAlvo: string): Promise<number | null> {
  if (_stepCache.size === 0) {
    const rows = await vGetAll("step");
    for (const s of rows) _stepCache.set(String(s.name).trim().toLowerCase(), s.id);
  }
  return _stepCache.get(nomeAlvo.trim().toLowerCase()) ?? null;
}

// ── Cliente: busca por nome (client-side, sem filtro dedicado documentado na
// API) ou cria um novo. ──
export async function vobiBuscarOuCriarCliente(nome: string): Promise<number> {
  const nomeTrim = nome.trim();
  const nomeLower = nomeTrim.toLowerCase();
  const todos = await vGetAll("company-customer");
  const exato = todos.find((c: any) => String(c.name || "").trim().toLowerCase() === nomeLower);
  if (exato) return exato.id;
  const parecidos = todos.filter((c: any) => String(c.name || "").toLowerCase().includes(nomeLower) || nomeLower.includes(String(c.name || "").toLowerCase()));
  if (parecidos.length === 1) return parecidos[0].id;
  const criado = await vPost("/company-customer", { name: nomeTrim });
  return criado.id;
}

export type NovaOportunidade = {
  nomeCliente: string;
  endereco?: {
    street?: string; number?: string; complement?: string;
    neighborhood?: string; city?: string; state?: string; zipcode?: string;
  };
  // Endereço em texto livre (como veio do roteiro do Telegram) — entra só na
  // descrição da necessidade, não tenta "adivinhar" os campos estruturados.
  enderecoTexto?: string;
  escopoResumo: string;
  m2?: number;
  // Nome final da Oportunidade — se informado, sobrescreve o padrão
  // "Cliente - Escopo". Usado pelo bot Comercial dedicado para gravar no
  // padrão CLIENTE_PROJETO (maiúsculo, igual ao nome da pasta), exigido pela
  // skill proposta-tecnica-comercial. Sem isso, mantém o padrão do JunIA.
  nomeOportunidade?: string;
  // Valor de ganho (estimativa) já formatado pelo roteiro do bot Comercial —
  // se informado, grava no campo `profits` logo após criar (ver
  // vobiAtualizarValorGanho, mesmo campo confirmado manualmente em 2026-08-04
  // no projeto 864/GOL — NÃO é `budget`, que é "Pretensão de investimento do
  // cliente", um campo diferente).
  valorGanho?: number;
};

export async function vobiCriarOportunidade(dados: NovaOportunidade): Promise<{ idRefurbish: number; idCompanyCustomer: number; stepEncontrada: boolean; valorGravado?: boolean }> {
  const [idEnt, idCliente, idStepNova] = await Promise.all([
    idEntidadePadrao(),
    vobiBuscarOuCriarCliente(dados.nomeCliente),
    idStepPorNome("NOVA"),
  ]);
  const descricao = dados.enderecoTexto ? `${dados.escopoResumo}\nEndereço: ${dados.enderecoTexto}` : dados.escopoResumo;
  const nomeFinal = dados.nomeOportunidade || `${dados.nomeCliente} - ${dados.escopoResumo}`;
  const body: any = {
    name: nomeFinal.slice(0, 190),
    idCompanyEntity: idEnt,
    idCompanyCustomer: idCliente,
    necessityDescription: descricao,
    ...(dados.endereco || {}),
  };
  if (idStepNova != null) body.idStep = idStepNova;
  if (dados.m2) body.m2 = dados.m2;
  const criado = await vPost("/refurbish", body);
  const resultado: { idRefurbish: number; idCompanyCustomer: number; stepEncontrada: boolean; valorGravado?: boolean } = {
    idRefurbish: criado.id, idCompanyCustomer: idCliente, stepEncontrada: idStepNova != null,
  };
  if (dados.valorGanho) {
    try {
      await vobiAtualizarValorGanho(criado.id, dados.valorGanho);
      resultado.valorGravado = true;
    } catch {
      resultado.valorGravado = false; // não derruba a criação da oportunidade por causa disso
    }
  }
  return resultado;
}

// ── Valor de ganho (estimativa) — campo `profits`, CONFIRMADO em 2026-08-04.
// ATENÇÃO: a Vobi tem outro campo parecido, `budget`, que é a tela
// "Pretensão de investimento do cliente" — NÃO é o valor da proposta. Sempre
// confere com GET depois de gravar (a Vobi já demonstrou PUT que responde
// sucesso sem persistir o campo enviado). ──
export async function vobiAtualizarValorGanho(idRefurbish: number, novoValor: number): Promise<{ confirmado: boolean; valorAntes: any; valorDepois: any }> {
  const antes = await vGet(`/refurbish/${idRefurbish}`);
  await vPut(`/refurbish/${idRefurbish}`, { profits: novoValor });
  const depois = await vGet(`/refurbish/${idRefurbish}`);
  const bateu = Math.abs(Number(depois.profits) - novoValor) < 0.01;
  if (!bateu) {
    throw new Error(
      `PUT retornou sucesso mas o valor de ganho NÃO persistiu (bug conhecido da Vobi). ` +
      `Antes=${antes.profits} Solicitado=${novoValor} Depois=${depois.profits}. Avise a Adriana, não considere concluído.`
    );
  }
  return { confirmado: true, valorAntes: antes.profits, valorDepois: depois.profits };
}

// ── Mudar etapa do funil pelo NOME (ex.: "VISITA", "EM ORÇAMENTO") —
// comando "pode mudar de etapa" do bot Comercial dedicado. ──
export async function vobiMudarEtapa(idRefurbish: number, nomeEtapa: string): Promise<{ confirmado: boolean; idStepAntes: any; idStepDepois: any }> {
  const idStep = await idStepPorNome(nomeEtapa);
  if (idStep == null) throw new Error(`Etapa "${nomeEtapa}" não encontrada no funil da Vobi.`);
  const antes = await vGet(`/refurbish/${idRefurbish}`);
  await vPut(`/refurbish/${idRefurbish}`, { idStep });
  const depois = await vGet(`/refurbish/${idRefurbish}`);
  const confirmado = depois.idStep === idStep;
  if (!confirmado) {
    throw new Error(`PUT retornou sucesso mas a etapa NÃO persistiu (bug conhecido da Vobi). Antes=${antes.idStep} Solicitado=${idStep} Depois=${depois.idStep}. Avise a Adriana.`);
  }
  return { confirmado: true, idStepAntes: antes.idStep, idStepDepois: depois.idStep };
}

// ── Oficializar o nível de orçamento rascunho (tira a marca "🚧 RASCUNHO
// (IA)"). Só chamar depois que o usuário confirmar a etapa "EM ORÇAMENTO"
// pelo comando "pode mudar de etapa". ──
export async function vobiOficializarOrcamento(idNivel: number, nomeFinal: string, corFinal = "#16A34A"): Promise<any> {
  return await vPut(`/refurbish-items/${idNivel}`, { name: nomeFinal, color: corFinal });
}

async function vPut(path: string, body: any): Promise<any> {
  const t = await token();
  const r = await fetch(`${VOBI}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vobi PUT ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export type ItemOrcamentoRascunho = {
  nome: string;
  tipo: "produto" | "servico";
  quantidade: number;
  precoUnitario: number;
};

// Monta a estrutura do orçamento (RASCUNHO) dentro da oportunidade: 1
// nível-raiz "🚧 RASCUNHO (IA)" + os itens dentro dele. SEMPRE rascunho —
// nunca vira orçamento oficial sem um engenheiro revisar direto na Vobi
// (decisão da Adriana, 30/07/2026).
export async function vobiCriarOrcamentoRascunho(
  idRefurbish: number,
  itens: ItemOrcamentoRascunho[]
): Promise<{ idNivel: number; itensCriados: number; itensFalhados: number }> {
  const nivel = await vPost("/refurbish-items", {
    type: 3, idRefurbish, name: "🚧 RASCUNHO (IA) — revisar antes de enviar ao cliente", color: "#F59E0B",
  });
  const idNivel = nivel.id;
  let ok = 0, falhou = 0;
  for (const item of itens) {
    try {
      await vPost("/refurbish-items", {
        type: item.tipo === "produto" ? 1 : 2,
        idRefurbish, idParent: idNivel,
        name: item.nome, price: item.precoUnitario, quantity: item.quantidade,
      });
      ok++;
    } catch {
      falhou++; // segue tentando os demais; o chamador reporta quantos falharam
    }
  }
  return { idNivel, itensCriados: ok, itensFalhados: falhou };
}

export function urlOportunidadeVobi(idRefurbish: number): string {
  // TODO: confirmar com a Adriana a rota exata de detalhe de projeto no app da Vobi.
  return `https://app.vobi.com.br/projetos/${idRefurbish}`;
}
