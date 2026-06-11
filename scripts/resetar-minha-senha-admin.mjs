/**
 * Reseta a senha de um usuário do portal (portal_profiles) para uma senha
 * temporária conhecida — útil quando você ficou sem acesso ao painel.
 *
 * Por padrão reseta adriana@costajr.com.br. Para outro e-mail:
 *   node scripts/resetar-minha-senha-admin.mjs outro.email@costajr.com.br
 *
 * Gera uma senha temporária, mostra na tela e grava em
 * scripts/SENHA-TEMPORARIA-ADMIN.txt. Use-a para entrar e depois troque.
 *
 * Não depende de bibliotecas — fetch e crypto nativos do Node 18+.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const ALVO = (process.argv[2] || "adriana@costajr.com.br").toLowerCase().trim();

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB_URL = env.PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("ERRO: faltam PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env"); process.exit(1); }

const SALT = "::cjr-manut-salt-v1";
async function hashSenha(senha) {
  const enc = new TextEncoder().encode(senha + SALT);
  const h = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function gerarSenha() {
  const L = "ABCDEFGHIJKLMNPQRSTUVWXYZ", D = "23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  for (let i = 0; i < 4; i++) s += D[Math.floor(Math.random() * D.length)];
  return s;
}

const headers = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };

(async () => {
  // Confirma que o usuário existe
  const g = await fetch(`${SB_URL}/rest/v1/portal_profiles?select=id,email,role,approval_status&email=eq.${encodeURIComponent(ALVO)}`, { headers });
  if (!g.ok) throw new Error(`Consulta falhou: ${g.status} ${await g.text()}`);
  const rows = await g.json();
  if (!rows.length) { console.error(`Usuário não encontrado: ${ALVO}`); process.exit(1); }
  const perfil = rows[0];

  const senha = gerarSenha();
  const senha_hash = await hashSenha(senha);

  // senha_troca_obrigatoria = false para entrar direto sem fluxo extra
  const u = await fetch(`${SB_URL}/rest/v1/portal_profiles?id=eq.${perfil.id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ senha_hash, senha_troca_obrigatoria: false, approval_status: "approved" }),
  });
  if (!u.ok) throw new Error(`Reset falhou: ${u.status} ${await u.text()}`);

  const txt = [
    "SENHA TEMPORÁRIA — Painel Admin Costa Júnior",
    "Gerado em: " + new Date().toLocaleString("pt-BR"),
    "Login: " + (env.SITE_BASE_URL || "https://costajr.com.br") + "/admin/login",
    "",
    `E-mail: ${perfil.email}`,
    `Cargo:  ${perfil.role}`,
    `Senha:  ${senha}`,
    "",
    "Entre com essa senha e depois troque por uma de sua preferência.",
  ].join("\n");
  writeFileSync(new URL("./SENHA-TEMPORARIA-ADMIN.txt", import.meta.url), txt, "utf8");

  console.log("========================================");
  console.log(`Senha resetada para: ${perfil.email}`);
  console.log(`NOVA SENHA TEMPORÁRIA: ${senha}`);
  console.log("Login: " + (env.SITE_BASE_URL || "https://costajr.com.br") + "/admin/login");
  console.log("(também salvo em scripts/SENHA-TEMPORARIA-ADMIN.txt)");
  console.log("CONCLUÍDO ✔");
})().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
