// ============================================================================
// Importa o conteúdo do antigo Portal Manus para o Supabase (produção).
//
// O que importa:
//   1. Base de conhecimento (36 Q&As)            → portal_kb
//   2. Documentos institucionais (vídeo + 8 PDFs) → portal_onboarding_steps
//      e as 8 políticas também                    → portal_integration_pdfs
//   3. Treinamentos Santander (2 vídeos + 1 PDF)  → portal_treinamentos_videos/pdfs
//
// Os arquivos hospedados no CDN do Manus (files.manuscdn.com) são BAIXADOS e
// re-hospedados no Supabase Storage (bucket público "portal"), porque o CDN
// antigo pode sair do ar a qualquer momento.
//
// Idempotente: pode rodar quantas vezes quiser — não duplica nada.
// Requer: migration 004_portal_colaborador.sql aplicada (para onboarding,
// treinamentos e integração; a KB funciona mesmo sem ela).
//
// Uso:  node scripts/importar-conteudo-manus.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não encontrados no .env");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  "content-type": "application/json",
};

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...headers, prefer: method === "POST" ? "return=representation" : "count=exact" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function tabelaExiste(t) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, { headers });
  return res.status === 200;
}

// ─── Storage ────────────────────────────────────────────────────────────────

const BUCKET = "portal";

async function garantirBucket() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers });
  if (res.ok) return;
  const cri = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!cri.ok) throw new Error(`Falha ao criar bucket: ${await cri.text()}`);
  console.log(`✔ Bucket "${BUCKET}" criado (público)`);
}

async function objetoExiste(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${path}`, { headers });
  return res.ok;
}

/** Baixa do CDN do Manus e sobe pro Supabase Storage. Retorna a URL pública. */
async function migrarArquivo(urlOrigem, destino, contentType) {
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${destino}`;
  if (await objetoExiste(destino)) return publicUrl;

  process.stdout.write(`  ↓ baixando ${destino} ... `);
  const dl = await fetch(urlOrigem);
  if (!dl.ok) {
    console.log(`FALHOU (HTTP ${dl.status}) — mantendo URL original do Manus`);
    return urlOrigem;
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  process.stdout.write(`${(buf.length / 1024 / 1024).toFixed(1)}MB ↑ subindo ... `);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${destino}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": contentType, "x-upsert": "true" },
    body: buf,
  });
  if (!up.ok) {
    console.log(`FALHOU (${await up.text()}) — mantendo URL original`);
    return urlOrigem;
  }
  console.log("ok");
  return publicUrl;
}

// ─── Conteúdo extraído do Manus ─────────────────────────────────────────────

const CAT = { financial: "Financeiro", administrative: "Administrativo", labor: "Trabalhista", safety: "Segurança do Trabalho", general: "Geral" };

