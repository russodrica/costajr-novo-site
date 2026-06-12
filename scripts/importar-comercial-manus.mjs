// ============================================================================
// Importa os clientes da Gestão Comercial do Manus (portalcjr.vip) para
// manut_leads. Fonte: JSON exportado pelo navegador logado
// (Downloads/manus-comercial-clientes.json — endpoint tRPC comercial.listClients).
//
// Mapeamento de etapas Manus → funil do portal:
//   contato_inicial → contato_feito | homologacao → proposta_enviada
//   retorno → negociando | homologado → negociando | cliente_ativo → convertido
//   (etapa original preservada nas observações)
//
// Idempotente (upsert por manus_id). Uso:
//   node scripts/importar-comercial-manus.mjs [caminho-do-json]
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL_SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const arquivo = process.argv[2] || "C:/Users/adriana.russo/Downloads/manus-comercial-clientes.json";
const bruto = JSON.parse(readFileSync(arquivo, "utf8"));
const clientes = Array.isArray(bruto) ? bruto : bruto.clients || [];

const MAPA_ETAPA = {
  contato_inicial: "contato_feito",
  homologacao: "proposta_enviada",
  retorno: "negociando",
  homologado: "negociando",
  cliente_ativo: "convertido",
};
const TIPO = { varejo: "Varejo", hospital: "Hospital", galpao: "Galpão", industria: "Indústria", condominio: "Condomínio" };

const rows = clientes.map((c) => ({
  manus_id: `manus-${c.id}`,
  nome: c.companyName,
  nome_loja: c.companyName,
  email: null,
  etapa: MAPA_ETAPA[c.stage] || "novo",
  tipo_cliente: TIPO[c.clientType] || c.clientType || null,
  responsavel: c.responsibleName || null,
  ultima_interacao_em: c.lastInteractionAt || null,
  origem: "Prospecção B2B (Manus)",
  observacoes: [
    `Etapa no Manus: ${c.stage}`,
    c.firstContactDate ? `1º contato: ${String(c.firstContactDate).slice(0, 10)}` : null,
    c.createdByName ? `Cadastrado por: ${c.createdByName}` : null,
    c.notes || null,
  ].filter(Boolean).join(" | "),
  created_at: c.createdAt || undefined,
}));

(async () => {
  console.log(`Importando ${rows.length} clientes da Gestão Comercial do Manus...`);
  const r = await fetch(`${URL_SB}/rest/v1/manut_leads?on_conflict=manus_id`, {
    method: "POST",
    headers: {
      apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { console.error("✘ ERRO:", r.status, (await r.text()).slice(0, 400)); process.exit(1); }
  console.log(`✅ ${rows.length} clientes sincronizados em manut_leads (idempotente por manus_id).`);
  const porEtapa = {};
  for (const x of rows) porEtapa[x.etapa] = (porEtapa[x.etapa] || 0) + 1;
  console.log("Por etapa:", JSON.stringify(porEtapa));
})();
