// ============================================================================
// JunIA — Inteligência da Costa Júnior (busca interna na base de conhecimento,
// sem LLM externo, como no portal original).
// Fluxo: detecta a categoria → aplica permissões do perfil → busca com
// pontuação → responde, redireciona ou cria pendência para o gestor.
// ============================================================================
import { supabaseAdmin } from "./supabase";
import { temPerfil, type AdminClaims } from "./auth";
import { permissoesDoUsuario } from "./permissoes";

// palavras-chave → categoria (portado do Manus, adaptado às nossas categorias)
const KEYWORDS: Record<string, string[]> = {
  "Trabalhista": ["clt", "férias", "ferias", "fgts", "13º", "decimo terceiro", "rescisão", "rescisao", "aviso prévio", "aviso previo", "jornada", "hora extra", "justa causa", "carteira assinada", "demissão", "demissao", "salário", "salario", "inss", "verbas"],
  "Financeiro": ["faturamento", "pagamento", "cobrança", "cobranca", "nota fiscal", "nf", "boleto", "pix", "orçamento", "orcamento", "custo", "desconto", "banco", "cartão", "cartao", "vencimento", "fatura", "ipva", "imposto", "retenção", "retencao", "conciliação", "caixa"],
  "Comercial": ["venda", "vendas", "proposta", "cliente novo", "lead", "prospecção", "prospeccao", "comissão", "comissao", "negociação", "negociacao", "contrato comercial"],
  "RH": ["folha de pagamento", "holerite", "benefício", "beneficio", "vale", "plano de saúde", "plano de saude", "admissão", "admissao", "aso", "atestado", "ponto", "departamento pessoal"],
  "Recrutamento": ["vaga", "candidato", "currículo", "curriculo", "processo seletivo", "entrevista", "contratação", "contratacao", "recrutamento"],
  "Segurança do Trabalho": ["epi", "nr-18", "nr18", "nr-35", "nr35", "nr-10", "nr10", "nr-6", "nr6", "cipa", "acidente", "segurança do trabalho", "seguranca do trabalho", "capacete", "proteção", "protecao", "sinalização"],
  "Operacional": ["obra", "construção", "construcao", "canteiro", "execução", "execucao", "material", "equipamento", "ferramenta", "manutenção", "manutencao", "chamado", "preventiva", "instalação", "instalacao"],
  "Administrativo": ["administrativo", "documento", "arquivo", "certidão", "certidao", "veículo", "veiculo", "condutor", "multa", "cnh", "locação", "locacao", "contrato de locação", "monday", "agenda"],
};

export const REDIRECIONAMENTOS: Record<string, string> = {
  "Financeiro": "Para questões financeiras, fale com o departamento financeiro da Costa Júnior.",
  "RH": "Para questões de Recursos Humanos e Departamento Pessoal, procure o RH/DP.",
  "Recrutamento": "Para questões de recrutamento e seleção, procure o time de R&S.",
  "Trabalhista": "Para questões trabalhistas, procure o RH da empresa.",
  "Administrativo": "Para questões administrativas, consulte o departamento administrativo.",
  "Segurança do Trabalho": "Para questões de segurança, consulte o time de segurança do trabalho.",
  "Comercial": "Para questões comerciais, fale com o departamento comercial.",
  "Operacional": "Para questões operacionais, fale com o coordenador de obras.",
};

export function detectarCategoria(texto: string): string {
  const t = texto.toLowerCase();
  let melhor = "Geral";
  let melhorHits = 0;
  for (const [cat, palavras] of Object.entries(KEYWORDS)) {
    const hits = palavras.filter((p) => t.includes(p)).length;
    if (hits > melhorHits) { melhorHits = hits; melhor = cat; }
  }
  return melhor;
}

function extrairPalavras(texto: string): string[] {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((p) => p.length > 3);
}

export function pontuarEntrada(pergunta: string, kb: { question: string; answer: string }): number {
  const p = pergunta.toLowerCase();
  const q = kb.question.toLowerCase();
  const a = kb.answer.toLowerCase();
  let score = 0;
  if (q.includes(p) || p.includes(q)) score += 10;
  if (a.includes(p)) score += 5;
  for (const palavra of extrairPalavras(pergunta)) {
    if (q.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(palavra)) score += 3;
    else if (a.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(palavra)) score += 1;
  }
  return score;
}

export interface RespostaJunIA {
  resposta: string;
  categoria: string;
  precisaResposta: boolean;   // virou pendência para o gestor
  fonte: "base de conhecimento" | "redirecionamento" | "sem resposta";
}

export async function responderJunIA(claims: AdminClaims, pergunta: string): Promise<RespostaJunIA> {
  const db = supabaseAdmin();
  const categoria = detectarCategoria(pergunta);

  // trava trabalhista individual
  const podeTrabalhista = claims.trabalhista || temPerfil(claims, ["admin", "rh"]);
  if (categoria === "Trabalhista" && !podeTrabalhista) {
    return { resposta: "Olá! Para questões trabalhistas, procure o RH da empresa — esse conteúdo é restrito. 😊", categoria, precisaResposta: false, fonte: "redirecionamento" };
  }

  const { categoriasKb } = await permissoesDoUsuario(claims);
  const catsOk = new Set([...categoriasKb.map((c) => c.toLowerCase()), "geral"]);

  const { data: kb } = await db.from("portal_kb").select("question, answer, category").limit(1000);
  const todas = (kb || []).map((k) => ({ ...k, score: pontuarEntrada(pergunta, k) })).filter((k) => k.score > 0);
  todas.sort((a, b) => b.score - a.score);

  const permitidas = todas.filter((k) => catsOk.has((k.category || "Geral").toLowerCase()) && ((k.category || "").toLowerCase() !== "trabalhista" || podeTrabalhista));
  const melhor = permitidas[0];

  if (melhor && melhor.score >= 6) {
    let resposta = `Olá! ${melhor.answer}`;
    const segunda = permitidas[1];
    if (segunda && segunda.score >= 6 && segunda.answer !== melhor.answer) {
      resposta += `\n\n📌 Relacionado: ${segunda.question}\n${segunda.answer}`;
    }
    return { resposta, categoria: melhor.category || categoria, precisaResposta: false, fonte: "base de conhecimento" };
  }

  // havia resposta, mas em categoria restrita ao perfil → redireciona
  const restrita = todas.find((k) => !catsOk.has((k.category || "Geral").toLowerCase()) && k.score >= 6);
  if (restrita) {
    const msg = REDIRECIONAMENTOS[restrita.category || ""] || "Esse assunto é tratado por outro departamento — fale com seu gestor.";
    return { resposta: `Olá! ${msg}`, categoria: restrita.category || categoria, precisaResposta: false, fonte: "redirecionamento" };
  }

  return {
    resposta: "Não tenho informações suficientes para responder essa pergunta agora. 🔎\n\nJá encaminhei para um gestor — você será avisado aqui no portal assim que a resposta chegar!",
    categoria,
    precisaResposta: true,
    fonte: "sem resposta",
  };
}

export async function notificar(userId: string, tipo: string, titulo: string, mensagem: string, link?: string) {
  await supabaseAdmin().from("portal_notificacoes").insert({ user_id: userId, tipo, titulo, mensagem, link: link || null });
}