const KB = [
  // PERGUNTAS_E_RESPOSTAS.pdf
  ["Qual data de fechamento do pagamento do Santander?", "A prévia fecha dia 20 e a autorização de faturamento costuma vir entre os dias 1 e 5 do mês subsequente.", "financial"],
  ["Qual percentual de faturamento de material e mão de obra permitido?", "Por lei, só podemos emitir no máximo 50% de material, e o saldo deve ser serviço.", "administrative"],
  ["Qual banco usamos para pagamento da COHAB?", "Banco do Brasil", "financial"],
  ["Qual prazo de pagamento do Santander?", "25 dias corridos", "financial"],
  ["Quando vender um material, como lançar?", "Lançar a receita no Centro de Custo de Venda e Despesa da aquisição também.", "financial"],
  ["Qual vencimento do Cartão Nubank Pessoa Jurídica (cartão final 7828, 4925, 6382 ou 1405)?", "Dia 02", "financial"],
  ["Qual vencimento do Cartão Nubank Pessoa Física?", "Dia 02", "financial"],
  ["Qual vencimento do cartão Itaú (cartão final 3380 ou 6303)?", "Dia 01", "financial"],
  ["Qual procedimento para aplicar justa causa?", "ORIENTAÇÕES RESUMIDAS PARA APLICAÇÃO DE JUSTA CAUSA:\n\n1. Organizar documentos: reunir todas as advertências e suspensões de forma cronológica, checando assinaturas ou registros de ciência.\n\n2. Comunicação formal: elaborar carta relatando o histórico disciplinar, a reincidência e a fundamentação jurídica, fixando a data da rescisão.\n\n3. Entrega da comunicação: convocar o colaborador, solicitar assinatura ou registrar recusa com assinatura de duas testemunhas.\n\n4. Procedimentos no sistema: registrar a justa causa no eSocial, emitir o TRCT, pagar saldo de salário e férias vencidas (se houver); demais verbas não são devidas.\n\n5. Arquivamento: guardar toda documentação disciplinar e rescisória para eventual defesa trabalhista.\n\nNota: A sequência de advertências, suspensão e nova falta injustificada justifica a justa causa de forma sólida.", "labor"],
  // Lições aprendidas / operação
  ["Como deve ser feito o pagamento do IPVA?", "O pagamento deve ser programado e pode ser feito através da própria conta do Santander.", "financial"],
  ["Como proceder com contas que não foram pagas no prazo?", "As contas não podem ficar registadas no passado.", "financial"],
  ["Qual a orientação sobre faturas e cobranças constantes?", "É necessário conferir sempre o que está a ser cobrado e questionar os valores, pois não se pode pagar sem conferência.", "financial"],
  ["Existe alguma alternativa para exames admissionais onde o pagamento seja facilitado?", "Foi identificada uma clínica que aceita cartão, dinheiro e PIX, permitindo tratar diretamente com o estabelecimento sem envolver o colaborador em admissão.", "labor"],
  ["Qual a frequência ideal para a gestão das obras?", "A gestão deve ser feita diariamente, registando todas as intercorrências para manter o controlo.", "general"],
  ["Onde estão localizados os modelos de fichas de entrega de EPI?", "Estão guardados no diretório: C:\\Users\\user\\OneDrive\\01_ADMINISTRATIVO\\000_COSTAJR\\PLANILHAS E CONTROLE ADM\\Modelos de Planilhas.", "safety"],
  ["Como deve ser o padrão de abertura de chamados ou atividades?", "Sugerido uso da plataforma TO DO para organização administrativa entre os colaboradores.", "administrative"],
  ["Qual o procedimento para inclusão de novos condutores em veículos locados?", "É necessário enviar a cópia da habilitação para que a inclusão seja feita no contrato de locação mensal.", "administrative"],
  ["Como funciona a pontuação de multas em veículos de empresa?", "Infelizmente a pontuação não temos autonomia, se não houve a indicação do condutor, é computado no condutor principal.", "administrative"],
  ["Qual o limite de pontos na CNH?", "Com 21 pontos já perde a carteira.", "labor"],
  ["Como responder a cobranças de fornecedores em atraso?", "Resposta oficial: Infelizmente estamos ainda em processo de regularização. A resposta para os fornecedores é: estamos tentando regularizar até o final do mês.", "financial"],
  ["Como deve ser feita a faxina semanal?", "O pagamento (PIX) deve ser confirmado semanalmente pelo financeiro para garantir a manutenção do local.", "administrative"],
  ["Existe alguma ferramenta gratuita para consulta de crédito?", "Foi mencionada a opção de consulta gratuita ao Serasa para verificar situações cadastrais ou site do CENPRO para verificar protestos.", "financial"],
  ["Onde encontro as certidões atualizadas?", "Manter certidões atualizadas no Monday. Verificar validade antes de participar de processos. Débitos impedem emissão.", "administrative"],
  ["Como lidar com pedidos de adiantamento para condução dos operários?", "Os pedidos devem ser avaliados com cautela; em casos de urgência para que os funcionários não abandonem o posto, o financeiro deve verificar a viabilidade do adiantamento imediato.", "financial"],
  ["Como proceder com o faturamento de materiais e mão de obra?", "O padrão é separar os valores de Mão de Obra e Material na descrição da nota.", "financial"],
  ["Como nomear e organizar as demandas de uma mesma obra?", "Como uma mesma obra pode ter demandas diferentes, é essencial especificar o nome e o tipo de serviço (ex: CBA_1023_Vila Joaniza_Telhado) para evitar confusão no faturamento.", "general"],
  ["O que fazer com lançamentos de obras ou receitas inexistentes?", "Caso uma receita ou obra não se concretize, o lançamento deve ser excluído do sistema para não gerar falsas previsões de caixa.", "financial"],
  ["Como registrar os valores bruto e líquido no sistema?", "Ao clicar em ver receita, deve-se alterar o valor total para o valor líquido recebido, mas manter sempre o valor bruto no campo de observações como histórico para conciliação futura.", "financial"],
  ["Onde os coordenadores devem deixar os arquivos revisados?", "Todos os orçamentos, propostas e planilhas revisadas devem ser deixados na rede (servidor/nuvem) para acesso imediato de toda a equipe.", "administrative"],
  ["Qual a orientação para novas demandas técnicas?", "Ao surgir uma nova demanda, deve-se criar um grupo específico e o coordenador deve dar um retorno imediato para que o administrativo inicie os lançamentos no sistema.", "general"],
  ["Quais bancos a empresa utiliza para gestão de saldos bancários?", "A empresa opera com múltiplos bancos, incluindo Santander, Bradesco, Sicoob e Caixa Econômica.", "financial"],
  ["Como devem ser tratadas as retenções de impostos nas notas fiscais?", "Foi estabelecido como lição aprendida que todas as notas devem ter as retenções (como INSS) conferidas antes da emissão, evitando erros cometidos no passado.", "financial"],
  ["Qual a exigência para documentação e fotos de campo?", "Há uma exigência rigorosa de evidências fotográficas para a conclusão de chamados. A falta de fotos simples (como alguém varrendo o local) pode travar o encerramento da demanda e, consequentemente, o faturamento.", "general"],
  ["Como deve ser feita a nomenclatura de obras?", "Devido à multiplicidade de serviços num mesmo local, as obras devem ser lançadas com nomes específicos que incluam o tipo de serviço (ex: telhado, lustre, persiana) para evitar confusão no momento de faturar saldos remanescentes.", "general"],
  ["Qual a chave PIX do Nubank pessoa física?", "11930002050", "financial"],
  ["Qual a chave PIX do Itaú pessoa física?", "31689296895", "financial"],
];

