import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(import.meta.env.JWT_SECRET || "dev-secret");
const ISSUER = "costajr.com.br";

export type ClienteClaims = { sub: string; tipo: "cliente"; email: string; troca?: boolean };
export type TecnicoClaims = { sub: string; tipo: "tecnico"; email: string; troca?: boolean };
export type AdminClaims   = { sub: string; tipo: "admin"; email: string; role: string };
export type AnyClaims = ClienteClaims | TecnicoClaims | AdminClaims;

export async function signToken(claims: AnyClaims, ttl: string = "7d"): Promise<string> {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(SECRET);
}

export async function verifyToken<T extends AnyClaims = AnyClaims>(token: string): Promise<T> {
  const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
  return payload as unknown as T;
}

// SHA-256 hash de senha com salt fixo (portado de manut.web.js)
const SALT = "::cjr-manut-salt-v1";
export async function hashSenha(senha: string): Promise<string> {
  const enc = new TextEncoder().encode(senha + SALT);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return (await hashSenha(senha)) === hash;
}

export function gerarSenhaInicial(): string {
  const letras = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const digitos = "23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += letras[Math.floor(Math.random() * letras.length)];
  for (let i = 0; i < 4; i++) s += digitos[Math.floor(Math.random() * digitos.length)];
  return s;
}

// ─── Helpers de request ────────────────────────────────────────────────────
export function getClienteToken(req: Request): string {
  return req.headers.get("x-cliente-auth") || "";
}
export function getTecnicoToken(req: Request): string {
  return req.headers.get("x-tecnico-auth") || "";
}
export function getPortalToken(req: Request): string {
  return req.headers.get("x-portal-auth") || "";
}

export async function requireCliente(req: Request): Promise<ClienteClaims> {
  const tok = getClienteToken(req);
  if (!tok) throw new Error("Não autenticado");
  const claims = await verifyToken<ClienteClaims>(tok);
  if (claims.tipo !== "cliente") throw new Error("Token inválido");
  return claims;
}

export async function requireTecnico(req: Request): Promise<TecnicoClaims> {
  const tok = getTecnicoToken(req);
  if (!tok) throw new Error("Não autenticado");
  const claims = await verifyToken<TecnicoClaims>(tok);
  if (claims.tipo !== "tecnico") throw new Error("Token inválido");
  return claims;
}

export async function requireAdmin(req: Request): Promise<AdminClaims> {
  const tok = getPortalToken(req);
  if (!tok) throw new Error("Não autenticado");
  // Bypass para desenvolvimento — header x-portal-auth: bypass
  if (tok === "bypass" && import.meta.env.ADMIN_BYPASS_KEY) {
    return { sub: "bypass-admin", tipo: "admin", email: "admin@costajr.com.br", role: "admin" };
  }
  const claims = await verifyToken<AdminClaims>(tok);
  if (claims.tipo !== "admin") throw new Error("Token inválido");
  if (!["admin","coordenador","financeiro","comercial","rh","operacional"].includes(claims.role)) {
    throw new Error("Sem permissão");
  }
  return claims;
}

// ─── Admin via cookie (páginas SSR) ──────────────────────────────────────────
export function getAdminTokenFromCookie(request: Request): string {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function requireAdminCookie(request: Request): Promise<AdminClaims> {
  const tok = getAdminTokenFromCookie(request);
  if (!tok) throw new Error("Não autenticado");
  const claims = await verifyToken<AdminClaims>(tok);
  if (claims.tipo !== "admin") throw new Error("Token inválido");
  return claims;
}

// JSON helpers
export function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
export function jsonErr(status: number, message: string, details?: unknown) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
