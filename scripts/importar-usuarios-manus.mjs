/**
 * Importa os colaboradores do sistema antigo (Manus) para o portal novo
 * (tabela portal_profiles no Supabase).
 *
 * - Idempotente: quem já existe (mesmo e-mail) é PULADO (não mexe na senha).
 * - Cada novo usuário recebe uma senha inicial aleatória e entra como
 *   "approved" com troca de senha obrigatória no 1º acesso.
 * - As senhas iniciais são gravadas em scripts/SENHAS-INICIAIS.txt
 *   (entregue a cada colaborador; ou use "Reset senha" no /admin/membros
 *   para enviar por e-mail).
 *
 * Uso (na máquina da Adriana, com internet):
 *   node scripts/importar-usuarios-manus.mjs
 *
 * Não depende de nenhuma biblioteca — usa fetch e crypto nativos do Node 18+.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

// ─── Lê o .env manualmente ────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SB_URL = env.PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("ERRO: PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
  process.exit(1);
}

// ─── Hash de senha (idêntico ao src/lib/auth.ts) ──────────────────────────
const SALT = "::cjr-manut-salt-v1";
async function hashSenha(senha) {
  const enc = new TextEncoder().encode(senha + SALT);
  const h = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function gerarSenhaInicial() {
  const letras = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const digitos = "23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += letras[Math.floor(Math.random() * letras.length)];
  for (let i = 0; i < 4; i++) s += digitos[Math.floor(Math.random() * digitos.length)];
  return s;
}

// ─── Cargos válidos no portal novo + mapeamento do antigo ─────────────────
// Antigo "administrativo" não existe mais → mapeado para "operacional".
const ROLE_VALIDAS = new Set(["admin", "coordenador", "financeiro", "comercial", "rh", "operacional"]);
function mapRole(r) {
  if (r === "administrativo") return "operacional";
  return ROLE_VALIDAS.has(r) ? r : "operacional";
}

// ─── Colaboradores exportados do Manus ────────────────────────────────────
const USUARIOS = [
  { name: "Gabrielly Lima",    email: "gabrielly.lima@costajr.com.br",    role: "operacional" },
  { name: "Samyria Almeida",   email: "samyria.almeida@costajr.com.br",   role: "coordenador" },
  { name: "Higor Pelicho",     email: "higor.pelicho@costajr.com.br",     role: "operacional" },
  { name: "Patrícia Lino",     email: "patricia.lino@costajr.com.br",     role: "administrativo" }, // → operacional
  { name: "Renata Peres",      email: "renata.peres@costajr.com.br",      role: "coordenador" },
  { name: "Aline Martiniano",  email: "aline.martiniano@costajr.com.br",  role: "financeiro" },
  { name: "Jessica Oliveira",  email: "jessica.cruz@costajr.com.br",      role: "comercial" },
  { name: "Adriana Russo",     email: "russodrica@gmail.com",             role: "operacional" },
  { name: "Costa JR",          email: "costajr@costajr.com.br",           role: "coordenador" },
  { name: "Adriana Russo",     email: "adriana@costajr.com.br",           role: "admin" },
];

const headers = {
  apikey: SB_KEY,
  Authorization: "Bearer " + SB_KEY,
  "Content-Type": "application/json",
};

async function existentes() {
  const r = await fetch(`${SB_URL}/rest/v1/portal_profiles?select=email`, { headers });
  if (!r.ok) throw new Error(`GET portal_profiles falhou: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.map((x) => String(x.email).toLowerCase()));
}

async function inserir(u, senhaHash) {
  const body = {
    email: u.email.toLowerCase().trim(),
    display_name: u.name,
    full_name: u.name,
    role: mapRole(u.role),
    approval_status: "approved",
    approved_at: new Date().toISOString(),
    senha_hash: senhaHash,
    senha_troca_obrigatoria: true,
  };
  const r = await fetch(`${SB_URL}/rest/v1/portal_profiles`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`INSERT ${u.email} falhou: ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  console.log("Conectando ao Supabase:", SB_URL);
  const jaTem = await existentes();
  const criados = [];
  const pulados = [];

  for (const u of USUARIOS) {
    const email = u.email.toLowerCase();
    if (jaTem.has(email)) {
      pulados.push(u.email);
      console.log(`[--] já existe, pulado: ${u.email}`);
      continue;
    }
    const senha = gerarSenhaInicial();
    const hash = await hashSenha(senha);
    try {
      await inserir(u, hash);
      criados.push({ nome: u.name, email: u.email, cargo: mapRole(u.role), senha });
      console.log(`[OK] criado: ${u.email} (${mapRole(u.role)}) — senha: ${senha}`);
    } catch (e) {
      console.error(`[ERRO] ${u.email}: ${e.message}`);
    }
  }

  // Grava as senhas iniciais num arquivo para a Adriana distribuir
  if (criados.length) {
    const linhas = [
      "SENHAS INICIAIS — Portal Costa Júnior (gerado em " + new Date().toLocaleString("pt-BR") + ")",
      "Entregue a cada colaborador. No 1º acesso o sistema obriga a trocar a senha.",
      "Login do portal: " + (env.SITE_BASE_URL || "https://costajr.com.br") + "/portal/login",
      "",
      ...criados.map((c) => `${c.nome}  |  ${c.email}  |  cargo: ${c.cargo}  |  senha: ${c.senha}`),
    ];
    writeFileSync(new URL("./SENHAS-INICIAIS.txt", import.meta.url), linhas.join("\n"), "utf8");
  }

  console.log("\n========================================");
  console.log(`Criados: ${criados.length} | Já existiam: ${pulados.length}`);
  if (criados.length) console.log("Senhas iniciais salvas em scripts/SENHAS-INICIAIS.txt");
  console.log("CONCLUÍDO ✔");
})().catch((e) => {
  console.error("\nFALHA GERAL:", e.message);
  process.exit(1);
});