const CDN = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663137065908";

// Documentos institucionais (vídeo de boas-vindas + 8 PDFs) → onboarding
const INSTITUCIONAIS = [
  { titulo: "Vídeo Institucional Interno", arquivo: `${CDN}/zdBwCTAODUleszqQ.mp4`, tipo: "video", ct: "video/mp4", destino: "onboarding/video-institucional.mp4", ordem: 10 },
  { titulo: "Apresentação Institucional 2025", arquivo: `${CDN}/lAAhGXEKewTdvLib.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/apresentacao-institucional-2025.pdf", ordem: 11 },
  { titulo: "Código de Cultura 2024", arquivo: `${CDN}/XhejTshntiBpUCyP.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/codigo-de-cultura-2024.pdf", ordem: 12 },
  { titulo: "Código de Ética e Conduta", arquivo: `${CDN}/cOYgbQMwEaojKgor.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/codigo-de-etica-e-conduta.pdf", ordem: 13 },
  { titulo: "Política de Diversidade e Inclusão", arquivo: `${CDN}/ImhuwljWlajBLTLM.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/politica-diversidade-inclusao.pdf", ordem: 14 },
  { titulo: "Política de Proteção de Dados Pessoais (LGPD)", arquivo: `${CDN}/eYwvOtBpeodJNgNO.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/politica-lgpd.pdf", ordem: 15 },
  { titulo: "Política de Responsabilidade Socioambiental", arquivo: `${CDN}/pOcGCDooHZQbWEbk.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/politica-socioambiental.pdf", ordem: 16 },
  { titulo: "Política de Saúde, Segurança e Meio Ambiente", arquivo: `${CDN}/XpJDabfgfeZLolYa.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/politica-saude-seguranca-ma.pdf", ordem: 17 },
  { titulo: "Política de Segurança do Trabalho", arquivo: `${CDN}/eGPBfUhgBaDSFTRs.pdf`, tipo: "pdf", ct: "application/pdf", destino: "onboarding/politica-seguranca-trabalho.pdf", ordem: 18 },
];

// Treinamentos (cliente Santander)
const TREINAMENTO_VIDEOS = [
  { titulo: "Fusão Santander", descricao: "Vídeo de treinamento sobre o processo de fusão do Santander", arquivo: `${CDN}/AYleOUDJRsOIJgYz.mp4`, ct: "video/mp4", destino: "treinamentos/fusao-santander.mp4" },
  { titulo: "Liberação de Acesso Santander", descricao: "Vídeo explicativo sobre o processo de liberação de acesso ao Santander. Para solicitar a liberação de acesso, preencha o formulário: https://forms.office.com/pages/responsepage.aspx?id=AlpZNW1NrESZ4fmrTNhy2zeemQ-jPJVHj19yTKxUgz5UMVpBV0VCS1BCQTVOQ0RMUzVVTEdHR0RGOC4u", arquivo: `${CDN}/bUARueuAKMLRkpwL.mp4`, ct: "video/mp4", destino: "treinamentos/liberacao-acesso-santander.mp4" },
];
const TREINAMENTO_PDFS = [
  { titulo: "Guia de Descaracterização de Lojas e Elementos - Santander", descricao: "Guia completo de descaracterização de lojas e elementos do Santander", arquivo: `${CDN}/agbrffJRTqTtkGfp.pdf`, ct: "application/pdf", destino: "treinamentos/guia-descaracterizacao-santander.pdf" },
];

// ─── Importação ─────────────────────────────────────────────────────────────

async function importarKB() {
  console.log("\n■ Base de conhecimento → portal_kb");
  let novos = 0, existentes = 0;
  for (const [question, answer, cat] of KB) {
    const { data } = await rest("GET", `portal_kb?select=id&question=eq.${encodeURIComponent(question)}&limit=1`);
    if (data?.length) { existentes++; continue; }
    const ins = await rest("POST", "portal_kb", { question, answer, category: CAT[cat] || "Geral", access_roles: ["all"] });
    if (!ins.ok) { console.error(`  ✘ "${question.slice(0, 50)}": ${JSON.stringify(ins.data)}`); continue; }
    novos++;
  }
  console.log(`  ✔ ${novos} inseridos, ${existentes} já existiam`);
}

async function importarOnboarding() {
  console.log("\n■ Documentos institucionais → portal_onboarding_steps + portal_integration_pdfs");
  if (!(await tabelaExiste("portal_onboarding_steps"))) {
    console.log("  ⚠ Tabela portal_onboarding_steps não existe — rode a migration 004 primeiro. PULANDO.");
    return false;
  }
  for (const doc of INSTITUCIONAIS) {
    const url = await migrarArquivo(doc.arquivo, doc.destino, doc.ct);

    const { data: ex } = await rest("GET", `portal_onboarding_steps?select=id&titulo=eq.${encodeURIComponent(doc.titulo)}&limit=1`);
    if (!ex?.length) {
      const conteudo = doc.tipo === "video"
        ? "Assista ao vídeo institucional para conhecer a Costa Júnior Engenharia."
        : `Leia o documento "${doc.titulo}". Ele faz parte da sua trilha de integração obrigatória.`;
      const ins = await rest("POST", "portal_onboarding_steps", {
        titulo: doc.titulo, conteudo, tipo: doc.tipo, url_recurso: url,
        access_roles: ["all"], ordem: doc.ordem, obrigatorio: true,
      });
      if (!ins.ok) console.error(`  ✘ onboarding "${doc.titulo}": ${JSON.stringify(ins.data)}`);
      else console.log(`  ✔ onboarding: ${doc.titulo}`);
    }

    // As políticas/PDFs também ficam na área Documentos (integração)
    if (doc.tipo === "pdf") {
      const { data: ex2 } = await rest("GET", `portal_integration_pdfs?select=id&titulo=eq.${encodeURIComponent(doc.titulo)}&limit=1`);
      if (!ex2?.length) {
        const ins2 = await rest("POST", "portal_integration_pdfs", {
          titulo: doc.titulo, descricao: "Documento institucional importado do portal anterior.",
          url, setor: "todos", access_roles: ["all"], ordem: doc.ordem, publicado: true,
        });
        if (!ins2.ok) console.error(`  ✘ integração "${doc.titulo}": ${JSON.stringify(ins2.data)}`);
        else console.log(`  ✔ documentos: ${doc.titulo}`);
      }
    }
  }
  return true;
}

async function importarTreinamentos() {
  console.log("\n■ Treinamentos → portal_treinamentos_videos / portal_treinamentos_pdfs");
  if (!(await tabelaExiste("portal_treinamentos_videos"))) {
    console.log("  ⚠ Tabela portal_treinamentos_videos não existe — rode a migration 004 primeiro. PULANDO.");
    return false;
  }
  let ordem = 1;
  for (const v of TREINAMENTO_VIDEOS) {
    const url = await migrarArquivo(v.arquivo, v.destino, v.ct);
    const { data: ex } = await rest("GET", `portal_treinamentos_videos?select=id&titulo=eq.${encodeURIComponent(v.titulo)}&limit=1`);
    if (!ex?.length) {
      const ins = await rest("POST", "portal_treinamentos_videos", {
        titulo: v.titulo, descricao: v.descricao, url_video: url,
        categoria: "Santander", access_roles: ["all"], ordem: ordem++, publicado: true,
      });
      if (!ins.ok) console.error(`  ✘ vídeo "${v.titulo}": ${JSON.stringify(ins.data)}`);
      else console.log(`  ✔ vídeo: ${v.titulo}`);
    }
  }
  for (const p of TREINAMENTO_PDFS) {
    const url = await migrarArquivo(p.arquivo, p.destino, p.ct);
    const { data: ex } = await rest("GET", `portal_treinamentos_pdfs?select=id&titulo=eq.${encodeURIComponent(p.titulo)}&limit=1`);
    if (!ex?.length) {
      const ins = await rest("POST", "portal_treinamentos_pdfs", {
        titulo: p.titulo, descricao: p.descricao, url,
        categoria: "Santander", access_roles: ["all"], ordem: ordem++, publicado: true,
      });
      if (!ins.ok) console.error(`  ✘ pdf "${p.titulo}": ${JSON.stringify(ins.data)}`);
      else console.log(`  ✔ pdf: ${p.titulo}`);
    }
  }
  return true;
}

(async () => {
  console.log("Importação de conteúdo do Manus → Supabase");
  console.log("Destino:", SUPABASE_URL);
  await garantirBucket();
  await importarKB();
  const okOnb = await importarOnboarding();
  const okTrei = await importarTreinamentos();
  console.log("\n──────────────────────────────────────────");
  if (okOnb && okTrei) console.log("✅ Importação completa.");
  else console.log("⚠ Importação PARCIAL — rode a migration db/migrations/004_portal_colaborador.sql no Supabase SQL Editor e execute este script de novo.");
})();
