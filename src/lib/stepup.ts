import { supabaseAdmin } from "./supabase";
import { enviarEmailSimples } from "./mailer";

// ─── Verificação de novo dispositivo/local (step-up por OTP) ─────────────────
// Objetivo: senha clonada/roubada não basta — logar de um DISPOSITIVO novo (ou a
// cada 30 dias) exige um código enviado por e-mail. A confiança é chaveada no
// COOKIE do dispositivo (não no IP — evita falso-positivo em celular). Guardamos
// só o HASH do device. Tudo FAIL-OPEN no login (erro nunca trava o acesso) e a
// feature inteira só liga com STEPUP_ENABLED=1 (rollout seguro).

const SECRET = import.meta.env.JWT_SECRET || process.env.JWT_SECRET || "dev-secret-CHANGE-ME";
const enc = new TextEncoder();

export const TD_COOKIE = "cjr_td";
export const STEPUP_ATIVO = (import.meta.env.STEPUP_ENABLED || process.env.STEPUP_ENABLED || "") === "1";
const TRUST_DIAS = 30;
const OTP_MIN = 10;
const MAX_TENT = 5;

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(data: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function gerarCodigo(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000)); // 6 dígitos
}
export function mascararEmail(email: string): string {
  const [u, d] = String(email || "").split("@");
  if (!d) return "seu e-mail";
  const ini = u.slice(0, 1);
  return `${ini}${"*".repeat(Math.max(1, u.length - 1))}@${d}`;
}

/** Lê o td_id do cookie assinado (HMAC). Retorna null se ausente/adulterado. */
export async function lerDeviceCookie(req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)cjr_td=([^;]+)/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const tdId = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  if (!tdId || !sig) return null;
  if ((await hmacHex(tdId)) !== sig) return null;
  return tdId;
}
/** Gera um td_id novo + o valor de cookie assinado a setar. */
export async function novoDeviceCookie(): Promise<{ tdId: string; cookieValue: string }> {
  const tdId = randToken(32);
  const sig = await hmacHex(tdId);
  return { tdId, cookieValue: `${tdId}.${sig}` };
}
async function deviceHashDe(tdId: string): Promise<string> {
  return hmacHex("dh:" + tdId);
}

/** Dispositivo confiável? (linha existe, não revogada, dentro de 30 dias). */
export async function deviceConfiavel(profileId: string, tdId: string | null): Promise<boolean> {
  if (!tdId) return false;
  const db = supabaseAdmin();
  const dh = await deviceHashDe(tdId);
  const { data } = await db.from("trusted_devices").select("trusted_until, revoked_at")
    .eq("profile_id", profileId).eq("device_hash", dh).maybeSingle();
  if (!data || data.revoked_at) return false;
  return new Date(data.trusted_until).getTime() > Date.now();
}

/** Atualiza last_seen/ip de um device confiável (best-effort). */
export async function tocarDevice(profileId: string, tdId: string, ip: string, geo: string): Promise<void> {
  try {
    const db = supabaseAdmin();
    const dh = await deviceHashDe(tdId);
    await db.from("trusted_devices").update({ last_seen: new Date().toISOString(), last_ip: ip, last_geo: geo })
      .eq("profile_id", profileId).eq("device_hash", dh);
  } catch { /* best-effort */ }
}

/** Cria o desafio OTP e envia o código por e-mail. Retorna o que o front precisa. */
export async function criarDesafioOtp(args: {
  profileId: string; nome: string; email: string; tdId: string; ip: string; canalEmail?: string;
}): Promise<{ challengeId: string; canal: string; destino: string }> {
  const db = supabaseAdmin();
  const dh = await deviceHashDe(args.tdId);
  const codigo = gerarCodigo();
  const codeHash = await sha256Hex(codigo + args.profileId + SECRET);
  const destinoEmail = (args.canalEmail || args.email || "").trim();
  const destinoMasc = mascararEmail(destinoEmail);
  const expira = new Date(Date.now() + OTP_MIN * 60 * 1000).toISOString();

  const { data, error } = await db.from("login_otps").insert({
    profile_id: args.profileId, code_hash: codeHash, device_hash: dh,
    canal: "email", destino_masc: destinoMasc, expires_at: expira,
  }).select("id").single();
  if (error || !data) throw new Error("Falha ao criar desafio de verificação");

  // Envia o código (e-mail). Telegram por usuário fica como melhoria (precisa do chat privado).
  if (destinoEmail) {
    await enviarEmailSimples({
      to: destinoEmail,
      subject: `Seu código de acesso: ${codigo}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#C41E3A">Costa Júnior — verificação de acesso</h2>
        <p>Olá, ${args.nome || "colaborador"}. Detectamos um login de um <b>novo dispositivo</b>.</p>
        <p>Use este código para concluir o acesso (vale ${OTP_MIN} minutos):</p>
        <p style="font-size:30px;font-weight:bold;letter-spacing:6px;background:#f3f4f6;padding:14px;text-align:center;border-radius:8px">${codigo}</p>
        <p style="color:#6b7280;font-size:13px">Se não foi você, <b>troque sua senha</b> — alguém pode ter ela.</p>
      </div>`,
    });
  }
  return { challengeId: data.id, canal: "email", destino: destinoMasc };
}

/** Valida o código. Em sucesso, marca o dispositivo como confiável por 30 dias.
 *  Retorna { ok, profileId } ou { ok:false, erro }. */
export async function verificarOtp(challengeId: string, codigo: string, tdId: string, ip: string, geo: string, ua: string)
  : Promise<{ ok: true; profileId: string } | { ok: false; erro: string; status: number }> {
  const db = supabaseAdmin();
  const { data: ch } = await db.from("login_otps").select("*").eq("id", challengeId).maybeSingle();
  if (!ch) return { ok: false, erro: "Código inválido ou expirado.", status: 400 };
  if (ch.consumed_at) return { ok: false, erro: "Este código já foi usado.", status: 400 };
  if (new Date(ch.expires_at).getTime() < Date.now()) return { ok: false, erro: "Código expirado. Faça login de novo.", status: 400 };
  if ((ch.attempts ?? 0) >= MAX_TENT) return { ok: false, erro: "Muitas tentativas. Faça login de novo.", status: 429 };

  await db.from("login_otps").update({ attempts: (ch.attempts ?? 0) + 1 }).eq("id", challengeId);

  const dh = await deviceHashDe(tdId);
  const esperado = await sha256Hex(String(codigo || "") + ch.profile_id + SECRET);
  if (dh !== ch.device_hash || esperado !== ch.code_hash) {
    return { ok: false, erro: "Código incorreto.", status: 401 };
  }

  // sucesso: consome o desafio e confia no dispositivo por 30 dias (upsert)
  await db.from("login_otps").update({ consumed_at: new Date().toISOString() }).eq("id", challengeId);
  const trustedUntil = new Date(Date.now() + TRUST_DIAS * 24 * 60 * 60 * 1000).toISOString();
  await db.from("trusted_devices").upsert({
    profile_id: ch.profile_id, device_hash: dh, last_ip: ip, last_geo: geo, user_agent: ua.slice(0, 300),
    trusted_until: trustedUntil, revoked_at: null, last_seen: new Date().toISOString(),
  }, { onConflict: "profile_id,device_hash" });

  return { ok: true, profileId: ch.profile_id };
}
